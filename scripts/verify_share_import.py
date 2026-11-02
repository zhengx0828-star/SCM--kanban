"""份额导入回归验证（临时库，不碰 backend/products.db）。

覆盖：
  1. 长表（段 + 基地 + 拉线数 + 基地份额）→ 多行聚合为一条记录、份额按拉线加权、段自动建档
  2. 同一段内某基地份额合计 ≠ 100%（容差 ±1%）→ 422
  3. 同一物料出现在两个段 → 422
  4. 文件里的段与物料主档不一致 → 422
  5. 旧宽表（基地A_份额 / 基地A_线数 成对两列）仍然兼容

用法：
    python scripts/verify_share_import.py
"""

import asyncio
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"

LONG_HEADERS = ["物料PN", "物料名称", "供应商代码", "供应商名称", "段", "基地", "拉线数", "基地份额", "本月份额", "Q", "D", "C"]
WIDE_HEADERS = ["物料PN", "物料名称", "供应商代码", "供应商名称", "本月系统份额", "Q", "D", "C", "基地A份额", "基地A条数", "基地B份额", "基地B条数"]

LONG_OK = [
    ("123", "侧板", "1341", "KL", "模组", "基地A", 2, 50, None, 0.7, 1, 1),
    ("123", "侧板", "1341", "KL", "模组", "基地B", 5, 80, None, 0.7, 1, 1),
    ("123", "侧板", "1245", "XS", "模组", "基地A", 2, 50, None, 1, 1, 0.7),
    ("123", "侧板", "1245", "XS", "模组", "基地B", 5, 20, None, 1, 1, 0.7),
]
LONG_BAD_BASE_SUM = [
    ("123", "侧板", "1341", "KL", "模组", "基地A", 2, 50, None, 0.7, 1, 1),
    ("123", "侧板", "1245", "XS", "模组", "基地A", 2, 40, None, 1, 1, 0.7),
]
LONG_CROSS_SEG = [
    ("123", "侧板", "1341", "KL", "模组", "基地A", 2, 100, None, 0.7, 1, 1),
    ("123", "侧板", "1341", "KL", "电芯", "基地C", 3, 100, None, 0.7, 1, 1),
]
WIDE_OK = [
    ("123", "侧板", "1341", "KL", 0.71, 0.7, 1, 1, 0.5, 2, 0.8, 5),
    ("123", "侧板", "1245", "XS", 0.14, 1, 1, 0.7, 0, 2, 0.2, 5),
    ("123", "侧板", "4532", "KDL", 0.14, 1, 1, 0.7, 0.5, 2, 0, 5),
]


def build_xlsx(rows: list[tuple], headers: list[str]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def make_request(content: bytes):
    from starlette.requests import Request

    async def receive():
        return {"type": "http.request", "body": content, "more_body": False}

    return Request({"type": "http", "method": "POST", "headers": []}, receive)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="scm_share_verify_"))
    shutil.copytree(BACKEND / "app", tmp / "app", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(BACKEND / "products.db", tmp / "products.db")
    sys.path.insert(0, str(tmp))

    from sqlalchemy import select

    from app.database import Base, SessionLocal, engine
    from app.migrations import run_migrations
    from app.models import Material, ShareRecord, SupplyRelation
    from app.routers.share import import_share_records

    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    print(f"临时库：{tmp}")

    passed = failed = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f"  [PASS] {name}")
        else:
            failed += 1
            print(f"  [FAIL] {name} {detail}")

    def run(rows, headers, month="2026-12"):
        db = SessionLocal()
        try:
            return asyncio.run(
                import_share_records(
                    make_request(build_xlsx(rows, headers)),
                    project_id=1,
                    month=month,
                    file_path=None,
                    db=db,
                )
            )
        finally:
            db.close()

    def expect_error(rows, headers, fragment: str, month="2026-12") -> tuple[bool, str]:
        from fastapi import HTTPException

        try:
            run(rows, headers, month)
            return False, "未抛异常"
        except HTTPException as exc:
            detail = str(exc.detail)
            return fragment in detail, detail[:200]

    def records(month="2026-12"):
        db = SessionLocal()
        try:
            rows = db.execute(
                select(ShareRecord)
                .join(SupplyRelation)
                .where(ShareRecord.month == month)
                .order_by(ShareRecord.id)
            ).scalars().all()
            return [
                {
                    "pn": r.supply_relation.material.pn,
                    "code": r.supply_relation.supplier.code,
                    "share": r.share_current,
                    "bases": json.loads(r.bases) if r.bases else [],
                    "quota": r.quota_suggested,
                }
                for r in rows
            ]
        finally:
            db.close()

    print("\n[1] 长表：模组段两基地两家供应商")
    res = run(LONG_OK, LONG_HEADERS)
    check("导入 2 条记录", res.imported == 2, f"imported={res.imported} errors={res.errors}")
    recs = {r["code"]: r for r in records()}
    kl = recs.get("1341", {})
    check("KL 聚合 2 个基地", len(kl.get("bases", [])) == 2, str(kl.get("bases")))
    check("KL 基地A = 50% / 2 线", any(b["base"] == "基地A" and b["share"] == 50 and b["lines"] == 2 for b in kl.get("bases", [])), str(kl.get("bases")))
    check("KL 本月系统份额 = 71.43（加权）", kl.get("share") == 71.43, f"share={kl.get('share')}")
    check("XS 本月系统份额 = 28.57", recs.get("1245", {}).get("share") == 28.57, f"share={recs.get('1245', {}).get('share')}")
    check("两家建议配额合计 = 100", sum(r["quota"] or 0 for r in recs.values()) == 100, str([r["quota"] for r in recs.values()]))

    db = SessionLocal()
    try:
        seg = db.execute(select(Material.segment).where(Material.pn == "123")).scalar_one()
    finally:
        db.close()
    check("段自动建档到物料主档 = 模组", seg == "模组", f"segment={seg}")

    print("\n[2] 基地份额合计 90% → 拦截")
    ok, detail = expect_error(LONG_BAD_BASE_SUM, LONG_HEADERS, "基地份额合计")
    check("报「基地份额合计 ≠ 100%」", ok, detail)

    print("\n[3] 同一物料在一个文件里跨两段 → 拦截")
    # 第一行会把「模组」写进物料主档，第二行的「电芯」随即撞上主档一致性检查，
    # 报错落在「一个物料只能属于一个段」——比笼统的「跨段」更具体，故断言这句。
    ok, detail = expect_error(LONG_CROSS_SEG, LONG_HEADERS, "一个物料只能属于一个段")
    check("报「一个物料只能属于一个段」", ok, detail)

    print("\n[4] 文件段与物料主档冲突 → 拦截")
    conflict = [("123", "侧板", "1341", "KL", "电芯", "基地A", 2, 100, None, 0.7, 1, 1)]
    ok, detail = expect_error(conflict, LONG_HEADERS, "一个物料只能属于一个段")
    check("报「一个物料只能属于一个段」", ok, detail)

    print("\n[5] 旧宽表仍然兼容")
    res = run(WIDE_OK, WIDE_HEADERS, month="2026-13")  # 用另一月份避免覆盖
    check("宽表导入 3 条", res.imported == 3, f"imported={res.imported} errors={res.errors}")
    wide = {r["code"]: r for r in records("2026-13")}
    check("宽表 KL 系统份额 = 71", wide.get("1341", {}).get("share") == 71, str(wide.get("1341")))

    print(f"\n结果：{passed} 通过 / {failed} 失败")
    shutil.rmtree(tmp, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
