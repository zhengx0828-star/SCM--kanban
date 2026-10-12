"""库存信号塔路由：动态库存与 DOH 风险监控看板。

推算单元 = 项目 × 物料 × 供应商 × 基地（InventoryPlan）。核心口径（规则页「库存管理」SOP 同步维护）：
- 需求来源两种模式：档案未带快照时与底表联动（客户需求 demand × BOM 系数），
  带快照时使用档案自带的历史/预测（Excel 导入与早期数据）；
- 系统预测需求：未来预测月度总量按自然日摊日均（qty ÷ 当月天数），窗口随「今天」滚动 30 天；
- COV = 需求样本标准差 ÷ 均值（≥ 2 个月才计算，否则 NA），衡量客户需求波动；
- 安全天数 = Z × COV × √LT（Z 为服务水平系数，默认 1.65 即 95%）；
  COV 不可算时回退兜底安全天数（INV_SAFE_DOH_DEFAULT），并标记为「非公式推导」；
- 安全库存 SS = 窗口日均需求 × 安全天数；
- 再订货点 ROP = (LT + 安全天数) × 日均需求；
- 每日期末库存 = 前日期末 + 当日手工修正入库 − (当日系统预测需求 + 当日手工修正需求)，
  首日前一天 = 初始现有库存；直接改过期末库存（盘点覆盖）则后续日基于覆盖值重算；
- 动态 DOH：从当日之后起按日扣减未来每日需求（计入未来手工修正入库），能完整覆盖的天数，
  不足一天按比例折算（0.1 天精度）；30 天窗口内消耗不完记为「30+」（capped）；
- 预警状态判定（优先级从高到低，每格只落一种）：
  深红 期末库存 ≤ 0（已断货）
  浅红 期末库存 < SS 或 DOH < 目标安全天数
  黄   DOH ∈ [安全天数, 安全天数 × 1.25)（贴近安全线）
  蓝   DOH > 过剩天数 或 30 天未耗尽（积压）
- 补货建议：窗口内期末首次跌破 ROP 之日 = 最晚下单日，建议补货量 = 一个周期量（即 ROP）；
- 产能校验：建议补货量 ÷ 该项目该供应商当月分配额度，三档（充足 / 紧张 / 不足）；
  额度未录入则不误报（na）。供应商总产能用于展示占比，不参与判定；
- 「所有格都可编辑」：系统预测需求 / 手工修正需求 / 手工修正入库 / 期末库存 直接改；
  DOH 格编辑 = 反推该日期末库存以满足目标覆盖天数。

接口：
- GET    /api/inventory/plans            推算单元列表（含 30 天矩阵 + 补货建议 + 产能校验）
- GET    /api/inventory/candidates       底表中尚未建档的「项目×物料×供应商」组合
- POST   /api/inventory/plans            新建单个库存档案
- POST   /api/inventory/plans/bulk       批量建档
- GET    /api/inventory/summary          遗留 KPI 概览（按 PN 去重；页面已改为前端本地漏斗统计）
- PATCH  /api/inventory/plans/{id}       改 LeadTime / 初始现有库存（左冻结列）
- PUT    /api/inventory/plans/{id}/days  批量改某日单元格（全格可编辑，落库即重算全链）
- POST   /api/inventory/import           Excel 导入（服务端文件路径模式，列约定见函数 docstring）
"""

import calendar
import io
import json
import math
import os
import re
import statistics
from datetime import date, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import (
    BaseSite,
    InventoryDay,
    InventoryPlan,
    Material,
    Project,
    ProjectSupplyRelation,
    Supplier,
    SupplyRelation,
)
from ..schemas import (
    INV_CAPACITY_FULL_RATIO,
    INV_CAPACITY_NA,
    INV_CAPACITY_OK,
    INV_CAPACITY_SHORT,
    INV_CAPACITY_TIGHT,
    INV_CAPACITY_TIGHT_RATIO,
    INV_COV_HI,
    INV_COV_LABEL_HIGH,
    INV_COV_LABEL_LOW,
    INV_COV_LABEL_MID,
    INV_COV_LABEL_NA,
    INV_COV_MID,
    INV_DOH_BUCKET_LOW,
    INV_DOH_BUCKET_OK,
    INV_DOH_BUCKET_STOCKOUT,
    INV_DOH_BUCKET_UNKNOWN,
    INV_DOH_BUCKET_URGENT,
    INV_EXCESS_DOH_DEFAULT,
    INV_MIN_HIST_MONTHS,
    INV_SAFE_DOH_DEFAULT,
    INV_SERVICE_LEVEL_OPTIONS,
    INV_SOURCE_MASTER,
    INV_SOURCE_SNAPSHOT,
    INV_STATUS_BLUE,
    INV_STATUS_OK,
    INV_STATUS_RED,
    INV_STATUS_STOCKOUT,
    INV_STATUS_YELLOW,
    INV_URGENT_DOH_THRESHOLD,
    INV_WINDOW_DAYS,
    INV_YELLOW_RATIO,
    INV_Z_DEFAULT,
    InventoryBulkCreate,
    InventoryBulkCreateResult,
    InventoryCandidate,
    InventoryCellOut,
    InventoryDayUpdate,
    InventoryDohBuckets,
    InventoryImportResult,
    InventoryMonthQty,
    InventoryMostUrgent,
    InventoryPlanCreate,
    InventoryPlanOut,
    InventoryPlanUpdate,
    InventoryProjectOverview,
    InventorySummary,
)

router = APIRouter(prefix="/api/inventory", tags=["Inventory"])

_DAY_LOAD = (
    selectinload(InventoryPlan.project),
    selectinload(InventoryPlan.material),
    selectinload(InventoryPlan.supplier),
    selectinload(InventoryPlan.base_site),
)


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------

def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _month_days(d: date) -> int:
    return calendar.monthrange(d.year, d.month)[1]


def _window(base: date) -> list[date]:
    """未来 30 天窗口（含今天，T1..T30）。"""
    return [base + timedelta(days=i) for i in range(INV_WINDOW_DAYS)]


def _month_label(raw: object) -> str | None:
    """把 '2026-7' / '2026-07' / '2026/7' 统一成 'YYYY-MM'；无法解析返回 None。

    月份写法不统一（缺前导零 / 用斜杠）会让「按月查需求」整片落空 —— 窗口查不到月份时
    需求被静默当 0，页面反而显示健康。故所有月份解析入口统一归一到两位月份。
    """
    if raw is None:
        return None
    parts = re.split(r"[-/.]", str(raw).strip())
    if len(parts) < 2:
        return None
    try:
        y, m = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return None
    if not (1 <= m <= 12):
        return None
    return f"{y:04d}-{m:02d}"


def _parse_month_qty(raw: str | None) -> list[InventoryMonthQty]:
    """解析库存 JSON [{m, q}, ...] → 按月份排序的列表。

    容错：JSON 非法、合法但不是数组（标量 123 / 1.5 / true）、元素不是对象、
    月份不可解析 —— 一律跳过而不是抛异常，单行脏数据不能让整页 500。
    """
    if not raw:
        return []
    if isinstance(raw, list):
        data: object = raw
    else:
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return []
    if not isinstance(data, list):
        return []          # 合法 JSON 但是标量 / 对象 → 视为「无快照」，降级走底表联动
    out: list[InventoryMonthQty] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        label = _month_label(item.get("m"))
        if label is None:
            continue
        try:
            out.append(InventoryMonthQty(m=label, q=float(item["q"])))
        except (TypeError, KeyError, ValueError):
            continue
    out.sort(key=lambda x: x.m)
    return out


def _month_array_to_items(raw: str | None, base: date) -> list[InventoryMonthQty]:
    """解析底表的 12 月数组（[q1, q2, ... q12]）→ [{m:'YYYY-MM', q}]。

    底表 project_supply_relations.demand / capacity 存的是定长 12 数组（下标 0 = 1 月），
    与 InventoryPlan.hist_json 的 [{m,q}] 结构不同，故单独解析。

    数组是**无年份的月度画像**，本函数按 base 所在年份打标签（供 COV 取样与展示）；
    窗口取数时另按「同月」兜底（见 `_fcast_of_day`），避免 12 月的 30 天窗口伸进
    次年 1 月时需求查不到、被静默算成 0。
    """
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    out: list[InventoryMonthQty] = []
    for i, v in enumerate(data[:12]):
        try:
            q = float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            q = 0.0
        m = date(base.year, i + 1, 1)                 # 下标 i → 当年 (i+1) 月
        out.append(InventoryMonthQty(m=f"{m.year:04d}-{m.month:02d}", q=q))
    return out


