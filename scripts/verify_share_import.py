"""份额导入回归验证（临时库，不碰 backend/products.db）。

覆盖：
  1. 长表（段 + 基地 + 拉线数 + 基地份额）→ 多行聚合为一条记录、份额按拉线加权、段自动建档
  2. 同一段内某基地份额合计 ≠ 100%（容差 ±1%）→ 422
  3. 同一物料出现在两个段 → 422
  4. 文件里的段与物料主档不一致 → 422
  5. 旧宽表（基地A_份额 / 基地A_线数 成对两列）仍然兼容
  6. 多块表头上下堆叠（块1 基地A/B、块2 基地C/D），且 PN / 供应商代码不在主档 → 自动建档并挂项目
  7. 基地列缺「A拉线数」→ 报表头级错误（不再把第二块表头当数据行报「未找到供应关系」）

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
                    "pid": r.project_id,
                    "pn": r.supply_relation.material.pn,
                    "code": r.supply_relation.supplier.code,
                    "share": r.share_current,
                    "bases": json.loads(r.bases) if r.bases else [],
                    "quota": r.quota_suggested,
                    "c": r.c_score,
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

    def build_stacked(b1, h1, b2, h2) -> bytes:
        """两块表头上下堆叠（客户 ERP 导出：模组段一块、电芯段一块，基地列还不一样）。"""
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.append(h1)
        for r in b1:
            ws.append(list(r))
        ws.append([])
        ws.append(h2)
        for r in b2:
            ws.append(list(r))
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def run_bytes(content: bytes, month: str):
        db = SessionLocal()
        try:
            return asyncio.run(
                import_share_records(
                    make_request(content), project_id=1, month=month, file_path=None, db=db
                )
            )
        finally:
            db.close()

    print("\n[6] 多块表头堆叠 + 主数据缺失自动建档")
    h1 = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "A条数", "B份额", "B条数"]
    h2 = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "C份额", "C条数", "D份额", "D条数"]
    b1 = [
        ("9001", "端板", "XJ", "34567", 0.1, 1, 1, 1, 0.5, 2, 0.1, 2),
        ("9001", "端板", "KDL", "89866", 0.9, 1, 1, 1, 0.5, 2, 0.9, 2),
    ]
    b2 = [
        ("9002", "侧板", "AD", "7575", 0.3, 1, 1, 1, 0.2, 1, 0.5, 1),
        ("9002", "侧板", "WD", "32323", 0.7, 0.7, 1, 1, 0.8, 1, 0.5, 1),
    ]
    res = run_bytes(build_stacked(b1, h1, b2, h2), month="2026-14")
    check("两块表头共导 4 条", res.imported == 4, f"imported={res.imported} errors={res.errors}")
    check("自动建 2 个物料", res.created_materials == 2, f"created_materials={res.created_materials}")
    check("自动建 4 个供应商", res.created_suppliers == 4, f"created_suppliers={res.created_suppliers}")
    check("自动挂 4 条项目明细", res.created_links == 4, f"created_links={res.created_links}")
    stacked = {r["code"]: r for r in records("2026-14")}
    check("块1 份额 10 / 90", stacked.get("34567", {}).get("share") == 10 and stacked.get("89866", {}).get("share") == 90,
          str({k: v["share"] for k, v in stacked.items()}))
    check("块1 基地按 A / B 解析", [b["base"] for b in stacked.get("34567", {}).get("bases", [])] == ["A", "B"],
          str(stacked.get("34567", {}).get("bases")))
    check("块2 基地按 C / D 解析（不受块1 列号影响）",
          [b["base"] for b in stacked.get("7575", {}).get("bases", [])] == ["C", "D"],
          str(stacked.get("7575", {}).get("bases")))
    check("块2 份额 30 / 70", stacked.get("7575", {}).get("share") == 30 and stacked.get("32323", {}).get("share") == 70,
          str({k: v["share"] for k, v in stacked.items()}))

    print("\n[7] 基地列缺一列（A份额 + B条数 笔误）→ 报表头错误")
    typo = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "B条数", "B份额", "B条数"]
    from fastapi import HTTPException

    try:
        run_bytes(build_stacked(b1, typo, [], typo), month="2026-15")
        check("报「缺少 A拉线数」", False, "未抛异常")
    except HTTPException as exc:
        detail = str(exc.detail)
        check("报「缺少 A拉线数」", "缺少「A拉线数」列" in detail, detail[:200])

    print("\n[8] 同一物料跨多个基地、各基地供应商组合不同（本月份额留空）")
    # 基地A(2线)：XJ 60 / KDL 40；基地B(3线)：XJ 50 / KDL 50；基地C(4线)：只有 XJ 100
    # 物料级分母 = 2+3+4 = 9 线（不是某家自己的线数）
    #   XJ  = (60×2 + 50×3 + 100×4) / 9 = 74.44
    #   KDL = (40×2 + 50×3)         / 9 = 25.56
    ha = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "A条数", "B份额", "B条数"]
    hc = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "C份额", "C条数"]
    ba = [
        ("8100", "端板", "XJ", "34567", None, 1, 1, 1, 60, 2, 50, 3),
        ("8100", "端板", "KDL", "89866", None, 1, 1, 1, 40, 2, 50, 3),
    ]
    bc = [("8100", "端板", "XJ", "34567", None, 1, 1, 1, 100, 4)]
    res = run_bytes(build_stacked(ba, ha, bc, hc), month="2026-16")
    check("跨块聚合为 2 条记录", res.imported == 2, f"imported={res.imported} errors={res.errors}")
    multi = {r["code"]: r for r in records("2026-16")}
    check("XJ 份额 = 74.44（按物料 9 条线加权）", multi.get("34567", {}).get("share") == 74.44,
          str(multi.get("34567", {}).get("share")))
    check("KDL 份额 = 25.56（缺席基地C 按 0 计）", multi.get("89866", {}).get("share") == 25.56,
          str(multi.get("89866", {}).get("share")))
    check("XJ 合并 3 个基地", [b["base"] for b in multi.get("34567", {}).get("bases", [])] == ["A", "B", "C"],
          str([b["base"] for b in multi.get("34567", {}).get("bases", [])]))
    check("KDL 只有 2 个基地", [b["base"] for b in multi.get("89866", {}).get("bases", [])] == ["A", "B"],
          str([b["base"] for b in multi.get("89866", {}).get("bases", [])]))

    print("\n[9] 多个 sheet、表头完全不同、列序还打乱（同一项目）")
    # Sheet1：表头前有标题行，基地 A/B；Sheet2：只有基地 C，且「供应商代码」在最前、「C份额」在评分列「C」之前
    def build_multisheet(spec) -> bytes:
        from openpyxl import Workbook

        wb = Workbook()
        wb.remove(wb.active)
        for title, rows in spec:
            ws = wb.create_sheet(title)
            for r in rows:
                ws.append(list(r))
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    h_ab = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "A条数", "B份额", "B条数"]
    h_c = ["供应商代码", "物料PN", "物料名称", "供应商名称", "C份额", "C条数", "本月份额", "Q", "D", "C"]
    spec = [
        ("基地A-B", [
            ["2026-11 份额表"],
            h_ab,
            ("8200", "端板", "XJ", "34567", None, 1, 1, 0.7, 60, 2, 50, 3),
            ("8200", "端板", "KDL", "89866", None, 1, 1, 1, 40, 2, 50, 3),
        ]),
        ("基地C", [
            h_c,
            ("34567", "8200", "端板", "XJ", 100, 4, None, 1, 1, 0.7),
            ("89866", "8200", "端板", "KDL", 0, 4, None, 1, 1, 1),
        ]),
    ]
    res = run_bytes(build_multisheet(spec), month="2026-17")
    check("两个 sheet 都导入（2 条记录）", res.imported == 2, f"imported={res.imported} errors={res.errors}")
    ms = {r["code"]: r for r in records("2026-17")}
    check("XJ 合并 3 个基地（sheet2 没被丢）",
          [b["base"] for b in ms.get("34567", {}).get("bases", [])] == ["A", "B", "C"],
          str([b["base"] for b in ms.get("34567", {}).get("bases", [])]))
    check("XJ 份额 = 74.44", ms.get("34567", {}).get("share") == 74.44, str(ms.get("34567", {}).get("share")))
    check("KDL 份额 = 25.56", ms.get("89866", {}).get("share") == 25.56, str(ms.get("89866", {}).get("share")))
    check("块2 的 C 评分没被「C份额」抢走（C=0.7）", ms.get("34567", {}).get("c") == 0.7, str(ms.get("34567", {}).get("c")))

    print("\n[10] sheet 名带项目与月份：一份文件跨项目跨月")
    h_ab2 = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "A条数"]
    spec2 = [
        ("LFP3-2026-11", [
            h_ab2,
            ("8300", "端板", "XJ", "34567", 60, 1, 1, 1, 50, 2),
            ("8300", "端板", "KDL", "89866", 40, 1, 1, 1, 50, 2),
        ]),
        ("EP1 2026年12月", [
            h_ab2,
            ("8300", "端板", "XJ", "34567", 70, 1, 1, 1, 50, 2),
            ("8300", "端板", "KDL", "89866", 30, 1, 1, 1, 50, 2),
        ]),
    ]
    res = run_bytes(build_multisheet(spec2), month="2026-18")
    check("两个项目各 2 条（共 4 条）", res.imported == 4, f"imported={res.imported} errors={res.errors}")
    groups = {(g["project_name"], g["month"]): g for g in res.by_project}
    check("URL 参数里的 2026-18 没被用到（sheet 名优先）", ("LFP3", "2026-18") not in groups, str(list(groups)))
    check("分组：LFP3 / 2026-11", ("LFP3", "2026-11") in groups, str(list(groups)))
    check("分组：EP1 / 2026-12", ("EP1", "2026-12") in groups, str(list(groups)))
    nov = {(r["pid"], r["code"]): r["share"] for r in records("2026-11") if r["pn"] == "8300"}
    dec = {(r["pid"], r["code"]): r["share"] for r in records("2026-12") if r["pn"] == "8300"}
    check("LFP3 11 月份额 60 / 40", nov.get((1, "34567")) == 60 and nov.get((1, "89866")) == 40, str(nov))
    check("EP1 12 月份额 70 / 30", dec.get((2, "34567")) == 70 and dec.get((2, "89866")) == 30, str(dec))

    print("\n[11] 行内「项目代码」「月份」两列")
    h_row = ["项目代码", "月份", "物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "A条数"]
    rows3 = [
        ("LFP3", "2026-09", "8400", "端板", "XJ", "34567", 100, 1, 1, 1, 100, 2),
        ("EP1", "2026-09", "8400", "端板", "XJ", "34567", 100, 1, 1, 1, 100, 2),
    ]
    res = run_bytes(build_multisheet([("混合", [h_row, *rows3])]), month="2026-18")
    check("同一 sheet 按行分到两个项目", res.imported == 2, f"imported={res.imported} errors={res.errors}")
    sep = {(r["pid"], r["code"]): r["share"] for r in records("2026-09") if r["pn"] == "8400"}
    check("LFP3(1) 与 EP1(2) 各有 1 条 100%", sep.get((1, "34567")) == 100 and sep.get((2, "34567")) == 100, str(sep))

    print("\n[12] 项目代码不存在 → 报错，不静默落到默认项目")
    bad = [("NOPE", "2026-09", "8500", "端板", "XJ", "34567", 100, 1, 1, 1, 100, 2)]
    try:
        run_bytes(build_multisheet([("混合", [h_row, *bad])]), month="2026-18")
        check("报「项目不存在」", False, "未抛异常")
    except HTTPException as exc:
        detail = str(exc.detail)
        check("报「项目不存在」", "项目「NOPE」不存在" in detail, detail[:200])

    print("\n[13] 拉线数是基地的：同一基地只能一个数，且只需填一次")
    h_line = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C", "A份额", "A条数"]
    conflict = [
        ("8600", "端板", "XJ", "34567", None, 1, 1, 1, 50, 2),
        ("8600", "端板", "KDL", "89866", None, 1, 1, 1, 50, 1),
    ]
    try:
        run_bytes(build_stacked(conflict, h_line, [], h_line), month="2026-19")
        check("同一基地填两个线数 → 报错", False, "未抛异常")
    except HTTPException as exc:
        detail = str(exc.detail)
        check("同一基地填两个线数 → 报错", "拉线数前后不一致" in detail, detail[:200])

    inherit = [
        ("8601", "端板", "XJ", "34567", None, 1, 1, 1, 50, 2),
        ("8601", "端板", "KDL", "89866", None, 1, 1, 1, 50, None),
    ]
    res = run_bytes(build_stacked(inherit, h_line, [], h_line), month="2026-19")
    check("第二家留空 → 继承基地线数，导入成功", res.imported == 2, f"imported={res.imported} errors={res.errors}")
    inh = {r["code"]: r for r in records("2026-19")}
    lines_map = {c: [b["lines"] for b in v.get("bases", [])] for c, v in inh.items()}
    check("两家基地快照都是 2 条线", lines_map.get("34567") == [2] and lines_map.get("89866") == [2], str(lines_map))
    check("两家份额各 50", inh.get("34567", {}).get("share") == 50 and inh.get("89866", {}).get("share") == 50,
          str({c: v.get("share") for c, v in inh.items()}))

    print("\n[14] 手动改基地字段时，份额分母同样取该物料全部基地")
    # 8700：XJ 基地A 50（2 线）+ 基地B 100（3 线）；KDL 只在基地A 50（2 线）
    #   分母 = 2+3 = 5 线 → XJ = (50×2 + 100×3)/5 = 80，KDL = (50×2)/5 = 20
    h_w = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C",
           "A份额", "A条数", "B份额", "B条数"]
    two = [
        ("8700", "端板", "XJ", "34567", None, 1, 1, 1, 50, 2, 100, 3),
        ("8700", "端板", "KDL", "89866", None, 1, 1, 1, 50, 2, None, None),
    ]
    res = run_bytes(build_stacked(two, h_w, [], h_w), month="2026-20")
    check("导入 2 条", res.imported == 2, f"imported={res.imported} errors={res.errors}")
    got = {r["code"]: r["share"] for r in records("2026-20") if r["pn"] == "8700"}
    check("XJ = 80 / KDL = 20（分母是物料 5 条线）", got.get("34567") == 80 and got.get("89866") == 20, str(got))

    from app.models import ShareRecord
    from app.routers.share import update_share_record
    from app.schemas import ShareRecordUpdate

    db = SessionLocal()
    try:
        rec = db.execute(
            select(ShareRecord).where(ShareRecord.month == "2026-20").order_by(ShareRecord.id)
        ).scalars().all()
        kdl = [r for r in rec if r.supply_relation.supplier.code == "89866"][0]
        updated = update_share_record(
            kdl.id, ShareRecordUpdate(bases=[{"base": "A", "share": 50, "lines": 2}]), db
        )
        check("手改基地后份额仍按 5 条线算（20，不是 50）", updated.share_current == 20, f"share={updated.share_current}")
    finally:
        db.close()

    print("\n[15] 下载的模板文件本身能导入（防止改模板改坏）")
    tpl = ROOT / "frontend" / "public" / "templates" / "share-import-template.xlsx"
    check("模板文件存在", tpl.exists(), str(tpl))
    if tpl.exists():
        res = run_bytes(tpl.read_bytes(), month="2026-21")
        check("模板导入无报错", not res.errors, str(res.errors[:3]))
        check("模板导入 4 条", res.imported + res.updated == 4, f"imported={res.imported} updated={res.updated}")
        tpl_rows = {(r["pn"], r["code"]): r for r in records("2026-21") if r["pn"] in ("123", "456")}
        check("模板 123 侧板：KL 71.43 / XS 28.57",
              tpl_rows.get(("123", "1341"), {}).get("share") == 71.43
              and tpl_rows.get(("123", "1245"), {}).get("share") == 28.57,
              str({k: v.get("share") for k, v in tpl_rows.items()}))
        check("模板块2 基地是 C/D（不是 A/B）",
              sorted(b["base"] for b in tpl_rows.get(("456", "1341"), {}).get("bases", [])) == ["C", "D"],
              str(tpl_rows.get(("456", "1341"), {}).get("bases")))

    print(f"\n结果：{passed} 通过 / {failed} 失败")
    shutil.rmtree(tmp, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
