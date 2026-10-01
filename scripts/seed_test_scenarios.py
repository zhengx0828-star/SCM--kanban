"""供应链看板 · 全场景测试数据种子（拓扑 / 指标极值 / 级联 / 份额 / 空态）。

前置：后端在 http://127.0.0.1:8000 运行（start-all 或 uvicorn）。
执行：runtime\\python\\python.exe scripts\\seed_test_scenarios.py
      （内部会先调用 _reset_supplier_data.py --yes 清空供应商相关数据）
      加 --with-edge 才会额外创建审计用的空态项目 EDGE001（默认不创建，
      避免测试项目混进正式项目列表）

产出：
  - 数据库中的全场景测试数据（含 20+ 条份额场景、20 条库存推算单元）
  - docs/audit/scenario_manifest.json        场景清单 + 期望值
  - docs/audit/inventory_snapshot_import.xlsx 快照模式导入表（可复用于「导入」入口验证）
  - 控制台：独立复算 vs 接口返回 的一致性核对表
"""
from __future__ import annotations

import json
import math
import statistics
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
API = "http://127.0.0.1:8000"
OUT = ROOT / "docs" / "audit"
OUT.mkdir(parents=True, exist_ok=True)

TODAY = date.today()
WINDOW_DAYS = 30
LAST_WINDOW_DAY = TODAY + timedelta(days=WINDOW_DAYS - 1)
WINDOW_MONTH = f"{LAST_WINDOW_DAY.year:04d}-{LAST_WINDOW_DAY.month:02d}"
WINDOW_MONTH_NO = LAST_WINDOW_DAY.month
MONTH_DAYS = (LAST_WINDOW_DAY.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
MONTH_DAYS = MONTH_DAYS.day

MANIFEST: dict = {"generated_at": TODAY.isoformat(), "window_month": WINDOW_MONTH, "sections": {}}
PROJ_ID: dict[str, int] = {}
# 审计专用的「空态项目」EDGE001 默认不创建：正式库里不该出现测试项目。
# 需要验证空态渲染时用 `--with-edge` 显式开启。
WITH_EDGE_PROJECT = "--with-edge" in sys.argv
# STEP 6（份额）里发现的负向结论，统一并入 STEP 7 的 rollover_and_negative 段落
NEG_NOTES: list[dict] = []


# ===========================================================================
# HTTP
# ===========================================================================
def req(method, path, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    r = urllib.request.Request(API + path, data=data, method=method)
    if data is not None:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def must(method, path, body=None, ok=(200, 201)):
    st, data = req(method, path, body)
    if st not in ok:
        raise SystemExit(f"✗ {method} {path} → {st}\n{json.dumps(data, ensure_ascii=False)[:900]}")
    return data


def all_pages(path: str) -> list:
    """分页拉全量（page_size 上限 100）。"""
    out, page = [], 1
    while True:
        sep = "&" if "?" in path else "?"
        d = must("GET", f"{path}{sep}page={page}&page_size=100")
        out += d["items"]
        if page >= d["total_pages"]:
            return out
        page += 1


# ===========================================================================
# 独立参考实现（用于与后端交叉验证）
# ===========================================================================
def ref_row(hist, q, lt, on_hand, z=1.65, excess=30.0):
    daily = q / MONTH_DAYS
    demands = [daily] * WINDOW_DAYS
    avg_daily = sum(demands) / len(demands)
    if len(hist) < 2:
        cov, safe_days, derived = None, 5.0, False
    else:
        mean = statistics.fmean(hist)
        if mean <= 0:
            # 需求均值 ≤ 0（全 0 / 负数）→ COV = 0/0 不可算，口径同「样本不足」：
            # cov 记 NA、安全天数回退兜底、derived=False。不得返回 0.0，否则会被读成
            # 「零波动 = 零安全库存」，把一个「没数据」的情形伪装成「很安全」。
            cov, safe_days, derived = None, 5.0, False
        else:
            cov = statistics.stdev(hist) / mean
            safe_days, derived = max(z * cov * math.sqrt(max(lt, 0.0)), 0.0), True
    ss = avg_daily * safe_days
    rop = (lt + safe_days) * avg_daily
    endings = [on_hand - (j + 1) * daily for j in range(WINDOW_DAYS)]
    order_idx = next((j for j, e in enumerate(endings) if e <= rop), None)
    stockout_idx = next((j for j, e in enumerate(endings) if e <= 0), None)
    return {
        "cov": None if cov is None else round(cov, 4),
        "safe_days": round(safe_days, 4),
        "safe_days_derived": derived,
        "ss": round(ss, 2),
        "rop": round(rop, 2),
        "avg_daily": round(avg_daily, 2),
        "order_idx": order_idx,
        "stockout_idx": stockout_idx,
        "bucket": -1 if order_idx is None else (0 if order_idx == 0 else 1 if order_idx < 7 else 2 if order_idx < 14 else 3),
        "on_hand": on_hand,
    }


def on_hand_for_index(hist, q, lt, idx):
    """反推 on_hand，使「期末首次 ≤ ROP」恰落在窗口第 idx 天。"""
    daily = q / MONTH_DAYS
    rop = ref_row(hist, q, lt, 0.0)["rop"]
    return round(rop + (idx + 0.5) * daily, 2)


# ===========================================================================
# STEP 0
# ===========================================================================
def step_reset():
    print("=" * 90)
    print("STEP 0 · 清空供应商相关数据（projects/materials/base_sites/rules 保留）")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "_reset_supplier_data.py"), "--yes"], check=True)


# ===========================================================================
# STEP 1 · 主数据
# ===========================================================================
SUPPLIERS = [
    ("TS-A01", "星辰电子", "深圳", 114.06, 22.55, "red", "核心芯片独供，单点失效风险"),
    ("TS-A02", "恒锐半导体", "上海", 121.47, 31.23, "yellow", "核心芯片二供，产能爬坡中"),
    ("TS-B01", "中原密封件", "郑州", 113.62, 34.75, "green", None),
    ("TS-B02", "江南密封科技", "苏州", 120.58, 31.30, None, "风险等级未评估（NULL）"),
    ("TS-C01", "海达结构胶", "青岛", 120.38, 36.07, "green", None),
    ("TS-C02", "天成胶粘剂", "常州", 119.97, 31.81, "yellow", None),
    ("TS-C03", "西部新材料", "成都", 104.07, 30.67, "red", None),
    ("TS-D01", "北疆紧固件", "沈阳", 123.43, 41.80, None, "超长交期 60 天"),
    ("TS-E01", "未映射供应商", None, None, None, None, "无城市/经纬度 → 地图不落点"),
]

