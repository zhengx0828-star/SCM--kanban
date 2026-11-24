"""从项目移除物料的批量接口 · 免污染验证（13 条断言）。

做法：把 `backend/app` + `products.db` 拷到系统临时目录，用 `SCM_DB_PATH` 指向副本，
在副本里补夹具（新物料 + 新供应商 + 明细），再直接调路由函数断言：
删对了、没误删、主数据没动、重复删报 404。

用法（在项目根）：python scripts/verify_remove_project_materials.py
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "backend"
TMP = Path(tempfile.mkdtemp(prefix="scm_rm_mat_"))
shutil.copytree(ROOT / "app", TMP / "app", ignore=shutil.ignore_patterns("__pycache__"))
shutil.copy(ROOT / "products.db", TMP / "products.db")

import os  # noqa: E402

os.environ["SCM_DB_PATH"] = str(TMP / "products.db")
sys.path.insert(0, str(TMP))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Material,
    ProjectDemandVersion,
    ProjectSupplyRelation,
    Supplier,
    SupplyRelation,
)
from app.routers.projects import remove_project_materials  # noqa: E402
from app.schemas import ProjectMaterialRemoveInput  # noqa: E402

ok = 0
fail = []


def check(name, cond, extra=""):
    global ok
    if cond:
        ok += 1
        print(f"  PASS {name} {extra}")
    else:
        fail.append(name)
        print(f"  FAIL {name} {extra}")


def counts(db):
    return {
        "links": db.execute(select(func.count()).select_from(ProjectSupplyRelation)).scalar_one(),
        "materials": db.execute(select(func.count()).select_from(Material)).scalar_one(),
        "relations": db.execute(select(func.count()).select_from(SupplyRelation)).scalar_one(),
        "versions": db.execute(select(func.count()).select_from(ProjectDemandVersion)).scalar_one(),
    }


def project_link_count(db, pid):
    return db.execute(
        select(func.count()).select_from(ProjectSupplyRelation).where(ProjectSupplyRelation.project_id == pid)
    ).scalar_one()


db = SessionLocal()

# ---- 选一个已有明细的项目，补一条夹具明细（同项目另一个物料 + 一家新供应商） ----
pid = db.execute(select(ProjectSupplyRelation.project_id).limit(1)).scalars().one()
existing_pn = db.execute(
    select(Material.pn)
    .join(SupplyRelation, SupplyRelation.material_id == Material.id)
    .join(ProjectSupplyRelation, ProjectSupplyRelation.supply_relation_id == SupplyRelation.id)
    .where(ProjectSupplyRelation.project_id == pid)
    .limit(1)
).scalars().one()

fix_mat = Material(pn="VERIFY-PN-001", name="验证物料")
fix_sup = Supplier(code="VERIFY-SUP-001", name="验证供应商")
db.add_all([fix_mat, fix_sup])
db.flush()
fix_rel = SupplyRelation(material_id=fix_mat.id, supplier_id=fix_sup.id)
db.add(fix_rel)
db.flush()
db.add(
    ProjectSupplyRelation(
        project_id=pid,
        supply_relation_id=fix_rel.id,
        capacity=json.dumps([100.0] * 12),
        bom_factor=2.0,
        demand=json.dumps([1000.0] * 12),
    )
)
db.commit()

print(f"项目 {pid}：已有物料 {existing_pn}，补入夹具 {fix_mat.pn}（1 条明细）")

before = counts(db)
before_proj = project_link_count(db, pid)
before_other = before["links"] - before_proj

res = remove_project_materials(pid, ProjectMaterialRemoveInput(pns=[fix_mat.pn]), db)
after = counts(db)

check("removed_materials = 1", res.removed_materials == 1, f"got {res.removed_materials}")
check("removed_links = 1", res.removed_links == 1, f"got {res.removed_links}")
check("pns 只含被移除的 PN", res.pns == [fix_mat.pn], f"got {res.pns}")
check("项目明细少 1 行", before_proj - project_link_count(db, pid) == 1)
check("其他项目的明细一行没动", before["links"] - before_proj == before_other)
check("物料主数据没删", after["materials"] == before["materials"], f"{before['materials']} → {after['materials']}")
check("供应关系主数据没删", after["relations"] == before["relations"])
check("需求版本没删", after["versions"] == before["versions"])
check(
    "同项目其它物料还在",
    db.execute(
        select(func.count())
        .select_from(ProjectSupplyRelation)
        .join(SupplyRelation, ProjectSupplyRelation.supply_relation_id == SupplyRelation.id)
        .join(Material, SupplyRelation.material_id == Material.id)
        .where(ProjectSupplyRelation.project_id == pid, Material.pn == existing_pn)
    ).scalar_one()
    > 0,
)

# ---- 批量：再补两个物料，一次移除两个（含重复 PN） ----
for i in (2, 3):
    m = Material(pn=f"VERIFY-PN-00{i}", name=f"验证物料{i}")
    db.add(m)
    db.flush()
    r = SupplyRelation(material_id=m.id, supplier_id=fix_sup.id)
    db.add(r)
    db.flush()
    db.add(ProjectSupplyRelation(project_id=pid, supply_relation_id=r.id, capacity=json.dumps([1.0] * 12)))
db.commit()

res2 = remove_project_materials(
    pid, ProjectMaterialRemoveInput(pns=["VERIFY-PN-002", "VERIFY-PN-003", "VERIFY-PN-002"]), db
)
check("批量移除 2 个物料", res2.removed_materials == 2, f"got {res2.removed_materials}")
check("重复 PN 不重复计数", res2.removed_links == 2, f"got {res2.removed_links}")

# ---- 边界：重复删 / 项目不存在 ----
try:
    remove_project_materials(pid, ProjectMaterialRemoveInput(pns=[fix_mat.pn]), db)
    check("重复移除报 404", False, "没有抛异常")
except HTTPException as e:
    check("重复移除报 404", e.status_code == 404, f"got {e.status_code}")

try:
    remove_project_materials(999999, ProjectMaterialRemoveInput(pns=["X"]), db)
    check("项目不存在报 404", False, "没有抛异常")
except HTTPException as e:
    check("项目不存在报 404", e.status_code == 404, f"got {e.status_code}")

db.close()
shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{ok} passed, {len(fail)} failed")
if fail:
    print("FAILED:", fail)
    sys.exit(1)
