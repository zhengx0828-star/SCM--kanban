"""从 ORM 模型生成 MySQL / OceanBase(MySQL 模式) 建表语句。

用法：
    python scripts/gen_mysql_schema.py            # 打印到 stdout
    python scripts/gen_mysql_schema.py -o docs/mysql/schema.sql

为什么不用 create_all 的默认输出：
  1. 模型里两个「部分唯一索引」（`sqlite_where`）在 MySQL 上没有对应语法，
     SQLAlchemy 会退化成**全表唯一索引**（sku 唯一、project_id 唯一），
     后者会让「同一项目只能有一个需求版本」—— 必须换成生成列 + 唯一键。
  2. `server_default=func.now()` 编译成 `DEFAULT (now())`，OceanBase 只认
     `DEFAULT CURRENT_TIMESTAMP`。
  3. 主键列上 `index=True` 生成的 `ix_*_id` 与 PRIMARY KEY 重复，删掉。
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

# 必须在 import 应用模块之前置好：models.py 按「是不是 MySQL」决定用生成列还是部分唯一索引
os.environ["SCM_DB_URL"] = "mysql+pymysql://schema@localhost:3306/schema_only"

from sqlalchemy.dialects import mysql  # noqa: E402
from sqlalchemy.schema import CreateIndex, CreateTable  # noqa: E402

from app.database import Base  # noqa: E402
import app.models  # noqa: E402,F401  (注册所有表)

DIALECT = mysql.dialect()

# 部分唯一索引 → 生成列（MySQL / OceanBase 无 partial index）
# models.py 在 MySQL 模式下已经带 Computed 列，这里只是兜底：列已存在就不再重复注入。
GENERATED_COLUMNS = {
    "products": [
        ("sku_active",
         "`sku_active` VARCHAR(64) GENERATED ALWAYS AS "
         "(IF(`is_deleted` = 0, `sku`, NULL)) STORED "
         "COMMENT '生成列：软删除后置 NULL，使 SKU 可复用（替代部分唯一索引）'"),
    ],
    "project_demand_versions": [
        ("current_project_id",
         "`current_project_id` INT GENERATED ALWAYS AS "
         "(IF(`is_current` = 1, `project_id`, NULL)) STORED "
         "COMMENT '生成列：仅当前版有值，保证同项目至多一条当前版（替代部分唯一索引）'"),
    ],
}

# 生成列上挂的唯一键（写在 CREATE TABLE 内；索引已存在时不再重复）
GENERATED_UNIQUE = {
    "products": ("uq_products_sku_active", "UNIQUE KEY `uq_products_sku_active` (`sku_active`)"),
    "project_demand_versions": ("uq_demand_version_current",
                                "UNIQUE KEY `uq_demand_version_current` (`current_project_id`)"),
}

HEADER = """-- ============================================================================
-- SCM 供应链看板 · OceanBase(MySQL 模式) 建表脚本
--
-- 目标库：见文件末尾「执行方式」；表名前缀：无。
-- 字符集：utf8mb4（中文 + emoji 安全）；引擎：InnoDB（需要外键与事务）。
-- 由 scripts/gen_mysql_schema.py 从 backend/app/models.py 生成，改模型后重跑。
--
-- 与 SQLite 版的三处必要差异：
--   1. products.sku_active / project_demand_versions.current_project_id 是生成列，
--      用来替代 SQLite 的「部分唯一索引」（MySQL 不支持 WHERE 条件索引）。
--   2. 时间默认值统一 CURRENT_TIMESTAMP（OceanBase 不认 DEFAULT (now())）。
--   3. FLOAT → DOUBLE，避免份额 / 评分的尾数抖动。
-- ============================================================================

