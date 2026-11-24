"""补库存（inventory_plans）与变更（changes/change_tasks）演示数据。

目标：让「库存管理」「变更管理」两个模块有数据可呈现，且带动 Dashboard 的
「库存<3 天」「变更进行中」两卡与风险矩阵。

口径：
- 库存 DOH 档位（后端 _doh_bucket_of）：stockout / urgent / low / ok，本脚本按
  on_hand 占月需求的比重分四档造，让首页有「库存<3 天」预警。
- 变更任务五色（后端 _task_state）：todo / soon / overdue / done / late，
  本脚本 5 张单覆盖全五色，让燃尽图/甘特图/预警表都有内容。
幂等：按 UNIQUE 键查重，重复则跳过。
"""
import json
import os
import sys
from datetime import date, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app import models as m  # noqa: E402

TODAY = date(2026, 11, 24)


def d(o):
    return date.fromisoformat(o) if isinstance(o, str) else o


def dt(o):
    return datetime.fromisoformat(o) if isinstance(o, str) else o


def mean12(raw):
    try:
        vals = json.loads(raw) if raw else []
        return sum(vals) / len(vals) if vals else 0.0
    except Exception:
        return 0.0


def seed_change_types(db):
    want = ["供应商切换", "成本优化", "产能爬坡"]
    added = 0
    for name in want:
        if db.query(m.ChangeType).filter(m.ChangeType.name == name).first():
            continue
        db.add(m.ChangeType(name=name, sort_order=len(want) + 1))
        added += 1
    db.flush()  # 确保后续 seed_changes 能查到新类型
    return added


def get_ids(db):
    mat = {x.pn: x.id for x in db.query(m.Material).all()}
    sup = {x.code: x.id for x in db.query(m.Supplier).all()}
    proj = {x.code: x.id for x in db.query(m.Project).all()}
    ctype = {x.name: x.id for x in db.query(m.ChangeType).all()}
    return mat, sup, proj, ctype


def seed_changes(db):
    mat, sup, proj, ctype = get_ids(db)
    # (项目, 物料pn, 类型, 供应商code|None, 负责人, 标题, status, 任务列表)
    # 任务：(name, owner, plan_start, plan_end, is_done, done_at|None)
    plans = [
        (
            "ABC", "123", "设计变更", "1341", "张工", "侧板减重设计变更", "active",
            [
                ("模具方案评审", "张工", "2026-11-05", "2026-11-12", True, "2026-11-11"),
                ("样件试制", "李工", "2026-11-13", "2026-11-20", True, "2026-11-23"),
                ("小批量验证", "王工", "2026-11-13", "2026-11-18", False, None),
                ("产线切换", "张工", "2026-11-26", "2026-12-05", False, None),
            ],
        ),
        (
            "ABC", "E-01", "供应商切换", "S009", "刘工", "电芯二供导入", "active",
            [
                ("新供应商打样", "刘工", "2026-11-10", "2026-11-22", True, "2026-11-20"),
                ("样品测试", "陈工", "2026-11-23", "2026-11-26", False, None),
                ("切换审批", "刘工", "2026-11-27", "2026-12-03", False, None),
            ],
        ),
        (
            "BBC", "DB-01", "成本优化", "S007", "赵工", "端板成本优化谈判", "active",
            [
                ("成本核算", "赵工", "2026-11-15", "2026-11-25", True, "2026-11-24"),
                ("谈判降价", "赵工", "2026-11-26", "2026-12-08", False, None),
                ("合同更新", "钱工", "2026-12-09", "2026-12-15", False, None),
            ],
        ),
        (
            "BBC", "JG-02", "设计变更", "S013", "孙工", "下箱体结构定型", "done",
            [
                ("结构评审", "孙工", "2026-10-20", "2026-10-28", True, "2026-10-26"),
                ("图纸更新", "周工", "2026-10-29", "2026-11-05", True, "2026-11-03"),
                ("设计发布", "孙工", "2026-11-06", "2026-11-10", True, "2026-11-09"),
            ],
        ),
        (
            "ABC", "BMS-01", "供应商切换", "S014", "吴工", "BMS 主控板供应商切换", "active",
            [
                ("市场寻源", "吴工", "2026-11-01", "2026-11-15", True, "2026-11-18"),
                ("供应商审核", "郑工", "2026-11-16", "2026-11-25", False, None),
                ("价格谈判", "吴工", "2026-11-18", "2026-11-22", False, None),
                ("正式切换", "吴工", "2026-12-01", "2026-12-15", False, None),
            ],
        ),
    ]
    added_chg = 0
    added_task = 0
    for pcode, pn, tname, scode, owner, title, status, tasks in plans:
        pid = proj.get(pcode)
        mid = mat.get(pn)
        tid = ctype.get(tname)
        sid = sup.get(scode) if scode else None
        if not (pid and mid and tid):
            continue
        exist = (
            db.query(m.Change)
            .filter(m.Change.project_id == pid, m.Change.material_id == mid, m.Change.title == title)
            .first()
        )
        if exist:
            continue
        starts = [d(x[2]) for x in tasks]
        ends = [d(x[3]) for x in tasks]
        chg = m.Change(
            project_id=pid, material_id=mid, change_type_id=tid, supplier_id=sid,
            title=title, owner=owner, status=status,
            plan_start=min(starts), plan_end=max(ends),
            completed_at=dt("2026-11-24T10:00:00") if status == "done" else None,
        )
        db.add(chg)
        db.flush()
        added_chg += 1
        for seq, (tname2, towner, ts, te, done, done_at) in enumerate(tasks, start=1):
            db.add(
                m.ChangeTask(
                    change_id=chg.id, parent_id=None, level=1, seq=seq,
                    name=tname2, owner=towner,
                    plan_start=d(ts), plan_end=d(te),
                    is_done=done, done_at=dt(done_at) if done_at else None,
                )
            )
            added_task += 1
    return added_chg, added_task