def _month_array_value(raw: str | None, month: int) -> float | None:
    """取底表 12 月数组中某个月（1-12）的值；未录入或非法返回 None。"""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, list) or not (1 <= month <= 12) or len(data) < month:
        return None
    v = data[month - 1]
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cov_of(hist: list[InventoryMonthQty]) -> tuple[float | None, str]:
    """历史需求 COV = 样本标准差 ÷ 均值。不足 2 个月不计算（NA）。"""
    if len(hist) < INV_MIN_HIST_MONTHS:
        return None, INV_COV_LABEL_NA
    qs = [h.q for h in hist]
    mean = statistics.fmean(qs)
    if mean <= 0:
        # 需求均值 ≤ 0（如全 0 / 负数）→ 波动不可算，回退兜底安全天数，
        # 不要返回 0.0 让人误读成「零波动 = 零安全库存」。
        return None, INV_COV_LABEL_NA
    stdev = statistics.stdev(qs) if len(qs) > 1 else 0.0
    cov = stdev / mean
    label = (
        INV_COV_LABEL_HIGH if cov >= INV_COV_HI
        else INV_COV_LABEL_MID if cov >= INV_COV_MID
        else INV_COV_LABEL_LOW
    )
    return cov, label


def _status_of(ending: float, doh: float, doh_capped: bool, ss: float, safe: float, excess: float) -> str:
    """预警状态判定（优先级：深红 > 浅红 > 蓝 > 黄 > 正常）。"""
    if ending <= 0:
        return INV_STATUS_STOCKOUT
    # doh_capped 时 doh 取窗口长度（30）作为下界，故 `doh < safe` 已覆盖
    # 「安全天数 > 30 天」的情形（旧写法用 not doh_capped 短路，会让这类行永远不亮红）。
    if ending < ss or doh < safe:
        return INV_STATUS_RED
    if doh_capped:
        # 30 天窗口内消耗不完：过剩阈值 ≤ 30 时视为积压（蓝）
        return INV_STATUS_BLUE if excess <= INV_WINDOW_DAYS else INV_STATUS_OK
    if doh > excess:
        return INV_STATUS_BLUE
    if safe <= doh < safe * INV_YELLOW_RATIO:
        return INV_STATUS_YELLOW
    return INV_STATUS_OK


def _fcast_map_of(fcast: list[InventoryMonthQty], source: str) -> dict[str, float]:
    """未来需求查询表：精确 'YYYY-MM' 键；底表联动再补一层「同月画像」'*MM' 兜底键。"""
    out: dict[str, float] = {f.m: f.q for f in fcast}
    if source == INV_SOURCE_MASTER:
        for f in fcast:
            label = _month_label(f.m)
            if label:
                out.setdefault(f"*{label[5:7]}", f.q)
    return out


def _fcast_of_day(fcast_map: dict[str, float], source: str, d: date) -> float:
    """取某日所属月份的未来需求总量。

    先精确匹配 'YYYY-MM'；底表联动（master）的 12 月数组不带年份，12 月的 30 天窗口
    伸进次年 1 月时精确键必然查不到 → 需求会被静默当 0。此时回退「同月画像」取值。
    查不到且无兜底一律返回 0.0，绝不抛异常。
    """
    v = fcast_map.get(_month_key(d))
    if v is None and source == INV_SOURCE_MASTER:
        v = fcast_map.get(f"*{d.month:02d}")
    return v if v is not None else 0.0


def _simulate_ending(
    plan: InventoryPlan,
    day_map: dict[date, InventoryDay],
    window: list[date],
    fcast_map: dict[str, float],
    source: str,
) -> tuple[list[float], list[float], list[float], list[bool]]:
    """正向递推 30 天：总需求(override 优先) / 手工入库 / 期末库存 / 该日是否有手改。"""
    demands: list[float] = []
    ins: list[float] = []
    endings: list[float] = []
    manuals: list[bool] = []
    prev = plan.on_hand
    for d in window:
        day = day_map.get(d)
        sys_d = _fcast_of_day(fcast_map, source, d) / _month_days(d)
        if day is not None and day.demand_override is not None:
            sys_d = day.demand_override
        manual_demand = day.manual_demand if day is not None else 0.0
        manual_in = day.manual_in if day is not None else 0.0
        total_demand = sys_d + manual_demand
        calc_ending = prev + manual_in - total_demand
        ending = day.ending_override if day is not None and day.ending_override is not None else calc_ending
        demands.append(total_demand)
        ins.append(manual_in)
        endings.append(ending)
        manuals.append(
            day is not None
            and (day.demand_override is not None or day.manual_demand != 0 or day.manual_in != 0 or day.ending_override is not None)
        )
        prev = ending
    return demands, ins, endings, manuals


def _doh_given_ending(
    ending0: float,
    start_idx: int,
    demands: list[float],
    ins: list[float],
) -> tuple[float, bool]:
    """给定某日期末库存 ending0，从 start_idx 之后逐日扣减需求（计入手工入库），算可覆盖天数。"""
    if ending0 <= 0:
        return 0.0, False
    surplus = ending0
    days_covered = 0.0
    for j in range(start_idx + 1, len(demands)):
        surplus += ins[j]          # 当日入库先到
        demand = demands[j]
        if demand <= 0:
            continue               # 无消耗的日子不消耗库存，不计覆盖天数
        if surplus >= demand:
            surplus -= demand
            days_covered += 1.0
        else:
            days_covered += surplus / demand if demand > 0 else 0.0
            surplus = 0.0
            break
    if surplus > 0:
        # 窗口内未耗尽 → 30+（capped）
        return float(INV_WINDOW_DAYS), True
    return days_covered, False


def _doh_of_ending_target(
    target: float,
    start_idx: int,
    demands: list[float],
    ins: list[float],
) -> float | None:
    """反推：该日期末库存应为多少，才能恰好覆盖 target 天消耗（用于编辑 DOH 格）。

    返回覆盖值；target > 窗口时直接给「窗口内全部净需求 + 1」确保 30+。
    """
    if target <= 0:
        return 0.0
    high = sum(max(demands[j] - ins[j], 0.0) for j in range(start_idx + 1, len(demands))) + 1.0
    if target >= INV_WINDOW_DAYS:
        return high
    lo, hi = 0.0, high
    for _ in range(60):  # 二分 60 次足够收敛
        mid = (lo + hi) / 2
        doh, _capped = _doh_given_ending(mid, start_idx, demands, ins)
        if doh >= target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def _round_cell(v: float) -> float:
    return round(v, 2)


# ---------------------------------------------------------------------------
# 单行输出构造（行 = plan + 30 天矩阵）
# ---------------------------------------------------------------------------

def _resolve_demand(
    plan: InventoryPlan, psr: ProjectSupplyRelation | None, base: date
) -> tuple[list[InventoryMonthQty], list[InventoryMonthQty], str, float | None]:
    """解析该档案的需求序列。

    返回 (用于算 COV 的样本, 用于摊日均的未来预测, 来源, BOM 系数)。

    优先使用档案自带快照（Excel 导入 / 早期手工录入的 hist_json、fcast_json）；
    两者皆空时与底表联动：物料需求 = 客户需求（PSR.demand）× BOM 系数，
    供需管理录入后库存推算自动跟随，无需二次录入。

    底表联动时 COV 样本只取「今天之前」的月份 —— 该数组是全年计划画像，若把未来月份
    也算进「历史波动」，会把计划波动误当历史波动（口径同步维护在规则页）。
    """
    hist = _parse_month_qty(plan.hist_json)
    fcast = _parse_month_qty(plan.fcast_json)
    if hist or fcast:
        return hist, fcast, INV_SOURCE_SNAPSHOT, None

    if psr is None:
        return [], [], INV_SOURCE_MASTER, None

    demand = _month_array_to_items(psr.demand, base)
    bom = psr.bom_factor if psr.bom_factor is not None else 1.0
    scaled = [InventoryMonthQty(m=d.m, q=d.q * bom) for d in demand]
    cur = _month_key(base)
    hist_only = [d for d in scaled if d.m < cur]
    return hist_only, scaled, INV_SOURCE_MASTER, psr.bom_factor


