"""份额联动验证 · 种子数据脚本（幂等，可重复执行）。

通过真实 API 造两月份额数据，覆盖：
- 独供（同项目同物料仅 1 家）跨 3 个项目；
- 份额波动（本月相对上期变化 ≥ ±30%）跨 2 个项目；
- 稳定物料不波动，用于对照。

执行前会清空 share_records 表（请确保已备份 products.db）。
"""
import json
import sqlite3
import urllib.request

BASE = "http://127.0.0.1:8000"
DB = "products.db"  # 相对 backend 目录

# 每条：(project_id, supply_relation_id, 08月份额, 09月份额)
# Q/D/C 统一给合法五档 0.7 / 0.5 / 0.5
ROWS = [
    # ---- 项目1 LFP3 (id=1) ----
    (1, 1, 70, 40),    # 结构胶A × 山东德邦   波动 -30
    (1, 16, 30, 60),   # 结构胶A × 上海康达   波动 +30  → material15 波动
    (1, 2, 100, 100),  # 发泡胶支架 × 回天     独供
    (1, 3, 100, 100),  # 环氧板 × 中科电气     独供
    (1, 4, 60, 60),    # 自冲铆钉 × 华威
    (1, 9, 40, 40),    # 自冲铆钉 × 江南
    (1, 5, 100, 100),  # 模组侧板 × 辽宁忠旺   独供
    # ---- 项目2 EP1 (id=2) ----
    (2, 6, 100, 100),  # 结构胶B × 富乐       独供
    (2, 7, 60, 20),    # 模组端板组件 × 渝创   波动 -40
    (2, 15, 40, 80),   # 模组端板组件 × 时代新材 波动 +40 → material17 波动
    (2, 10, 55, 55),   # 模组端板铸造 × 重庆渝美
    (2, 17, 45, 45),   # 模组端板铸造 × 广东鸿图
    (2, 18, 50, 50),   # 环氧板 × 凯诚
    (2, 19, 50, 50),   # 环氧板 × 中科电气
    (2, 20, 100, 100), # 自冲铆钉 × 江南       独供
    # ---- 项目3 PW1 (id=3) ----
    (3, 21, 100, 100), # 结构胶A × 正松       独供
    (3, 22, 60, 60),   # 发泡胶支架 × 回天
    (3, 23, 40, 40),   # 发泡胶支架 × 信维
    (3, 24, 50, 50),   # 自冲铆钉 × 华威
    (3, 25, 50, 50),   # 自冲铆钉 × 赛福
    (3, 26, 55, 55),   # 模组侧板 × 华菱
    (3, 27, 45, 45),   # 模组侧板 × 南山
    (3, 28, 100, 100), # 模组端板组件 × 时代新材 独供
]


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {path} 失败 {e.code}: {body}") from e


def get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    # 1) 清空 share_records（幂等）
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM share_records")
    conn.commit()
    conn.close()
    print("已清空 share_records")

    # 2) 造 08 月（上月）
    created = 0
    for pid, sr, s08, s09 in ROWS:
        post("/api/share/records", {
            "project_id": pid,
            "supply_relation_id": sr,
            "month": "2026-08",
            "share_current": s08,
            "q_score": 0.7,
            "d_score": 0.5,
            "c_score": 0.5,
        })
        created += 1
    print(f"08 月已创建 {created} 条")

    # 3) 造 09 月（本月，share_prev 自动带入 08 月份额）
    created = 0
    for pid, sr, s08, s09 in ROWS:
        post("/api/share/records", {
            "project_id": pid,
            "supply_relation_id": sr,
            "month": "2026-09",
            "share_current": s09,
            "q_score": 0.7,
            "d_score": 0.5,
            "c_score": 0.5,
        })
        created += 1
    print(f"09 月已创建 {created} 条")

    # 4) 打印 dashboard-stats
    stats = get("/api/share/dashboard-stats")
    print("\n===== /api/share/dashboard-stats =====")
    print(json.dumps(stats, ensure_ascii=False, indent=2))

    # 5) 断言关键值（口径：顶层 = 按物料 PN 去重的物料数；by_project = 记录级预警条数，与份额页 KPI/排行同口径）
    assert stats["month"] == "2026-09", f"最新月应为 2026-09，实际 {stats['month']}"
    assert stats["fluctuation_materials"] == 2, f"波动物料应为 2，实际 {stats['fluctuation_materials']}"
    assert stats["sole_materials"] == 7, f"独供物料应为 7，实际 {stats['sole_materials']}"
    by_project = {b["project_id"]: b for b in stats["by_project"]}
    assert by_project[1]["fluctuation_materials"] == 2 and by_project[1]["sole_materials"] == 3, "项目1 波动2条/独供3"
    assert by_project[2]["fluctuation_materials"] == 2 and by_project[2]["sole_materials"] == 2, "项目2 波动2条/独供2"
    assert by_project[3]["fluctuation_materials"] == 0 and by_project[3]["sole_materials"] == 2, "项目3 波动0/独供2"
    print("\n✓ 全部断言通过：顶层波动物料 2（PN 去重）、独供物料 7（PN 去重）；by_project 波动为记录级预警条数（1 个物料 2 家供应商波动 = 2 条）")


if __name__ == "__main__":
    main()