def seed_inventory(db):
    # 取项目挂载的供应关系（项目×物料×供应商），每个配一个基地，造库存单元
    links = db.query(m.ProjectSupplyRelation).order_by(m.ProjectSupplyRelation.id).all()
    bases = db.query(m.BaseSite).order_by(m.BaseSite.id).all()
    if not bases:
        return 0
    added = 0
    for i, link in enumerate(links):
        rel = db.get(m.SupplyRelation, link.supply_relation_id)
        if not rel:
            continue
        base = bases[i % len(bases)]
        exist = (
            db.query(m.InventoryPlan)
            .filter(
                m.InventoryPlan.project_id == link.project_id,
                m.InventoryPlan.material_id == rel.material_id,
                m.InventoryPlan.supplier_id == rel.supplier_id,
                m.InventoryPlan.base_id == base.id,
            )
            .first()
        )
        if exist:
            continue
        monthly = mean12(link.demand)
        # 四档：断货 / 紧急 / 偏低 / 充足（按 on_hand 占月需求比重）
        bucket = i % 4
        if bucket == 0:
            on_hand = 0.0
        elif bucket == 1:
            on_hand = round(monthly * 0.07, 0)  # ~2 天量 → urgent
        elif bucket == 2:
            on_hand = round(monthly * 0.15, 0)  # ~4.5 天量 → low
        else:
            on_hand = round(monthly * 0.55, 0)  # ~16 天量 → ok
        lead_time = 5 + (i % 5) * 2  # 5/7/9/11/13
        db.add(
            m.InventoryPlan(
                project_id=link.project_id,
                material_id=rel.material_id,
                supplier_id=rel.supplier_id,
                base_id=base.id,
                lead_time_days=lead_time,
                on_hand=on_hand,
            )
        )
        added += 1
    return added


def main():
    db = SessionLocal()
    try:
        n_type = seed_change_types(db)
        n_chg, n_task = seed_changes(db)
        n_inv = seed_inventory(db)
        db.commit()
        print(f"变更类型 +{n_type}，变更单 +{n_chg}，任务 +{n_task}，库存单元 +{n_inv}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
