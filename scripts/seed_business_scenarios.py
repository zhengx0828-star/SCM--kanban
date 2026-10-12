"""重建业务数据：小体量、全覆盖。

用途
----
清空既有业务数据（保留 rules 规则页），重建一套**语感真实、样本精简**的数据集：
项目/供应商/物料都用真实业务命名与编码，但每一个都刻意承载一种"会出现的真实情况"。

设计要点
--------
- 4 个项目：覆盖 多物料多源 / 需求激增 / 需求下滑积压 / 数据稀薄
- 8 家供应商：覆盖 独供 / 多源 / 未评估 / 已停用关系
- 12 个物料：覆盖 独家2 / 双源3 / 三源2 / 主备2 / 有关系未挂项目1 / 无关系2
- 库存：覆盖 DOH 五档 + 需求不可用三档 + COV=0 边界 + LT>30 边界
- 份额：覆盖 独供/波动/偏差/错配/Q不一致/基地摊薄

执行
----
    cd D:\\scm-kanban
    runtime\\python\\python.exe scripts\\seed_business_scenarios.py

幂等：先清空业务表再写入，可反复执行。
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "backend" / "products.db"
API = "http://127.0.0.1:8000"

TODAY = date.today()
WINDOW_DAYS = 30
LAST_WINDOW_DAY = TODAY + timedelta(days=WINDOW_DAYS - 1)

# 未来预测必须覆盖「今天起 30 天」的每个月
need_months: list[str] = []
_d = TODAY
while _d <= LAST_WINDOW_DAY:
    m = f"{_d.year:04d}-{_d.month:02d}"
    if m not in need_months:
        need_months.append(m)
    _d += timedelta(days=1)


# ---------------------------------------------------------------------------
# HTTP 助手
# ---------------------------------------------------------------------------

def req(method: str, path: str, payload=None, expect=(200, 201, 204)):
    """curl 调用后端（沙箱下 urllib 被代理劫持，必须走 curl --noproxy）。"""
    cmd = ["curl", "-s", "--noproxy", "*", "-X", method, API + path,
           "-H", "Content-Type: application/json",
           "-w", "\n__HTTP__%{http_code}"]
    if payload is not None:
        cmd += ["-d", json.dumps(payload, ensure_ascii=False)]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout
    body, _, code = out.rpartition("\n__HTTP__")
    code = int(code.strip() or 0)
    if code not in expect:
        raise RuntimeError(f"{method} {path} -> {code}\n{body[:400]}")
    try:
        return json.loads(body) if body.strip() else None
    except json.JSONDecodeError:
        return body


def must(method: str, path: str, payload=None):
    return req(method, path, payload)


def find_all(path: str) -> list[dict]:
    """取分页对象的全部 items（供应商返回裸数组）。"""
    d = req("GET", path)
    if isinstance(d, list):
        return d
    items, page = [], 1
    while True:
        sep = "&" if "?" in path else "?"
        d = req("GET", f"{path}{sep}page={page}&page_size=200")
        items += d.get("items", [])
        if page >= d.get("total_pages", 1):
            return items
        page += 1


# ---------------------------------------------------------------------------
# STEP 0 · 清空
# ---------------------------------------------------------------------------

def step_reset() -> None:
    """清空业务表。rules 规则页与 products 演示表保留。"""
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    # 外键开启后需按依赖顺序删；这里直接关掉约束整表清，最后清孤儿
    cur.execute("PRAGMA foreign_keys=OFF")
    has_seq = cur.execute(
        "select 1 from sqlite_master where type='table' and name='sqlite_sequence'"
    ).fetchone()
    for t in [
        "inventory_days", "inventory_plans", "share_records",
        "project_supply_relations", "supply_relations",
        "materials", "suppliers", "base_sites", "projects",
    ]:
        cur.execute(f'DELETE FROM "{t}"')
        if has_seq:
            cur.execute("DELETE FROM sqlite_sequence WHERE name=?", (t,))
    conn.commit()
    # 全库孤儿清理（rowid 复用会静默串数据，必须清干净）
    conn.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA foreign_key_check")
    bad = cur.fetchall()
    if bad:
        raise RuntimeError(f"外键检查未通过：{bad[:5]}")
    conn.close()
    print("[STEP 0] 已清空业务表（rules / products 保留）")


# ---------------------------------------------------------------------------
# 主数据
# ---------------------------------------------------------------------------

# 8 家供应商：覆盖 独供 / 多源 / 未评估 / 风险三色
SUPPLIERS = [
    dict(code="SUP-HX01", name="深圳市华芯电子有限公司", city="深圳",
         longitude=114.0579, latitude=22.5431, contact_person="陈志远",
         phone="0755-8623-1180", supply_material="主控芯片 / MCU",
         risk_level="red", remark="独供 MCU 主控，交期受晶圆产能制约"),
    dict(code="SUP-HX02", name="上海临港半导体有限公司", city="上海",
         longitude=121.4737, latitude=31.2304, contact_person="周敏",
         phone="021-5896-2200", supply_material="主控芯片 / MCU（备选）",
         risk_level="yellow", remark="二供认证中，产能仍在爬坡"),
    dict(code="SUP-MF01", name="郑州市中原密封件厂", city="郑州",
         longitude=113.6254, latitude=34.7466, contact_person="李国栋",
         phone="0371-6633-8899", supply_material="密封圈 / 密封垫",
         risk_level="green", remark="独供密封件，合作 6 年交付稳定"),
    dict(code="SUP-MF02", name="苏州江南精密密封科技", city="苏州",
         longitude=120.5853, latitude=31.2989, contact_person="吴雅琴",
         phone="0512-6677-3321", supply_material="密封圈（多源）",
         risk_level=None, remark="新导入供应商，尚无质量评分"),
    dict(code="SUP-JG01", name="青岛海达结构胶有限公司", city="青岛",
         longitude=120.3826, latitude=36.0671, contact_person="孙立新",
         phone="0532-8877-6612", supply_material="结构胶 / 导热胶",
         risk_level="green", remark="结构胶主供，产能充足"),
    dict(code="SUP-JG02", name="常州天成胶粘剂有限公司", city="常州",
         longitude=119.9741, latitude=31.8112, contact_person="赵宏",
         phone="0519-8899-1234", supply_material="结构胶（多源）",
         risk_level="yellow", remark="二供，价格优势但交付时有波动"),
    dict(code="SUP-JG03", name="成都西部新材料股份", city="成都",
         longitude=104.0665, latitude=30.5723, contact_person="罗建平",
         phone="028-8555-7788", supply_material="结构胶 / 特种胶",
         risk_level="red", remark="三供，近期质量评分下滑"),
    dict(code="SUP-JGJ01", name="沈阳北疆紧固件制造", city="沈阳",
         longitude=123.4315, latitude=41.8057, contact_person="马晓东",
         phone="024-2334-5566", supply_material="自冲铆钉 / 紧固件",
         risk_level=None, remark="紧固件供应商，尚未做风险评估"),
]

# 4 个项目：覆盖 多源正常 / 需求激增 / 需求下滑 / 数据稀薄
PROJECTS = [
    dict(code="PRJ-PACK-A", name="动力电池 PACK 产线",
         status="active", owner="张伟",
         description="方形电芯模组 PACK 装配，物料种类多、供应商分散，是主力量产项目"),
    dict(code="PRJ-ESS-B", name="储能系统集成项目",
         status="active", owner="刘芳",
         description="工商业储能柜集成，下半年订单激增，部分物料存在独供风险"),
    dict(code="PRJ-EDU-C", name="乘用车电驱总成项目",
         status="active", owner="王强",
         description="三合一电驱总成，车型改款导致需求下滑，库存积压需重点关注"),
    dict(code="PRJ-PROTO-D", name="试制样机验证项目",
         status="planning", owner="陈静",
         description="新平台试制，需求与 BOM 尚未定型，数据稀薄用于验证空态表现"),
]

# 基地
BASE_SITES = [
    dict(code="SZ", name="深圳", city="深圳", remark="华南总装基地"),
    dict(code="SH", name="上海", city="上海", remark="华东基地"),
    dict(code="ZZ", name="郑州", city="郑州", remark="中原基地"),
    dict(code="QD", name="青岛", city="青岛", remark="华北基地"),
    dict(code="CD", name="成都", city="成都", remark="西南基地"),
]

# 12 个物料：编码用真实格式，名称用业务叫法
MATERIALS = [
    dict(pn="110205-00031", name="车规级 MCU 主控芯片", category="电子元器件",
         spec="LQFP-144 / AEC-Q100", remark="模组控制核心，独供"),
    dict(pn="110205-00032", name="车规级 MCU 备选料", category="电子元器件",
         spec="LQFP-144 / 国产替代", remark="二供认证料，pin-to-pin 兼容"),
    dict(pn="581601-00035", name="环氧板绝缘隔片", category="绝缘材料",
         spec="1.5mm / FR-4", remark="模组绝缘件，独供"),
    dict(pn="581601-00046", name="环氧板绝缘隔片（加厚）", category="绝缘材料",
         spec="2.0mm / FR-4", remark="加厚规格，双源"),
    dict(pn="150200-00245", name="双组分结构胶", category="胶粘剂",
         spec="25kg/桶", remark="三源竞争，价格敏感"),
    dict(pn="150200-00246", name="导热结构胶", category="胶粘剂",
         spec="20kg/桶", remark="双源，导热性能关键"),
    dict(pn="270200-00019", name="自冲铆钉", category="紧固件",
         spec="M5×12 / 铝钢组合", remark="双源，主备格局"),
    dict(pn="270200-00028", name="自冲铆钉（加长）", category="紧固件",
         spec="M5×16 / 铝钢组合", remark="双源，主备格局"),
    dict(pn="510302-00415", name="模组端板铸件", category="结构件",
         spec="ADC12 / 压铸", remark="结构件，供应稳定"),
    dict(pn="510404-00220", name="模组侧板铝挤 U 型框", category="结构件",
         spec="6061-T6 / 铝挤", remark="三源，产能充足"),
    dict(pn="570954-00071", name="密封圈", category="密封件",
         spec="EPDM / φ42", remark="密封件，双源"),
    dict(pn="570954-00092", name="发泡胶支架", category="结构件",
         spec="PA66+GF30", remark="底表存在但尚未建立任何供应关系"),
]


def step_masters() -> dict[str, int]:
    """建供应商 / 项目 / 基地 / 物料。返回各表 code→id 映射。"""
    sup_id: dict[str, int] = {}
    for s in SUPPLIERS:
        r = must("POST", "/api/suppliers", s)
        sup_id[s["code"]] = r["id"]

    proj_id: dict[str, int] = {}
    for p in PROJECTS:
        r = must("POST", "/api/projects", p)
        proj_id[p["code"]] = r["id"]

    base_id: dict[str, int] = {}
    for b in BASE_SITES:
        r = must("POST", "/api/bases", b)
        base_id[b["code"]] = r["id"]

    mat_id: dict[str, int] = {}
    for m in MATERIALS:
        r = must("POST", "/api/materials", m)
        mat_id[m["pn"]] = r["id"]

    print(f"[主数据] 供应商 {len(sup_id)} · 项目 {len(proj_id)} · 基地 {len(base_id)} · 物料 {len(mat_id)}")
    return {"sup": sup_id, "proj": proj_id, "base": base_id, "mat": mat_id}


# ---------------------------------------------------------------------------
# 供应关系（L2）：物料 × 供应商
# ---------------------------------------------------------------------------

# 每个物料的供应商组合 —— 刻意覆盖 独供/双源/三源/主备/无关系
SUPPLY_MAP = {
    # 独供 ×2
    "110205-00031": ["SUP-HX01"],
    "581601-00035": ["SUP-MF01"],
    # 双源 ×3
    "581601-00046": ["SUP-MF01", "SUP-MF02"],
    "150200-00246": ["SUP-JG01", "SUP-JG03"],
    "570954-00071": ["SUP-MF01", "SUP-MF02"],
    # 三源 ×2
    "150200-00245": ["SUP-JG01", "SUP-JG02", "SUP-JG03"],
    "510404-00220": ["SUP-MF01", "SUP-JG02", "SUP-JGJ01"],
    # 主备格局 ×2（稍后挂项目时指定 is_primary）
    "270200-00019": ["SUP-JGJ01", "SUP-JG01"],
    "270200-00028": ["SUP-JGJ01", "SUP-JG03"],
    # 有供应关系但【不挂到任何项目】×1（孤儿关系）
    "510302-00415": ["SUP-MF01"],
    # 备选 MCU（双源，但只在项目中作备选）
    "110205-00032": ["SUP-HX02", "SUP-HX01"],
    # 570954-00092 发泡胶支架：刻意不给任何供应关系（纯底表物料）
}


def step_topology(m: dict) -> dict[tuple[str, str], int]:
    """建 L2 供应关系，返回 (pn, supplier_code) → relation_id。"""
    rel: dict[tuple[str, str], int] = {}
    for pn, sups in SUPPLY_MAP.items():
        for sc in sups:
            r = must("POST", "/api/supply-relations",
                     {"material_id": m["mat"][pn], "supplier_id": m["sup"][sc]})
            rel[(pn, sc)] = r["id"]
    print(f"[供应关系] {len(rel)} 条")
    return rel


# ---------------------------------------------------------------------------
# 项目明细（L3 / PSR）：需求 + BOM + 产能 + 主供
# ---------------------------------------------------------------------------

def _flat(base: float, n: int = 12) -> list[float]:
    """完全平稳需求 → COV=0（用于验证安全天数=0 的绝对阈值兜底）。"""
    return [base] * n


def _ramp(start: float, end: float, n: int = 12) -> list[float]:
    """线性爬坡（需求激增）。"""
    step = (end - start) / (n - 1)
    return [round(start + step * i, 1) for i in range(n)]


def _decline(start: float, end: float, n: int = 12) -> list[float]:
    """线性下滑（需求萎缩 → 库存积压）。"""
    return _ramp(start, end, n)


def _wavy(base: float, amp: float, n: int = 12) -> list[float]:
    """有波动（COV 中等偏高）。"""
    out = []
    for i in range(n):
        out.append(round(base + (amp if i % 3 == 0 else -amp / 2 if i % 3 == 1 else 0), 1))
    return out


def _zeros(n: int = 12) -> list[float]:
    """需求全 0（用于验证「需求为 0」档）。"""
    return [0.0] * n


# (项目代码, 物料PN, 供应商代码, role, is_primary, demand, bom_factor, capacity, lead_time)
PSR_ROWS = [
    # ---------- PRJ-PACK-A：多物料多源，正常态基线 ----------
    ("PRJ-PACK-A", "110205-00031", "SUP-HX01", "主供", True,
     _flat(3200), 1.0, _flat(4000), "7"),
    ("PRJ-PACK-A", "110205-00032", "SUP-HX02", "备选", False,
     _flat(3200), 1.0, _flat(1200), "15"),
    ("PRJ-PACK-A", "581601-00035", "SUP-MF01", "主供", True,
     _wavy(2800, 600), 2.0, _flat(7000), "10"),
    ("PRJ-PACK-A", "150200-00245", "SUP-JG01", "主供", True,
     _flat(900), 0.05, _flat(1200), "12"),
    ("PRJ-PACK-A", "150200-00245", "SUP-JG02", "二供", False,
     _flat(900), 0.05, _flat(600), "10"),
    ("PRJ-PACK-A", "150200-00245", "SUP-JG03", "三供", False,
     _flat(900), 0.05, _flat(500), "18"),
    ("PRJ-PACK-A", "510404-00220", "SUP-MF01", "主供", True,
     _flat(1500), 1.0, _flat(2000), "14"),

    # ---------- PRJ-ESS-B：需求激增 + 部分独供 ----------
    ("PRJ-ESS-B", "110205-00031", "SUP-HX01", "主供", True,
     _ramp(800, 3600), 1.0, _flat(4000), "7"),
    ("PRJ-ESS-B", "581601-00035", "SUP-MF01", "主供", True,
     _ramp(600, 2400), 2.0, _flat(6000), "10"),
    ("PRJ-ESS-B", "270200-00019", "SUP-JGJ01", "主供", True,
     _ramp(1200, 4800), 4.0, _flat(9000), "8"),
    ("PRJ-ESS-B", "270200-00019", "SUP-JG01", "备选", False,
     _ramp(1200, 4800), 4.0, _flat(3000), "20"),
    ("PRJ-ESS-B", "150200-00246", "SUP-JG01", "主供", True,
     _wavy(1400, 400), 0.08, _flat(2000), "12"),
    ("PRJ-ESS-B", "570954-00071", "SUP-MF01", "主供", True,
     _flat(2200), 3.0, _flat(8000), "9"),

    # ---------- PRJ-EDU-C：需求下滑 → 库存积压 ----------
    ("PRJ-EDU-C", "510302-00415", "SUP-MF01", "主供", True,
     _decline(3600, 900), 1.0, _flat(4000), "16"),
    ("PRJ-EDU-C", "270200-00028", "SUP-JGJ01", "主供", True,
     _decline(2000, 500), 4.0, _flat(8000), "8"),
    ("PRJ-EDU-C", "270200-00028", "SUP-JG03", "备选", False,
     _decline(2000, 500), 4.0, _flat(2400), "22"),
    ("PRJ-EDU-C", "581601-00046", "SUP-MF01", "主供", True,
     _decline(1800, 400), 2.0, _flat(5000), "10"),
    ("PRJ-EDU-C", "581601-00046", "SUP-MF02", "二供", False,
     _decline(1800, 400), 2.0, _flat(1800), "12"),

    # ---------- PRJ-PROTO-D：数据稀薄（覆盖需求不可用三档）----------
    # D1) BOM 系数显式 0 → 「BOM 为 0」档
    ("PRJ-PROTO-D", "150200-00245", "SUP-JG01", "主供", True,
     _flat(500), 0.0, _flat(1000), "12"),
    # D2) 需求全 0（BOM 正常）→ 「需求为 0」档
    ("PRJ-PROTO-D", "510404-00220", "SUP-MF01", "主供", True,
     _zeros(), 1.0, _flat(1000), "14"),
    # D3) 需求为空 list → 「缺需求数据」档
    ("PRJ-PROTO-D", "570954-00071", "SUP-MF02", "主供", True,
     None, None, None, "9"),
]


def step_psr(m: dict, rel: dict) -> dict[tuple[str, str, str], int]:
    """把供应关系挂到项目下（带需求/BOM/产能），返回 (proj, pn, sup) → psr_id。"""
    out: dict[tuple[str, str, str], int] = {}
    for proj, pn, sc, role, primary, demand, bom, cap, lt in PSR_ROWS:
        payload = {
            "supply_relation_id": rel[(pn, sc)],
            "role": role,
            "is_primary": primary,
            "lead_time": lt,
            "demand": demand,
            "bom_factor": bom,
            "capacity": cap,
        }
        r = must("POST", f"/api/projects/{m['proj'][proj]}/relations", payload)
        out[(proj, pn, sc)] = r["id"]
    print(f"[项目明细] {len(out)} 条（含 主供/备选、BOM=0、需求为空 等边界）")
    return out


# ---------------------------------------------------------------------------
# 份额（L3 项目级）
# ---------------------------------------------------------------------------

def share_create(proj_id: int, rel_id: int, month: str, **kw) -> dict:
    payload = {"project_id": proj_id, "supply_relation_id": rel_id, "month": month}
    payload.update(kw)
    return must("POST", "/api/share/records", payload)


def step_share(m: dict, rel: dict) -> int:
    """份额记录：覆盖 独供 / 波动 / 偏差 / 错配 / Q 不一致 / 基地摊薄 / 三源竞争。

    ⚠️ 两个必须遵守的约束（否则样例会被更高优先级的风险吞掉）：

    1. `is_sole = (同项目×同物料×同月 只有 1 条记录)`，而风险归类优先级是
       **独供 > 波动 > 偏差 > 错配**。所以「波动 / 偏差 / 错配」**必须挂在多源物料上**，
       否则记录一生成就被标成独供，永远走不到后面的分支（这不是 bug，是口径）。
    2. 同一个 (项目×物料×月) 下所有供应商共享同一个 is_sole，
       所以布局时要保证「专供某类风险的那家」和它的同物料伙伴**都在场**。

    月份跨越 08/09/10 三个月，让前端默认打开的「当前自然月」有数据，
    同时保留「上月 vs 本月」的跨月对比（波动 / 偏差都依赖 quota_prev / share_prev）。
    """
    n = 0
    pm, rm = m["proj"], m["rel"]
    m1, m2, m3 = "2026-08", "2026-09", "2026-10"

    # ══════════════════════════════════════════════════════════════
    # V1 独供：单一供应商 100% 平台期（稳定，不触发波动）
    #   110205-00031 在 PRJ-PACK-A 下只有 SUP-HX01 一家 → is_sole=1 → 命中「独供」
    # ══════════════════════════════════════════════════════════════
    for month in (m1, m2, m3):
        share_create(pm["PRJ-PACK-A"], rm[("110205-00031", "SUP-HX01")], month,
                     share_current=100, q_score=1, d_score=1, c_score=1,
                     bases=[{"base": "深圳", "share": 100, "lines": 2}],
                     remark="MCU 主控独供")
        n += 1

    # ══════════════════════════════════════════════════════════════
    # V2 波动：挂在**双源**物料 270200-00019（自冲铆钉，PRJ-ESS-B）
    #   主供 SUP-JGJ01：40 → 70 → 85（连续两月涨幅 ≥30%，波动持续两期）
    #   备选 SUP-JG01：恒定 30 → 30 → 15（第三月跌 50%，同样触发波动，
    #                  演示「跌」方向的波动）
    # ══════════════════════════════════════════════════════════════
    for month, main, alt in ((m1, 40, 30), (m2, 70, 30), (m3, 85, 15)):
        share_create(pm["PRJ-ESS-B"], rm[("270200-00019", "SUP-JGJ01")], month,
                     share_current=main, q_score=0.7, d_score=1, c_score=0.7,
                     bases=[{"base": "上海", "share": main, "lines": 1}],
                     remark="铆钉主供份额持续跃升（40→70→85）")
        n += 1
        share_create(pm["PRJ-ESS-B"], rm[("270200-00019", "SUP-JG01")], month,
                     share_current=alt, q_score=0.7, d_score=0.7, c_score=1,
                     bases=[{"base": "上海", "share": alt, "lines": 1}],
                     remark="铆钉备选（末月份额腰斩，演示下跌方向波动）")
        n += 1

    # ══════════════════════════════════════════════════════════════
    # V3 偏差：挂在**三源**物料 150200-00245（双组分结构胶，PRJ-PACK-A）
    #   三家加权分相同 → 建议配额各 33%；但主供 SUP-JG01 手工维持 90%，
    #   |90 − 33| = 57pt > 5pt → 每月都触发「偏差」（且份额不跨月变化 → 不误报波动）
    # ══════════════════════════════════════════════════════════════
    for month in (m1, m2, m3):
        share_create(pm["PRJ-PACK-A"], rm[("150200-00245", "SUP-JG01")], month,
                     share_current=90, q_score=0.7, d_score=0.7, c_score=0.7,
                     bases=[{"base": "青岛", "share": 90, "lines": 1}],
                     remark="手工维持 90% 高份额，与建议配额 33% 严重偏离")
        n += 1
        share_create(pm["PRJ-PACK-A"], rm[("150200-00245", "SUP-JG02")], month,
                     share_current=7, q_score=0.7, d_score=0.7, c_score=0.7,
                     bases=[{"base": "青岛", "share": 7, "lines": 1}],
                     remark="结构胶二供")
        n += 1
        share_create(pm["PRJ-PACK-A"], rm[("150200-00245", "SUP-JG03")], month,
                     share_current=3, q_score=0.7, d_score=0.7, c_score=0.7,
                     bases=[{"base": "青岛", "share": 3, "lines": 1}],
                     remark="结构胶三供")
        n += 1

    # ══════════════════════════════════════════════════════════════
    # V5 基地摊薄：同物料在两个基地份额不同 + 拉线数加权
    #   深圳 30%×3 线 / 成都 60%×1 线 → 加权后 37.5%
    # ══════════════════════════════════════════════════════════════
    share_create(pm["PRJ-PACK-A"], rm[("510404-00220", "SUP-MF01")], m2,
                 q_score=0.7, d_score=0.7, c_score=0.7,
                 bases=[{"base": "深圳", "share": 30, "lines": 3},
                        {"base": "成都", "share": 60, "lines": 1}],
                 remark="基地间份额摊薄（拉线数加权）")
    n += 1

    # ══════════════════════════════════════════════════════════════
    # V7 错配：份额 ≥50% 但加权分 < 0.5（差的拿最多活）
    #   挂 PRJ-EDU-C 的**双源**物料 270200-00028（自冲铆钉加长）。
    #   要让「错配」在**当前月也能出现**且不被「偏差」抢先，必须让 share ≈ 系统建议配额
    #   （偏差判据 |share − quota_prev| > 5pt）。而建议配额 = wscore 归一化，
    #   所以两家 wscore 必须接近，才会各拿 ~50%，与 50% 的实际份额吻合。
    #   故两家都用 Q=0.5/D=0.3/C=0.5（同 Q 方案 Q20/D10/C70 → wscore 0.48 < 0.5）：
    #     → 建议配额各 50，实际份额各 50 → 偏差 = 0（不触发）
    #     → wscore 0.48 < 0.5 且 share 50 ≥ 50 → 命中「错配」✓
    #   份额三月恒定 → 不触发波动。
    # ══════════════════════════════════════════════════════════════
    for month in (m1, m2, m3):
        share_create(pm["PRJ-EDU-C"], rm[("270200-00028", "SUP-JGJ01")], month,
                     share_current=50, q_score=0.5, d_score=0.3, c_score=0.5,
                     bases=[{"base": "郑州", "share": 50, "lines": 1}],
                     remark="加权分 <0.5 却仍占 50% 份额 → 份额×评分错配")
        n += 1
        share_create(pm["PRJ-EDU-C"], rm[("270200-00028", "SUP-JG03")], month,
                     share_current=50, q_score=0.5, d_score=0.3, c_score=0.5,
                     bases=[{"base": "郑州", "share": 50, "lines": 1}],
                     remark="同样评分偏低、份额 50%（与主供对称，便于观察错配）")
        n += 1

    # ══════════════════════════════════════════════════════════════
    # V6 Q 一致 vs 不一致的权重切换演示（同上双源物料的另一条）
    #   581601-00046（绝缘隔片加厚，PRJ-EDU-C 下 SUP-MF01 主 + SUP-MF02 二）
    #   Q 一致 → 成本权重 70%；Q 不一致 → 整组切 Q70/D10/C20
    # ══════════════════════════════════════════════════════════════
    for month in (m2, m3):
        share_create(pm["PRJ-EDU-C"], rm[("581601-00046", "SUP-MF01")], month,
                     share_current=60, q_score=1, d_score=0.7, c_score=1,
                     bases=[{"base": "郑州", "share": 60, "lines": 1}],
                     remark="绝缘隔片主供，Q/C 一致（成本权重 70%）")
        n += 1
        share_create(pm["PRJ-EDU-C"], rm[("581601-00046", "SUP-MF02")], month,
                     share_current=40, q_score=0.7, d_score=0.7, c_score=1,
                     bases=[{"base": "郑州", "share": 40, "lines": 1}],
                     remark="绝缘隔片二供，Q 与主供不一致 → 权重切 Q70/D10/C20")
        n += 1

    print(f"[份额] {n} 条（{m1}/{m2}/{m3} 三月；独供·波动·偏差·错配·Q不一致·基地摊薄）")
    return n


# ---------------------------------------------------------------------------
# 库存（Excel 导入，精确控制 历史需求 / 未来预测）
# ---------------------------------------------------------------------------

def _hist_months(k: int) -> list[str]:
    """最近 k 个自然月（含本月）。"""
    out, y, mo = [], TODAY.year, TODAY.month
    for _ in range(k):
        out.append(f"{y:04d}-{mo:02d}")
        mo -= 1
        if mo == 0:
            mo, y = 12, y - 1
    return list(reversed(out))


def build_inventory_xlsx(path: Path) -> list[tuple]:
    """生成「带快照」的库存导入 Excel（历史需求 + 未来预测）。

    覆盖：DOH 五档 / COV=0 边界 / LT>30 边界 / 蓝灯过剩
    注意：本表**不含**「需求不可用三档」的行 —— 那些行走底表联动，
    另存一个「整表无月份列」的文件（见 build_inventory_master_xlsx）。
    原因是导入器的校验是**整表级**的：只要表中任一列是「未来预测_」，
    所有行都必须覆盖 30 天窗口。
    """
    import openpyxl

    hist_m = _hist_months(3)          # 3 个月历史（才够算 COV）
    fc_m = need_months                # 未来预测必须覆盖 30 天窗口

    header = (["项目代码", "基地", "物料PN", "供应商代码", "采购LeadTime(天)", "初始现有库存"]
              + [f"历史需求_{mm}" for mm in hist_m]
              + [f"未来预测_{mm}" for mm in fc_m])

    # (项目, 基地, PN, 供应商, LT, 期初库存, [3个月历史], {未来各月预测}, 备注)
    rows = [
        # ① 库存耗尽：期初 0，需求正常 → DOH≤0
        ("PRJ-PACK-A", "深圳", "110205-00031", "SUP-HX01", 7, 0,
         [3200, 3200, 3200], {mm: 3200 for mm in fc_m}, "库存已归零，主供断料"),

        # ② 紧急（绝对阈值）：DOH≈1天，且需求完全平稳 → COV=0 → 安全天数=0
        ("PRJ-PACK-A", "深圳", "110205-00031", "SUP-HX02", 7, 110,
         [3200, 3200, 3200], {mm: 3200 for mm in fc_m}, "备选料库存极低，验证绝对阈值兜底"),

        # ② 紧急（跌破安全天数）：波动大 → 安全天数高，DOH 低于它
        ("PRJ-PACK-A", "深圳", "581601-00035", "SUP-MF01", 10, 900,
         [2800, 3400, 2200], {mm: 2800 for mm in fc_m}, "波动大导致安全库存高"),

        # ③ 偏低：DOH 够 LT 但不够安全库存
        ("PRJ-PACK-A", "深圳", "510404-00220", "SUP-MF01", 14, 1100,
         [1400, 1600, 1500], {mm: 1500 for mm in fc_m}, "侧板库存偏紧"),

        # ⚠️ 边界：LeadTime=60 > 30 天窗口 → 即使 30 天耗不完也必须判「偏低」
        ("PRJ-ESS-B", "上海", "270200-00019", "SUP-JGJ01", 60, 400,
         [1200, 1400, 1300], {mm: 1300 for mm in fc_m}, "LT>30天，验证 capped 不当充足"),

        # ④ 充足：库存远大于需求
        ("PRJ-PACK-A", "成都", "150200-00245", "SUP-JG01", 12, 9000,
         [900, 950, 880], {mm: 900 for mm in fc_m}, "结构胶库存充足"),

        # ④ 充足→蓝灯过剩：需求下滑 + 高库存
        ("PRJ-EDU-C", "郑州", "510302-00415", "SUP-MF01", 16, 12000,
         [3600, 2400, 1800], {mm: 1200 for mm in fc_m}, "需求下滑，库存积压"),

        # ④ 充足：另一条正常行
        ("PRJ-ESS-B", "上海", "570954-00071", "SUP-MF01", 9, 4200,
         [2200, 2200, 2200], {mm: 2200 for mm in fc_m}, "密封圈供应平稳"),

        # ③ 偏低：二供份额小
        ("PRJ-PACK-A", "成都", "150200-00245", "SUP-JG02", 10, 260,
         [900, 900, 900], {mm: 900 for mm in fc_m}, "二供份额小，库存偏低"),
    ]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "库存推算单元"
    ws.append(header)
    for proj, base, pn, sc, lt, oh, hist, fcast, _note in rows:
        line = [proj, base, pn, sc, lt, oh]
        for q in hist:
            line.append(q)
        line += [None] * (len(hist_m) - len(hist))
        for mm in fc_m:
            line.append(fcast.get(mm))
        ws.append(line)
    wb.save(path)
    return rows


def build_inventory_master_xlsx(path: Path) -> list[tuple]:
    """生成「整表无月份列」的库存导入 Excel → 走底表联动。

    覆盖「需求不可用三档」：
      · BOM 系数为 0  → 需求被乘成 0
      · 需求全 0      → 有序列但窗口日均 ≈ 0
      · 需求为空      → 完全无需求序列
    """
    import openpyxl

    rows = [
        # ⑤ BOM 为 0（该 PSR 的 bom_factor 已设为 0）
        ("PRJ-PROTO-D", "青岛", "150200-00245", "SUP-JG01", 12, 500,
         "BOM 系数为 0 → 需求被乘成 0"),
        # ⑤ 需求为 0（该 PSR 的 demand 全 0，BOM=1）
        ("PRJ-PROTO-D", "青岛", "510404-00220", "SUP-MF01", 14, 300,
         "需求全 0 → 有序列但窗口中无消耗"),
        # ⑤ 缺需求数据（该 PSR 的 demand / bom 均为空）
        ("PRJ-PROTO-D", "成都", "570954-00071", "SUP-MF02", 9, 500,
         "需求与 BOM 均未录入 → 无需求数据"),
    ]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "底表联动"
    ws.append(["项目代码", "基地", "物料PN", "供应商代码", "采购LeadTime(天)", "初始现有库存"])
    for proj, base, pn, sc, lt, oh, _note in rows:
        ws.append([proj, base, pn, sc, lt, oh])
    wb.save(path)
    return rows


def _import_one(path: Path, label: str) -> int:
    r = must("POST", f"/api/inventory/import?file_path={path.as_posix()}")
    imported = r.get("imported", 0)
    updated = r.get("updated", 0)
    errs = r.get("errors") or []
    print(f"[库存] {label} imported={imported} updated={updated} errors={len(errs)}")
    for e in errs:
        print("   ! ", e)
    if errs:
        raise RuntimeError(f"{label} 导入有 {len(errs)} 条错误，请检查上表")
    return imported + updated


def step_inventory(docs: Path) -> tuple[int, list]:
    """分两个文件导入：带快照的 + 走底表联动的。"""
    snap = docs / "inventory_business_import.xlsx"
    master = docs / "inventory_master_linkage_import.xlsx"
    rows_a = build_inventory_xlsx(snap)
    rows_b = build_inventory_master_xlsx(master)
    n = _import_one(snap, "带快照") + _import_one(master, "底表联动")
    return n, rows_a + rows_b


# ---------------------------------------------------------------------------
# 自校验
# ---------------------------------------------------------------------------

def step_verify() -> None:
    """核对各模块数据量与关键边界。"""
    print()
    print("=" * 78)
    print("自校验")
    print("=" * 78)

    plans = req("GET", "/api/inventory/plans?project_ids=1,2,3,4")
    print(f"/plans 行数 = {len(plans)}")

    # DOH 分档分布
    dist: dict[str, int] = {}
    for p in plans:
        dist[p.get("doh_bucket", "?")] = dist.get(p.get("doh_bucket", "?"), 0) + 1
    print("DOH 分档分布:", json.dumps(dist, ensure_ascii=False))

    # 关键边界：LT>30 的行必须不是「充足」
    cap_bug = [p for p in plans
               if (p.get("lead_time_days") or 0) > 30
               and p.get("doh_bucket") == "ok"]
    print(f"LT>30 却判充足的行 = {len(cap_bug)}（应为 0）")

    # 关键边界：COV=0 且 DOH<3 必须进「紧急」
    thr_bug = [p for p in plans
               if (p.get("cov") or 0) == 0
               and (p.get("doh_today") or 999) < 3
               and (p.get("doh_today") or 999) > 0
               and p.get("doh_bucket") != "urgent"]
    print(f"COV=0 且 DOH<3 却非紧急的行 = {len(thr_bug)}（应为 0）")

    # 需求不可用三档
    src: dict[str, int] = {}
    for p in plans:
        if p.get("doh_bucket") == "unknown":
            k = ("缺需求数据" if not p.get("hist") and not p.get("fcast")
                 else "BOM为0" if p.get("bom_zero")
                 else "需求为0")
            src[k] = src.get(k, 0) + 1
    print("需求不可用三档:", json.dumps(src, ensure_ascii=False))

    ov = req("GET", "/api/inventory/project-overview")
    print(f"/project-overview 项目数 = {len(ov)}")
    for it in ov:
        b = it.get("doh_buckets", {})
        print("   %-12s %-18s 行=%-3s 物料=%-3s 耗尽%s/紧急%s/偏低%s/充足%s/无法评估%s" % (
            it.get("project_code"), it.get("project_name"),
            it.get("plan_count"), it.get("material_count"),
            b.get("stockout"), b.get("urgent"), b.get("low"), b.get("ok"), b.get("unknown")))

    # 份额
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    for t in ["suppliers", "projects", "base_sites", "materials",
              "supply_relations", "project_supply_relations",
              "share_records", "inventory_plans", "inventory_days", "rules"]:
        print(f"   {t:30s} {cur.execute(f'select count(*) from {t}').fetchone()[0]}")
    cur.execute("PRAGMA foreign_key_check")
    fk = cur.fetchall()
    print(f"   外键检查孤儿行 = {len(fk)}")
    conn.close()

    # ── 份额四类风险覆盖率（独供 > 波动 > 偏差 > 错配，必须四类都能出现）
    print()
    print("份额风险归类覆盖（优先级 独供>波动>偏差>错配）:")
    risk_seen: set[str] = {}
    for prj in req("GET", "/api/projects")["items"]:
        pid = prj["id"]
        for month in ("2026-08", "2026-09", "2026-10"):
            rks = req("GET", f"/api/share/risks?project_id={pid}&month={month}")
            if not rks:
                continue
            for r in rks:
                rt = r.get("risk_type")
                if rt and rt not in risk_seen:
                    risk_seen[rt] = f"{prj['code']} @{month} {r.get('pn')}/{r.get('supplier_code')}"
                    print(f"   ✓ {rt:12s} {risk_seen[rt]}")
    missing = {"sole", "fluctuation", "deviation", "mismatch"} - set(risk_seen)
    if missing:
        print(f"   ✗ 未覆盖的风险类型: {sorted(missing)}"
              f"（波动/偏差/错配必须挂在多源物料上，否则被独供掩蔽）")
    else:
        print("   ✓ 四类风险全部覆盖")

    # ── 份额：当前自然月必须有数据（否则前端默认打开的月份是空页）
    cur_month = TODAY.strftime("%Y-%m")
    total_cur = 0
    for prj in req("GET", "/api/projects")["items"]:
        recs = req("GET", f"/api/share/records?project_id={prj['id']}&month={cur_month}")
        total_cur += len(recs.get("items", []) if isinstance(recs, dict) else recs)
    flag = "✓" if total_cur > 0 else "✗"
    print(f"   {flag} 当前月 {cur_month} 份额记录 = {total_cur} 条（应 > 0，否则 /share 默认页空白）")


def main() -> None:
    print("=" * 78)
    print(f"重建业务数据 · {TODAY} · 未来窗口 {TODAY} ~ {LAST_WINDOW_DAY}")
    print("=" * 78)

    if not DB.exists():
        raise SystemExit(f"数据库不存在：{DB}")

    step_reset()
    m = step_masters()
    rel = step_topology(m)
    m["rel"] = rel
    step_psr(m, rel)
    step_share(m, rel)

    docs = ROOT / "docs" / "audit"
    docs.mkdir(parents=True, exist_ok=True)
    step_inventory(docs)

    step_verify()
    print()
    print("重建完成。导入模板 →", docs / "inventory_business_import.xlsx")


if __name__ == "__main__":
    main()
