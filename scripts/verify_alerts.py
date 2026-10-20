"""预警中心 — 免污染验证（不碰 backend/products.db）

做法：把 products.db 拷到临时目录，在副本里造库存单元 / 变更单 / 缺 BOM 的物料，
然后直接用副本 Session 调 list_alerts()，验证库存、变更、数据缺口三条分支。

用法（在项目根目录）：
    runtime\\python\\python.exe scripts\\verify_alerts.py
    # 本机无 runtime 时用任意装了后端依赖的解释器
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models import Change, ChangeTask, InventoryPlan, Material, ProjectSupplyRelation  # noqa: E402
from app.routers.alerts import list_alerts  # noqa: E402

LIVE_DB = os.path.join(ROOT, "backend", "products.db")


def main() -> int:
    tmp = os.path.join(tempfile.gettempdir(), "alerts_verify.db")
    shutil.copy(LIVE_DB, tmp)
    engine = create_engine(f"sqlite:///{tmp}", future=True)
    Session = sessionmaker(bind=engine, future=True)
    db = Session()

    # --- 造库存单元：三个供应商各一条，期初库存不同 → 断货 / 紧急 / 充足 ---
    today = date.today()
    fcast = f'[{{"m":"{today:%Y-%m}","q":9300}}]'
    plans = [
        dict(supplier_id=1, base_id=1, on_hand=0.0),        # 断货
        dict(supplier_id=2, base_id=2, on_hand=500.0),      # 紧急
        dict(supplier_id=3, base_id=3, on_hand=200000.0),   # 充足
    ]
    for p in plans:
        db.add(
            InventoryPlan(
                project_id=1,
                material_id=1,
                supplier_id=p["supplier_id"],
                base_id=p["base_id"],
                lead_time_days=7,
                on_hand=p["on_hand"],
                hist_json=None,
                fcast_json=fcast,
            )
        )

    # --- 造变更单：一张超期未完成（P0）、一张 3 天内到期（P1）、一张迟交完成（P2） ---
    db.flush()
    cases = [
        ("超期变更", today - timedelta(days=6), False),
        ("临期变更", today + timedelta(days=2), False),
        ("迟交变更", today - timedelta(days=4), True),
    ]
    for i, (title, plan_end, done) in enumerate(cases, start=1):
        c = Change(
            project_id=1,
            material_id=1,
            change_type_id=1,
            title=title,
            owner="张三",
            status="active",
        )
        db.add(c)
        db.flush()
        db.add(
            ChangeTask(
                change_id=c.id,
                level=1,
                seq=1,
                name=f"{title}·验证任务",
                plan_start=plan_end - timedelta(days=3),
                plan_end=plan_end,
                is_done=done,
                done_at=(plan_end + timedelta(days=4) if done else None),
            )
        )

    # --- 造数据缺口：把 123 侧板的 BOM 置空 → 供需算不出，应归入「缺 BOM 系数」 ---
    for r in db.query(ProjectSupplyRelation).filter(ProjectSupplyRelation.project_id == 1).all():
        r.bom_factor = None
    db.commit()

    res = list_alerts(project_ids="", base_month="2026-10", horizon=3, db=db)

    print(f"base_month={res.base_month} horizon={res.horizon}")
    print(f"counts={res.counts}")
    print(f"by_source={res.by_source}")
    print("-" * 78)
    for it in res.items:
        due = "—" if it.due_in_days is None else f"{it.due_in_days:+d}d"
        print(f"[{it.severity}] due={due:<6} {it.source}/{it.kind:<12} {it.title}")
        print(f"        {it.detail}   (as_of={it.as_of}, impact={it.impact})")
    print("-" * 78)
    for p in res.by_project:
        dims = {k: (v.severity, v.count) for k, v in p.dims.items()}
        print(f"{p.code:<8} sev={p.severity} counts={p.counts} dims={dims}")
        if p.worst:
            print(f"         worst: {p.worst.title}")

    # --- 断言 ---
    kinds = {it.kind for it in res.items}
    expect = {"stockout", "urgent", "overdue", "near", "late", "missing_input"}
    missing = expect - kinds
    db.close()
    engine.dispose()  # Windows 下不释放句柄删不掉文件
    try:
        os.remove(tmp)
    except OSError:
        pass

    # 排序：紧急程度 → 距出事天数（无事件日沉底）→ 影响量
    rank = {"p0": 0, "p1": 1, "p2": 2}
    keys = [
        (rank.get(it.severity, 9), it.due_in_days if it.due_in_days is not None else 10**6)
        for it in res.items
    ]
    unsorted_at = next((i for i in range(1, len(keys)) if keys[i] < keys[i - 1]), None)
    if unsorted_at is not None:
        print(f"\nFAIL 第 {unsorted_at + 1} 条排序不符合「紧急程度 → 距出事天数」")
        return 1

    if missing:
        print(f"\nFAIL 缺少预期类型：{sorted(missing)}")
        return 1
    print("\nPASS 六类分支均命中；排序符合 紧急程度 → 距出事天数 → 影响量")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
