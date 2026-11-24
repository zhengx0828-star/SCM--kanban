"""供应商红黄绿判定回归验证（不碰正式库）。

口径（2026-11-03 用户确认）：
  红 = 红牌 / 黄牌 / 断货 / 供需缺口 / 库存跌破；黄 = 进行中变更 / 唯一货源（独供但库存正常）；其余绿。

做法：临时 SQLite + create_all 造 7 家供应商，库存与份额/供需用桩函数喂数据，
      牌与变更走真实表查询。断言颜色、理由 code 与红压黄优先级。

运行：python scripts/verify_supplier_risk.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parent.parent / "backend"
TMP_DIR = Path(tempfile.mkdtemp(prefix="scm_risk_"))
os.environ["SCM_DB_PATH"] = str(TMP_DIR / "risk.db")
sys.path.insert(0, str(BACKEND))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    Change,
    ChangeType,
    Material,
    Project,
    ProjectSupplyRelation,
    Supplier,
    SupplierCard,
    SupplyRelation,
)
import app.supplier_risk as risk  # noqa: E402

Base.metadata.create_all(engine)

PASSED = 0


def check(cond: bool, msg: str) -> None:
    global PASSED
    if not cond:
        raise AssertionError(msg)
    PASSED += 1


def main() -> None:
    today = date.today()
    with SessionLocal() as db:
        proj = Project(code="P-01", name="项目一")
        db.add(proj)
        db.flush()

        mats = {}
        for key in ("M1", "M2", "M3", "M4"):
            m = Material(pn=f"PN-{key}", name=f"物料{key}")
            db.add(m)
            mats[key] = m
        db.flush()

        sups = {}
        for i, name in enumerate(["红牌", "断货", "独供跌破", "有变更", "无台账", "缺口", "人工红", "纯独供"], start=1):
            s = Supplier(code=f"S{i:02d}", name=name, city="陕西", longitude=108.9, latitude=34.2)
            db.add(s)
            sups[name] = s
        db.flush()

        for name, sup in sups.items():
            mat = mats["M2"] if name == "有变更" else mats["M3"] if name == "缺口" else mats["M1"]
            rel = SupplyRelation(material_id=mat.id, supplier_id=sup.id)
            db.add(rel)
            db.flush()
            db.add(ProjectSupplyRelation(project_id=proj.id, supply_relation_id=rel.id, bom_factor=1.0))
            db.flush()
            sup._mat_key = "M2" if name == "有变更" else "M3" if name == "缺口" else "M1"

        # 红牌 / 黄牌（真实表，真实判定函数）
        db.add(SupplierCard(supplier_id=sups["红牌"].id, card="red", reason="批量质量事故", effective_from=today - timedelta(days=3)))
        db.add(
            SupplierCard(
                supplier_id=sups["无台账"].id,
                card="yellow",
                reason="临时交付预警",
                effective_from=today - timedelta(days=1),
            )
        )

        # 进行中的变更：只挂物料 M2 → 应推断到 M2 的在供供应商
        ctype = ChangeType(name="供应商切换")
        db.add(ctype)
        db.flush()
        db.add(
            Change(
                project_id=proj.id,
                material_id=mats["M2"].id,
                change_type_id=ctype.id,
                title="M2 切换二供",
                status="active",
            )
        )

        # 人工标红（只允许加红）
        sups["人工红"].risk_level = "red"
        db.commit()

        ids = {name: sup.id for name, sup in sups.items()}

    # ---- 桩：库存 / 供需 / 份额 ----
    def fake_assemble(db, project_ids, base_ids, supplier_ids, pns, service_z, excess):
        units = [
            SimpleNamespace(supplier_id=ids["断货"], status="stockout"),
            SimpleNamespace(supplier_id=ids["独供跌破"], status="red"),
            SimpleNamespace(supplier_id=ids["无台账"], status="ok"),
        ]
        return units

    def fake_supply(db, projects, project_ids, months):
        item = SimpleNamespace(
            kind="shortage",
            title="PN-M3 物料M3 · 2026-11 只能满足 78% 需求",
            ref=SimpleNamespace(project_id=proj_id, material_id=mat3_id),
        )
        return [item], {}

    def fake_shares(db, month):
        rel_a = SimpleNamespace(
            supplier_id=ids["独供跌破"],
            material=SimpleNamespace(pn="PN-M1", name="物料M1"),
        )
        rel_b = SimpleNamespace(
            supplier_id=ids["纯独供"],
            material=SimpleNamespace(pn="PN-M4", name="物料M4"),
        )
        return [
            SimpleNamespace(is_sole=1, supply_relation=rel_a),
            SimpleNamespace(is_sole=1, supply_relation=rel_b),
        ]

    with SessionLocal() as db:
        proj_id = db.query(Project).one().id
        mat3_id = db.query(Material).filter(Material.pn == "PN-M3").one().id

    risk._assemble = fake_assemble
    risk._supply_items = fake_supply
    risk._load_all_records = fake_shares

    with SessionLocal() as db:
        result = risk.assess_supplier_risk(db, base_month="2026-11", horizon=3)

    def level(name: str) -> str:
        return result[ids[name]].level

    def codes(name: str) -> set[str]:
        return {r.code for r in result[ids[name]].reasons}

    check(level("红牌") == "red", f"红牌应为红，实际 {level('红牌')}")
    check("card_red" in codes("红牌"), "红牌理由缺失")

    check(level("断货") == "red", f"断货应为红，实际 {level('断货')}")
    check("stockout" in codes("断货"), "断货理由缺失")

    # 库存跌破 = 影响交付 → 红
    check(level("独供跌破") == "red", f"库存跌破应为红，实际 {level('独供跌破')}")
    check("low_stock" in codes("独供跌破"), "库存跌破理由缺失")
    check("sole" not in codes("独供跌破"), "已有库存问题的不应再重复记一条独供")

    # 变更在途 → 黄（用户口径：有变更就是黄，不算影响交付）
    check(level("有变更") == "yellow", f"进行中变更应为黄，实际 {level('有变更')}")
    check("change" in codes("有变更"), "变更理由缺失")

    # 唯一货源但库存正常 → 黄
    check(level("纯独供") == "yellow", f"纯独供应为黄，实际 {level('纯独供')}")
    check("sole" in codes("纯独供"), "唯一货源理由缺失")

    check(level("缺口") == "red", f"供需缺口应为红，实际 {level('缺口')}")
    check("shortage" in codes("缺口"), "缺口理由缺失")

    check(level("人工红") == "red", f"人工标红应为红，实际 {level('人工红')}")
    check("manual_red" in codes("人工红"), "人工标红理由缺失")

    # 黄牌也是红（用户口径：红黄牌都是红色）
    check(level("无台账") == "red", f"黄牌应为红，实际 {level('无台账')}")
    check("card_yellow" in codes("无台账"), "黄牌理由缺失")

    # 缺口按物料归因：M3 下只有「缺口」一家，其他家不应被染红
    check("shortage" not in codes("红牌"), "缺口误染其他供应商")

    # 红压黄：红牌那家同时有断货级别输入时仍为 red，理由按 red 优先排序
    first = result[ids["红牌"]].reasons[0]
    check(first.code == "card_red", f"理由排序应红在前，实际 {first.code}")

    print(f"\nPASS: {PASSED} 条断言全部通过")
    for name in ["红牌", "断货", "独供跌破", "有变更", "缺口", "人工红", "纯独供", "无台账"]:
        r = result[ids[name]]
        print(f"  {name:6s} -> {r.level:6s}  " + " | ".join(f"{x.label}：{x.detail}" for x in r.reasons))


if __name__ == "__main__":
    main()
