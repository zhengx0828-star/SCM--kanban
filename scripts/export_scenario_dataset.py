"""把当前测试数据集导出为「自包含 Mock 数据集」（JSON + TS 两种形态）。

用途：
  1. docs/audit/scenario_dataset.json  —— 给后端 / 脚本 / 其他工具消费；
  2. frontend/src/mocks/scenario-dataset.ts —— 给前端在无后端时做离线渲染 / 单测用。

只导出测试数据集涉及的表，且保留原始 id（外键关系可直接复原）。
用法：runtime\\python\\python.exe scripts\\export_scenario_dataset.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "backend" / "products.db"
OUT_JSON = ROOT / "docs" / "audit" / "scenario_dataset.json"
OUT_TS = ROOT / "frontend" / "src" / "mocks" / "scenario-dataset.ts"

# 表 → 导出顺序（保持外键父表在前）
TABLES = [
    "suppliers",
    "base_sites",
    "materials",
    "projects",
    "supply_relations",
    "project_supply_relations",
    "share_records",
    "inventory_plans",
    "inventory_days",
]

# 场景标注：哪条数据在验证哪条逻辑分支（写进数据集，便于回归）
SCENARIO_TAGS = {
    "TEST-CORE-001": "共用料跨项目/跨基地：同一 PN 被 3 个项目 × 多基地使用（M:N 拓扑）",
    "TEST-CORE-002": "单基地专用（N:1）",
    "TEST-MULTI-020": "多对多 + 份额分摊：同项目同物料 3 家供应商",
    "TEST-SOLE-010": "独供（Sole Source）+ 需求数据缺失（hist/fcast 全空 → master 无 PSR.demand）",
    "TEST-ZERO-030": "零需求 / BOM 系数为 0 的静默失效场景",
    "TEST-BIG-040": "极值拉爆：超大需求与超大库存",
}


def dump_table(cur: sqlite3.Cursor, table: str) -> list[dict]:
    cur.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = None
    cur = conn.cursor()

    data: dict[str, list[dict]] = {}
    for t in TABLES:
        try:
            data[t] = dump_table(cur, t)
        except sqlite3.OperationalError as e:
            print(f"  跳过 {t}: {e}")
            data[t] = []
    conn.close()

    # ---- 场景标签挂到物料上 ----
    for m in data["materials"]:
        if m.get("pn") in SCENARIO_TAGS:
            m["_scenario"] = SCENARIO_TAGS[m["pn"]]

    ds = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source": "backend/products.db（供应链看板 Control Tower 全场景测试数据集）",
        "note": "本数据集由 scripts/seed_test_scenarios.py 生成，可用同一脚本幂等重建（脚本会先清空再写入）。",
        "counts": {t: len(v) for t, v in data.items()},
        "scenario_tags": SCENARIO_TAGS,
        **data,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(ds, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- TS 版本（前端 mock 用，类型放宽为 Record<string, unknown>[]） ----
    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    ts = [
        "/* 自动生成，请勿手工编辑 —— 由 scripts/export_scenario_dataset.py 产出 */",
        "/* 全场景供应链测试数据集：正常 / 异常 / 极端边界，覆盖网络拓扑、指标极值、级联风险三大维度。 */",
        "",
        "/* eslint-disable */",
        "export type ScenarioRow = Record<string, unknown>;",
        "",
        "export interface ScenarioDataset {",
    ]
    for t in TABLES:
        ts.append(f"  {t}: ScenarioRow[];")
    ts += [
        "  generated_at: string;",
        "  scenario_tags: Record<string, string>;",
        "  counts: Record<string, number>;",
        "}",
        "",
        "export const scenarioDataset: ScenarioDataset = ",
        json.dumps(ds, ensure_ascii=False, indent=2) + " as unknown as ScenarioDataset;",
        "",
        "export default scenarioDataset;",
        "",
    ]
    OUT_TS.write_text("\n".join(ts), encoding="utf-8")

    print("导出完成：")
    for t, rows in data.items():
        print(f"  {t:26s} {len(rows):4d} 行")
    print(f"  → {OUT_JSON}")
    print(f"  → {OUT_TS}")


if __name__ == "__main__":
    main()
