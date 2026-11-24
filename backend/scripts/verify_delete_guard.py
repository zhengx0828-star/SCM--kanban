"""临时验证：删项目/物料/供应商不得连带销毁细分评价与红黄牌（跑完即删）。

用法（backend 目录）：
    <python> ../scripts/_tmp/verify_delete_guard.py
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

tmp_db = BACKEND.parent / "runtime" / "_verify_delete_guard.db"
tmp_db.parent.mkdir(exist_ok=True)
shutil.copy(BACKEND / "products.db", tmp_db)
os.environ["SCM_DB_PATH"] = str(tmp_db)
for key in ("SCM_DB_URL", "SCM_MYSQL_HOST"):
    os.environ.pop(key, None)

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Material,
    Project,
    Supplier,
    SupplierCard,
    SupplierSegment,
    SupplyRelation,
    ProjectSupplyRelation,
)

FAILS = []


def check(name: str, cond: bool, extra: str = "") -> None:
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        FAILS.append(name)


with TestClient(app, raise_server_exceptions=False) as client:
    db = SessionLocal()
    try:
        p = Project(code="ZZ-VERIFY-1", name="删项目保护验证")
        m = Material(pn="ZZ-PN-VERIFY", name="验证物料")
        s = Supplier(code="ZZ-SUP-VERIFY", name="验证供应商")
        db.add_all([p, m, s])
        db.flush()

        rel = SupplyRelation(material_id=m.id, supplier_id=s.id)
        db.add(rel)
        db.flush()
        db.add(ProjectSupplyRelation(project_id=p.id, supply_relation_id=rel.id))
        db.add(SupplierSegment(period="2026-11", material_id=m.id, supplier_id=s.id, cap_filled=6, will_filled=6))
        db.add(
            SupplierCard(
                supplier_id=s.id,
                card="red",
                reason="验证用",
                effective_from=__import__("datetime").date(2026, 11, 1),
            )
        )
        db.commit()
        pid, mid, sid = p.id, m.id, s.id
    finally:
        db.close()

    r = client.delete(f"/api/projects/{pid}")
    check("删项目返回 204", r.status_code == 204, f"status={r.status_code}")

    db = SessionLocal()
    try:
        m_alive = db.get(Material, mid) is not None
        s_alive = db.get(Supplier, sid) is not None
        seg_alive = (
            db.query(SupplierSegment).filter(SupplierSegment.supplier_id == sid).count() == 1
        )
        card_alive = db.query(SupplierCard).filter(SupplierCard.supplier_id == sid).count() == 1
    finally:
        db.close()

    check("物料未被连带删除", m_alive)
    check("供应商未被连带删除", s_alive)
    check("细分评价仍在（12 项档位）", seg_alive)
    check("红黄牌仍在", card_alive)

    # ---- 直接删物料 / 供应商应被 409 拦下 ----
    r = client.delete(f"/api/materials/{mid}")
    check("删物料被 409 拦下", r.status_code == 409, f"status={r.status_code}")
    r = client.delete(f"/api/suppliers/{sid}")
    check("删供应商被 409 拦下", r.status_code == 409, f"status={r.status_code}")

    # ---- 清理验证数据 ----
    db = SessionLocal()
    try:
        db.query(SupplierCard).filter(SupplierCard.supplier_id == sid).delete()
        db.query(SupplierSegment).filter(SupplierSegment.supplier_id == sid).delete()
        db.query(SupplyRelation).filter(SupplyRelation.supplier_id == sid).delete()
        db.commit()
        db.delete(db.get(Material, mid))
        db.delete(db.get(Supplier, sid))
        db.commit()
    finally:
        db.close()

print("\n" + ("全部通过" if not FAILS else f"失败 {len(FAILS)} 条：{FAILS}"))
sys.exit(1 if FAILS else 0)
