"""临时验证：需求版本与投影必须同生共死（跑完即删，脚本目录已 gitignore）。

用法（backend 目录）：
    <python> ../scripts/_tmp/verify_demand_atomic.py
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

tmp_db = Path(tempfile.gettempdir()) / "scm_demand_atomic.db"
shutil.copy(BACKEND / "products.db", tmp_db)
os.environ["SCM_DB_PATH"] = str(tmp_db)
for key in ("SCM_DB_URL", "SCM_MYSQL_HOST"):
    os.environ.pop(key, None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import projects as projects_router  # noqa: E402

FAILS = []


def check(name: str, cond: bool, extra: str = "") -> None:
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        FAILS.append(name)


def pick_project(client) -> int:
    rows = client.get("/api/projects", params={"page": 1, "page_size": 100}).json()["items"]
    for p in rows:
        rel = client.get(f"/api/projects/{p['id']}/relations").json()
        if rel:
            return p["id"]
    raise SystemExit("没有可用的项目")


with TestClient(app, raise_server_exceptions=False) as client:
    pid = pick_project(client)
    base = client.get(f"/api/projects/{pid}/demand-versions").json()
    n_before = len(base)
    cur_before = next((v for v in base if v["is_current"]), None)
    print(f"项目 {pid}：现有版本 {n_before} 个，当前版 {cur_before and cur_before['version_no']}")

    # ---- 1. 投影写入失败时，版本行不得落库 ----
    original = projects_router._write_demand_projection
    projects_router._write_demand_projection = lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("模拟投影写入失败")
    )
    payload = {"demand": [111.0] * 12, "label": "原子性测试"}
    r = client.put(f"/api/projects/{pid}/demand", json=payload)
    projects_router._write_demand_projection = original
    check("投影失败时接口返回 5xx", r.status_code >= 500, f"status={r.status_code}")

    after = client.get(f"/api/projects/{pid}/demand-versions").json()
    check("投影失败后版本数不变（事务已回滚）", len(after) == n_before, f"{n_before} -> {len(after)}")
    cur_after = next((v for v in after if v["is_current"]), None)
    check(
        "当前版未被改名次",
        (cur_after or {}).get("id") == (cur_before or {}).get("id"),
        f"{(cur_before or {}).get('version_no')} -> {(cur_after or {}).get('version_no')}",
    )

    # ---- 2. 正常保存：版本 +1，且投影等于新值 ----
    r = client.put(f"/api/projects/{pid}/demand", json=payload)
    check("正常保存返回 200", r.status_code == 200, f"status={r.status_code}")
    links = r.json()
    check("投影 12 个月全部等于新值", all(abs(v - 111.0) < 1e-6 for l in links for v in l["demand"]))

    vers = client.get(f"/api/projects/{pid}/demand-versions").json()
    check("版本数 +1", len(vers) == n_before + 1, f"{n_before} -> {len(vers)}")
    newest = max(vers, key=lambda v: v["seq"])
    check("最新版就是当前版", newest["is_current"] is True, f"seq={newest['seq']}")

    # ---- 3. 切回旧版：投影跟着回到旧值 ----
    if cur_before:
        r = client.post(f"/api/projects/{pid}/demand-versions/{cur_before['id']}/set-current")
        check("设为当前版返回 200", r.status_code == 200, f"status={r.status_code}")
        links = client.get(f"/api/projects/{pid}/relations").json()
        expect = cur_before["demand"]
        check(
            "投影回退到旧版数值",
            all(abs(a - b) < 1e-6 for l in links for a, b in zip(l["demand"], expect)),
        )
        cur_now = next(v for v in client.get(f"/api/projects/{pid}/demand-versions").json() if v["is_current"])
        check("当前版指针回到旧版", cur_now["id"] == cur_before["id"])

from app.database import engine as _engine

_engine.dispose()
try:
    tmp_db.unlink(missing_ok=True)
except PermissionError:
    pass
print("\n" + ("全部通过" if not FAILS else f"失败 {len(FAILS)} 条：{FAILS}"))
sys.exit(1 if FAILS else 0)
