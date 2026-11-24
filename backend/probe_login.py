"""登录探测：把「用户名 × 密码」的组合挨个试一遍，直接告出哪一组能进。

用途：SeaOceanBase 报 1045 时，最难判断的是「用户名要不要带租户」「密码是不是真值」。
本脚本绕开 SQLAlchemy / DSN 拼接，用 pymysql 直连，逐组打印返回码，一次定位。

用法（容器内，backend 目录）：

    # 试 3 种用户名写法 × 1 个密码
    python3 backend/probe_login.py \
        --host <ob-host> --port 2883 \
        --users '<user>,<user>@<tenant>,<user>@<namespace>' \
        --passwords '<password>' \
        --database mtm-online

    # 也可以直接读现有环境变量
    python3 backend/probe_login.py --from-env --users '<user>,<user>@<tenant>'

★ 失败会累积登录失败次数，账号可能有锁定策略。默认最多试 6 组，超过了会要求 --force。
★ 密码不会打印明文，只显示长度与前 2 位。
"""

from __future__ import annotations

import argparse
import os
import sys

MAX_ATTEMPTS = 6


def mask(pwd: str) -> str:
    if not pwd:
        return "<空>"
    head = pwd[:2]
    return f"{head}…（{len(pwd)} 位）"


def main() -> int:
    ap = argparse.ArgumentParser(description="OceanBase / MySQL 登录探测")
    ap.add_argument("--host")
    ap.add_argument("--port", type=int, default=2883)
    ap.add_argument("--database", default="mtm-online")
    ap.add_argument("--users", help="逗号分隔的候选用户名")
    ap.add_argument("--passwords", help="逗号分隔的候选密码")
    ap.add_argument("--from-env", action="store_true", help="把 SCM_MYSQL_* 的值也加进候选")
    ap.add_argument("--force", action="store_true", help="超过 6 组也继续试")
    args = ap.parse_args()

    try:
        import pymysql
    except ImportError:
        print("[FATAL] 缺 pymysql，先跑一次 start.sh 装依赖。", file=sys.stderr)
        return 2

    host = args.host or os.environ.get("SCM_MYSQL_HOST") or ""
    port = args.port or int(os.environ.get("SCM_MYSQL_PORT") or 2883)
    db = args.database or os.environ.get("SCM_MYSQL_DB") or "mtm-online"
    if not host:
        print("[FATAL] 没给 --host，也没有 SCM_MYSQL_HOST。", file=sys.stderr)
        return 2

    users = [u.strip() for u in (args.users or "").split(",") if u.strip()]
    pwds = [p for p in (args.passwords or "").split(",") if p]
    if args.from_env or not users:
        env_user = (os.environ.get("SCM_MYSQL_USER") or "").strip()
        if env_user and env_user not in users:
            users.insert(0, env_user)
    if args.from_env or not pwds:
        env_pwd = os.environ.get("SCM_MYSQL_PASSWORD") or ""
        if env_pwd and env_pwd not in pwds:
            pwds.insert(0, env_pwd)

    if not users or not pwds:
        print("[FATAL] 请给 --users 与 --passwords（或 --from-env 配合环境变量）。", file=sys.stderr)
        return 2

    total = len(users) * len(pwds)
    print(f"目标 {host}:{port}  库 {db}  组合 {len(users)}×{len(pwds)} = {total} 组")
    print(f"用户名候选：{users}")
    print(f"密码候选：{[mask(p) for p in pwds]}")
    if total > MAX_ATTEMPTS and not args.force:
        print(f"[ABORT] 组合数超过 {MAX_ATTEMPTS}，可能触发账号锁定。确认要试请加 --force。", file=sys.stderr)
        return 3
    print("-" * 74)

    ok = None
    for i, user in enumerate(users, 1):
        for pwd in pwds:
            label = f"[{i}] user={user!r} pass={mask(pwd)}"
            try:
                conn = pymysql.connect(
                    host=host, port=port, user=user, password=pwd,
                    database=db, charset="utf8mb4", connect_timeout=8,
                )
                with conn.cursor() as cur:
                    cur.execute("SELECT VERSION(), USER(), DATABASE()")
                    ver, who, cur_db = cur.fetchone()
                conn.close()
                print(f"{label:<62} → ✅ 成功  {ver}  {who}  {cur_db}")
                ok = (user, pwd)
                break
            except pymysql.err.OperationalError as exc:
                code = exc.args[0] if exc.args else "?"
                msg = str(exc.args[1] if len(exc.args) > 1 else exc)
                if code == 1049:
                    # 认证过了，只是库不存在
                    print(f"{label:<62} → ⚠ 1049 登录成功但库不存在：{db}")
                    ok = (user, pwd)
                    break
                if code == 1045:
                    print(f"{label:<62} → ✗ 1045 认证被拒")
                elif code == 2003:
                    print(f"{label:<62} → ✗ 2003 连不上主机/端口")
                    print("        网络不通，后面的组合不用试了。", file=sys.stderr)
                    return 4
                else:
                    print(f"{label:<62} → ✗ {code} {msg[:60]}")
            except Exception as exc:  # noqa: BLE001
                print(f"{label:<62} → ✗ {type(exc).__name__} {str(exc)[:50]}")
        if ok:
            break

    print("-" * 74)
    if ok:
        print("可用组合（照抄进 .env，值原样，不要加引号）：")
        print(f"  SCM_MYSQL_USER={ok[0]}")
        print(f"  SCM_MYSQL_PASSWORD=<就是刚才那一组密码，共 {len(ok[1])} 位>")
        print(f"  SCM_MYSQL_DB={db}")
        return 0
    print("全部失败。按这个顺序查：")
    print("  1) 密码是不是凭据中心里「冒号后那一段」的真值（长度通常 8-20 位）")
    print("  2) 用户名是否要带租户：user@租户名（租户名问 DBA 或看连接串）")
    print("  3) 该账号是否只允许从特定 IP 登录（1045 也会因 host 权限不匹配而报）")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