MATERIALS = [
    ("TEST-CORE-001", "主控芯片 MCU-64", "电子元器件", "LQFP64"),
    ("TEST-CORE-002", "主控芯片 MCU-64 备选", "电子元器件", "LQFP64"),
    ("TEST-SOLE-010", "独家密封圈", "密封件", "φ30"),
    ("TEST-MULTI-020", "多源结构胶", "胶粘剂", "50ml"),
    ("TEST-ZERO-030", "零需求测试件", "结构件", None),
    ("TEST-BIG-040", "超量测试件", "结构件", None),
    ("RB-SC-01", "份额场景·独供件", "份额测试", None),
    ("RB-SC-02", "份额场景·波动件", "份额测试", None),
    ("RB-SC-03", "份额场景·偏差件", "份额测试", None),
    ("RB-SC-04", "份额场景·偏差边界件", "份额测试", None),
    ("RB-SC-05", "份额场景·错配件", "份额测试", None),
    ("RB-SC-06", "份额场景·错配边界件", "份额测试", None),
    ("RB-SC-07", "份额场景·上期为0件", "份额测试", None),
    ("RB-SC-08", "份额场景·Q不一致件", "份额测试", None),
    ("RB-SC-09", "份额场景·Q缺失件", "份额测试", None),
    ("RB-SC-10", "份额场景·基地摊薄件", "份额测试", None),
    ("RB-SC-11", "份额场景·小数份额件", "份额测试", None),
    ("RB-SC-12", "份额场景·混合口径件", "份额测试", None),
    ("RB-SC-13", "份额场景·配额取整件", "份额测试", None),
    ("RB-SC-15", "份额场景·跨项目独供差异件", "份额测试", None),
]

SUP: dict[str, int] = {}
MAT: dict[str, int] = {}


def step_masters():
    global SUP, MAT
    print("=" * 90)
    print("STEP 1 · 主数据（9 供应商 / 20 物料%s）" % (" / 1 空态项目" if WITH_EDGE_PROJECT else ""))
    for code, name, city, lng, lat, risk, remark in SUPPLIERS:
        SUP[code] = must("POST", "/api/suppliers", {
            "code": code, "name": name, "city": city, "longitude": lng, "latitude": lat,
            "risk_level": risk, "remark": remark})["id"]
    # 物料/项目：幂等（已存在则复用，保证脚本可重复执行）
    for m in all_pages("/api/materials"):
        MAT[m["pn"]] = m["id"]
    for pn, name, cat, spec in MATERIALS:
        if pn not in MAT:
            MAT[pn] = must("POST", "/api/materials", {"pn": pn, "name": name, "category": cat, "spec": spec})["id"]
    for p in all_pages("/api/projects"):
        PROJ_ID[p["code"]] = p["id"]
    # EDGE001 只在显式加 --with-edge 时创建（默认不污染正式项目列表）
    if WITH_EDGE_PROJECT and "EDGE001" not in PROJ_ID:
        PROJ_ID["EDGE001"] = must("POST", "/api/projects", {
            "code": "EDGE001", "name": "边界验证项目（空态）", "status": "planning", "owner": "审计用"})["id"]
    print(f"  供应商 {len(SUP)} · 物料 {len(MAT)} · 项目 {PROJ_ID}")
    MANIFEST["sections"]["masters"] = {"suppliers": SUP, "materials": MAT, "projects": PROJ_ID}


def rel_of(pn, scode):
    """幂等：已存在同 (物料, 供应商) 关系则复用，避免 UNIQUE 冲突。"""
    for r in must("GET", "/api/supply-relations/options"):
        if r["pn"] == pn and r["supplier_code"] == scode:
            return r["id"]
    return must("POST", "/api/supply-relations", {"material_id": MAT[pn], "supplier_id": SUP[scode]})["id"]


def link(pid, rel_id, **fields):
    return must("POST", f"/api/projects/{pid}/relations", {"supply_relation_id": rel_id, **fields})["id"]


def _any_rel(pid):
    """取该项目已挂载的第一条供应关系 id（用于构造「非法月份」等只校验月份的场景）。"""
    return must("GET", f"/api/projects/{pid}/relations")[0]["supply_relation_id"]


def _purge_rels(rel_ids, sup_ids):
    """直连 SQLite 回收探针实体（未挂载关系录份额的守卫用例专用）。"""
    conn = sqlite3.connect(ROOT / "backend" / "products.db")
    cur = conn.cursor()
    for rid in rel_ids:
        cur.execute("DELETE FROM share_records WHERE supply_relation_id=?", (rid,))
        cur.execute("DELETE FROM project_supply_relations WHERE supply_relation_id=?", (rid,))
        cur.execute("DELETE FROM supply_relations WHERE id=?", (rid,))
    for sid in sup_ids:
        cur.execute("DELETE FROM suppliers WHERE id=?", (sid,))
    conn.commit()
    conn.close()


def psr_id(pcode, pn, scode):
    """按 项目 × 物料 × 供应商 找该项目明细 id。"""
    for l in must("GET", f"/api/projects/{PROJ_ID[pcode]}/relations"):
        if l["pn"] == pn and l["supplier_code"] == scode:
            return l["id"]
    return None


# ===========================================================================
# STEP 2 · 拓扑
# ===========================================================================
D1000, D2000, D500, DZERO = [1000.0] * 12, [2000.0] * 12, [500.0] * 12, [0.0] * 12


