"""临时验证：变更 Excel 导入必须整批原子（跑完即删）。

用法（backend 目录）：
    <python> ../scripts/_tmp/verify_change_import_atomic.py
"""

import io
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

tmp_db = Path(tempfile.gettempdir()) / "scm_change_import.db"
shutil.copy(BACKEND / "products.db", tmp_db)
os.environ["SCM_DB_PATH"] = str(tmp_db)
for key in ("SCM_DB_URL", "SCM_MYSQL_HOST"):
    os.environ.pop(key, None)

import openpyxl  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

FAILS = []


def check(name: str, cond: bool, extra: str = "") -> None:
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        FAILS.append(name)


def build_sheet(project_code: str, title: str, pn: str) -> bytes:
    """拿服务端模板，往「变更单」sheet 追加一行；返回 xlsx 字节。"""
    tpl = client.get("/api/changes/template")
    wb = openpyxl.load_workbook(io.BytesIO(tpl.content))
    for name in wb.sheetnames:          # 两个 sheet 的示例行都要删，否则会被判为错误行
        wb[name].delete_rows(2, wb[name].max_row)
    ws = wb["变更单"]
    header = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    row = {h: None for h in header}
    for h in header:
        if "项目" in h and "代码" in h:
            row[h] = project_code
        elif h == "物料PN":
            row[h] = pn
        elif "标题" in h:
            row[h] = title
        elif "类型" in h:
            row[h] = "供应商切换"
    ws.delete_rows(2, ws.max_row)  # 模板自带示例行，按 SOP 要求先删
    ws.append([row[h] for h in header])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


with TestClient(app, raise_server_exceptions=False) as client:
    projects = client.get("/api/projects", params={"page": 1, "page_size": 5}).json()["items"]
    if not projects:
        raise SystemExit("没有可用的项目")
    code = projects[0]["code"]
    mats = client.get("/api/materials", params={"page": 1, "page_size": 1}).json()["items"]
    pn = mats[0]["pn"]
    before = client.get("/api/changes", params={"page": 1, "page_size": 100, "archived": "all"}).json()["total"]
    print(f"基准：项目 {code}，现有变更单 {before} 张")

    # ---- 1. 含一行非法项目 → 整批 422，且一张都不入库 ----
    wb = openpyxl.load_workbook(io.BytesIO(build_sheet(code, "合法行-应被回滚", pn)))
    ws = wb["变更单"]
    ws.delete_rows(2, ws.max_row)
    header = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    bad = {h: None for h in header}
    for h in header:
        if "项目" in h and "代码" in h:
            bad[h] = "NOPE-999"
        elif h == "物料PN":
            bad[h] = pn
        elif "标题" in h:
            bad[h] = "非法行-触发回滚"
        elif "类型" in h:
            bad[h] = "供应商切换"
    ws.append([bad[h] for h in header])
    buf = io.BytesIO()
    wb.save(buf)

    r = client.post("/api/changes/import", content=buf.getvalue())
    check("混入非法行时返回 422", r.status_code == 422, f"status={r.status_code}")
    detail = r.json().get("detail", "")
    check("错误文案说明未写入", "未写入任何数据" in detail, detail[:60])
    after = client.get("/api/changes", params={"page": 1, "page_size": 100, "archived": "all"}).json()["total"]
    check("变更单数量未增加（合法行也被回滚）", after == before, f"{before} -> {after}")

    # ---- 2. 全部合法 → 200 且 +1 ----
    r = client.post("/api/changes/import", content=build_sheet(code, "合法行-应入库", pn))
    check("全合法时返回 200", r.status_code == 200, f"status={r.status_code} body={r.text[:80]}")
    if r.status_code == 200:
        body = r.json()
        check("created_changes = 1", body["created_changes"] == 1, str(body))
        after = client.get("/api/changes", params={"page": 1, "page_size": 100, "archived": "all"}).json()["total"]
        check("变更单数量 +1", after == before + 1, f"{before} -> {after}")

print("\n" + ("全部通过" if not FAILS else f"失败 {len(FAILS)} 条：{FAILS}"))
sys.exit(1 if FAILS else 0)