def _load_link_maps(
    db: Session, plans: list[InventoryPlan]
) -> tuple[dict[tuple[int, int, int], ProjectSupplyRelation], dict[int, SupplyRelation]]:
    """批量加载档案对应的项目供应明细（产能额度 / BOM / 需求）与供应关系（供应商总产能）。

    键 (project_id, supplier_id, material_id) —— 避免逐行查询造成 N+1。
    """
    psr_map: dict[tuple[int, int, int], ProjectSupplyRelation] = {}
    sr_map: dict[int, SupplyRelation] = {}
    if not plans:
        return psr_map, sr_map

    project_ids = {p.project_id for p in plans}
    material_ids = {p.material_id for p in plans}
    supplier_ids = {p.supplier_id for p in plans}

    rows = db.execute(
        select(ProjectSupplyRelation)
        .join(SupplyRelation, SupplyRelation.id == ProjectSupplyRelation.supply_relation_id)
        .where(
            ProjectSupplyRelation.project_id.in_(project_ids),
            SupplyRelation.material_id.in_(material_ids),
            SupplyRelation.supplier_id.in_(supplier_ids),
        )
        .order_by(ProjectSupplyRelation.is_primary.desc(), ProjectSupplyRelation.id)
    ).scalars().all()

    for psr in rows:
        sr = psr.supply_relation
        sr_map[sr.id] = sr
        key = (psr.project_id, sr.supplier_id, sr.material_id)
        psr_map.setdefault(key, psr)  # 主供优先（已按 is_primary 倒序）
    return psr_map, sr_map


def _infer_supplier(db: Session, project_id: int, material_id: int) -> Supplier | None:
    """按「项目 × 物料」推断供应商：优先该项目的主供，其次任意供应此物料的供应商。

    供 Excel 导入使用：表里没写「供应商代码」时兜底，尽量让导入不中断。
    """
    row = db.execute(
        select(Supplier)
        .join(SupplyRelation, SupplyRelation.supplier_id == Supplier.id)
        .join(ProjectSupplyRelation, ProjectSupplyRelation.supply_relation_id == SupplyRelation.id)
        .where(
            ProjectSupplyRelation.project_id == project_id,
            SupplyRelation.material_id == material_id,
        )
        .order_by(ProjectSupplyRelation.is_primary.desc(), ProjectSupplyRelation.id)
        .limit(1)
    ).scalars().first()
    if row is not None:
        return row
    return db.execute(
        select(Supplier)
        .join(SupplyRelation, SupplyRelation.supplier_id == Supplier.id)
        .where(SupplyRelation.material_id == material_id)
        .order_by(Supplier.id)
        .limit(1)
    ).scalars().first()


def _build_plan_out(
    plan: InventoryPlan,
    base: date,
    service_z: float,
    excess: float,
    psr: ProjectSupplyRelation | None = None,
    sr: SupplyRelation | None = None,
    day_map: dict[date, InventoryDay] | None = None,
) -> InventoryPlanOut:
    """构造单行完整输出：30 天矩阵 + 安全库存口径 + 补货建议 + 产能校验。"""
    hist, fcast, source, bom_factor = _resolve_demand(plan, psr, base)
    fcast_map = _fcast_map_of(fcast, source)
    cov, cov_label = _cov_of(hist)

    # 安全天数 = Z × COV × √LT；COV 不可算（需求样本 < 2 个月）时回退兜底值
    if cov is None:
        safe_days = float(INV_SAFE_DOH_DEFAULT)
        safe_derived = False
    else:
        safe_days = max(service_z * cov * math.sqrt(max(plan.lead_time_days, 0.0)), 0.0)
        safe_derived = True

    window = _window(base)
    if day_map is None:
        day_map = {d.date: d for d in plan.days}

    demands, ins, endings, manuals = _simulate_ending(plan, day_map, window, fcast_map, source)
    avg_daily = sum(demands) / len(demands) if demands else 0.0
    ss = avg_daily * safe_days
    rop = (plan.lead_time_days + safe_days) * avg_daily

    # 需求「有序列但为 0」的显式标记 —— 不能让「漏录 / BOM=0」伪装成绿色健康（见审计 F-03）。
    # 判据：① 序列存在（hist/fcast 至少要有一个月份行）② BOM 系数显式为 0 ③ 窗口日均需求 ≈ 0。
    # 注意：底表联动但 PSR.demand 为空时 → hist/fcast 都是空列表，属于「完全没有序列」，
    # 不算 demand_blank（那种情形由前端「缺需求数据」分支表达），故这里只看实际序列。
    has_series = bool(hist or fcast)
    bom_zero = source == INV_SOURCE_MASTER and bom_factor is not None and bom_factor == 0
    demand_blank = has_series and avg_daily <= 0

    days_out: list[InventoryCellOut] = []
    order_idx: int | None = None    # 期末首次跌破 ROP
    stockout_idx: int | None = None  # 期末首次 ≤ 0
    for i, d in enumerate(window):
        day = day_map.get(d)
        doh, capped = _doh_given_ending(endings[i], i, demands, ins)
        status_key = _status_of(endings[i], doh, capped, ss, safe_days, excess)
        sys_d = _fcast_of_day(fcast_map, source, d) / _month_days(d)
        sys_overridden = day is not None and day.demand_override is not None
        days_out.append(
            InventoryCellOut(
                date=d.isoformat(),
                sys_demand=_round_cell(day.demand_override if sys_overridden and day is not None else sys_d),
                sys_overridden=bool(sys_overridden),
                manual_demand=_round_cell(day.manual_demand if day is not None else 0.0),
                manual_in=_round_cell(day.manual_in if day is not None else 0.0),
                ending=_round_cell(endings[i]),
                ending_overridden=bool(day is not None and day.ending_override is not None),
                doh=round(doh, 1),
                doh_capped=capped,
                status=status_key,
                manual=bool(manuals[i]),
            )
        )
        if order_idx is None and endings[i] <= rop:
            order_idx = i
        if stockout_idx is None and endings[i] <= 0:
            stockout_idx = i

    # ---- 补货建议：窗口内实际跌破 ROP 才给（补货量 = 一个周期量 = ROP）----
    replenish_qty: float | None = None
    order_by_date: str | None = None
    stockout_date: str | None = None
    days_until_order: int | None = None
    capacity_limit: float | None = None
    capacity_used: float | None = None
    capacity_usage: float | None = None
    capacity_status = INV_CAPACITY_NA
    capacity_month: str | None = None

    if stockout_idx is not None:
        stockout_date = window[stockout_idx].isoformat()

    if order_idx is not None:
        order_day = window[order_idx]
        replenish_qty = _round_cell(rop)
        order_by_date = order_day.isoformat()
        days_until_order = order_idx
        capacity_month = _month_key(order_day)
        month_no = order_day.month
        capacity_limit = _month_array_value(psr.capacity, month_no) if psr else None
        capacity_used = _month_array_value(sr.capacity, month_no) if sr else None
        if capacity_limit is None:
            capacity_status = INV_CAPACITY_NA            # 额度未录入 → 不误报
        elif capacity_limit <= 0:
            # 显式录了 0 / 负数：本月没有分配额度，任何补货量都超额度 → 必须判「不足」。
            # 旧写法把它并进「未录额度」，等于把「没额度」误报成「没校验」。
            capacity_status = INV_CAPACITY_SHORT
        else:
            capacity_usage = replenish_qty / capacity_limit
            if capacity_usage > INV_CAPACITY_FULL_RATIO:
                capacity_status = INV_CAPACITY_SHORT
            elif capacity_usage >= INV_CAPACITY_TIGHT_RATIO:
                capacity_status = INV_CAPACITY_TIGHT
            else:
                capacity_status = INV_CAPACITY_OK

    out = InventoryPlanOut(
        id=plan.id,
        project_id=plan.project_id,
        project_code=plan.project.code if plan.project else "—（项目已删除）",
        project_name=plan.project.name if plan.project else "—",
        supplier_id=plan.supplier_id,
        # 供应商 / 基地 / 物料可能被删（主数据删除端点已加 409 保护，这里再兜一层：
        # 历史孤儿行也不能让整页 500）。
        supplier_name=plan.supplier.name if plan.supplier else "—（供应商已删除）",
        supplier_code=plan.supplier.code if plan.supplier else "—",
        base_id=plan.base_id,
        base_name=plan.base_site.name if plan.base_site else "—（基地已删除）",
        material_id=plan.material_id,
        pn=plan.material.pn if plan.material else "—（物料已删除）",
        material_name=plan.material.name if plan.material else "—",
        lead_time_days=plan.lead_time_days,
        on_hand=plan.on_hand,
        demand_source=source,
        bom_factor=bom_factor,
        demand_blank=demand_blank,
        bom_zero=bom_zero,
        cov=round(cov, 4) if cov is not None else None,
        cov_label=cov_label,
        avg_daily=_round_cell(avg_daily),
        hist=hist,
        fcast=fcast,
        service_z=service_z,
        safe_days=round(safe_days, 2),
        safe_days_derived=safe_derived,
        ss=_round_cell(ss),
        rop=_round_cell(rop),
        replenish_qty=replenish_qty,
        order_by_date=order_by_date,
        stockout_date=stockout_date,
        days_until_order=days_until_order,
        capacity_limit=capacity_limit,
        capacity_used=capacity_used,
        capacity_usage=round(capacity_usage, 4) if capacity_usage is not None else None,
        capacity_status=capacity_status,
        capacity_month=capacity_month,
        days=days_out,
    )
    # 四档档位由后端统一判定（唯一入口 _doh_bucket_of），前端直接用，不重算防漂移
    out.doh_bucket = _doh_bucket_of(out)
    out.doh_today = round(_today_doh(out), 1)
    return out