def step_topology():
    print("=" * 90)
    print("STEP 2 · 供应关系 + 项目明细（1:1 / 1:N / N:1 / M:N / 独供 / 跨基地 / 级联）")
    P1, P2, P3 = PROJ_ID["SSD222"], PROJ_ID["DVSF132"], PROJ_ID["SOCK124"]
    reg: dict[str, dict] = {}

    # M:N 级联（同一 L2 关系挂 3 个项目）
    core = rel_of("TEST-CORE-001", "TS-A01")
    for pid, tag in ((P1, "P1"), (P2, "P2"), (P3, "P3")):
        lid = link(pid, core, role="主供", is_primary=True, demand=D1000, capacity=[2000.0] * 12,
                   bom_factor=1.0, lead_time="7D")
        reg[f"T-CORE-{tag}"] = {"rel": core, "link": lid, "project": pid, "pn": "TEST-CORE-001", "supplier": "TS-A01"}
    # 1:N 二供
    alt = rel_of("TEST-CORE-001", "TS-A02")
    reg["T-CORE-ALT"] = {"rel": alt, "link": link(P1, alt, role="备选", is_primary=False, demand=D1000,
                                                 capacity=[500.0] * 12, bom_factor=1.0),
                         "project": P1, "pn": "TEST-CORE-001", "supplier": "TS-A02"}
    # 单项目专用料（跨项目 bom 不同）
    alt2 = rel_of("TEST-CORE-002", "TS-A02")
    reg["T-BASE-ONLY"] = {"rel": alt2, "link": link(P3, alt2, role="备选", demand=D500, bom_factor=2.5),
                          "project": P3, "pn": "TEST-CORE-002", "supplier": "TS-A02"}
    # 1:N 三家 + 跨项目复用
    for scode, cap, role in (("TS-C01", 3000.0, "主供"), ("TS-C02", 1500.0, "备选"), ("TS-C03", 800.0, "认证中")):
        r = rel_of("TEST-MULTI-020", scode)
        reg[f"T-MULTI-{scode}"] = {"rel": r, "link": link(P1, r, role=role, is_primary=(scode == "TS-C01"),
                                                          demand=D2000, capacity=[cap] * 12, bom_factor=1.0),
                                   "project": P1, "pn": "TEST-MULTI-020", "supplier": scode}
    r = rel_of("TEST-MULTI-020", "TS-C02")
    reg["T-MULTI-P3"] = {"rel": r, "link": link(P3, r, role="主供", is_primary=True, demand=D1000, bom_factor=1.0),
                         "project": P3, "pn": "TEST-MULTI-020", "supplier": "TS-C02"}
    # 独供 1:1
    r = rel_of("TEST-SOLE-010", "TS-B01")
    reg["T-SOLE"] = {"rel": r, "link": link(P1, r, role="主供", is_primary=True, demand=None, bom_factor=1.5),
                     "project": P1, "pn": "TEST-SOLE-010", "supplier": "TS-B01"}
    # 零需求 / BOM=0
    r = rel_of("TEST-ZERO-030", "TS-B02")
    reg["T-ZERO"] = {"rel": r, "link": link(P1, r, demand=DZERO, bom_factor=1.0),
                     "project": P1, "pn": "TEST-ZERO-030", "supplier": "TS-B02"}
    r = rel_of("TEST-ZERO-030", "TS-C01")
    reg["T-ZERO-BOM0"] = {"rel": r, "link": link(P1, r, demand=D2000, bom_factor=0.0),
                          "project": P1, "pn": "TEST-ZERO-030", "supplier": "TS-C01"}
    # N:1（一供应商多物料）
    r = rel_of("270200-00019", "TS-D01")
    reg["T-N1-A"] = {"rel": r, "link": link(P1, r, demand=D1000, bom_factor=1.0, lead_time="60D"),
                     "project": P1, "pn": "270200-00019", "supplier": "TS-D01"}
    r = rel_of("581601-00035", "TS-B02")
    reg["T-N1-B"] = {"rel": r, "link": link(P2, r, demand=D1000, bom_factor=1.0),
                     "project": P2, "pn": "581601-00035", "supplier": "TS-B02"}
    # bom_factor 留空 → 默认 1.0
    r = rel_of("TEST-BIG-040", "TS-E01")
    reg["T-BIG"] = {"rel": r, "link": link(P2, r, demand=D500, bom_factor=None),
                    "project": P2, "pn": "TEST-BIG-040", "supplier": "TS-E01"}
    print(f"  供应关系 {len({v['rel'] for v in reg.values()})} 条 · 项目明细 {len(reg)} 条")
    MANIFEST["sections"]["topology"] = {k: {kk: vv for kk, vv in v.items()} for k, v in reg.items()}


# ===========================================================================
# STEP 3 · 库存快照模式（Excel 导入）
# ===========================================================================
H3 = [1000.0, 1050.0, 980.0]
HFLAT = [3000.0, 3000.0, 3000.0]
HVOL = [100.0, 900.0, 1500.0]
HZERO = [0.0, 0.0, 0.0]

# key, 项目, 基地, PN, 供应商, LT, 月预测, hist, order_idx(-1=不下单), on_hand_override, 说明
SNAP_ROWS = [
    ("IN-S001", "SSD222", "常州", "TEST-CORE-001", "TS-A01", 7.0, 9000.0, H3, -1, 15000.0,
     "无需下单，但 DOH 封顶 30 → 默认 excess=30 判【蓝·积压】（口径耦合，见报告 F-08）"),
    ("IN-S002", "SSD222", "常州", "TEST-CORE-001", "TS-A02", 7.0, 0.0, HZERO, -1, 1000.0,
     "需求恒 0：COV 不可算（0/0）→ NA + 兜底安全天数；demand_blank=True 走中性「无消耗」提示（F-09）"),
    ("IN-S003", "SSD222", "重庆", "TEST-CORE-001", "TS-A01", 30.0, 1200.0, H3, 0, 300.0,
     "不可逆断货：DOH 6.8 < LT 30 → 今日下单也来不及（分桶 0 + 卡① hint）"),
    ("IN-S004", "SSD222", "苏州", "TEST-MULTI-020", "TS-C01", 7.0, 3000.0, HFLAT, 0, None, "分桶 0 今日需下单（产能回填 ok）"),
    ("IN-S005", "SSD222", "苏州", "TEST-MULTI-020", "TS-C02", 12.0, 3000.0, HFLAT, 3, None, "分桶 1（D2–D7，产能回填 tight）"),
    ("IN-S006", "SSD222", "苏州", "TEST-MULTI-020", "TS-C03", 15.0, 3000.0, HFLAT, 10, None, "分桶 2（D8–D14，产能回填 short）"),
    ("IN-S007", "SSD222", "宁波", "TEST-SOLE-010", "TS-B01", 20.0, 1000.0, HVOL, 20, None,
     "分桶 3（D15–D30）+ COV 高波动（safe_days 被 COV 拉大）"),
    ("IN-S008", "SSD222", "青岛", "270200-00019", "TS-D01", 60.0, 3600.0, [1500.0, 1550.0, 1600.0], 0, 500.0,
     "超长 LT 60 天 → 不可逆断货"),
    ("IN-S009", "SSD222", "苏州", "TEST-CORE-001", "TS-A01", 15.0, 2000.0, [1000.0], 5, None,
     "COV 不可算（hist 仅 1 月）→ 安全天数兜底 5、safe_days_derived=false、行内标「兜底」"),
    ("IN-S010", "SSD222", "青岛", "TEST-BIG-040", "TS-E01", 7.0, 5000.0, HFLAT, -1, 1000000000.0,
     "过剩 + 极值：on_hand=1e9 → 单元格极值渲染压力测试"),
    ("IN-S011", "DVSF132", "重庆", "TEST-CORE-001", "TS-A01", 7.0, 3100.0, H3, 6, None, "级联：核心件断供传导到 EP1"),
    ("IN-S012", "SOCK124", "东莞", "TEST-CORE-001", "TS-A01", 7.0, 3000.0, H3, 12, None, "级联：核心件断供传导到 PW1"),
    ("IN-S013", "DVSF132", "宁波", "581601-00035", "TS-B02", 10.0, 900.0, [100.0, 200.0], 14, None,
     "COV 中波动档 mid（COV=0.471 ∈ [0.35,0.8)）+ 晚窗口下单"),
    ("IN-S014", "SOCK124", "苏州", "TEST-MULTI-020", "TS-C02", 7.0, 3000.0, HFLAT, 0, None, "份额/库存交叉：同供应商多项目多基地"),
    ("IN-S015", "DVSF132", "青岛", "581601-00035", "TS-B02", 10.0, 1000.0, [100.0, 900.0], 0, 132.26,
     "浅红（期末 < SS）+ 不可逆 + 今日下单（红/库存双重触发）"),
]

