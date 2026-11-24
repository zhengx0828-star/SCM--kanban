"""把库建到 MySQL / OceanBase(MySQL 模式)，可选把现有 SQLite 数据整表搬过去。

用法（在包根目录或 backend 目录都能跑）：

    # 1) 只建表（不搬数据）
    python backend/init_mysql.py --host <ob-host> --port 2883 \
        --user <user> --password '***' --database mtm-online --schema-only

    # 2) 建表 + 把 backend/products.db 的数据搬过去
    python backend/init_mysql.py ... --sqlite backend/products.db

    # 3) 目标库已有旧数据，要求清空重来
    python backend/init_mysql.py ... --sqlite backend/products.db --reset

也可以不用命令行参数，直接给环境变量：
    SCM_MYSQL_HOST / SCM_MYSQL_PORT / SCM_MYSQL_USER / SCM_MYSQL_PASSWORD / SCM_MYSQL_DB
或整串 DSN：SCM_DB_URL=mysql+pymysql://user:pass@host:2883/mtm-online?charset=utf8mb4

★ 安全阀：
  - 目标表非空且没给 --reset 时，**该表跳过**并打印原因，绝不覆盖线上数据；
  - --reset 会 DELETE 目标库 19 张表的全部行（按外键倒序），执行前要求二次确认；
  - 整个过程只写这 19 张表，不动库里其他表。
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))

# 先用命令行参数占好环境变量，再 import 应用模块 —— database.py 在 import 时就读 DSN
def _preset_env(args: argparse.Namespace) -> None:
    if args.dsn:
        os.environ["SCM_DB_URL"] = args.dsn
        return
    if args.host:
        os.environ["SCM_MYSQL_HOST"] = args.host
        os.environ["SCM_MYSQL_PORT"] = str(args.port)
        os.environ["SCM_MYSQL_USER"] = args.user or ""
        os.environ["SCM_MYSQL_PASSWORD"] = args.password or ""
        os.environ["SCM_MYSQL_DB"] = args.database or "mtm-online"


def main() -> int:
    ap = argparse.ArgumentParser(description="初始化 MySQL / OceanBase 表结构并迁移 SQLite 数据")
    ap.add_argument("--dsn", help="完整 DSN（mysql+pymysql://...），给了就忽略下面的 host/user 等")
    ap.add_argument("--host")
    ap.add_argument("--port", type=int, default=2883)
    ap.add_argument("--user")
    ap.add_argument("--password")
    ap.add_argument("--database", default="mtm-online")
    ap.add_argument("--sqlite", help="要搬数据的 SQLite 文件，如 backend/products.db；不给就不搬")
    ap.add_argument("--schema-only", action="store_true", help="只建表，不搬数据")
    ap.add_argument("--reset", action="store_true", help="建表前清空目标 19 张表的数据")
    ap.add_argument("--yes", action="store_true", help="--reset 的二次确认")
    ap.add_argument("--check", action="store_true", help="只做连通性自检（不建表、不搬数据）")
    args = ap.parse_args()
    _preset_env(args)

    from sqlalchemy import func, select, text  # noqa: E402
    from sqlalchemy.exc import OperationalError  # noqa: E402

    try:
        from app.database import IS_MYSQL, Base, engine  # noqa: E402
    except RuntimeError as exc:
        # DSN 里密码含 @ 之类的问题在 import 阶段就会抛，这里给人话而不是堆栈
        print(f"[FATAL] 数据库配置有误：{exc}", file=sys.stderr)
        return 7
    import app.models  # noqa: E402,F401  注册模型

    if not IS_MYSQL:
        print("[FATAL] 没读到 MySQL 连接信息。给 --host/--user/--password，或设 SCM_DB_URL。", file=sys.stderr)
        return 2

    # ---------- 1. 连通性 ----------
    safe_dsn = engine.url.render_as_string(hide_password=True)
    try:
        with engine.connect() as conn:
            ver = conn.execute(text("SELECT VERSION()")).scalar()
            db = conn.execute(text("SELECT DATABASE()")).scalar()
            who = conn.execute(text("SELECT USER()")).scalar()
            charset = conn.execute(text("SELECT @@character_set_database")).scalar()
    except OperationalError as exc:
        raw = str(getattr(exc, "orig", exc))
        print(f"[FATAL] 连不上数据库：{safe_dsn}", file=sys.stderr)
        print(f"        原始错误：{raw}", file=sys.stderr)
        if "1045" in raw or "Access denied" in raw:
            # 1045 = 网络已通、服务器到了认证这一步才拒 —— 纯粹是账号/密码/租户不对
            user = (os.environ.get("SCM_MYSQL_USER") or "").strip()
            pwd = os.environ.get("SCM_MYSQL_PASSWORD") or ""
            print("        这是「认证被拒」（1045），说明网络是通的，只差账号密码：", file=sys.stderr)
            if ":" in user:
                print(f"        ✗ 用户名里有冒号：{user}", file=sys.stderr)
                print("          填纯用户名，例如 <user>，不要带「命名空间:应用:字段」这种凭据路径。",
                      file=sys.stderr)
            if pwd and ("PASSWORD:" in pwd.upper() or "DATASOURCE" in pwd.upper()):
                print(f"        ✗ 密码长度 {len(pwd)}，内容像凭据中心的引用串（..._PASSWORD:真值）而不是密码本身。",
                      file=sys.stderr)
                print("          冒号后面那一段才是密码。", file=sys.stderr)
            print("        若用户名确认无误，再试带租户：用户名@租户名（如 <user>@<tenant>）。",
                  file=sys.stderr)
        else:
            print("        排查：① host/port 是否可达（内网才通）② 用户密码 ③ 库是否存在"
                  " ④ 用户名是否要带 @租户 后缀", file=sys.stderr)
        return 6
    print(f"[1/4] 已连接 {safe_dsn}")
    print(f"      版本 {ver}    当前库 {db}    账号 {who}    字符集 {charset}")

    if args.check:
        print("      自检通过：连接、账号、库、字符集均正常（未建表、未写数据）")
        return 0

    tables = list(Base.metadata.sorted_tables)

    # ---------- 2. 清空（可选） ----------
    if args.reset:
        if not args.yes:
            print("[ABORT] --reset 会删除目标库下列表的全部数据，确认请加 --yes：")
            print("        " + "、".join(t.name for t in tables))
            return 3
        with engine.begin() as conn:
            for t in reversed(tables):  # 外键倒序
                conn.execute(t.delete())
        print("[2/4] 已清空目标 19 张表")

    # ---------- 3. 建表 ----------
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        existing = set(
            conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = DATABASE()"
                )
            ).scalars()
        )
    missing = [t.name for t in tables if t.name not in existing]
    if missing:
        print(f"[FATAL] 建表后仍缺：{missing}", file=sys.stderr)
        return 4
    print(f"[3/4] 表结构就绪：{len(tables)} 张表")
    if not args.sqlite or args.schema_only:
        print("[4/4] 跳过数据搬迁（未给 --sqlite 或指定了 --schema-only）")
        return 0

    # ---------- 4. 搬数据 ----------
    src_path = Path(args.sqlite)
    if not src_path.is_absolute():
        src_path = (Path.cwd() / src_path).resolve()
    if not src_path.is_file():
        print(f"[FATAL] SQLite 文件不存在：{src_path}", file=sys.stderr)
        return 5

    src = sqlite3.connect(str(src_path))
    src.row_factory = sqlite3.Row
    src_tables = {
        r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    print(f"[4/4] 从 {src_path.name} 搬数据")

    moved, skipped = 0, []
    for t in tables:
        if t.name not in src_tables:
            continue
        rows = [dict(r) for r in src.execute(f'SELECT * FROM "{t.name}"')]
        if not rows:
            continue
        with engine.connect() as conn:
            already = conn.execute(select(func.count()).select_from(t)).scalar() or 0
        if already:
            skipped.append(f"{t.name}(目标已有 {already} 行)")
            continue
        # 生成列（MySQL 侧独有）不在源表里，按列名取交集
        writable = {c.name for c in t.columns if c.computed is None}
        payload = [{k: v for k, v in r.items() if k in writable} for r in rows]
        with engine.begin() as conn:
            conn.execute(t.insert(), payload)
        moved += len(payload)
        print(f"      {t.name:<26} +{len(payload)} 行")

    src.close()
    if skipped:
        print("      跳过（目标表非空，加 --reset 可覆盖）：" + "、".join(skipped))
    print(f"      共写入 {moved} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