def _split_csv(v: str) -> list[str]:
    return [s.strip() for s in v.split(",") if s.strip()]


def _int_list(v: str) -> list[int]:
    out: list[int] = []
    for s in _split_csv(v):
        try:
            out.append(int(s))
        except ValueError:
            continue
    return out


def _load_plans(
    db: Session,
    project_ids: list[int],
    base_ids: list[int],
    supplier_ids: list[int],
    pns: list[str],
) -> list[InventoryPlan]:
    q = select(InventoryPlan).options(*_DAY_LOAD)
    if project_ids:
        q = q.where(InventoryPlan.project_id.in_(project_ids))
    if base_ids:
        q = q.where(InventoryPlan.base_id.in_(base_ids))
    if supplier_ids:
        q = q.where(InventoryPlan.supplier_id.in_(supplier_ids))
    if pns:
        q = q.join(InventoryPlan.material).where(Material.pn.in_(pns))
    return list(db.execute(q).scalars().all())


def _out_of(plan: InventoryPlan, psr_map, sr_map, today: date, service_z: float, excess: float) -> InventoryPlanOut:
    """单行装配：查到对应的项目供应明细 / 供应关系后交给 _build_plan_out。"""
    psr = psr_map.get((plan.project_id, plan.supplier_id, plan.material_id))
    sr = psr.supply_relation if psr is not None else None
    return _build_plan_out(plan, today, service_z, excess, psr, sr, {d.date: d for d in plan.days})


# ---------------------------------------------------------------------------
# 顶部四卡口径：今日 DOH 四档（唯一判定入口，前端与 project-overview 共用）
# ---------------------------------------------------------------------------

def _unknown_kind(out: InventoryPlanOut) -> str | None:
    """需求不可用三档的成因；可用则返回 None。

    判定顺序按「谁最具体」：完全没有序列 > BOM 被乘成 0 > 有序列但恒 0。
    硬约束 has_series = bool(hist or fcast)（勿写 or source == MASTER，
    否则「无序列」会被误判成「需求为 0」）。
    """
    no_series = len(out.hist) == 0 and len(out.fcast) == 0
    if no_series:
        return "no_series"
    if out.bom_zero:
        return "bom_zero"
    if out.demand_blank:
        return "demand_blank"
    return None


def _doh_bucket_of(out: InventoryPlanOut) -> str:
    """今日 DOH 四档判定（口径见 docs/inventory-redesign/03-口径定义.md）。

    ① stockout  DOH <= 0 或今日已断货
    ② urgent    0 < DOH < 安全天数，**或 DOH < INV_URGENT_DOH_THRESHOLD（绝对阈值）**
    ③ low       安全天数 <= DOH < LeadTime（左闭右开）
    ④ ok        DOH >= LeadTime
    ⑤ unknown   需求不可用三档优先于一切，绝不入正常档

    关键 1：doh_capped（30 天窗口内未耗尽）**不得当作「充足」判据**。
    capped 只说明 30 天内耗不完；若 LT > 30，DOH 30 天仍走不完采购周期 → low。

    关键 2：**安全天数可能是 0**。需求完全平稳 → COV = 0 → 安全天数 = Z×0×√LT = 0，
    此时 `doh < safe_days` 恒为假，DOH 只剩 1 天的行会被宽容地判成 low（业务上不合理）。
    故叠加绝对阈值兜底：DOH < 3 天一律 urgent，与安全天数口径并行（谁先命中算谁）。
    """
    if _unknown_kind(out) is not None:
        return INV_DOH_BUCKET_UNKNOWN

    d0 = out.days[0]
    doh = float(INV_WINDOW_DAYS) if d0.doh_capped else d0.doh
    if doh <= 0 or d0.status == INV_STATUS_STOCKOUT:
        return INV_DOH_BUCKET_STOCKOUT
    if doh < out.safe_days or doh < INV_URGENT_DOH_THRESHOLD:
        return INV_DOH_BUCKET_URGENT
    if doh < out.lead_time_days:
        return INV_DOH_BUCKET_LOW
    return INV_DOH_BUCKET_OK


def _empty_buckets() -> dict[str, int]:
    return {
        "stockout": 0,
        "urgent": 0,
        "low": 0,
        "ok": 0,
        "unknown": 0,
        "unknown_no_series": 0,
        "unknown_bom_zero": 0,
        "unknown_demand_blank": 0,
    }


def _tally(buckets: dict[str, int], out: InventoryPlanOut) -> None:
    """把一行计入四档统计（含 unknown 的三档成因细分）。"""
    kind = _unknown_kind(out)
    if kind is not None:
        buckets[INV_DOH_BUCKET_UNKNOWN] += 1
        buckets[f"unknown_{kind}"] += 1
        return
    buckets[_doh_bucket_of(out)] += 1


def _today_doh(out: InventoryPlanOut) -> float:
    """今日 DOH（capped 按窗口长度处理）—— 用于排序与「最紧急」选取。"""
    d0 = out.days[0]
    return float(INV_WINDOW_DAYS) if d0.doh_capped else float(d0.doh)


def _filter_rows(rows: list[InventoryPlanOut], bucket: str) -> list[InventoryPlanOut]:
    """按四卡档位过滤（bucket 为空 = 不过滤）。

    支持**逗号分隔多档**（如 `stockout,urgent`）：Dashboard「库存天数 < 3」卡
    聚合的就是「已断货 + 紧急」两档，跳转时按同一口径带上两档，避免
    「卡上写 5、列表只有 3 行」的口径不一致。单档传参行为不变。
    """
    want = set(_split_csv(bucket))
    if not want:
        return rows
    return [r for r in rows if _doh_bucket_of(r) in want]


def _unknown_last(r: InventoryPlanOut) -> int:
    return 1 if _doh_bucket_of(r) == INV_DOH_BUCKET_UNKNOWN else 0


def _sort_rows(rows: list[InventoryPlanOut], sort: str) -> list[InventoryPlanOut]:
    """列表排序。默认 doh 升序（最危险在最上）；unknown 恒排最后。"""
    if sort == "pn":
        return sorted(rows, key=lambda r: (r.pn, r.project_name, r.base_name))
    if sort == "replenish":
        return sorted(rows, key=lambda r: (_unknown_last(r), -(r.replenish_qty or 0)))
    if sort == "lt":
        return sorted(rows, key=lambda r: (_unknown_last(r), r.lead_time_days))
    if sort == "order":
        return sorted(rows, key=lambda r: (_unknown_last(r), r.order_by_date or "9999-12-31"))
    return sorted(rows, key=lambda r: (_unknown_last(r), _today_doh(r)))