SNAP_EXPECTED: dict[str, dict] = {}


def build_xlsx() -> Path:
    header = ["项目代码", "基地", "物料PN", "供应商代码", "LeadTime", "初始现有库存",
              "历史需求_2026-07", "历史需求_2026-08", "历史需求_2026-09", f"未来预测_{WINDOW_MONTH}"]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "库存推算单元"
    ws.append(header)
    for key, pcode, base, pn, scode, lt, q, hist, idx, ovr, note in SNAP_ROWS:
        on_hand = ovr if ovr is not None else on_hand_for_index(hist, q, lt, idx)
        hs = (list(hist) + [None, None, None])[:3]
        ws.append([pcode, base, pn, scode, lt, on_hand, hs[0], hs[1], hs[2], q])
        SNAP_EXPECTED[key] = {"ref": ref_row(hist, q, lt, on_hand), "note": note, "on_hand": on_hand,
                              "hist": hist, "q": q, "lt": lt, "key_spec": (pcode, base, pn, scode)}
    p = OUT / "inventory_snapshot_import.xlsx"
    wb.save(p)
    return p


def step_snapshot():
    print("=" * 90)
    print(f"STEP 3 · 库存快照模式（Excel 导入 {len(SNAP_ROWS)} 行，窗口 {WINDOW_MONTH}，当月 {MONTH_DAYS} 天）")
    p = build_xlsx()
    res = must("POST", "/api/inventory/import?file_path=" + urllib.parse.quote(str(p), safe=""))
    print(f"  imported={res['imported']} updated={res['updated']} errors={res['errors']}")
    MANIFEST["sections"]["inventory_snapshot"] = {
        "file": str(p.relative_to(ROOT)), "result": res,
        "rows": {k: {"note": v["note"], "on_hand": v["on_hand"], "ref": v["ref"]} for k, v in SNAP_EXPECTED.items()}}


# ===========================================================================
# STEP 4 · 底表联动模式
# ===========================================================================
MASTER_ROWS = [
    ("IN-M001", "SSD222", "TEST-CORE-001", "TS-A01", "宁波", 7.0, 400.0, "master 联动：客户需求 × BOM 1.0"),
    ("IN-M002", "SSD222", "TEST-ZERO-030", "TS-B02", "常州", 7.0, 500.0, "master 零需求（demand 全 0）"),
    ("IN-M003", "SSD222", "TEST-SOLE-010", "TS-B01", "青岛", 7.0, 500.0, "缺客户需求（PSR.demand=NULL）→ 琥珀徽章"),
    ("IN-M004", "DVSF132", "TEST-BIG-040", "TS-E01", "东莞", 7.0, 300.0, "bom_factor=NULL → 默认 1.0"),
    ("IN-M005", "SSD222", "TEST-ZERO-030", "TS-C01", "青岛", 7.0, 300.0, "bom_factor=0 → 需求恒 0"),
    ("IN-M006", "SOCK124", "TEST-CORE-002", "TS-A02", "青岛", 7.0, 300.0, "BOM=2.5 放大"),
]


def step_master():
    print("=" * 90)
    print("STEP 4 · 库存底表联动模式（POST /plans/bulk，6 行）")
    bases = {b["name"]: b["id"] for b in must("GET", "/api/bases")}
    items = [{"project_id": PROJ_ID[pc], "material_id": MAT[pn], "supplier_id": SUP[sc], "base_id": bases[b],
              "lead_time_days": lt, "on_hand": oh} for _, pc, pn, sc, b, lt, oh, _ in MASTER_ROWS]
    res = must("POST", "/api/inventory/plans/bulk", {"items": items})
    print(f"  created={res['created']} skipped={res['skipped']} errors={res['errors']}")
    MANIFEST["sections"]["inventory_master"] = {
        "result": res, "rows": {r[0]: {"note": r[-1], "on_hand": r[6]} for r in MASTER_ROWS}}


# ===========================================================================
# STEP 5 · 产能四档回填
# ===========================================================================
def step_capacity():
    print("=" * 90)
    print("STEP 5 · 产能校验四档回填（额度按 order_by_date 所在月对齐）")
    plans = must("GET", "/api/inventory/plans")
    idx = {(p["project_code"], p["base_name"], p["pn"], p["supplier_code"]): p for p in plans}
    targets = [("IN-S004", "ok", 0.50), ("IN-S005", "tight", 0.85), ("IN-S006", "short", 1.20), ("IN-S011", "zero", 0.0)]
    out = []
    for key, want, ratio in targets:
        _, pcode, base, pn, scode, lt, q, hist, _i, _o, note = next(r for r in SNAP_ROWS if r[0] == key)
        p = idx.get((pcode, base, pn, scode))
        lid = psr_id(pcode, pn, scode)
        if p is None or lid is None:
            out.append({"key": key, "skipped": True})
            continue
        limit = 0.0 if want == "zero" else round(p["rop"] / ratio, 2)
        cap = [0.0] * 12
        cap[WINDOW_MONTH_NO - 1] = limit
        must("PATCH", f"/api/projects/{PROJ_ID[pcode]}/relations/{lid}", {"capacity": cap})
        out.append({"key": key, "want": want, "limit": limit, "rop": p["rop"], "note": note})
    print("  " + json.dumps(out, ensure_ascii=False)[:700])
    MANIFEST["sections"]["capacity"] = out


# ===========================================================================
# STEP 6 · 份额全场景
# ===========================================================================
def share_create(pid, rel_id, month, *, share=None, q=None, d=None, c=None, bases=None):
    body = {"project_id": pid, "supply_relation_id": rel_id, "month": month}
    if share is not None:
        body["share_current"] = share
    for k, v in (("q_score", q), ("d_score", d), ("c_score", c)):
        if v is not None:
            body[k] = v
    if bases is not None:
        body["bases"] = bases
    return must("POST", "/api/share/records", body)


