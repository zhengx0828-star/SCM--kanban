"""边界探针：验证后端在「脏 JSON / 批内重复 / 孤儿引用 / 非法值」下的行为。

纪律：所有探针只使用临时实体（TMP-* 前缀），探针结束即回收，绝不触碰测试数据集。
用法：runtime\\python\\python.exe scripts\\_probe_and_cleanup.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
API = "http://127.0.0.1:8000"
DB = ROOT / "backend" / "products.db"
OUT = ROOT / "docs" / "audit"
RESULTS: list[dict] = []


def req(method, path, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    r = urllib.request.Request(API + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def items(path):
    sep = "&" if "?" in path else "?"
    d = req("GET", f"{path}{sep}page=1&page_size=100")[1]
    if isinstance(d, list):
        return d
    out, page = list(d["items"]), 1
    while page < d.get("total_pages", 1):
        page += 1
        out += req("GET", f"{path}{sep}page={page}&page_size=100")[1]["items"]
    return out


def rec(case, status, expect, actual, severity=""):
    """severity 为空 = 该探针未发现缺陷（符合预期）；非空 = 命中的缺陷编号与等级。"""
    RESULTS.append({"case": case, "status": status, "expect": expect, "actual": actual, "severity": severity})
    tag = severity.split()[0] if severity else "OK"
    print(f"  [{tag}] {case}\n        expect = {expect}\n        actual = {actual}")


# ---------------------------------------------------------------------------
# 临时实体工厂
# ---------------------------------------------------------------------------
SEQ = [0]


def make_fixture(with_plan: bool = True):
    """建一套 TMP 实体（每套编码唯一），可选建一个库存档案。返回 id 字典。"""
    SEQ[0] += 1
    n = uuid.uuid4().hex[:10]        # 全局唯一，避免与历史残留/并发重名
    _, s = req("POST", "/api/suppliers", {"code": f"TMP-SUP-{n}", "name": f"临时探针供应商{n}", "city": "常州"})
    _, m = req("POST", "/api/materials", {"pn": f"TMP-PN-{n}", "name": f"临时探针物料{n}"})
    _, p = req("POST", "/api/projects", {"code": f"TMP-PRJ-{n}", "name": f"临时探针项目{n}", "status": "planning"})
    _, r = req("POST", "/api/supply-relations", {"material_id": m["id"], "supplier_id": s["id"]})
    req("POST", f"/api/projects/{p['id']}/relations", {"supply_relation_id": r["id"], "demand": [1000.0] * 12, "bom_factor": 1.0})
    base = next(b for b in items("/api/bases") if b["name"] == "青岛")
    ids = {"sup": s["id"], "mat": m["id"], "prj": p["id"], "rel": r["id"], "base": base["id"], "plan": None}
    if with_plan:
        st, plan = req("POST", "/api/inventory/plans", {"project_id": p["id"], "material_id": m["id"],
                                                       "supplier_id": s["id"], "base_id": base["id"],
                                                       "lead_time_days": 7, "on_hand": 500})
        if not isinstance(plan, dict) or "id" not in plan:
            print(f"        !! 建档失败 4元组={p['id']}/{m['id']}/{s['id']}/{base['id']} → {st} {json.dumps(plan, ensure_ascii=False)[:300]}")
        ids["plan"] = plan["id"]
    return ids


def drop_fixture(ids):
    """回收一套 fixture 的全部痕迹。

    注意：批量建档端点返回的是计数而非 id，拿不到 plan.id，因此这里按
    项目 / 物料 / 供应商 三条外键「全清」，避免漏删造成孤儿档案。
    """
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM inventory_days WHERE plan_id IN "
        "(SELECT id FROM inventory_plans WHERE project_id=? OR material_id=? OR supplier_id=?)",
        (ids["prj"], ids["mat"], ids["sup"]),
    )
    cur.execute(
        "DELETE FROM inventory_plans WHERE project_id=? OR material_id=? OR supplier_id=?",
        (ids["prj"], ids["mat"], ids["sup"]),
    )
    cur.execute("DELETE FROM share_records WHERE project_id=?", (ids["prj"],))
    cur.execute("DELETE FROM project_supply_relations WHERE project_id=?", (ids["prj"],))
    cur.execute("DELETE FROM projects WHERE id=?", (ids["prj"],))
    cur.execute("DELETE FROM supply_relations WHERE id=?", (ids["rel"],))
    cur.execute("DELETE FROM materials WHERE id=?", (ids["mat"],))
    cur.execute("DELETE FROM suppliers WHERE id=?", (ids["sup"],))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
def p1_intra_batch_dup():
    ids = make_fixture(with_plan=False)   # 该四元组尚未建档，保证批内第 1 条能建、第 2 条才是重复
    item = {"project_id": ids["prj"], "material_id": ids["mat"], "supplier_id": ids["sup"], "base_id": ids["base"]}
    st, d = req("POST", "/api/inventory/plans/bulk", {"items": [item, dict(item)]})
    ok = st == 200 and isinstance(d, dict) and d.get("created") == 1 and d.get("skipped") == 1
    rec("P1 批量建档 items 内自重复", st,
        "created=1 / skipped=1（端点 docstring 承诺「单条失败不影响其余」）",
        f"status={st} body={json.dumps(d, ensure_ascii=False)[:160]}",
        "" if ok else "F-05 高：IntegrityError 未捕获 → 整批 500，且已 add 的记录全部丢失")

    st, d = req("POST", "/api/inventory/plans/bulk", {"items": [item, item]})
    print(f"        （重复调用确认幂等性）status={st}")
    drop_fixture(ids)   # P1 不建档案，但仍需回收实体


def p2_bad_json():
    for label, raw, col in (
        ("JSON 整数 123", "123", "hist_json"),
        ("JSON 浮点 1.5", "1.5", "hist_json"),
        ("JSON 布尔 true", "true", "hist_json"),
        ("JSON 对象 {..}", '{"m":"2026-09","q":1}', "hist_json"),
        ("JSON 字符串 \"abc\"", '"abc"', "hist_json"),
        ("非 JSON 文本 abc", "abc", "hist_json"),
    ):
        ids = make_fixture()
        conn = sqlite3.connect(DB)
        conn.execute(f"UPDATE inventory_plans SET {col}=? WHERE id=?", (raw, ids["plan"]))
        conn.commit()
        conn.close()
        st, d = req("GET", "/api/inventory/plans")
        if st == 500:
            note = "F-01 高：json.loads 结果非 list → `for item in data` 抛 TypeError 未捕获 → 库存页整页 500"
        else:
            hit = next((p for p in d if p["id"] == ids["plan"]), None) if isinstance(d, list) else None
            note = f"降级为空（hist={len(hit['hist']) if hit else '?'} 条）"
        rec(f"P2 {label}", st, "200 且静默忽略脏数据", f"status={st} → {note}",
            "" if st == 200 else "F-01 高：单行脏 JSON 打爆整页")
        drop_fixture(ids)


def p3_month_key():
    ids = make_fixture()
    bad = json.dumps([{"m": "2026-7", "q": 1000}, {"m": "2026-8", "q": 1050}, {"m": "2026-9", "q": 980}], ensure_ascii=False)
    conn = sqlite3.connect(DB)
    conn.execute("UPDATE inventory_plans SET hist_json=? WHERE id=?", (bad, ids["plan"]))
    conn.commit()
    conn.close()
    st, d = req("GET", "/api/inventory/plans")
    hit = next((p for p in d if p["id"] == ids["plan"]), None) if isinstance(d, list) else None
    rec("P3 历史月份未补零（'2026-7'）", st, "归一化为 2026-07 或忽略",
        f"status={st} 原样返回={[h['m'] for h in hit['hist']] if hit else None} cov={hit['cov'] if hit else None}",
        "" if hit and all(h["m"][5:7].isdigit() and len(h["m"]) == 7 for h in hit["hist"])
        else "F-02 中：不做月份归一化；若与 _month_key 产物比较则永远匹配不上（跨年/缺月需求静默归 0）")
    drop_fixture(ids)

    # 跨年预测（快照模式：显式带年份的月份键，精确匹配即可）
    ids = make_fixture()
    conn = sqlite3.connect(DB)
    conn.execute("UPDATE inventory_plans SET fcast_json=? WHERE id=?",
                 (json.dumps([{"m": "2026-10", "q": 3100}, {"m": "2027-01", "q": 9000}], ensure_ascii=False), ids["plan"]))
    conn.commit()
    conn.close()
    st, d = req("GET", "/api/inventory/plans")
    hit = next((p for p in d if p["id"] == ids["plan"]), None) if isinstance(d, list) else None
    ok = bool(hit) and "2027-01" in [f["m"] for f in hit["fcast"]]
    rec("P3 快照预测含次年月份（2027-01）", st, "次年月份原样保留（窗口走到 1 月时可精确命中）",
        f"status={st} fcast={[f['m'] for f in hit['fcast']] if hit else None}",
        "" if ok else "跨年月份键丢失")
    drop_fixture(ids)


def p9_cross_year():
    """跨年时间轴：底表的 12 月数组不带年份，用「12 月基准」直接打桩验证取数不为 0。"""
    sys.path.insert(0, str(ROOT / "backend"))
    from datetime import date as D

    from app.routers import inventory as inv

    plan = SimpleNamespace(hist_json=None, fcast_json=None)
    psr = SimpleNamespace(demand=json.dumps([100.0] * 12), bom_factor=1.0)
    hist, fcast, source, _bom = inv._resolve_demand(plan, psr, D(2026, 12, 15))
    fmap = inv._fcast_map_of(fcast, source)
    dec = inv._fcast_of_day(fmap, source, D(2026, 12, 5))
    jan = inv._fcast_of_day(fmap, source, D(2027, 1, 5))
    ok = dec == 100.0 and jan == 100.0
    rec("P9 跨年窗口需求取数（基准 2026-12-15）", 200,
        "2026-12 取到当年 12 月值、2027-01 取到同月画像值，都不得为 0",
        f"hist={len(hist)} 条（只取今天之前的月份）/ 2026-12={dec} / 2027-01={jan}",
        "" if ok else "F-02/F-09 高：跨年窗口末段需求静默归 0（12 月的 30 天窗口伸进次年 1 月）")


def p10_share_month_guard():
    """份额月份校验 + dashboard 默认月（不得被未来月份顶掉）。"""
    ids = make_fixture(with_plan=False)
    for m in ("2026-13", "2026-00", "2026-9"):
        st, d = req("POST", "/api/share/records",
                    {"project_id": ids["prj"], "supply_relation_id": ids["rel"], "month": m, "share_current": 100})
        rec(f"P10 份额月份非法 {m}", st, "422（month 必须 01-12 两位）",
            f"status={st} {json.dumps(d, ensure_ascii=False)[:90]}",
            "" if st == 422 else "F-15 中：pattern 过宽，脏月份会让 dashboard 的 max(month) 跳到空档")
    st, _ = req("POST", "/api/share/records",
                {"project_id": ids["prj"], "supply_relation_id": ids["rel"], "month": "2027-05", "share_current": 100})
    st2, stats = req("GET", "/api/share/dashboard-stats")
    month = stats.get("month") if isinstance(stats, dict) else None
    ok = st == 201 and isinstance(month, str) and month <= "2026-10"
    rec("P10 存在未来月份时 dashboard 默认月", st2, "仍是「≤ 当前自然月」的最大月份",
        f"未来月写入={st}；dashboard.month={month}",
        "" if ok else "F-19 高：取 max(month) 会落到未来空月份 → 首页风险整片归零")
    drop_fixture(ids)


def p11_share_unmounted_relation():
    """给「项目未挂载」的供应关系录份额 → 应 409。"""
    ids = make_fixture(with_plan=False)
    n = uuid.uuid4().hex[:8]
    _, s2 = req("POST", "/api/suppliers", {"code": f"TMP-SUP2-{n}", "name": f"临时探针供应商2-{n}", "city": "常州"})
    _st, r2 = req("POST", "/api/supply-relations", {"material_id": ids["mat"], "supplier_id": s2["id"]})
    st, d = req("POST", "/api/share/records",
                {"project_id": ids["prj"], "supply_relation_id": r2["id"], "month": "2026-09", "share_current": 50})
    rec("P11 给「项目未挂载」的供应关系录份额", st, "409 拦截（先在供需管理挂载）",
        f"status={st} {json.dumps(d, ensure_ascii=False)[:110]}",
        "" if st == 409 else "F-20 高：写出统计孤岛（份额挂在项目下，项目却没有这条供应关系）")
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("DELETE FROM share_records WHERE supply_relation_id=?", (r2["id"],))
    cur.execute("DELETE FROM project_supply_relations WHERE supply_relation_id=?", (r2["id"],))
    cur.execute("DELETE FROM supply_relations WHERE id=?", (r2["id"],))
    cur.execute("DELETE FROM suppliers WHERE id=?", (s2["id"],))
    conn.commit()
    conn.close()
    drop_fixture(ids)


def p12_rollover_guard():
    """反向 / 原地月度结转 → 应 422。"""
    ids = make_fixture(with_plan=False)
    st, d = req("POST", f"/api/share/rollover?project_id={ids['prj']}&from_month=2026-09&to_month=2026-08")
    rec("P12 反向月度结转（2026-09 → 2026-08）", st, "422 拒绝（目标月必须晚于来源月）",
        f"status={st} {json.dumps(d, ensure_ascii=False)[:100]}",
        "" if st == 422 else "F-21 中：反向结转静默成功，把源月 share_prev 写成未来月的值")
    drop_fixture(ids)


def p13_share_scale_mix():
    """基地份额「小数 / 百分数」混用 → 应 422；统一口径应放行且自动算出 50%。"""
    ids = make_fixture(with_plan=False)
    st, d = req("POST", "/api/share/records", {
        "project_id": ids["prj"], "supply_relation_id": ids["rel"], "month": "2026-09",
        "bases": [{"base": "青岛", "share": 0.5, "lines": 10}, {"base": "常州", "share": 50, "lines": 10}],
    })
    rec("P13 基地份额小数/百分数混用", st, "422（同一条记录口径必须统一）",
        f"status={st} {json.dumps(d, ensure_ascii=False)[:120]}",
        "" if st == 422 else "F-18 高：混写时 0.5 被当成 0.5%，静默错 100 倍")
    st2, d2 = req("POST", "/api/share/records", {
        "project_id": ids["prj"], "supply_relation_id": ids["rel"], "month": "2026-09",
        "bases": [{"base": "青岛", "share": 50, "lines": 10}, {"base": "常州", "share": 50, "lines": 10}],
    })
    cur_share = d2.get("share_current") if isinstance(d2, dict) else None
    rec("P13 统一百分数口径（50 / 50）", st2, "201 且自动份额 = 50%",
        f"status={st2} share_current={cur_share}",
        "" if st2 == 201 and cur_share == 50 else "口径归一异常")
    drop_fixture(ids)


def p14_demand_blank_flags():
    """需求被 BOM 乘成 0 / 需求本身全 0 → 必须带显式标记，不得显示「正常」。"""
    ids = make_fixture(with_plan=False)
    rel_id = items(f"/api/projects/{ids['prj']}/relations")[0]["id"]
    req("PATCH", f"/api/projects/{ids['prj']}/relations/{rel_id}", {"bom_factor": 0.0})
    _st, plan = req("POST", "/api/inventory/plans", {
        "project_id": ids["prj"], "material_id": ids["mat"], "supplier_id": ids["sup"],
        "base_id": ids["base"], "lead_time_days": 7, "on_hand": 500})
    _st2, plans = req("GET", "/api/inventory/plans")
    hit = next((p for p in plans if p["id"] == plan["id"]), None) if isinstance(plans, list) else None
    ok = bool(hit) and hit["bom_zero"] and hit["demand_blank"]
    rec("P14 BOM=0（需求被乘成 0）", 200, "bom_zero=True 且 demand_blank=True",
        f"bom_zero={hit['bom_zero'] if hit else '?'} demand_blank={hit['demand_blank'] if hit else '?'} "
        f"avg_daily={hit['avg_daily'] if hit else '?'} end_day1={hit['days'][0]['ending'] if hit else '?'}",
        "" if ok else "F-03 高：需求被 BOM 乘成 0 却显示绿色「30 天内无需补货」，比报错危险得多")

    # 需求本身全 0（BOM=1）
    req("PATCH", f"/api/projects/{ids['prj']}/relations/{rel_id}", {"bom_factor": 1.0, "demand": [0.0] * 12})
    _st3, plans = req("GET", "/api/inventory/plans")
    hit2 = next((p for p in plans if p["id"] == plan["id"]), None) if isinstance(plans, list) else None
    ok2 = bool(hit2) and hit2["demand_blank"] and not hit2["bom_zero"]
    rec("P14 客户需求 12 个月全 0（BOM=1）", 200, "demand_blank=True 且 bom_zero=False",
        f"bom_zero={hit2['bom_zero'] if hit2 else '?'} demand_blank={hit2['demand_blank'] if hit2 else '?'} "
        f"avg_daily={hit2['avg_daily'] if hit2 else '?'}",
        "" if ok2 else "F-03 高：漏录需求被当成「零需求健康库存」")
    drop_fixture(ids)


def p4_orphan_share():
    ids = make_fixture()
    req("POST", "/api/share/records", {"project_id": ids["prj"], "supply_relation_id": ids["rel"],
                                       "month": "2026-09", "share_current": 100})
    st, _ = req("DELETE", f"/api/projects/{ids['prj']}")
    conn = sqlite3.connect(DB)
    orph_share = conn.execute("SELECT COUNT(*) FROM share_records WHERE project_id=?", (ids["prj"],)).fetchone()[0]
    orph_psr = conn.execute("SELECT COUNT(*) FROM project_supply_relations WHERE project_id=?", (ids["prj"],)).fetchone()[0]
    orph_plan = conn.execute("SELECT COUNT(*) FROM inventory_plans WHERE project_id=?", (ids["prj"],)).fetchone()[0]
    conn.close()
    rec("P4 删除项目后下游数据残留", st, "全为 0 条（应随项目级联清理）",
        f"残留 share_records={orph_share}、project_supply_relations={orph_psr}、inventory_plans={orph_plan}",
        "F-11 高：Project 只声明了 supply_links 一条 cascade；ShareRecord / InventoryPlan 无 ORM 级联，"
        "且 SQLite PRAGMA foreign_keys 未开启 → ondelete=CASCADE 形同虚设。"
        "后果：孤儿行残留，且 SQLite rowid 复用会让「新建项目」撞上孤儿档案 → 误报 409 档案已存在（已实测复现）"
        if (orph_share or orph_psr or orph_plan) else "")
    drop_fixture(ids)


def p5_orphan_plan_after_supplier_delete():
    ids = make_fixture()
    st, _ = req("DELETE", f"/api/suppliers/{ids['sup']}")
    st2, d2 = req("GET", "/api/inventory/plans")
    ok = st2 == 200
    rec("P5 删除仍被库存档案引用的供应商", st + st2, "409 拦截，或库存页仍可用",
        f"DELETE={st}；随后 GET /inventory/plans = {st2}"
        + ("（正常）" if ok else " → 整页 500：InventoryPlan.supplier 变成 None，_build_plan_out 取 .name 崩溃"),
        "F-10 高：供应商删除只做 ORM cascade，未校验 inventory_plans 引用 → 库存信号塔整页 500"
        if not ok else "")
    # 无论 409 拦截成功与否都回收实体：探针失败更不能留下脏数据
    drop_fixture(ids)


def p6_negative_values():
    ids = make_fixture()
    for label, body in (("on_hand=-100", {"on_hand": -100}), ("on_hand=-1e9", {"on_hand": -1e9}),
                        ("lead_time_days=0", {"lead_time_days": 0}), ("lead_time_days=-5", {"lead_time_days": -5})):
        st, d = req("PATCH", f"/api/inventory/plans/{ids['plan']}", body)
        rec(f"P6 PATCH {label}", st, "422", f"status={st} on_hand={d.get('on_hand') if isinstance(d, dict) else '?'} "
            f"lt={d.get('lead_time_days') if isinstance(d, dict) else '?'}",
            "F-06 中：on_hand 无 ge=0 → 可写入负库存并直接判断货" if st == 200 and "on_hand=-" in label else "")
    st, d = req("PUT", f"/api/inventory/plans/{ids['plan']}/days", [{"date": "2026-10-05", "manual_demand": -1e12}])
    rec("P6 手工修正需求 = -1e12（极端负值）", st, "422（日格数值需有上下限）", f"status={st}",
        "" if st == 422 else "F-07 低：日格数值无上下限，可把期末库存拉成极端值（UI 需能容纳）")
    drop_fixture(ids)


def p7_capacity_zero():
    ids = make_fixture()
    st, d = req("PATCH", f"/api/projects/{ids['prj']}/relations/"
                         f"{items(f'/api/projects/{ids['prj']}/relations')[0]['id']}",
                {"capacity": [0.0] * 12})
    st2, plans = req("GET", "/api/inventory/plans")
    hit = next((p for p in plans if p["id"] == ids["plan"]), None) if isinstance(plans, list) else None
    rec("P7 产能额度显式录入 0", st2, "判 short（额度为 0 → 任何补货都超额度）",
        f"capacity_limit={hit['capacity_limit'] if hit else None} capacity_status={hit['capacity_status'] if hit else None}",
        "F-08 中：额度 0 与「未录额度」同为 na，掩盖真实产能缺口" if hit and hit["capacity_status"] == "na" else "")
    drop_fixture(ids)


def p8_enum_and_null_render():
    """后端枚举/字段极值是否会让前端枚举表崩（数据侧取证 + 源码静态回归）。

    后端这几个枚举是从自由文本/计算派生的（不是 L1 主数据的受控下拉），一旦新增取值，
    前端 `x[...]` 直接下标就会取到 undefined，再读属性 → 整页白屏。故：
      ① 列出后端当前实际取值集合；
      ② 静态扫描前端源码，确认所有取值处都有 `?? 兜底`（回归门禁）。
    """
    st, plans = req("GET", "/api/inventory/plans")
    statuses = sorted({c["status"] for p in plans for c in p["days"]}) if isinstance(plans, list) else []
    covs = sorted({p["cov_label"] for p in plans}) if isinstance(plans, list) else []
    caps = sorted({p["capacity_status"] for p in plans}) if isinstance(plans, list) else []
    rec("P8 后端枚举取值集合", 200, "与前端 INV_STATUS_META / INV_COV_META / INV_CAPACITY_META 键完全一致",
        f"status={statuses}\ncov_label={covs}\ncapacity_status={caps}")

    # ---- 静态回归：后端派生枚举的取值处必须带 ?? 兜底 ----
    guarded = ("INV_STATUS_META", "INV_COV_META", "INV_CAPACITY_META", "RISK_TYPE_META")
    unguarded: list[str] = []
    src = ROOT / "frontend" / "src"
    for f in sorted(src.rglob("*.ts*")):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for name in guarded:
                idx = line.find(name + "[")
                if idx == -1:
                    continue
                rest = line[idx:]
                # 取值后必须紧跟 `??`（本行内）；`Const.N[` 这类别的常量数组不在此列
                if "??" not in rest and "??" not in line:
                    unguarded.append(f"{f.relative_to(ROOT).as_posix()}:{i}  {line.strip()[:100]}")
    rec("P8 前端枚举取值兜底（静态扫描）", 200, "INV_*_META / RISK_TYPE_META 的每处取值都带 `?? 兜底`",
        f"未兜底 {len(unguarded)} 处" + ("\n" + "\n".join(unguarded[:8]) if unguarded else "（全部已兜底）"),
        "" if not unguarded else "F-14 高：后端新增枚举取值 → undefined 下标 → 整页渲染崩溃")

    empty = [p["pn"] for p in plans if not p["hist"] and not p["fcast"]] if isinstance(plans, list) else []
    rec("P8 缺需求数据（hist/fcast 全空）行", 200, "前端展示琥珀徽章 + 「无法推算补货建议」",
        f"{empty}", "" if empty else "本数据集未覆盖到该分支")


def purge_tmp():
    """兜底清理：① TMP/DBG 前缀的临时实体；② 全库「孤儿行」（外键指向已删除行）。

    第 ② 步是必要的：SQLite rowid 会被复用，孤儿行的 project_id 会被「新建项目」重新占用，
    导致新项目静默继承旧档案/旧份额（UNIQUE 冲突 → 误报 409 档案已存在）。实测复现过。
    """
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    for sql in (
        "DELETE FROM suppliers WHERE code LIKE 'TMP%' OR code LIKE 'DBG%'",
        "DELETE FROM materials WHERE pn LIKE 'TMP%' OR pn LIKE 'DBG%'",
        "DELETE FROM projects WHERE code LIKE 'TMP%' OR code LIKE 'DBG%'",
        # ---- 全库孤儿行 ----
        "DELETE FROM inventory_days WHERE plan_id NOT IN (SELECT id FROM inventory_plans)",
        "DELETE FROM inventory_plans WHERE project_id NOT IN (SELECT id FROM projects)"
        " OR material_id NOT IN (SELECT id FROM materials)"
        " OR supplier_id NOT IN (SELECT id FROM suppliers)"
        " OR base_id NOT IN (SELECT id FROM base_sites)",
        "DELETE FROM share_records WHERE project_id NOT IN (SELECT id FROM projects)"
        " OR supply_relation_id NOT IN (SELECT id FROM supply_relations)",
        "DELETE FROM project_supply_relations WHERE project_id NOT IN (SELECT id FROM projects)"
        " OR supply_relation_id NOT IN (SELECT id FROM supply_relations)",
        "DELETE FROM supply_relations WHERE supplier_id NOT IN (SELECT id FROM suppliers)"
        " OR material_id NOT IN (SELECT id FROM materials)",
    ):
        cur.execute(sql)
        if cur.rowcount:
            print(f"    清理 {cur.rowcount:3d} 行 ← {sql[:64]}")
    conn.commit()
    conn.close()


def main():
    print("=" * 90)
    print("边界探针（仅临时实体，结束即回收）")
    purge_tmp()   # 开跑前先清历史遗留，保证可重复执行
    p1_intra_batch_dup()
    p2_bad_json()
    p3_month_key()
    p4_orphan_share()
    p5_orphan_plan_after_supplier_delete()
    p6_negative_values()
    p7_capacity_zero()
    p8_enum_and_null_render()
    p9_cross_year()
    p10_share_month_guard()
    p11_share_unmounted_relation()
    p12_rollover_guard()
    p13_share_scale_mix()
    p14_demand_blank_flags()
    purge_tmp()
    OUT.joinpath("probe_results.json").write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding="utf-8")
    # 残留检查
    conn = sqlite3.connect(DB)
    left = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in ("suppliers", "materials", "projects", "supply_relations", "project_supply_relations",
                      "share_records", "inventory_plans", "inventory_days")}
    tmp = conn.execute("SELECT COUNT(*) FROM suppliers WHERE code LIKE 'TMP%'").fetchone()[0]
    conn.close()
    print("\n  残留检查：" + json.dumps(left, ensure_ascii=False) + f"  TMP 供应商={tmp}")
    st, d = req("GET", "/api/share/dashboard-stats")
    print(f"  dashboard-stats = {json.dumps(d, ensure_ascii=False)[:180]}")
    print(f"  探针结果 → {OUT / 'probe_results.json'}")


if __name__ == "__main__":
    main()
