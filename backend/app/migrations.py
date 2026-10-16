"""轻量数据库迁移。

SQLAlchemy 的 `create_all` 只会「建缺失的表」，不会改已有表的结构；
而 SQLite 又不支持 `ALTER TABLE ... ADD CONSTRAINT` 或修改列定义。
因此凡是「改约束 / 删列」的场景，统一走：

    新建新结构表 → 逐行拷贝并转换 → DROP 旧表 → RENAME 新表

且整个过程必须在 `PRAGMA foreign_keys=OFF` 下进行，否则：
  - `DROP TABLE inventory_plans` 会因 inventory_days 的外键引用而级联删数据；
  - `RENAME` 会连带改写 inventory_days 里记录的外键目标名。

注意 `PRAGMA foreign_keys` 是**连接级**且**不能在事务内切换**，故此处手动管理事务。
"""

from sqlalchemy import text
from sqlalchemy.engine import Engine


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}
    ).fetchone()
    return row is not None


def _columns(conn, table: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {r[1] for r in rows}


def _add_column_if_missing(conn, table: str, column: str, ddl: str, logs: list[str]) -> None:
    if not _table_exists(conn, table):
        return
    if column in _columns(conn, table):
        return
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
    logs.append(f"{table}.{column} 已补齐")


def _migrate_inventory_plans(conn, logs: list[str]) -> None:
    """inventory_plans：「项目 × 基地(自由文本) × 物料」→「项目 × 物料 × 供应商 × 基地(主数据)」。

    转换规则：
      - 旧的 base 自由文本 → 去重后写入 base_sites 主数据表（code/name/city 同名），再回填 base_id；
      - supplier_id 由该项目下该物料的供应关系推断（优先主供），
        退而求其次取该物料的任意供应商；两者都取不到的行跳过并记录，避免脏数据入库。
    """
    if not _table_exists(conn, "inventory_plans"):
        return
    cols = _columns(conn, "inventory_plans")
    if "base_id" in cols:
        return  # 已是新结构
    if "base" not in cols:
        logs.append("inventory_plans 结构异常（既无 base 也无 base_id），跳过迁移")
        return
    if not _table_exists(conn, "base_sites"):
        logs.append("base_sites 尚未建立，跳过 inventory_plans 迁移")
        return

    rows = conn.execute(
        text(
            "SELECT id, project_id, base, material_id, lead_time_days, on_hand, "
            "hist_json, fcast_json, created_at, updated_at FROM inventory_plans"
        )
    ).mappings().all()

    # 1) 基地主数据：把历史自由文本收编为受控主数据
    base_id_map: dict[str, int] = {}
    for r in rows:
        name = (r["base"] or "").strip()
        if not name or name in base_id_map:
            continue
        found = conn.execute(text("SELECT id FROM base_sites WHERE name=:n"), {"n": name}).fetchone()
        if found:
            base_id_map[name] = found[0]
        else:
            res = conn.execute(
                text("INSERT INTO base_sites (code, name, city) VALUES (:c, :n, :n)"),
                {"c": name, "n": name},
            )
            base_id_map[name] = res.lastrowid
    if base_id_map:
        logs.append(f"基地主数据收编 {len(base_id_map)} 条：{'、'.join(base_id_map)}")

    # 2) 供应商推断
    def resolve_supplier(project_id: int, material_id: int) -> int | None:
        row = conn.execute(
            text(
                "SELECT sr.supplier_id FROM project_supply_relations psr "
                "JOIN supply_relations sr ON sr.id = psr.supply_relation_id "
                "WHERE psr.project_id = :p AND sr.material_id = :m "
                "ORDER BY psr.is_primary DESC, psr.id LIMIT 1"
            ),
            {"p": project_id, "m": material_id},
        ).fetchone()
        if row:
            return row[0]
        row = conn.execute(
            text("SELECT supplier_id FROM supply_relations WHERE material_id=:m ORDER BY id LIMIT 1"),
            {"m": material_id},
        ).fetchone()
        return row[0] if row else None

    # 3) 重建表
    conn.execute(
        text(
            """
            CREATE TABLE inventory_plans_new (
                id INTEGER NOT NULL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                material_id INTEGER NOT NULL,
                supplier_id INTEGER NOT NULL,
                base_id INTEGER NOT NULL,
                lead_time_days FLOAT NOT NULL,
                on_hand FLOAT NOT NULL,
                hist_json TEXT,
                fcast_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT uq_inventory_link UNIQUE (project_id, material_id, supplier_id, base_id),
                FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE,
                FOREIGN KEY(material_id) REFERENCES materials (id) ON DELETE CASCADE,
                FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
                FOREIGN KEY(base_id) REFERENCES base_sites (id) ON DELETE CASCADE
            )
            """
        )
    )

    moved = skipped = 0
    for r in rows:
        supplier_id = resolve_supplier(r["project_id"], r["material_id"])
        base_id = base_id_map.get((r["base"] or "").strip() or "")
        if supplier_id is None or base_id is None:
            skipped += 1
            continue
        conn.execute(
            text(
                "INSERT INTO inventory_plans_new (id, project_id, material_id, supplier_id, base_id, "
                "lead_time_days, on_hand, hist_json, fcast_json, created_at, updated_at) "
                "VALUES (:id, :pid, :mid, :sid, :bid, :lt, :oh, :hist, :fcast, :ca, :ua)"
            ),
            {
                "id": r["id"],
                "pid": r["project_id"],
                "mid": r["material_id"],
                "sid": supplier_id,
                "bid": base_id,
                "lt": r["lead_time_days"],
                "oh": r["on_hand"],
                "hist": r["hist_json"],
                "fcast": r["fcast_json"],
                "ca": r["created_at"],
                "ua": r["updated_at"],
            },
        )
        moved += 1

    conn.execute(text("DROP TABLE inventory_plans"))
    conn.execute(text("ALTER TABLE inventory_plans_new RENAME TO inventory_plans"))
    for ddl in (
        "CREATE INDEX IF NOT EXISTS ix_inventory_plans_project_id ON inventory_plans (project_id)",
        "CREATE INDEX IF NOT EXISTS ix_inventory_plans_material_id ON inventory_plans (material_id)",
        "CREATE INDEX IF NOT EXISTS ix_inventory_plans_supplier_id ON inventory_plans (supplier_id)",
        "CREATE INDEX IF NOT EXISTS ix_inventory_plans_base_id ON inventory_plans (base_id)",
    ):
        conn.execute(text(ddl))
    tail = f"，跳过 {skipped} 条（无法推断供应商）" if skipped else ""
    logs.append(f"inventory_plans 已升级为 项目×物料×供应商×基地，迁移 {moved} 条{tail}")


def _migrate_demand_versions(conn, logs: list[str]) -> None:
    """把历史 `project_supply_relations.demand` 收编为需求版本 V1.0。

    需求版本化上线前，「客户需求」是**就地覆盖**的单个字段，没有任何历史留痕。
    本迁移把它落成每个项目的第一个版本，避免老数据在版本化后「查不到当前版」。

    幂等且保守：
      - 只给「尚无任何版本记录」的项目补一条 V1.0；
      - `demand` 为空 / 空串的项目**跳过**（保持「未录入」空态，不造数据）；
      - 只读取旧值、只插入新行，**不 UPDATE、不 DELETE 任何既有字段**。
    """
    if not _table_exists(conn, "project_demand_versions"):
        return  # 建表由 main.py 的 create_all 负责
    if not _table_exists(conn, "project_supply_relations"):
        return

    rows = conn.execute(
        text(
            "SELECT project_id, demand FROM project_supply_relations "
            "WHERE demand IS NOT NULL AND TRIM(demand) <> '' "
            "GROUP BY project_id ORDER BY project_id"
        )
    ).mappings().all()
    if not rows:
        return

    migrated = skipped = 0
    for r in rows:
        pid = r["project_id"]
        exists = conn.execute(
            text("SELECT 1 FROM project_demand_versions WHERE project_id = :p LIMIT 1"), {"p": pid}
        ).fetchone()
        if exists:
            skipped += 1
            continue
        conn.execute(
            text(
                "INSERT INTO project_demand_versions "
                "(project_id, seq, version_no, label, demand, source, effective_date, is_current, note, created_by) "
                "VALUES (:p, 1, '1.0', :label, :demand, 'manual', NULL, 1, :note, NULL)"
            ),
            {
                "p": pid,
                "label": "初始版（历史数据迁移）",
                "demand": r["demand"],
                "note": "需求版本化上线时由既有客户需求自动生成",
            },
        )
        migrated += 1

    if migrated:
        logs.append(f"需求版本已为 {migrated} 个项目建立 V1.0")
    if skipped:
        logs.append(f"需求版本迁移跳过 {skipped} 个项目（已有版本记录）")


def run_migrations(engine: Engine) -> list[str]:
    """执行全部迁移，返回执行记录（供启动日志打印）。幂等，可重复调用。"""
    logs: list[str] = []
    with engine.connect() as conn:
        # PRAGMA foreign_keys 是连接级设置，且**在事务内切换不生效**。
        # 但 SQLAlchemy 2.0 在执行第一条语句后就会标记 autobegin，
        # 使随后的 conn.begin() 抛 InvalidRequestError；故先 commit 清掉该标记。
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.commit()
        try:
            with conn.begin():
                _add_column_if_missing(conn, "supply_relations", "capacity", "TEXT", logs)
                _migrate_inventory_plans(conn, logs)
                _migrate_demand_versions(conn, logs)
        finally:
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
    return logs