def step_share():
    print("=" * 90)
    print("STEP 6 · 份额管理全场景")
    P1, P2 = PROJ_ID["SSD222"], PROJ_ID["DVSF132"]
    M8, M9 = "2026-08", "2026-09"
    cases = []

    def pair(pn, s1, s2):
        r1, r2 = rel_of(pn, s1), rel_of(pn, s2)
        return r1, r2

    # RB01 独供 + 波动 → 优先级应归独供
    r = rel_of("RB-SC-01", "TS-B01")
    link(P1, r, role="主供", is_primary=True)
    share_create(P1, r, M8, share=40, q=0.7, d=0.5, c=0.5)
    share_create(P1, r, M9, share=100, q=0.7, d=0.5, c=0.5)
    cases.append({"id": "RB01", "pn": "RB-SC-01", "expect": "独供风险（同时满足波动 → 优先级取独供）", "month": M9})

    # RB02 波动（49 = 70×0.7 含等号；51 ≥ 30×1.3）
    r1, r2 = pair("RB-SC-02", "TS-C01", "TS-C02")
    link(P1, r1); link(P1, r2)
    for r, s in ((r1, 70), (r2, 30)):
        share_create(P1, r, M8, share=s, q=0.7, d=0.5, c=0.5)
    for r, s in ((r1, 49), (r2, 51)):
        share_create(P1, r, M9, share=s, q=0.7, d=0.5, c=0.5)
    cases.append({"id": "RB02", "pn": "RB-SC-02", "expect": "两条均「份额波动」（49≤70×0.7 含等号触发；51≥30×1.3 触发）", "month": M9})

    # RB03 建议偏差（share_prev=share_current 消除波动；quota_prev=50）
    r1, r2 = pair("RB-SC-03", "TS-C02", "TS-C03")
    link(P1, r1); link(P1, r2)
    for r in (r1, r2):
        share_create(P1, r, M8, share=50, q=0.5, d=0.5, c=0.5)
    share_create(P1, r1, M9, share=56, q=0.5, d=0.5, c=0.5)
    share_create(P1, r2, M9, share=44, q=0.5, d=0.5, c=0.5)
    cases.append({"id": "RB03", "pn": "RB-SC-03", "expect": "两条均「建议偏差」|56−50|=6>5、|44−50|=6>5", "month": M9})

    # RB04 偏差边界（恰 5pp 不触发）+ 错配边界（weighted 恰 0.5 不触发）→ 应无风险
    r1, r2 = pair("RB-SC-04", "TS-C03", "TS-C01")
    link(P1, r1); link(P1, r2)
    for r, s in ((r1, 55), (r2, 45)):
        share_create(P1, r, M8, share=s, q=0.5, d=0.5, c=0.5)
    for r, s in ((r1, 55), (r2, 45)):
        share_create(P1, r, M9, share=s, q=0.5, d=0.5, c=0.5)
    cases.append({"id": "RB04", "pn": "RB-SC-04", "expect": "无风险（偏差恰 5pp、weighted 恰 0.5 均不触发）", "month": M9})

    # RB05 错配（Q 一致→cost；w 0.46/0.30 → quota 61/39，share 60/40 → 偏差 ≤5）
    r1, r2 = pair("RB-SC-05", "TS-C01", "TS-C02")
    link(P1, r1); link(P1, r2)
    share_create(P1, r1, M8, share=60, q=0.3, d=0.5, c=0.5)
    share_create(P1, r2, M8, share=40, q=0.3, d=0.3, c=0.3)
    share_create(P1, r1, M9, share=60, q=0.3, d=0.5, c=0.5)
    share_create(P1, r2, M9, share=40, q=0.3, d=0.3, c=0.3)
    cases.append({"id": "RB05", "pn": "RB-SC-05", "expect": "TS-C01 一条「错配」；TS-C02 无风险", "month": M9})

    # RB06 错配边界（share=50 且 weighted=0.5 → 不触发）
    r1, r2 = pair("RB-SC-06", "TS-C02", "TS-C03")
    link(P1, r1); link(P1, r2)
    for m in (M8, M9):
        for r in (r1, r2):
            share_create(P1, r, m, share=50, q=0.5, d=0.5, c=0.5)
    cases.append({"id": "RB06", "pn": "RB-SC-06", "expect": "无风险（share=50 但 weighted=0.5 不满足 <0.5）", "month": M9})

    # RB07 prev=0 & cur>0 → 波动（优先级高于 40pp 偏差）
    r1, r2 = pair("RB-SC-07", "TS-C01", "TS-C02")
    link(P1, r1); link(P1, r2)
    share_create(P1, r1, M8, share=0, q=0.5, d=0.5, c=0.5)
    share_create(P1, r2, M8, share=100, q=0.5, d=0.5, c=0.5)
    share_create(P1, r1, M9, share=10, q=0.5, d=0.5, c=0.5)
    share_create(P1, r2, M9, share=90, q=0.5, d=0.5, c=0.5)
    cases.append({"id": "RB07", "pn": "RB-SC-07", "expect": "TS-C01「份额波动」（上期 0 → 本期 >0）；优先级高于 40pp 偏差", "month": M9})

    # RB08 Q 不一致 → quality 配比 0.7Q+0.1D+0.2C
    r1, r2 = pair("RB-SC-08", "TS-C03", "TS-B01")
    link(P1, r1); link(P1, r2)
    share_create(P1, r1, M9, share=64, q=0.7, d=0.5, c=0.5)
    share_create(P1, r2, M9, share=36, q=0.3, d=0.5, c=0.5)
    cases.append({"id": "RB08", "pn": "RB-SC-08", "expect": "weight_scheme=quality，weighted 0.64/0.36，建议配额 64/36", "month": M9})

    # RB09 Q/D/C 全缺失 → total<=0 → quota_suggested 保持 None
    r1, r2 = pair("RB-SC-09", "TS-B01", "TS-C01")
    link(P1, r1); link(P1, r2)
    share_create(P1, r1, M9, share=50)
    share_create(P1, r2, M9, share=50)
    cases.append({"id": "RB09", "pn": "RB-SC-09", "expect": "weighted/quota 均 None（不写入 0）", "month": M9})

    # RB10 基地分母摊薄
    r1, r2 = pair("RB-SC-10", "TS-C01", "TS-C02")
    link(P1, r1); link(P1, r2)
    share_create(P1, r1, M9, q=0.5, d=0.5, c=0.5, bases=[
        {"base": "常州", "lines": 2, "share": 80}, {"base": "重庆", "lines": 2, "share": None}])
    share_create(P1, r2, M9, q=0.5, d=0.5, c=0.5, bases=[
        {"base": "常州", "lines": 2, "share": 20}, {"base": "重庆", "lines": 2, "share": None}])
    cases.append({"id": "RB10", "pn": "RB-SC-10",
                  "expect": "自动份额 40 / 10（share 空但有 lines 的基地仍进分母 → 摊薄，见 F-14）", "month": M9})

    # RB11 小数份额启发式（全 ≤1 → ×100）
    r1, r2 = pair("RB-SC-11", "TS-C01", "TS-C02")
    link(P1, r1); link(P1, r2)
    share_create(P1, r1, M9, q=0.5, d=0.5, c=0.5, bases=[{"base": "常州", "lines": 1, "share": 0.6}])
    share_create(P1, r2, M9, q=0.5, d=0.5, c=0.5, bases=[{"base": "常州", "lines": 1, "share": 0.4}])
    cases.append({"id": "RB11", "pn": "RB-SC-11", "expect": "自动份额 60 / 40（小数口径正确识别）", "month": M9})

    # RB12 混合口径 → 现已显式拒绝（422）；统一口径后正常
    r1, r2 = pair("RB-SC-12", "TS-C01", "TS-C02")
    link(P1, r1); link(P1, r2)
    mix = [{"base": "常州", "lines": 1, "share": 0.5}, {"base": "苏州", "lines": 1, "share": 50}]
    st_mix, body_mix = req("POST", "/api/share/records",
                           {"project_id": P1, "supply_relation_id": r1, "month": M9,
                            "q_score": 0.5, "d_score": 0.5, "c_score": 0.5, "bases": mix})
    NEG_NOTES.append({
        "case": "RB12 基地份额小数/百分数混用",
        "status": st_mix,
        "expect": "422（口径必须统一，不再静默错 100 倍）",
        "actual": (body_mix or {}).get("detail", "") if isinstance(body_mix, dict) else str(body_mix)[:80],
    })
    uni = [{"base": "常州", "lines": 1, "share": 50}, {"base": "苏州", "lines": 1, "share": 50}]
    share_create(P1, r1, M9, q=0.5, d=0.5, c=0.5, bases=uni)
    share_create(P1, r2, M9, q=0.5, d=0.5, c=0.5, bases=uni)
    cases.append({"id": "RB12", "pn": "RB-SC-12",
                  "expect": "混合口径被 422 拦截（审计 F-18 已修）；统一百分数后自动份额 50 / 50", "month": M9})

    # RB13 配额取整 33/33/33 = 99
    rs = []
    for sc in ("TS-C01", "TS-C02", "TS-C03"):
        r = rel_of("RB-SC-13", sc)
        link(P1, r)
        share_create(P1, r, M9, share=33.33, q=0.5, d=0.5, c=0.5)
        rs.append(r)
    cases.append({"id": "RB13", "pn": "RB-SC-13", "expect": "三家等权 → 建议配额 33/33/33 = 99%（无余额补偿，SOP 声明可接受）", "month": M9})

    # RB15 跨项目独供差异
    r1 = rel_of("RB-SC-15", "TS-B01")
    r2 = rel_of("RB-SC-15", "TS-C01")
    link(P1, r1)
    link(P2, r1); link(P2, r2)
    share_create(P1, r1, M9, share=100, q=0.5, d=0.5, c=0.5)
    share_create(P2, r1, M9, share=60, q=0.5, d=0.5, c=0.5)
    share_create(P2, r2, M9, share=40, q=0.5, d=0.5, c=0.5)
    cases.append({"id": "RB15", "pn": "RB-SC-15", "expect": "P1 判独供 / P2 不判独供（独供按项目内判定）", "month": M9})

    print(f"  {len(cases)} 组场景已写入")
    MANIFEST["sections"]["share"] = cases