SET NAMES utf8mb4;
"""

FOOTER = """
-- ============================================================================
-- 执行方式
--   mysql -h nd-test-dbcloud.catlbattery.com -P 2883 -u <用户> -p '<密码>' \\
--         --default-character-set=utf8mb4 -D 'mtm-online' < schema.sql
-- 或一次性建库（若允许）：
--   CREATE DATABASE IF NOT EXISTS `scm_kanban` DEFAULT CHARSET utf8mb4;
--
-- 若 OceanBase 版本不支持 STORED 生成列（报 1064/1235）：
--   删掉两条生成列与对应 UNIQUE KEY，改由应用层保证（写版本时先清旧 current）。
-- ============================================================================
"""


def _table_ddl(table) -> str:
    sql = str(CreateTable(table).compile(dialect=DIALECT)).strip()
    # 时间默认值：DEFAULT (now()) → DEFAULT CURRENT_TIMESTAMP
    sql = sql.replace("DEFAULT (now())", "DEFAULT CURRENT_TIMESTAMP")
    # 浮点：避免 FLOAT 精度
    sql = re.sub(r"\bFLOAT\b", "DOUBLE", sql)
    # 整数类型名统一
    sql = re.sub(r"\bINTEGER\b", "INT", sql)
    # SQLAlchemy 为 pyformat 参数风格把注释里的 % 转义成 %%，直连 mysql 时会原样存进去
    sql = sql.replace("%%", "%")
    # AUTO_INCREMENT 提到 COMMENT 前面（OceanBase 对属性顺序比 MySQL 敏感）
    sql = re.sub(r"(\t\w+ \w+ NOT NULL )COMMENT ('[^']*') AUTO_INCREMENT", r"\1AUTO_INCREMENT COMMENT \2", sql)

    have_cols = {c.name for c in table.columns}
    have_idx = {i.name for i in table.indexes}
    extra_cols = [ddl for col, ddl in GENERATED_COLUMNS.get(table.name, []) if col not in have_cols]
    extra_keys = []
    if table.name in GENERATED_UNIQUE:
        idx_name, idx_ddl = GENERATED_UNIQUE[table.name]
        if idx_name not in have_idx:
            extra_keys.append(idx_ddl)
    if extra_cols or extra_keys:
        lines = sql.split("\n")
        # 定位 PRIMARY KEY 行，把生成列插在它前面
        pk_at = next((i for i, ln in enumerate(lines) if ln.strip().startswith("PRIMARY KEY")), None)
        if pk_at is None:  # 无主键的表（正常不会发生）
            pk_at = len(lines) - 1
        insert = [f"\t{c}," for c in extra_cols] + [f"\t{k}," for k in extra_keys]
        lines[pk_at:pk_at] = insert
        sql = "\n".join(lines)

    # 收尾：引擎与字符集
    sql = sql.rstrip()
    assert sql.endswith(")"), sql[-80:]
    sql = sql[:-1] + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;"
    return sql


def _index_ddl(table, pk_cols: set[str]) -> list[str]:
    out = []
    for idx in sorted(table.indexes, key=lambda i: i.name or ""):
        cols = [c.name for c in idx.columns]
        # 主键列上的单列索引与 PRIMARY KEY 重复
        if len(cols) == 1 and cols[0] in pk_cols:
            continue
        out.append(str(CreateIndex(idx).compile(dialect=DIALECT)).strip() + ";")
    return out


def build() -> str:
    parts = [HEADER]
    for table in Base.metadata.sorted_tables:
        title = (table.comment or "").strip() or table.name
        parts.append(f"\n-- ---------------------------------------------------------------------------\n"
                     f"-- {table.name}  {title}\n"
                     f"-- ---------------------------------------------------------------------------")
        parts.append(_table_ddl(table))
        pk_cols = {c.name for c in table.primary_key.columns}
        idx = _index_ddl(table, pk_cols)
        if idx:
            parts.append("\n".join(idx))
    parts.append(FOOTER)
    return "\n".join(parts) + "\n"


if __name__ == "__main__":
    sql = build()
    if "-o" in sys.argv:
        out = Path(sys.argv[sys.argv.index("-o") + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(sql, encoding="utf-8")
        print(f"已写入 {out}（{len(sql.splitlines())} 行）")
    else:
        print(sql)