def _assemble(
    db: Session,
    project_ids: list[int],
    base_ids: list[int],
    supplier_ids: list[int],
    pns: list[str],
    service_z: float,
    excess: float,
) -> list[InventoryPlanOut]:
    """加载 + 装配 + 排序（list_plans / export 共用，保证两处口径与顺序一致）。"""
    if not project_ids:
        # L1 必须带项目（L0 未选项目不加载物料）；export 同约束
        return []
    plans = _load_plans(db, project_ids, base_ids, supplier_ids, pns)
    psr_map, sr_map = _load_link_maps(db, plans)
    today = date.today()
    return [_out_of(p, psr_map, sr_map, today, service_z, excess) for p in plans]


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------

@router.get("/plans", response_model=list[InventoryPlanOut], summary="推算单元列表（含 30 天矩阵 / 补货建议 / 产能校验）")
def list_plans(
    project_ids: str = Query("", description="项目 ID，逗号分隔；**必填**（L0 未选项目时不加载物料，空则返回 []）"),
    base_ids: str = Query("", description="基地 ID，逗号分隔；空 = 全部"),
    supplier_ids: str = Query("", description="供应商 ID，逗号分隔；空 = 全部"),
    pns: str = Query("", description="物料 PN，逗号分隔；空 = 全部"),
    bucket: str = Query("", description="顶部四卡过滤：stockout / urgent / low / ok / unknown，**支持逗号多档**（如 stockout,urgent）；空 = 全部"),
    sort: str = Query("doh", description="排序：doh(默认,升序) / pn / replenish / lt / order"),
    service_z: float = Query(INV_Z_DEFAULT, gt=0, description="服务水平系数 Z（95% ≈ 1.65）"),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0, description="过剩库存天数"),
    db: Session = Depends(get_db),
) -> list[InventoryPlanOut]:
    out = _assemble(
        db,
        _int_list(project_ids),
        _int_list(base_ids),
        _int_list(supplier_ids),
        _split_csv(pns),
        service_z,
        excess,
    )
    return _sort_rows(_filter_rows(out, bucket), sort)


@router.get(
    "/project-overview",
    response_model=list[InventoryProjectOverview],
    summary="项目级 DOH 概览（L0 项目卡片墙；不含任何物料明细）",
)
def project_overview(
    service_z: float = Query(INV_Z_DEFAULT, gt=0, description="服务水平系数 Z（95% ≈ 1.65）"),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0, description="过剩库存天数"),
    db: Session = Depends(get_db),
) -> list[InventoryProjectOverview]:
    """全部项目的今日 DOH 四档分布 + 最紧急物料。

    与 `/plans` **共用 `_build_plan_out` / `_tally` / `_doh_bucket_of`**，
    保证 L0 角标与 L1 四卡计数完全一致（禁止另写一套判定）。
    无论项目多少，本端点都不返回物料明细，体积恒定。
    """
    today = date.today()
    plans = _load_plans(db, [], [], [], [])
    psr_map, sr_map = _load_link_maps(db, plans)

    grouped: dict[int, dict] = {}
    for p in plans:
        g = grouped.get(p.project_id)
        if g is None:
            g = {
                "project_id": p.project_id,
                "project_code": p.project.code if p.project else "",
                "project_name": p.project.name if p.project else "",
                "rows": [],
                "buckets": _empty_buckets(),
                "pns": set(),
            }
            grouped[p.project_id] = g
        out = _out_of(p, psr_map, sr_map, today, service_z, excess)
        g["rows"].append(out)
        g["pns"].add(out.pn)
        _tally(g["buckets"], out)

    result: list[InventoryProjectOverview] = []
    for g in grouped.values():
        rows: list[InventoryPlanOut] = g["rows"]
        # 最紧急 = DOH 最小且非 unknown
        urgent = [r for r in rows if _doh_bucket_of(r) != INV_DOH_BUCKET_UNKNOWN]
        most_urgent = None
        if urgent:
            top = min(urgent, key=_today_doh)
            most_urgent = InventoryMostUrgent(
                material_name=top.material_name,
                pn=top.pn,
                base_name=top.base_name,
                doh=round(_today_doh(top), 1),
                bucket=_doh_bucket_of(top),
            )
        b = g["buckets"]
        result.append(
            InventoryProjectOverview(
                project_id=g["project_id"],
                project_code=g["project_code"],
                project_name=g["project_name"],
                plan_count=len(rows),
                material_count=len(g["pns"]),
                doh_buckets=InventoryDohBuckets(
                    stockout=b["stockout"],
                    urgent=b["urgent"],
                    low=b["low"],
                    ok=b["ok"],
                    unknown=b["unknown"],
                    unknown_no_series=b["unknown_no_series"],
                    unknown_bom_zero=b["unknown_bom_zero"],
                    unknown_demand_blank=b["unknown_demand_blank"],
                ),
                most_urgent=most_urgent,
            )
        )
    # 最危险的项目排最前（先按 ①+② 计数降序，再按项目名）
    result.sort(key=lambda r: (-(r.doh_buckets.stockout + r.doh_buckets.urgent), r.project_name))
    return result


@router.get("/summary", response_model=InventorySummary, summary="遗留 KPI 风险概览（按 PN 去重，暂未接入 UI）")
def inventory_summary(
    project_ids: str = Query("", description="项目 ID，逗号分隔；空 = 全部"),
    base_ids: str = Query("", description="基地 ID，逗号分隔；空 = 全部"),
    supplier_ids: str = Query("", description="供应商 ID，逗号分隔；空 = 全部"),
    pns: str = Query("", description="物料 PN，逗号分隔；空 = 全部"),
    service_z: float = Query(INV_Z_DEFAULT, gt=0),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0),
    db: Session = Depends(get_db),
) -> InventorySummary:
    today = date.today()
    plans = _load_plans(db, _int_list(project_ids), _int_list(base_ids), _int_list(supplier_ids), _split_csv(pns))
    psr_map, sr_map = _load_link_maps(db, plans)

    stockout_pns: set[str] = set()      # 断货高风险 SKU（PN 种类）：任一期末 < SS 或 DOH < 安全天数
    irreversible_pns: set[str] = set()  # 不可逆断货：将归零（未来库存 ≤ 0 或 DOH=0）且剩余覆盖 < LeadTime
    high_cov_pns: set[str] = set()      # 高波动 SKU：COV ≥ 0.8
    manual_cells = 0

    for p in plans:
        out = _out_of(p, psr_map, sr_map, today, service_z, excess)
        if out.cov_label == INV_COV_LABEL_HIGH:
            high_cov_pns.add(out.pn)
        row_stockout = False
        # 不可逆断货（今天视角）：窗口第 1 天的剩余覆盖天数 < LeadTime → 现在下单也来不及补货
        d0 = out.days[0]
        if not d0.doh_capped and d0.doh < p.lead_time_days:
            irreversible_pns.add(out.pn)
        for cell in out.days:
            if cell.status in (INV_STATUS_RED, INV_STATUS_STOCKOUT) or cell.doh < out.safe_days:
                row_stockout = True
            if cell.manual:
                manual_cells += 1
        if row_stockout:
            stockout_pns.add(out.pn)

    return InventorySummary(
        total_plans=len(plans),
        stockout_pns=len(stockout_pns),
        irreversible_pns=len(irreversible_pns),
        high_cov_pns=len(high_cov_pns),
        manual_cells=manual_cells,
        today=today.isoformat(),
    )


@router.patch("/plans/{plan_id}", response_model=InventoryPlanOut, summary="改 LeadTime / 初始现有库存（左冻结列）")
def update_plan(
    plan_id: int,
    payload: InventoryPlanUpdate,
    service_z: float = Query(INV_Z_DEFAULT, gt=0, description="服务水平系数 Z"),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0, description="过剩库存天数"),
    db: Session = Depends(get_db),
) -> InventoryPlanOut:
    plan = db.get(InventoryPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"推算单元 {plan_id} 不存在")
    data = payload.model_dump(exclude_unset=True)
    if "lead_time_days" in data:
        plan.lead_time_days = data["lead_time_days"]
    if "on_hand" in data:
        plan.on_hand = data["on_hand"]
    db.commit()
    db.refresh(plan)
    psr_map, sr_map = _load_link_maps(db, [plan])
    return _out_of(plan, psr_map, sr_map, date.today(), service_z, excess)