# ===========================================================================
# STEP 7 · 结转 + 负向请求
# ===========================================================================
def step_rollover_negative():
    print("=" * 90)
    print("STEP 7 · 结转（含跨年）+ 负向/边界请求")
    P1, P2, P3 = PROJ_ID["SSD222"], PROJ_ID["DVSF132"], PROJ_ID["SOCK124"]
    neg = []

    # 跨年结转 2026-12 → 2027-01
    r = rel_of("RB-SC-13", "TS-C01")
    link(P3, r)
    share_create(P3, r, "2026-12", share=70, q=0.5, d=0.5, c=0.5)
    st, d = req("POST", f"/api/share/rollover?project_id={P3}&from_month=2026-12&to_month=2027-01")
    neg.append({"case": "跨年结转 2026-12 → 2027-01", "status": st,
                "expect": "生成 2027-01 空档且 share_prev/quota_prev 带入", "detail": str(d)[:120]})
    # 反向结转（to 早于 from）
    st, d = req("POST", f"/api/share/rollover?project_id={P3}&from_month=2027-01&to_month=2026-12")
    neg.append({"case": "反向结转 to_month 早于 from_month", "status": st,
                "expect": "应 422（拒绝倒流）", "actual": "无校验，被静默跳过" if st == 200 else "被拒"})

    # 非法月份
    r900 = rel_of("RB-SC-09", "TS-B01")
    for bad_month in ("2026-13", "2026-00"):
        st, d = req("POST", "/api/share/records", {"project_id": P1, "supply_relation_id": r900, "month": bad_month})
        neg.append({"case": f"份额月份 {bad_month}", "status": st, "expect": "422",
                    "actual": "通过格式校验（pattern 未限制 01-12）" if st in (200, 201) else "被拒"})

    # 份额越界
    st, d = req("POST", "/api/share/records", {"project_id": P1, "supply_relation_id": r900, "month": "2026-11", "share_current": 150})
    neg.append({"case": "share_current=150", "status": st, "expect": "422"})
    st, d = req("POST", "/api/share/records", {"project_id": P1, "supply_relation_id": r900, "month": "2026-11", "q_score": 0.4})
    neg.append({"case": "QDC 非五档 q_score=0.4", "status": st, "expect": "422"})

    # 越项目写入
    st, d = req("POST", "/api/share/records", {"project_id": P2, "supply_relation_id": r900, "month": "2026-11"})
    neg.append({"case": "往「未挂载该供应关系」的项目写份额", "status": st,
                "expect": "422/409（项目未挂载该关系）",
                "actual": "写入成功（缺 ProjectSupplyRelation 校验，见 F-12）" if st in (200, 201) else "被拒"})

    # 需求/BOM 校验
    st, d = req("PUT", f"/api/projects/{P1}/demand", {"demand": [1.0] * 11})
    neg.append({"case": "demand 数组长度 11", "status": st, "expect": "422"})
    st, d = req("PUT", f"/api/projects/{PROJ_ID['SSD222']}/bom", {"material_pn": "RB-SC-01", "bom_factor": -1})
    neg.append({"case": "bom_factor=-1", "status": st, "expect": "422"})

    # 库存侧
    bases = must("GET", "/api/bases")
    st, d = req("POST", "/api/inventory/plans", {"project_id": P1, "material_id": MAT["TEST-CORE-001"],
                                                "supplier_id": SUP["TS-A01"], "base_id": bases[0]["id"]})
    neg.append({"case": "重复建档同一四元组", "status": st, "expect": "409"})
    plans = must("GET", "/api/inventory/plans")
    pid = next(p["id"] for p in plans if p["pn"] == "TEST-CORE-001" and p["project_code"] == "SSD222")
    st, d = req("PATCH", f"/api/inventory/plans/{pid}", {"on_hand": -100})
    neg.append({"case": "PATCH on_hand=-100", "status": st, "expect": "422（负库存无意义）",
                "actual": "接受负库存 → 全窗口断货（见 F-06）" if st == 200 else "被拒"})
    st, d = req("PATCH", f"/api/inventory/plans/{pid}", {"lead_time_days": 0})
    neg.append({"case": "PATCH lead_time_days=0", "status": st, "expect": "422"})
    fresh = next(b for b in bases if b["name"] == "东莞")   # 该单元尚未建档，用于验证「批内自重复」
    st, d = req("POST", "/api/inventory/plans/bulk", {"items": [
        {"project_id": P1, "material_id": MAT["TEST-CORE-001"], "supplier_id": SUP["TS-A01"], "base_id": fresh["id"]},
        {"project_id": P1, "material_id": MAT["TEST-CORE-001"], "supplier_id": SUP["TS-A01"], "base_id": fresh["id"]}]})
    neg.append({"case": "批量建档 items 内自重复", "status": st,
                "expect": "一条 created 一条 skipped（文档承诺单条失败不影响其余）",
                "actual": f"整批 500/失败（IntegrityError 未捕获，见 F-05）：{str(d)[:80]}" if st >= 500 else f"created={d.get('created') if isinstance(d, dict) else '?'} skipped={d.get('skipped') if isinstance(d, dict) else '?'}"})

    # 空态（EDGE001 为可选的审计项目，默认不创建 → 见顶部 WITH_EDGE_PROJECT）
    P4 = PROJ_ID.get("EDGE001")
    if P4:
        for path in (f"/api/projects/{P4}/materials", f"/api/projects/{P4}/suppliers", f"/api/projects/{P4}/relations"):
            st, d = req("GET", path)
            neg.append({"case": f"空态 {path}", "status": st, "detail": str(d)[:100]})
    else:
        print("  [skip] EDGE001 未创建，跳过空态项目探针（需要时加 --with-edge）")
    st, d = req("GET", "/api/inventory/plans?project_ids=99999")
    neg.append({"case": "库存筛选不存在的项目", "status": st, "detail": f"rows={len(d) if isinstance(d, list) else '?'}"})
    st, d = req("GET", "/api/share/summary?project_id=99999&month=2026-09")
    neg.append({"case": "份额 summary 不存在项目", "status": st, "detail": str(d)[:140]})

    # ---- 审计修复后的守卫（F-15 / F-20 / F-21 / F-19）----
    for bad_month in ("2026-13", "2026-00", "2026-9"):
        st, d = req("POST", "/api/share/records",
                    {"project_id": P1, "supply_relation_id": _any_rel(P1), "month": bad_month, "share_current": 100})
        neg.append({"case": f"份额月份非法 {bad_month}", "status": st, "expect": "422",
                    "actual": str(d)[:80]})
    # 未挂载的供应关系录份额 → 409
    _st, _s = req("POST", "/api/suppliers", {"code": "TS-ZZZ", "name": "未挂载验证供应商", "city": "常州"})
    if isinstance(_s, dict) and "id" in _s:
        _st2, _r = req("POST", "/api/supply-relations", {"material_id": MAT["RB-SC-01"], "supplier_id": _s["id"]})
        if isinstance(_r, dict) and "id" in _r:
            st, d = req("POST", "/api/share/records",
                        {"project_id": P1, "supply_relation_id": _r["id"], "month": "2026-09", "share_current": 50})
            neg.append({"case": "给「项目未挂载」的供应关系录份额", "status": st, "expect": "409",
                        "actual": str(d)[:90]})
            _purge_rels([_r["id"]], [_s["id"]])
    # 反向结转 → 422
    st, d = req("POST", f"/api/share/rollover?project_id={P1}&from_month=2026-09&to_month=2026-08")
    neg.append({"case": "反向月度结转 2026-09 → 2026-08", "status": st, "expect": "422",
                "actual": str(d)[:90]})
    st, d = req("GET", "/api/share/dashboard-stats")
    neg.append({"case": "dashboard-stats", "status": st, "detail": json.dumps(d, ensure_ascii=False)[:260]})
    st, d = req("GET", f"/api/inventory/plans?excess=60")
    capped = sum(1 for p in d if p["days"] and p["days"][-1]["doh_capped"]) if isinstance(d, list) else 0
    blue = sum(1 for p in d if p["days"] and p["days"][0]["status"] == "blue") if isinstance(d, list) else 0
    neg.append({"case": "excess=60（>窗口 30）时的口径变化", "status": st,
                "detail": f"封顶行 {capped} · 首格蓝灯 {blue}（对照 excess=30 时应为 {capped}）"})

    print(f"  {len(neg)} 项已执行")
    neg.extend(NEG_NOTES)
    MANIFEST["sections"]["rollover_and_negative"] = neg


