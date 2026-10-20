"""预警中心聚合接口（Dashboard 即预警中心，不单独开页面）。

设计约束（改动前必读）
=====================

1. **预警不落库**。每次请求实时从四个业务模块现算，所以不存在「源数据已修好、
   预警还红着」。也正因为是派生数据，本模块**不做已读/忽略**——标了已读数字还在，
   只会让两套状态打架。

2. **判定逻辑零复制**。所有类型判定都直接 import 各模块既有函数：
       inventory._assemble / _unknown_kind      → 库存四档 + 数据缺口三成因
       changes._load_changes / _task_state      → 任务五色状态
       share._load_records / _risk_chain_type   → 独供 / 波动 / 偏差 / 错配
   只有「供需三档」原本写在前端 `lib/supply-risk.ts`，这里按原样移植了一份，
   并用 scripts/verify_supply_risk_parity.mjs 做逐月比对。**别在这里顺手改口径**，
   否则 Dashboard 的数字会和板块页面对不上。

3. **时间口径不统一是常态**：份额是月快照、库存是今日、变更是今日、供需是某月。
   所以每个条目都带 `as_of`，页面不允许统一写「本月」。

4. **排序键：severity → due_in_days → impact → fingerprint。**
   `impact` 单位因 kind 而异（件 / 天 / 百分点 / 单元数），只在同 kind 内可比；
   跨来源唯一能比的是 `due_in_days`（距出事天数），所以它排在 impact 前面。
   来源固定序保留，但只作同档同天数的兜底 —— 让来源主导会把「已断货」排到
   「三个月后的供需缺口」后面。无事件日的（份额 / 数据缺口）沉到同档末尾。

5. ★ **还没有第 6 类来源：供应商红黄绿**。Dashboard 地图点位按 `suppliers.risk_level`
   （red/yellow/green，NULL=未评估）着色，那本身就是一种风险预警，只是**判定规则尚未定义**
   （当前靠人工打标）。规则定下来后按同样方式接入：新增 `source="supplier"`，
   从 `Supplier.risk_level` 读，别在供应商表里另算一套。届时矩阵要多一列、
   `ALERT_SOURCE_LABEL` 与 `ALERT_TARGET_LABEL` 要同步补（都指向「供应商列表」）。
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Project, ProjectSupplyRelation, ShareRecord, SupplyRelation
from ..schemas import (
    ALERT_HORIZON_DEFAULT,
    ALERT_SOURCE_ORDER,
    ALERT_SUPPLY_TIGHT_MAX,
    ALERT_SUPPLY_TIGHT_MIN,
    INV_CAPACITY_SHORT,
    INV_DOH_BUCKET_LOW,
    INV_DOH_BUCKET_STOCKOUT,
    INV_DOH_BUCKET_URGENT,
    INV_EXCESS_DOH_DEFAULT,
    INV_URGENT_DOH_THRESHOLD,
    INV_Z_DEFAULT,
    MONTH_PATTERN,
    RISK_DEVIATION_PT,
    RISK_FLUCTUATION_RATIO,
    AlertDimStat,
    AlertItem,
    AlertProjectBrief,
    AlertProjectRow,
    AlertProjectWorst,
    AlertRef,
    AlertResponse,
    AlertThresholds,
)
from .changes import _leaf_tasks, _load_changes, _load_tasks_map, _task_state, _today
from .inventory import _assemble, _unknown_kind
from .share import _load_records, _risk_chain_type

router = APIRouter(prefix="/api/alerts", tags=["预警中心"])

_SEV_RANK = {"p0": 0, "p1": 1, "p2": 2}


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def _json12(raw: Optional[str]) -> list[float]:
    """把 12 月 JSON 数组解析成定长 12 的 float 列表（缺失补 0）。"""
    if not raw:
        return [0.0] * 12
    try:
        arr = json.loads(raw)
    except (TypeError, ValueError):
        return [0.0] * 12
    if not isinstance(arr, list):
        return [0.0] * 12
    out = [0.0] * 12
    for i in range(min(12, len(arr))):
        try:
            out[i] = float(arr[i] or 0)
        except (TypeError, ValueError):
            out[i] = 0.0
    return out


def _days_until_month(month: Optional[str], today: date) -> Optional[int]:
    """距该月 1 日的天数（负数 = 该月已经过去）。用于「距出事天数」。"""
    if not month:
        return None
    try:
        y, m = int(month[:4]), int(month[5:7])
    except (TypeError, ValueError):
        return None
    return (date(y, m, 1) - today).days


def _num(v: Optional[float], unit: str = "") -> str:
    if v is None:
        return "—"
    n = f"{v:,.0f}" if abs(v) >= 100 else f"{v:,.1f}".rstrip("0").rstrip(".")
    return f"{n}{unit}"


def _default_base_month(db: Session) -> str:
    """份额基准月：最新**有实际份额**的月份。

    ★ 不能直接取 max(month)：月末结转生成的空档月份（share_current 全为 NULL）
      也是合法记录，取它会落到一个没有份额的空月，把当月风险整片遮住
      （schemas.py 的 MONTH_PATTERN 注释里记过这个坑）。没有数据则退回当前月。
    """
    latest = db.execute(
        select(ShareRecord.month)
        .where(ShareRecord.share_current.is_not(None))
        .order_by(ShareRecord.month.desc())
        .limit(1)
    ).scalar()
    return latest or date.today().strftime("%Y-%m")


def _horizon_months(base_month: str, horizon: int) -> list[str]:
    """从基准月起的 N 个月；数组只有 1-12 月，跨年不做推演（12 月封顶）。"""
    year, mon = base_month.split("-")
    y, m = int(year), int(mon)
    n = 12 if horizon <= 0 else max(1, horizon)
    out: list[str] = []
    while len(out) < n and m <= 12:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
    return out


def _brief(p: Project) -> AlertProjectBrief:
    return AlertProjectBrief(project_id=p.id, code=p.code, name=p.name)


def _item(
    *,
    fingerprint: str,
    source: str,
    kind: str,
    severity: str,
    title: str,
    detail: str,
    as_of: str,
    impact: float,
    project: Project,
    ref: AlertRef,
    due_in_days: Optional[int] = None,
) -> AlertItem:
    return AlertItem(
        fingerprint=fingerprint,
        source=source,
        kind=kind,
        severity=severity,
        title=title,
        detail=detail,
        as_of=as_of,
        impact=float(impact),
        due_in_days=due_in_days,
        project=_brief(project),
        ref=ref,
    )


# ---------------------------------------------------------------------------
# 来源 1：供需缺口（移植自前端 lib/supply-risk.ts，口径必须一致）
# ---------------------------------------------------------------------------

def _supply_items(
    db: Session,
    projects: list[Project],
    project_ids: list[int],
    months: list[str],
) -> tuple[list[AlertItem], dict[int, set[str]]]:
    """返回 (预警条目, 各项目缺 BOM 的物料集合)。

    口径与前端 SupplyDemandPage.aggregateMaterialRows 完全一致：
      物料需求[t] = Σ(项目客户需求[t] × 该项目该物料 BOM)
      物料产能[t] = Σ 该物料每一行供应商的月度产能
    ★ 前端跨项目汇总时同一供应商同物料会被重复计入，这里照搬，不做「修正」——
      修正会让 Dashboard 与热力图对不上，要改就两边一起改。
    """
    stmt = select(ProjectSupplyRelation).options(
        joinedload(ProjectSupplyRelation.supply_relation).joinedload(SupplyRelation.material)
    )
    if project_ids:
        stmt = stmt.where(ProjectSupplyRelation.project_id.in_(project_ids))
    rows = list(db.execute(stmt).scalars().all())

    by_proj: dict[int, list[ProjectSupplyRelation]] = defaultdict(list)
    for r in rows:
        rel = r.supply_relation
        if rel is not None and rel.material is not None:
            by_proj[r.project_id].append(r)

    pmap = {p.id: p for p in projects}
    items: list[AlertItem] = []
    missing_bom: dict[int, set[str]] = defaultdict(set)
    today = _today()

    for pid, rel_rows in by_proj.items():
        project = pmap.get(pid)
        if project is None:
            continue

        # 项目级客户需求（当前版投影，同项目各行一致）→ 取首个非空
        demand_series: Optional[list[float]] = None
        for r in rel_rows:
            d = _json12(r.demand)
            if any(d):
                demand_series = d
                break

        bom_by_pn: dict[str, Optional[float]] = {}
        name_by_pn: dict[str, str] = {}
        mid_by_pn: dict[str, int] = {}
        cap_by_pn: dict[str, list[float]] = defaultdict(lambda: [0.0] * 12)
        for r in rel_rows:
            mat = r.supply_relation.material
            pn = mat.pn
            name_by_pn[pn] = mat.name
            mid_by_pn[pn] = mat.id
            if pn not in bom_by_pn:
                bom_by_pn[pn] = r.bom_factor
            cap = _json12(r.capacity)
            for t in range(12):
                cap_by_pn[pn][t] += cap[t]

        for pn, bom in bom_by_pn.items():
            if not bom:
                # 有需求但缺 BOM → 供需系数算不出来，归入数据缺口（P1，见 _data_items 说明）
                if demand_series is not None and any(demand_series):
                    missing_bom[pid].add(pn)
                continue
            if demand_series is None:
                continue

            worst: Optional[tuple[float, str, float, float]] = None  # (coef, month, demand, cap)
            affected = 0
            for mth in months:
                t = int(mth[5:7]) - 1
                dem = demand_series[t] * bom
                if dem <= 0:
                    continue
                cap = cap_by_pn[pn][t]
                coef = cap / dem
                if coef > ALERT_SUPPLY_TIGHT_MAX:
                    continue
                affected += 1
                if worst is None or coef < worst[0]:
                    worst = (coef, mth, dem, cap)
            if worst is None:
                continue

            coef, mth, dem, cap = worst
            gap = max(0.0, dem - cap)
            shortage = coef < ALERT_SUPPLY_TIGHT_MIN
            if shortage:
                title = f"{pn} {name_by_pn[pn]} · {mth} 只能满足 {coef * 100:.0f}% 需求"
                detail = (
                    f"{project.code} · 需求 {_num(dem)} / 产能 {_num(cap)} · 缺口 {_num(gap)}"
                    + (f" · 窗口内 {affected} 个月不达标" if affected > 1 else "")
                )
                impact = gap
            else:
                title = f"{pn} {name_by_pn[pn]} · {mth} 供需偏紧（{coef * 100:.0f}%）"
                detail = (
                    f"{project.code} · 需求 {_num(dem)} / 产能 {_num(cap)} · 缓冲 {(coef - 1) * 100:.0f}%"
                    + (f" · 窗口内 {affected} 个月偏紧" if affected > 1 else "")
                )
                impact = dem

            items.append(
                _item(
                    fingerprint=f"supply:{pid}:{pn}:{mth}",
                    source="supply",
                    kind="shortage" if shortage else "tight",
                    severity="p0" if shortage else "p1",
                    title=title,
                    detail=detail,
                    as_of=mth,
                    impact=impact,
                    project=project,
                    # 事件日 = 缺口月的 1 号（需求在整月里发生，取月首作代表）
                    due_in_days=_days_until_month(mth, today),
                    ref=AlertRef(project_id=pid, material_id=mid_by_pn[pn], pn=pn, month=mth),
                )
            )

    return items, missing_bom


# ---------------------------------------------------------------------------
# 来源 2：库存（复用 inventory._assemble，桶号由后端算好，本模块不重算）
# ---------------------------------------------------------------------------

def _inventory_items(
    db: Session,
    projects: list[Project],
    project_ids: list[int],
) -> tuple[list[AlertItem], dict[tuple[int, str], list[str]]]:
    """返回 (预警条目, 数据缺口分组 {(project_id, cause): [物料PN…]})。"""
    outs = _assemble(db, project_ids, [], [], [], INV_Z_DEFAULT, INV_EXCESS_DOH_DEFAULT)
    pmap = {p.id: p for p in projects}
    items: list[AlertItem] = []
    unknown: dict[tuple[int, str], list[str]] = defaultdict(list)
    today = _today()
    today_iso = today.isoformat()

    for out in outs:
        project = pmap.get(out.project_id)
        if project is None:
            continue
        base_ref = AlertRef(
            project_id=out.project_id,
            material_id=out.material_id,
            pn=out.pn,
            supplier_id=out.supplier_id,
            supplier_code=out.supplier_code,
            base_id=out.base_id,
        )

        cause = _unknown_kind(out)
        if cause is not None:
            unknown[(out.project_id, cause)].append(out.pn)
            continue

        bucket = out.doh_bucket
        if bucket in (INV_DOH_BUCKET_STOCKOUT, INV_DOH_BUCKET_URGENT, INV_DOH_BUCKET_LOW):
            doh = out.doh_today
            if bucket == INV_DOH_BUCKET_STOCKOUT:
                title = f"{out.base_name} · {out.pn} 已断货"
                detail = f"DOH {_num(doh, ' 天')} · 供应商 {out.supplier_code} · 现存 {_num(out.on_hand)}"
                severity, kind, impact = "p0", "stockout", 1000 + max(0.0, -(doh or 0))
                due = 0  # 已经断，事件日就是今天
            elif bucket == INV_DOH_BUCKET_URGENT:
                title = f"{out.base_name} · {out.pn} 库存紧急"
                detail = (
                    f"DOH {_num(doh, ' 天')} · 安全 {_num(out.safe_days, ' 天')}"
                    f" · 供应商 {out.supplier_code} · 现存 {_num(out.on_hand)}"
                )
                # 越接近断货 impact 越大（DOH 越小 → 1000 - doh 越大）
                severity, kind, impact = "p0", "urgent", 1000 - (doh or 0)
                due = max(0, int(doh or 0))  # 事件日 = 耗尽那天
            else:
                title = f"{out.base_name} · {out.pn} 库存偏低"
                detail = (
                    f"DOH {_num(doh, ' 天')} · 低于采购提前期 {_num(out.lead_time_days, ' 天')}"
                    f" · 供应商 {out.supplier_code}"
                )
                severity, kind, impact = "p1", "low", 1000 - (doh or 0)
                due = max(0, int(doh or 0))

            items.append(
                _item(
                    fingerprint=f"inventory:{out.id}:{bucket}",
                    source="inventory",
                    kind=kind,
                    severity=severity,
                    title=title,
                    detail=detail,
                    as_of=today_iso,
                    impact=impact,
                    project=project,
                    due_in_days=due,
                    ref=base_ref.model_copy(update={"bucket": f"{INV_DOH_BUCKET_STOCKOUT},{INV_DOH_BUCKET_URGENT}"}),
                )
            )

        if out.capacity_status == INV_CAPACITY_SHORT and out.capacity_usage is not None:
            items.append(
                _item(
                    fingerprint=f"inventory:{out.id}:cap_short",
                    source="inventory",
                    kind="cap_short",
                    severity="p1",
                    title=f"{out.pn} · {out.supplier_code} 项目额度占用 {out.capacity_usage * 100:.0f}%",
                    detail=(
                        f"{project.code} · {out.base_name} · 建议补货 {_num(out.replenish_qty)}"
                        f" / 额度 {_num(out.capacity_limit)}"
                    ),
                    as_of=out.capacity_month or today_iso,
                    impact=out.capacity_usage * 100,
                    project=project,
                    # 事件日 = 超额那个月的 1 号（占的是该月额度）
                    due_in_days=_days_until_month(out.capacity_month, today),
                    ref=base_ref,
                )
            )

    return items, unknown


# ---------------------------------------------------------------------------
# 来源 3：变更（复用 changes._task_state，五色状态唯一判定入口）
# ---------------------------------------------------------------------------

def _change_items(db: Session, project_ids: list[int]) -> list[AlertItem]:
    today = _today()
    changes = _load_changes(db, project_ids=project_ids or None)
    tasks_map = _load_tasks_map(db, [c.id for c in changes])
    items: list[AlertItem] = []
    today_iso = today.isoformat()

    for c in changes:
        if c.status == "voided":
            continue
        project = c.project
        if project is None:
            continue
        for t in _leaf_tasks(tasks_map.get(c.id, [])):
            state, overdue_days, late_days = _task_state(t.plan_end, t.is_done, t.done_at, today)
            if state == "overdue":
                severity, kind, impact = "p0", "overdue", float(overdue_days)
                title = f"「{c.title}」{t.name} 超期 {overdue_days} 天未完成"
                due = -overdue_days  # 负数：已经逾期
            elif state == "soon":
                left = (t.plan_end - today).days if t.plan_end else 0
                severity, kind, impact = "p1", "near", float(-left)  # 剩余天数取负：越接近到期值越大
                title = f"「{c.title}」{t.name} {left} 天后到期"
                due = left
            elif state == "late":
                severity, kind, impact = "p2", "late", float(late_days)
                title = f"「{c.title}」{t.name} 已迟交 {late_days} 天完成"
                due = None  # 已完成，没有未来的事件日；只作复盘
            else:
                continue

            owner = t.owner or c.owner or "未指派"
            detail = (
                f"{project.code} · {c.material.pn if c.material else '—'}"
                f" · 责任人 {owner} · 计划完成 {t.plan_end.isoformat() if t.plan_end else '未定'}"
            )
            items.append(
                _item(
                    fingerprint=f"change:{c.id}:{t.id}:{state}",
                    source="change",
                    kind=kind,
                    severity=severity,
                    title=title,
                    detail=detail,
                    as_of=today_iso,
                    impact=impact,
                    project=project,
                    due_in_days=due,
                    ref=AlertRef(
                        project_id=project.id,
                        change_id=c.id,
                        task_id=t.id,
                        pn=c.material.pn if c.material else None,
                    ),
                )
            )
    return items


# ---------------------------------------------------------------------------
# 来源 4：份额（复用 share._risk_chain_type，四类风险唯一判定入口）
# ---------------------------------------------------------------------------

_SHARE_TITLES = {
    "sole": "独供",
    "fluctuation": "份额波动",
    "deviation": "建议偏差",
    "mismatch": "份额评分错配",
}


def _share_items(db: Session, projects: list[Project], project_ids: list[int], base_month: str) -> list[AlertItem]:
    targets = [p for p in projects if not project_ids or p.id in project_ids]
    items: list[AlertItem] = []

    for p in targets:
        for r in _load_records(db, p.id, base_month):
            risk = _risk_chain_type(r)
            if risk is None:
                continue
            rel = r.supply_relation
            pn = rel.material.pn if rel and rel.material else "—"
            mname = rel.material.name if rel and rel.material else ""
            scode = rel.supplier.code if rel and rel.supplier else ""
            sname = rel.supplier.name if rel and rel.supplier else ""

            if risk == "sole":
                title = f"{pn} {mname} · 独供，仅 {scode}"
                detail = f"{p.code} · 份额 {_num(r.share_current, '%')} · 无备份供应商"
                impact = r.share_current or 0.0
            elif risk == "fluctuation":
                cur, prev = r.share_current or 0.0, r.share_prev or 0.0
                title = f"{pn} {mname} · {scode} 份额 {prev:.0f}% → {cur:.0f}%（环比 {cur - prev:+.0f}pt）"
                detail = f"{p.code} · {pn} {mname} · 波动阈值 ±{RISK_FLUCTUATION_RATIO * 100:.0f}%"
                impact = abs(cur - prev)
            elif risk == "deviation":
                cur, quota = r.share_current or 0.0, r.quota_prev or 0.0
                title = f"{pn} {mname} · {scode} 份额 {cur:.0f}% vs 上月建议 {quota:.0f}%"
                detail = f"{p.code} · {pn} {mname} · 建议偏差 {abs(cur - quota):.0f}pt > {RISK_DEVIATION_PT}pt"
                impact = abs(cur - quota)
            else:  # mismatch
                title = f"{pn} {mname} · {scode} 份额 {r.share_current or 0:.0f}% 但加权分仅 {r.weighted_score or 0:.2f}"
                detail = f"{p.code} · {pn} {mname} · 份额 ≥ 50% 且评分 < 0.5"
                impact = r.share_current or 0.0

            items.append(
                _item(
                    fingerprint=f"share:{r.id}:{risk}",
                    source="share",
                    kind=risk,
                    severity="p1" if risk in ("sole", "fluctuation") else "p2",
                    title=title,
                    detail=detail,
                    as_of=base_month,
                    impact=impact,
                    project=p,
                    ref=AlertRef(
                        project_id=p.id,
                        material_id=rel.material_id if rel else None,
                        pn=pn if pn != "—" else None,
                        supplier_id=rel.supplier_id if rel else None,
                        supplier_code=scode or None,
                        month=base_month,
                    ),
                )
            )
    return items


# ---------------------------------------------------------------------------
# 来源 5：数据缺口（★ 定 P1，不是 P2）
#
# 缺需求 / BOM=0 时，供需页判「无数据」（灰）、库存页判「无法评估」（灰卡），
# 两处都不报警 —— 等于假绿。它比任何单条 P0 都危险，因为会让人以为没事。
# 故按「项目 × 成因」聚合成一条（不按单元逐条刷，否则几十条会把 P0 淹掉）。
# ---------------------------------------------------------------------------

_CAUSE_LABEL = {
    "no_series": "缺需求序列",
    "bom_zero": "BOM 系数为 0",
    "demand_blank": "需求为 0",
    "bom_missing": "缺 BOM 系数",
}


def _data_items(
    projects: list[Project],
    unknown: dict[tuple[int, str], list[str]],
    missing_bom: dict[int, set[str]],
) -> list[AlertItem]:
    pmap = {p.id: p for p in projects}
    grouped: dict[tuple[int, str], set[str]] = defaultdict(set)

    for (pid, cause), pns in unknown.items():
        grouped[(pid, cause)].update(pns)
    for pid, pns in missing_bom.items():
        grouped[(pid, "bom_missing")].update(pns)

    items: list[AlertItem] = []
    for (pid, cause), pns in grouped.items():
        project = pmap.get(pid)
        if project is None or not pns:
            continue
        label = _CAUSE_LABEL.get(cause, cause)
        n = len(pns)
        sample = "、".join(sorted(pns)[:3]) + ("…" if n > 3 else "")
        items.append(
            _item(
                fingerprint=f"data:{pid}:{cause}",
                source="data",
                kind="missing_input",
                severity="p1",
                title=f"{project.code} · {n} 个物料{label}",
                detail=f"{sample} · 供需系数与库存 DOH 均无法计算 → 两处预警静默",
                as_of="当前",
                impact=float(n),
                project=project,
                ref=AlertRef(project_id=pid, pn=sorted(pns)[0]),
            )
        )
    return items


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------

@router.get("", response_model=AlertResponse, summary="预警中心聚合（Dashboard 即预警中心）")
def list_alerts(
    project_ids: str = Query("", description="项目 ID，逗号分隔；空 = 全部"),
    base_month: str = Query("", pattern=rf"^$|{MONTH_PATTERN[1:-1]}", description="份额基准月 YYYY-MM；空 = 最新有份额数据的月份"),
    horizon: int = Query(ALERT_HORIZON_DEFAULT, ge=0, le=12, description="供需关注窗口（月）；0 = 全年"),
    db: Session = Depends(get_db),
) -> AlertResponse:
    pid_list = [int(x) for x in project_ids.split(",") if x.strip().isdigit()]
    projects = list(db.execute(select(Project).order_by(Project.code)).scalars().all())
    if pid_list:
        projects = [p for p in projects if p.id in pid_list]

    month = base_month or _default_base_month(db)
    months = _horizon_months(month, horizon)
    all_ids = [p.id for p in projects]

    supply_items, missing_bom = _supply_items(db, projects, all_ids, months)
    inventory_items, unknown = _inventory_items(db, projects, all_ids)
    change_items = _change_items(db, all_ids)
    share_items = _share_items(db, projects, all_ids, month)
    data_items = _data_items(projects, unknown, missing_bom)

    items = [*supply_items, *inventory_items, *change_items, *share_items, *data_items]
    # severity → source 固定序 → impact 降序 → fingerprint（末位保证稳定，避免前端跳动）
    # 排序键：紧急程度 → 距出事天数 → 影响量 → 指纹。
    #
    # ★ 为什么中间插「距出事天数」而不是来源固定序：
    #   件、天、百分点不能相加，跨来源本来没有可比的量；唯一人人能比的只有
    #   「还有几天出事」。原来的来源固定序（供需 > 库存 > …）是我为了输出稳定拍的，
    #   业务上站不住 —— 已断货会被排到 3 个月后的供需缺口后面。
    #   来源顺序保留，但只作为「同档、同事件日」时的兜底，不再主导。
    # ★ 无事件日的（份额、数据缺口这类状态型风险）沉到同档末尾。
    _NO_DUE = 10**6
    items.sort(
        key=lambda x: (
            _SEV_RANK.get(x.severity, 9),
            x.due_in_days if x.due_in_days is not None else _NO_DUE,
            ALERT_SOURCE_ORDER.index(x.source) if x.source in ALERT_SOURCE_ORDER else 9,
            -x.impact,
            x.fingerprint,
        )
    )

    counts = {s: 0 for s in _SEV_RANK}
    for it in items:
        counts[it.severity] = counts.get(it.severity, 0) + 1
    counts["total"] = len(items)

    by_source = {s: 0 for s in ALERT_SOURCE_ORDER}
    for it in items:
        by_source[it.source] = by_source.get(it.source, 0) + 1

    # 项目矩阵：severity 取该项目最严重级别；dims 键为来源
    agg: dict[int, dict[str, Any]] = {}
    for it in items:
        pid = it.ref.project_id
        if pid is None or pid not in {p.id for p in projects}:
            continue
        row = agg.setdefault(
            pid,
            {
                "counts": {s: 0 for s in _SEV_RANK},
                "dims": {},
                "severity": None,
                "worst": it,
            },
        )
        row["counts"][it.severity] = row["counts"].get(it.severity, 0) + 1
        dim = row["dims"].setdefault(it.source, {"severity": None, "count": 0})
        dim["count"] += 1
        if dim["severity"] is None or _SEV_RANK[it.severity] < _SEV_RANK[dim["severity"]]:
            dim["severity"] = it.severity
        if row["severity"] is None or _SEV_RANK[it.severity] < _SEV_RANK[row["severity"]]:
            row["severity"] = it.severity
            row["worst"] = it

    pmap = {p.id: p for p in projects}
    # 无信号的项目也要出一行（severity=None、counts 全 0）：
    # 老板看到「LFP3 一排红、TV-M 全空」才知道另一个项目是干净的；
    # 只列有信号的项目，会让人误以为其他项目没被检查。
    for p in projects:
        agg.setdefault(
            p.id,
            {
                "counts": {s: 0 for s in _SEV_RANK},
                "dims": {},
                "severity": None,
                "worst": None,
            },
        )

    by_project: list[AlertProjectRow] = []
    for pid, row in agg.items():
        p = pmap[pid]
        worst = row["worst"]
        by_project.append(
            AlertProjectRow(
                project_id=pid,
                code=p.code,
                name=p.name,
                severity=row["severity"],
                counts=row["counts"],
                dims={k: AlertDimStat(**v) for k, v in row["dims"].items()},
                worst=(
                    AlertProjectWorst(kind=worst.kind, title=worst.title, as_of=worst.as_of)
                    if worst is not None
                    else None
                ),
            )
        )
    # 最紧急的项目在前；同级按 P0 数降序
    # 无信号（severity=None）沉底，其余按紧急程度 + P0 数
    by_project.sort(key=lambda r: (_SEV_RANK.get(r.severity or "", 9), -r.counts.get("p0", 0), r.code))

    return AlertResponse(
        generated_at=datetime.now(),
        base_month=month,
        horizon=months,
        thresholds=AlertThresholds(
            supply={"tight_min": ALERT_SUPPLY_TIGHT_MIN, "tight_max": ALERT_SUPPLY_TIGHT_MAX},
            share={
                "fluctuation_ratio": RISK_FLUCTUATION_RATIO,
                "deviation_pt": float(RISK_DEVIATION_PT),
            },
            inventory={"urgent_doh": float(INV_URGENT_DOH_THRESHOLD)},
        ),
        counts=counts,
        by_source=by_source,
        by_project=by_project,
        items=items,
    )