@router.put("/plans/{plan_id}/days", response_model=InventoryPlanOut, summary="批量改某日单元格（落库即重算全链）")
def update_plan_days(
    plan_id: int,
    cells: list[InventoryDayUpdate],
    service_z: float = Query(INV_Z_DEFAULT, gt=0, description="服务水平系数 Z"),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0, description="过剩库存天数"),
    db: Session = Depends(get_db),
) -> InventoryPlanOut:
    plan = db.get(InventoryPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"推算单元 {plan_id} 不存在")

    today = date.today()
    window_set = {d: i for i, d in enumerate(_window(today))}
    window = _window(today)
    # 未来需求与底表联动时要用同一份解析（快照 / 客户需求×BOM），否则反推 DOH 会错位
    psr_map, sr_map = _load_link_maps(db, [plan])
    psr = psr_map.get((plan.project_id, plan.supplier_id, plan.material_id))
    _hist, fcast, _source, _bom = _resolve_demand(plan, psr, today)
    fcast_map = _fcast_map_of(fcast, _source)

    # 预取该 plan 在窗口内的所有 days（含窗口外的保留不动）
    existing: dict[date, InventoryDay] = {d.date: d for d in plan.days}

    for cell in cells:
        try:
            d = datetime.strptime(cell.date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"日期格式错误: {cell.date}")
        if d not in window_set:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"日期 {cell.date} 不在 30 天窗口内")
        idx = window_set[d]
        is_new = d not in existing
        day = existing.get(d)
        if day is None:
            # 显式给默认值（SQLAlchemy column default 仅在 flush 时生效，内存对象需先有值）
            day = InventoryDay(plan_id=plan.id, date=d, manual_demand=0.0, manual_in=0.0)
            existing[d] = day

        raw = cell.model_dump(exclude_unset=True)
        raw.pop("date", None)

        # 编辑 DOH 格 → 反推目标期末库存（用应用了手工字段后的序列反推）
        doh_target = raw.pop("doh_target", None)

        # 先应用普通字段
        changed = False
        if "demand_override" in raw:
            day.demand_override = raw["demand_override"]  # None = 清空覆盖恢复系统值
            changed = True
        if "manual_demand" in raw:
            day.manual_demand = raw["manual_demand"] if raw["manual_demand"] is not None else 0.0
            changed = True
        if "manual_in" in raw:
            day.manual_in = raw["manual_in"] if raw["manual_in"] is not None else 0.0
            changed = True
        if "ending_override" in raw:
            day.ending_override = raw["ending_override"]  # None = 清空覆盖恢复自动算
            changed = True
        if doh_target is not None:
            cur_demands, cur_ins, _e, _m = _simulate_ending(plan, existing, window, fcast_map, _source)
            ending = _doh_of_ending_target(float(doh_target), idx, cur_demands, cur_ins)
            if ending is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"无法按 DOH={doh_target} 反推期末库存")
            day.ending_override = ending
            changed = True

        # 全部归默认 → 无痕移除该行（恢复纯系统值）
        if changed and (
            day.demand_override is None
            and (day.manual_demand or 0.0) == 0
            and (day.manual_in or 0.0) == 0
            and day.ending_override is None
        ):
            if day.id is not None:
                db.delete(day)
            existing.pop(d, None)
            continue

        # 保留该行：新对象挂入 session（老对象改动自动跟踪）
        if is_new and day.id is None:
            db.add(day)

    db.commit()
    db.refresh(plan)
    day_map = {d.date: d for d in existing.values()}
    return _build_plan_out(plan, today, service_z, excess, psr, sr_map.get(psr.supply_relation_id) if psr else None, day_map)


# ---------------------------------------------------------------------------
# 新建档案：从底表选取（单条 + 批量）
# ---------------------------------------------------------------------------