# ===========================================================================
# STEP 8 · 交叉验证
# ===========================================================================
def step_verify():
    print("=" * 90)
    print("STEP 8 · 独立复算 vs 接口返回（快照行 + 全量概览）")
    plans = must("GET", "/api/inventory/plans")
    idx = {(p["project_code"], p["base_name"], p["pn"], p["supplier_code"]): p for p in plans}
    bad = 0
    for key, spec in SNAP_EXPECTED.items():
        pcode, base, pn, scode = spec["key_spec"]
        p = idx.get((pcode, base, pn, scode))
        if p is None:
            print(f"  MISSING {key}")
            bad += 1
            continue
        ref = spec["ref"]
        diffs = {}
        for name, a, b in (("cov", ref["cov"], None if p["cov"] is None else round(p["cov"], 4)),
                           ("safe_days", ref["safe_days"], round(p["safe_days"], 4)),
                           ("derived", ref["safe_days_derived"], p["safe_days_derived"]),
                           ("ss", ref["ss"], round(p["ss"], 2)),
                           ("rop", ref["rop"], round(p["rop"], 2)),
                           ("avg_daily", ref["avg_daily"], round(p["avg_daily"], 2))):
            if isinstance(a, bool) or isinstance(b, bool):
                if a != b:
                    diffs[name] = (a, b)
            elif a is None or b is None:
                if a != b:
                    diffs[name] = (a, b)
            elif abs(a - b) > 0.02:
                diffs[name] = (a, b)
        api_order = next((i for i, c in enumerate(p["days"]) if c["ending"] <= p["rop"]), None)
        api_bucket = -1 if api_order is None else (0 if api_order == 0 else 1 if api_order < 7 else 2 if api_order < 14 else 3)
        if api_bucket != ref["bucket"]:
            diffs["bucket"] = (ref["bucket"], api_bucket)
        api_stock = next((i for i, c in enumerate(p["days"]) if c["ending"] <= 0), None)
        if (api_stock is None) != (ref["stockout_idx"] is None):
            diffs["stockout"] = (ref["stockout_idx"], api_stock)
        if diffs:
            bad += 1
        print(f"  [{'OK  ' if not diffs else 'DIFF'}] {key} bucket={api_bucket} safe={p['safe_days']:.2f} "
              f"rop={p['rop']:.2f} order={str(p['order_by_date'])} stock={str(p['stockout_date'])} "
              f"cap={p['capacity_status']} src={p['demand_source']}" + (f"  ⟵ {diffs}" if diffs else ""))
    print(f"\n  快照行一致性：{len(SNAP_EXPECTED) - bad}/{len(SNAP_EXPECTED)}")
    MANIFEST["sections"]["verify"] = {"snapshot_rows": len(SNAP_EXPECTED), "mismatch": bad}

    print("\n  === 全部库存推算单元（%d 行）===" % len(plans))
    print("  项目      PN               供应商   基地  src      cov    safe    rop         on_hand       order        stockout     cap")
    for p in sorted(plans, key=lambda x: (x["project_code"], x["pn"], x["supplier_code"], x["base_name"])):
        print(f"  {p['project_code']:8s}  {p['pn']:16s} {p['supplier_code']:7s} {p['base_name']:4s}  "
              f"{p['demand_source']:8s} {str(p['cov'])[:5]:5s} {p['safe_days']:6.2f} {p['rop']:11.2f} "
              f"{p['on_hand']:>13.1f} {str(p['order_by_date']):12s} {str(p['stockout_date']):12s} {p['capacity_status']}")

    print("\n  === 份额记录 ===")
    for m in ("2026-09", "2026-08", "2026-12", "2027-01"):
        for pcode, pid in PROJ_ID.items():
            st, d = req("GET", f"/api/share/records?project_id={pid}&month={m}")
            if st != 200 or not isinstance(d, dict) or not d.get("items"):
                continue
            for r in d["items"]:
                print(f"  {r['month']} {r['project_name']:6s} {r['pn']:12s} {r['supplier_code']:7s} "
                      f"cur={str(r['share_current'])[:6]:6s} prev={str(r['share_prev'])[:6]:6s} qp={str(r['quota_prev'])[:6]:6s} "
                      f"qs={str(r['quota_suggested'])[:6]:6s} sole={int(r['is_sole'])} w={str(r['weighted_score'])[:6]:6s} "
                      f"scheme={str(r['weight_scheme']):8s} bases={str(r['bases'])[:58]}")


