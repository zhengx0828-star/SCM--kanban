"""清空「供应商相关」数据，为全场景测试数据腾出干净底板。

保留：projects / materials / base_sites / rules（非供应商数据，属主数据与口径文档）
清空：suppliers / supply_relations / project_supply_relations / share_records
      / inventory_plans / inventory_days

用法（仓库根）：
    runtime\\python\\python.exe scripts\\_reset_supplier_data.py --yes
不带 --yes 只做 dry-run 打印。
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "backend" / "products.db"

# 清空顺序：先子后父（本库未开 PRAGMA foreign_keys，顺序仅为可读性）
TARGETS = [
    "inventory_days",
    "inventory_plans",
    "share_records",
    "project_supply_relations",
    "supply_relations",
    "suppliers",
]
KEEP = ["projects", "materials", "base_sites", "rules"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="真正执行（否则 dry-run）")
    args = ap.parse_args()

    if not DB.exists():
        raise SystemExit(f"数据库不存在: {DB}")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DB.with_name(f"products.db.bak-pre-testseed-{stamp}")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print("=== 清空前 ===")
    for t in KEEP + TARGETS:
        n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t:28s} {n}")

    if not args.yes:
        print("\n[dry-run] 未做任何改动。加 --yes 执行。")
        conn.close()
        return

    shutil.copy2(DB, backup)
    print(f"\n已备份 → {backup}")

    has_seq = cur.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
    ).fetchone()[0]
    for t in TARGETS:
        cur.execute(f"DELETE FROM {t}")
        if has_seq:
            cur.execute("DELETE FROM sqlite_sequence WHERE name = ?", (t,))
    conn.commit()

    print("\n=== 清空后 ===")
    for t in KEEP + TARGETS:
        n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t:28s} {n}")
    conn.close()


if __name__ == "__main__":
    main()