def _ensure_selectable(db: Session, project_id: int, material_id: int, supplier_id: int, base_id: int) -> tuple:
    """校验「项目 × 物料 × 供应商 × 基地」四元组合法且未重复建档。"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 不存在")
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"物料 {material_id} 不存在")
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应商 {supplier_id} 不存在")
    base = db.get(BaseSite, base_id)
    if base is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"基地 {base_id} 不存在")

    dup = db.execute(
        select(InventoryPlan).where(
            InventoryPlan.project_id == project_id,
            InventoryPlan.material_id == material_id,
            InventoryPlan.supplier_id == supplier_id,
            InventoryPlan.base_id == base_id,
        )
    ).scalars().first()
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"档案已存在：{project.code} · {material.pn} · {supplier.name} · {base.name}",
        )
    return project, material, supplier, base


def _new_plan(payload: InventoryPlanCreate) -> InventoryPlan:
    """新建档案的需求留空 → 自动与底表联动（客户需求 × BOM 系数）。"""
    return InventoryPlan(
        project_id=payload.project_id,
        material_id=payload.material_id,
        supplier_id=payload.supplier_id,
        base_id=payload.base_id,
        lead_time_days=payload.lead_time_days,
        on_hand=payload.on_hand,
        hist_json=None,
        fcast_json=None,
    )


@router.get("/candidates", response_model=list[InventoryCandidate], summary="底表中尚未建档的组合")
def list_candidates(
    project_ids: str = Query("", description="项目 ID，逗号分隔；空 = 全部"),
    db: Session = Depends(get_db),
) -> list[InventoryCandidate]:
    """列出「项目 × 物料 × 供应商」组合及其已建档基地，供批量选取建档。"""
    pid_filter = _int_list(project_ids)
    q = (
        select(ProjectSupplyRelation)
        .join(SupplyRelation, SupplyRelation.id == ProjectSupplyRelation.supply_relation_id)
        .options(
            selectinload(ProjectSupplyRelation.project),
            selectinload(ProjectSupplyRelation.supply_relation).selectinload(SupplyRelation.material),
            selectinload(ProjectSupplyRelation.supply_relation).selectinload(SupplyRelation.supplier),
        )
        .order_by(ProjectSupplyRelation.project_id, ProjectSupplyRelation.id)
    )
    if pid_filter:
        q = q.where(ProjectSupplyRelation.project_id.in_(pid_filter))

    existing: dict[tuple[int, int, int], list[int]] = {}
    for plan in db.execute(select(InventoryPlan)).scalars().all():
        existing.setdefault((plan.project_id, plan.material_id, plan.supplier_id), []).append(plan.base_id)

    out: list[InventoryCandidate] = []
    seen: set[tuple[int, int, int]] = set()
    for psr in db.execute(q).scalars().all():
        sr = psr.supply_relation
        key = (psr.project_id, sr.material_id, sr.supplier_id)
        if key in seen:
            continue
        seen.add(key)
        demand_months = len([x for x in (_month_array_to_items(psr.demand, date.today())) if x.q])
        out.append(
            InventoryCandidate(
                project_id=psr.project_id,
                project_code=psr.project.code,
                project_name=psr.project.name,
                material_id=sr.material_id,
                pn=sr.material.pn,
                material_name=sr.material.name,
                supplier_id=sr.supplier_id,
                supplier_code=sr.supplier.code,
                supplier_name=sr.supplier.name,
                bom_factor=psr.bom_factor,
                demand_months=demand_months,
                planned_base_ids=existing.get(key, []),
            )
        )
    return out


@router.post("/plans", response_model=InventoryPlanOut, status_code=status.HTTP_201_CREATED, summary="新建单个库存档案")
def create_plan(
    payload: InventoryPlanCreate,
    service_z: float = Query(INV_Z_DEFAULT, gt=0),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0),
    db: Session = Depends(get_db),
) -> InventoryPlanOut:
    _ensure_selectable(db, payload.project_id, payload.material_id, payload.supplier_id, payload.base_id)
    plan = _new_plan(payload)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    psr_map, sr_map = _load_link_maps(db, [plan])
    return _out_of(plan, psr_map, sr_map, date.today(), service_z, excess)


@router.post("/plans/bulk", response_model=InventoryBulkCreateResult, summary="批量建档（底表批量选取）")
def bulk_create_plans(payload: InventoryBulkCreate, db: Session = Depends(get_db)) -> InventoryBulkCreateResult:
    """逐条校验并创建；单条失败不影响其余，错误按行号回传，便于前端定位。

    批内自重复（同一次提交里两行同四元组）提前识别，避免 UNIQUE 冲突拖到 commit
    把整批回滚 —— 那是与「单条失败不影响其余」承诺相悖的。
    """
    result = InventoryBulkCreateResult()
    seen: dict[tuple[int, int, int, int], int] = {}   # 四元组 → 首次出现序号
    for i, item in enumerate(payload.items, start=1):
        quad = (item.project_id, item.material_id, item.supplier_id, item.base_id)
        first = seen.get(quad)
        if first is not None:
            result.skipped += 1
            result.errors.append(f"第 {i} 项：与本次提交的第 {first} 项重复（同一项目×物料×供应商×基地）")
            continue
        seen[quad] = i
        try:
            _ensure_selectable(db, item.project_id, item.material_id, item.supplier_id, item.base_id)
        except HTTPException as exc:
            result.skipped += 1
            result.errors.append(f"第 {i} 项：{exc.detail}")
            continue
        try:
            # SAVEPOINT 逐条落盘：单条撞 UNIQUE 只回滚这一条，不影响前面已建的
            with db.begin_nested():
                db.add(_new_plan(item))
            result.created += 1
        except IntegrityError:
            result.skipped += 1
            result.errors.append(f"第 {i} 项：该「项目×物料×供应商×基地」已建档")
            seen.pop(quad, None)
    db.commit()
    return result


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除库存档案")
def delete_plan(plan_id: int, db: Session = Depends(get_db)) -> None:
    plan = db.get(InventoryPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"推算单元 {plan_id} 不存在")
    db.delete(plan)  # 级联删除该档案的手工修正日
    db.commit()


@router.post("/import", response_model=InventoryImportResult, summary="Excel 导入库存推算单元")
def import_inventory(
    file_path: str = Query(..., description="服务器本地 Excel 文件绝对路径"),
    db: Session = Depends(get_db),
) -> InventoryImportResult:
    """Excel 列约定（表头行，模板见 README / 导入弹窗提示）：

    项目代码 | 基地 | 物料PN | 供应商代码(可选) | 采购LeadTime(天) | 初始现有库存
             | 历史需求_YYYY-MM ... | 未来预测_YYYY-MM ...

    - 基地必须已存在于基地主数据表（库存页可维护），否则该行报错；
    - 「供应商代码」可填代码或名称；留空时按「项目 × 物料」自动推断（优先主供）；
    - 「历史需求_」列数量不限（几列算几列，算 COV 至少 2 列才有意义）；
    - 「未来预测_」列若提供则必须覆盖 今天起 30 天（不足则报错行），月度总量按当月天数摊日均；
      若整表不含任何月份列，则该批档案与底表联动（物料需求 = 客户需求 × BOM 系数）；
    - 推算单元 = (项目代码, 基地, 物料PN, 供应商代码)，已存在则更新系统数据并
      **清空该单元的手工修正**（重新导入即重建推算）。
    """
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"文件不存在: {file_path}")

    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if header is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel 为空")

    today = date.today()
    last_window_day = today + timedelta(days=INV_WINDOW_DAYS - 1)
    last_month_key = _month_key(last_window_day)

    def col_idx(name: str) -> int | None:
        for i, h in enumerate(header):
            if h and name in str(h):
                return i
        return None

    idx_project = col_idx("项目代码") or col_idx("项目")
    idx_base = col_idx("基地")
    idx_pn = col_idx("物料PN") or col_idx("物料")
    idx_supplier = col_idx("供应商代码") or col_idx("供应商")
    idx_lt = col_idx("LeadTime") or col_idx("采购提前期") or col_idx("采购LeadTime")
    idx_onhand = col_idx("初始现有库存") or col_idx("现有库存") or col_idx("On-hand") or col_idx("OnHand")

    # 动态月份列
    month_pat = re.compile(r"^(历史需求|未来预测)[_（(]?(\d{4}-\d{2})")
    hist_cols: list[tuple[int, str]] = []   # (col, month)
    fcast_cols: list[tuple[int, str]] = []
    for i, h in enumerate(header):
        if h is None:
            continue
        m = month_pat.match(str(h).strip())
        if not m:
            continue
        kind, month = m.group(1), m.group(2)
        if kind == "历史需求":
            hist_cols.append((i, month))
        else:
            fcast_cols.append((i, month))
    hist_cols.sort(key=lambda x: x[1])
    fcast_cols.sort(key=lambda x: x[1])

    # 主数据索引（基地必须在基地主数据表里存在，否则报错提示先维护基地）
    projects = {p.code: p for p in db.execute(select(Project)).scalars()}
    materials = {m.pn: m for m in db.execute(select(Material)).scalars()}
    suppliers = {s.code: s for s in db.execute(select(Supplier)).scalars()}
    suppliers_by_name = {s.name: s for s in db.execute(select(Supplier)).scalars()}
    base_sites = {b.name: b for b in db.execute(select(BaseSite)).scalars()}
    # 档案识别键：(项目代码, 基地名, 物料PN, 供应商代码)；供应商列缺省时按项目×物料推断
    existing_plans: dict[tuple[str, str, str, str], InventoryPlan] = {}
    for p in db.execute(select(InventoryPlan).options(*_DAY_LOAD)).scalars():
        existing_plans[(p.project.code, p.base_site.name, p.material.pn, p.supplier.code)] = p

    result = InventoryImportResult()
    row_num = 1
    for row in rows_iter:
        row_num += 1
        if not row or all(v is None or str(v).strip() == "" for v in row):
            continue

        def val(i: int | None):
            if i is None or i >= len(row) or row[i] is None:
                return None
            return row[i]

        project_code = str(val(idx_project)).strip() if val(idx_project) is not None else ""
        base_name = str(val(idx_base)).strip() if val(idx_base) is not None else ""
        pn = str(val(idx_pn)).strip() if val(idx_pn) is not None else ""
        supplier_raw = str(val(idx_supplier)).strip() if val(idx_supplier) is not None else ""
        if not project_code or not base_name or not pn:
            result.errors.append(f"第 {row_num} 行: 项目代码/基地/物料PN 不能为空")
            continue
        try:
            lead_time = float(val(idx_lt)) if val(idx_lt) is not None else 7.0
            on_hand = float(val(idx_onhand)) if val(idx_onhand) is not None else 0.0
        except (TypeError, ValueError):
            result.errors.append(f"第 {row_num} 行: LeadTime/初始库存不是数字")
            continue
        if lead_time <= 0:
            result.errors.append(f"第 {row_num} 行: LeadTime 必须 > 0")
            continue
        if on_hand < 0:
            result.errors.append(f"第 {row_num} 行: 初始现有库存不能为负")
            continue
        if project_code not in projects:
            result.errors.append(f"第 {row_num} 行: 项目代码「{project_code}」不存在")
            continue
        if pn not in materials:
            result.errors.append(f"第 {row_num} 行: 物料 PN「{pn}」不存在")
            continue
        base_site = base_sites.get(base_name)
        if base_site is None:
            result.errors.append(f"第 {row_num} 行: 基地「{base_name}」不在基地主数据中，请先在库存页维护基地")
            continue

        # 供应商：优先按填写的代码/名称匹配；未填则按「项目 × 物料」从底表推断
        supplier = None
        if supplier_raw:
            supplier = suppliers.get(supplier_raw) or suppliers_by_name.get(supplier_raw)
            if supplier is None:
                result.errors.append(f"第 {row_num} 行: 供应商「{supplier_raw}」不存在")
                continue
        else:
            supplier = _infer_supplier(db, projects[project_code].id, materials[pn].id)
            if supplier is None:
                result.errors.append(
                    f"第 {row_num} 行: 无法推断供应商，请在表中增加「供应商代码」列，或先维护该项目×物料的供应关系"
                )
                continue

        # 解析动态月份列（历史需求：任意数量；未来预测：须覆盖窗口末月）
        hist_items: list[InventoryMonthQty] = []
        parse_ok = True
        for col, month in hist_cols:
            v = val(col)
            if v is None or str(v).strip() == "":
                continue
            try:
                hist_items.append(InventoryMonthQty(m=month, q=float(v)))
            except (TypeError, ValueError):
                result.errors.append(f"第 {row_num} 行: 历史需求 {month} 不是数字")
                parse_ok = False
                break
        if not parse_ok:
            continue

        fcast_items: list[InventoryMonthQty] = []
        fcast_months: set[str] = set()
        for col, month in fcast_cols:
            v = val(col)
            if v is None or str(v).strip() == "":
                continue
            try:
                fcast_items.append(InventoryMonthQty(m=month, q=float(v)))
                fcast_months.add(month)
            except (TypeError, ValueError):
                result.errors.append(f"第 {row_num} 行: 未来预测 {month} 不是数字")
                parse_ok = False
                break
        if not parse_ok:
            continue
        # 表里完全没有「未来预测_」列时 = 走底表联动（客户需求 × BOM 系数），不强制；
        # 一旦提供了预测列，就必须覆盖到今天起 30 天，否则窗口尾部会凭空按 0 需求推算。
        if fcast_cols and last_month_key not in fcast_months:
            result.errors.append(
                f"第 {row_num} 行: 未来预测未覆盖到今天起 30 天（需含 {last_month_key} 月）"
            )
            continue

        key = (project_code, base_name, pn, supplier.code)
        plan = existing_plans.get(key)
        # 无有效月份列则存 None，表示该档案改为与底表联动
        hist_json = json.dumps([{"m": h.m, "q": h.q} for h in hist_items], ensure_ascii=False) if hist_items else None
        fcast_json = json.dumps([{"m": f.m, "q": f.q} for f in fcast_items], ensure_ascii=False) if fcast_items else None
        if plan is None:
            plan = InventoryPlan(
                project_id=projects[project_code].id,
                material_id=materials[pn].id,
                supplier_id=supplier.id,
                base_id=base_site.id,
                lead_time_days=lead_time,
                on_hand=on_hand,
                hist_json=hist_json,
                fcast_json=fcast_json,
            )
            db.add(plan)
            existing_plans[key] = plan
            result.imported += 1
        else:
            plan.lead_time_days = lead_time
            plan.on_hand = on_hand
            plan.hist_json = hist_json
            plan.fcast_json = fcast_json
            # 重新导入 = 重建推算：清空该单元全部手工修正（规则页 SOP）
            for day in list(plan.days):
                db.delete(day)
            result.updated += 1

    db.commit()
    return result


# ---------------------------------------------------------------------------
# 导出：当前筛选视图 → xlsx（供采购/开会使用，列与 L1 页面同源）
# ---------------------------------------------------------------------------

EXPORT_COLUMNS: list[tuple[str, str]] = [
    ("project_name", "项目名称"),
    ("project_code", "项目代码"),
    ("base_name", "基地"),
    ("pn", "物料PN"),
    ("material_name", "物料名称"),
    ("supplier_name", "供应商"),
    ("supplier_code", "供应商代码"),
    ("lead_time_days", "LeadTime(天)"),
    ("on_hand", "初始现有库存"),
    ("avg_daily", "窗口日均需求"),
    ("ss", "安全库存SS"),
    ("safe_days", "安全天数"),
    ("safe_days_derived", "安全天数来源"),
    ("rop", "再订货点ROP"),
    ("doh_today", "今日DOH"),
    ("doh_bucket", "DOH分档"),
    ("status_label", "预警状态"),
    ("demand_note", "需求数据说明"),
    ("replenish_qty", "建议补货量"),
    ("order_by_date", "最晚下单日"),
    ("days_until_order", "距下单天数"),
    ("stockout_date", "预计耗尽日"),
    ("capacity_status", "产能校验"),
    ("capacity_limit", "当月分配额度"),
    ("capacity_usage", "产能占用率"),
    ("cov", "历史COV"),
    ("cov_label", "波动档"),
    ("demand_source", "需求来源"),
]

_DOH_BUCKET_LABEL = {
    INV_DOH_BUCKET_STOCKOUT: "① 库存耗尽",
    INV_DOH_BUCKET_URGENT: "② 紧急",
    INV_DOH_BUCKET_LOW: "③ 偏低",
    INV_DOH_BUCKET_OK: "④ 充足",
    INV_DOH_BUCKET_UNKNOWN: "⑤ 无法评估",
}

_STATUS_LABEL = {
    INV_STATUS_STOCKOUT: "已断货",
    INV_STATUS_RED: "偏低",
    INV_STATUS_YELLOW: "贴近安全",
    INV_STATUS_BLUE: "过剩",
    INV_STATUS_OK: "正常",
}

_CAPACITY_LABEL = {
    INV_CAPACITY_OK: "产能充足",
    INV_CAPACITY_TIGHT: "产能紧张",
    INV_CAPACITY_SHORT: "产能不足",
    INV_CAPACITY_NA: "未录额度",
}

_COV_LABEL = {
    INV_COV_LABEL_HIGH: "高波动",
    INV_COV_LABEL_MID: "中波动",
    INV_COV_LABEL_LOW: "低波动",
    INV_COV_LABEL_NA: "不可算",
}

_DEMAND_NOTE = {
    None: "正常",
    "no_series": "缺需求数据",
    "bom_zero": "BOM 系数为 0",
    "demand_blank": "需求为 0",
}


@router.get("/export", summary="导出当前筛选视图为 xlsx（列与页面列表同源）")
def export_inventory(
    project_ids: str = Query("", description="项目 ID，逗号分隔；**必填**"),
    base_ids: str = Query("", description="基地 ID，逗号分隔；空 = 全部"),
    supplier_ids: str = Query("", description="供应商 ID，逗号分隔；空 = 全部"),
    pns: str = Query("", description="物料 PN，逗号分隔；空 = 全部"),
    bucket: str = Query("", description="顶部四卡过滤（支持逗号多档）；空 = 全部"),
    sort: str = Query("doh", description="排序，同 /plans"),
    service_z: float = Query(INV_Z_DEFAULT, gt=0),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0),
    db: Session = Depends(get_db),
) -> Response:
    """导出：与 `/plans` 复用 `_assemble` / `_filter_rows` / `_sort_rows`，保证顺序与口径一致。"""
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
    except ImportError:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务端未安装 openpyxl，无法导出",
        )

    rows = _sort_rows(
        _filter_rows(
            _assemble(
                db,
                _int_list(project_ids),
                _int_list(base_ids),
                _int_list(supplier_ids),
                _split_csv(pns),
                service_z,
                excess,
            ),
            bucket,
        ),
        sort,
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "库存信号塔"
    head_fill = PatternFill("solid", fgColor="F1EFE8")
    head_font = Font(bold=True, size=10)
    for c, (_key, label) in enumerate(EXPORT_COLUMNS, start=1):
        cell = ws.cell(row=1, column=c, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r, row in enumerate(rows, start=2):
        kind = _unknown_kind(row)
        values = {
            "project_name": row.project_name,
            "project_code": row.project_code,
            "base_name": row.base_name,
            "pn": row.pn,
            "material_name": row.material_name,
            "supplier_name": row.supplier_name,
            "supplier_code": row.supplier_code,
            "lead_time_days": round(row.lead_time_days, 2),
            "on_hand": round(row.on_hand, 2),
            "avg_daily": round(row.avg_daily, 2),
            "ss": round(row.ss, 1),
            "safe_days": round(row.safe_days, 2),
            "safe_days_derived": "公式推导" if row.safe_days_derived else "兜底值",
            "rop": round(row.rop, 1),
            "doh_today": round(_today_doh(row), 1),
            "doh_bucket": _DOH_BUCKET_LABEL.get(_doh_bucket_of(row), "④ 充足"),
            "status_label": _STATUS_LABEL.get(row.days[0].status, "正常"),
            "demand_note": _DEMAND_NOTE.get(kind, "正常"),
            "replenish_qty": round(row.replenish_qty, 1) if row.replenish_qty is not None else "",
            "order_by_date": row.order_by_date or "",
            "days_until_order": row.days_until_order if row.days_until_order is not None else "",
            "stockout_date": row.stockout_date or "",
            "capacity_status": _CAPACITY_LABEL.get(row.capacity_status, "未录额度"),
            "capacity_limit": round(row.capacity_limit, 1) if row.capacity_limit is not None else "",
            "capacity_usage": (
                f"{row.capacity_usage * 100:.0f}%" if row.capacity_usage is not None else ""
            ),
            "cov": round(row.cov, 3) if row.cov is not None else "",
            "cov_label": _COV_LABEL.get(row.cov_label, "不可算"),
            "demand_source": "底表联动" if row.demand_source == INV_SOURCE_MASTER else "档案快照",
        }
        for c, (key, _label) in enumerate(EXPORT_COLUMNS, start=1):
            ws.cell(row=r, column=c, value=values[key])

    widths = [22, 14, 12, 14, 20, 18, 14, 12, 14, 14, 12, 10, 12, 13, 10, 12, 12, 14,
              12, 13, 12, 13, 12, 14, 12, 10, 10, 10]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    filename = f"inventory-signal-tower-{stamp}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            )
        },
    )