# ===========================================================================
# STEP 8.5 · 手工修正（日格编辑）全分支
# ===========================================================================
MANUAL_CASES = [
    # (项目, PN, 供应商, 基地, 偏移天, 字段, 值, 说明)
    ("SSD222", "TEST-CORE-001", "TS-A01", "宁波", 2, "demand_override", 99999.0, "应急：把系统预测需求改大 → 提前断货"),
    ("SSD222", "TEST-CORE-001", "TS-A01", "常州", 1, "manual_in", 5000.0, "在途到货 → 期末库存抬升"),
    ("DVSF132", "581601-00035", "TS-B02", "青岛", 4, "ending_override", 0.0, "盘点实盘为 0 → 强制已断货"),
    ("SSD222", "270200-00019", "TS-D01", "青岛", 3, "manual_demand", -3000.0, "需求临时下调（负修正）→ 库存被动抬高"),
    ("SOCK124", "TEST-CORE-002", "TS-A02", "青岛", 1, "doh_target", 10.0, "按目标 DOH 反推期末库存（doh_target 分支）"),
]


def step_manual_days():
    print("=" * 90)
    print("STEP 8.5 · 手工修正全分支（demand_override / manual_in / ending_override / manual_demand / doh_target）")
    plans = must("GET", "/api/inventory/plans")
    idx = {(p["project_code"], p["pn"], p["supplier_code"], p["base_name"]): p for p in plans}
    out = []
    for pcode, pn, scode, base, off, field, val, note in MANUAL_CASES:
        p = idx.get((pcode, pn, scode, base))
        if p is None:
            out.append({"key": f"{pcode}/{pn}/{scode}/{base}", "skipped": True, "note": "未找到该推算单元"})
            continue
        d = (TODAY + timedelta(days=off)).isoformat()
        before = {c["date"]: c for c in p["days"]}.get(d, {})
        st, after = req("PUT", f"/api/inventory/plans/{p['id']}/days", [{"date": d, field: val}])
        cell = {c["date"]: c for c in (after or {}).get("days", [])}.get(d, {}) if isinstance(after, dict) else {}
        out.append({"key": f"{pcode}/{pn}/{scode}/{base}", "date": d, "field": field, "value": val,
                    "http": st, "note": note,
                    "before": {"ending": before.get("ending"), "status": before.get("status")},
                    "after": {"ending": cell.get("ending"), "status": cell.get("status"), "manual": cell.get("manual")},
                    "order_by_date": (after or {}).get("order_by_date") if isinstance(after, dict) else None,
                    "stockout_date": (after or {}).get("stockout_date") if isinstance(after, dict) else None})
        print(f"  {field:16s} {pcode}/{pn}/{base} @{d} = {val}  → http={st} "
              f"ending {before.get('ending')} → {cell.get('ending')} status {before.get('status')} → {cell.get('status')}")
    MANIFEST["sections"]["manual_days"] = out


def finalize():
    """收尾：清掉负向测试留下的脏数据，保证数据集本身「可正常浏览」。

    - 删除非核心月份（非 2026-08/2026-09）份额：非法月份 2026-13/2026-00、越项目写入的
      2026-11、跨年结转探针的 2026-12/2027-01。否则 dashboard-stats 取 max(month) 会跳到
      空月份，把 2026-09 的风险数据整片遮住（这本身也是缺陷，见报告 F-15）。
    - 恢复被「PATCH on_hand=-100」探针改坏的行。
    """
    conn = sqlite3.connect(ROOT / "backend" / "products.db")
    cur = conn.cursor()
    n1 = cur.execute("SELECT COUNT(*) FROM share_records WHERE month NOT IN ('2026-08','2026-09')").fetchone()[0]
    cur.execute("DELETE FROM share_records WHERE month NOT IN ('2026-08','2026-09')")
    n2 = cur.execute("UPDATE inventory_plans SET on_hand=400 WHERE on_hand < 0").rowcount
    conn.commit()
    conn.close()
    print("=" * 90)
    print(f"STEP 9 · 收尾清理：删除非核心月份份额 {n1} 条、恢复负库存 {n2} 行")
    MANIFEST["sections"]["finalize"] = {"deleted_share_rows": n1, "restored_on_hand": n2}


def main():
    step_reset()
    step_masters()
    step_topology()
    step_snapshot()
    step_master()
    step_capacity()
    step_share()
    step_rollover_negative()
    finalize()
    step_verify()
    step_manual_days()   # 手工修正会改变期末库存，必须放在一致性核对之后
    mf = OUT / "scenario_manifest.json"
    mf.write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=" * 90)
    print(f"场景清单 → {mf}")


if __name__ == "__main__":
    main()
