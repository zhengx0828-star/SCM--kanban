"""库存信号塔路由：动态库存与 DOH 风险监控看板。

推算单元 = 项目 × 基地 × 物料（InventoryPlan）。核心口径（规则页「库存管理」SOP 同步维护）：
- 系统预测需求：未来预测月度总量按自然日摊日均（qty ÷ 当月天数），窗口随「今天」滚动 30 天；
- 历史需求 COV = 样本标准差 ÷ 均值（≥ 2 个月才计算，否则 NA）；
- 安全库存 SS = 窗口内日均需求 × 采购提前期 × (1 + COV)；
- 每日期末库存 = 前日期末 + 当日手工修正入库 − (当日系统预测需求 + 当日手工修正需求)，
  首日前一天 = 初始现有库存；直接改过期末库存（盘点覆盖）则后续日基于覆盖值重算；
- 动态 DOH：从当日之后起按日扣减未来每日需求（计入未来手工修正入库），能完整覆盖的天数，
  不足一天按比例折算（0.1 天精度）；30 天窗口内消耗不完记为「30+」（capped）；
- 预警状态判定（优先级从高到低，每格只落一种）：
  深红 期末库存 ≤ 0（已断货）
  浅红 期末库存 < SS 或 DOH < 目标安全天数
  黄   DOH ∈ [安全天数, 安全天数 × 1.25)（贴近安全线）
  蓝   DOH > 过剩天数 或 30 天未耗尽（积压）
- 「所有格都可编辑」：系统预测需求 / 手工修正需求 / 手工修正入库 / 期末库存 直接改；
  DOH 格编辑 = 反推该日期末库存以满足目标覆盖天数；被改过的格右上角标三角。

接口：
- GET    /api/inventory/plans    推算单元列表（含 30 天矩阵），支持项目/基地/PN 过滤 + safe/excess 参数
- GET    /api/inventory/summary  遗留 KPI 概览（按 PN 去重；页面已改版为前端本地「风险时间漏斗」按行数统计，本接口暂未接入 UI）
- PATCH  /api/inventory/plans/{id}      改 LeadTime / 初始现有库存（左冻结列）
- PUT    /api/inventory/plans/{id}/days 批量改某日单元格（全格可编辑，落库即重算全链）
- POST   /api/inventory/import   Excel 导入（服务端文件路径模式，列约定见函数 docstring）
"""

import calendar
import json
import os
import re
import statistics
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import InventoryDay, InventoryPlan, Material, Project
from ..schemas import (
    INV_COV_HI,
    INV_COV_LABEL_HIGH,
    INV_COV_LABEL_LOW,
    INV_COV_LABEL_MID,
    INV_COV_LABEL_NA,
    INV_COV_MID,
    INV_EXCESS_DOH_DEFAULT,
    INV_MIN_HIST_MONTHS,
    INV_SAFE_DOH_DEFAULT,
    INV_STATUS_BLUE,
    INV_STATUS_OK,
    INV_STATUS_RED,
    INV_STATUS_STOCKOUT,
    INV_STATUS_YELLOW,
    INV_WINDOW_DAYS,
    INV_YELLOW_RATIO,
    InventoryCellOut,
    InventoryDayUpdate,
    InventoryImportResult,
    InventoryMonthQty,
    InventoryPlanOut,
    InventoryPlanUpdate,
    InventorySummary,
)

router = APIRouter(prefix="/api/inventory", tags=["Inventory"])

_DAY_LOAD = (
    selectinload(InventoryPlan.project),
    selectinload(InventoryPlan.material),
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


def _parse_month_qty(raw: str | None) -> list[InventoryMonthQty]:
    """解析库存 JSON [{m, q}, ...] → 按月份排序的列表。"""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    out: list[InventoryMonthQty] = []
    for item in data:
        try:
            out.append(InventoryMonthQty(m=str(item["m"]), q=float(item["q"])))
        except (TypeError, KeyError, ValueError):
            continue
    out.sort(key=lambda x: x.m)
    return out


def _cov_of(hist: list[InventoryMonthQty]) -> tuple[float | None, str]:
    """历史需求 COV = 样本标准差 ÷ 均值。不足 2 个月不计算（NA）。"""
    if len(hist) < INV_MIN_HIST_MONTHS:
        return None, INV_COV_LABEL_NA
    qs = [h.q for h in hist]
    mean = statistics.fmean(qs)
    if mean <= 0:
        return 0.0, INV_COV_LABEL_LOW
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
    if ending < ss or (not doh_capped and doh < safe):
        return INV_STATUS_RED
    if doh_capped:
        # 30 天窗口内消耗不完：过剩阈值 ≤ 30 时视为积压（蓝）
        return INV_STATUS_BLUE if excess <= INV_WINDOW_DAYS else INV_STATUS_OK
    if doh > excess:
        return INV_STATUS_BLUE
    if safe <= doh < safe * INV_YELLOW_RATIO:
        return INV_STATUS_YELLOW
    return INV_STATUS_OK


def _simulate_ending(
    plan: InventoryPlan,
    day_map: dict[date, InventoryDay],
    window: list[date],
    fcast: dict[str, float],
) -> tuple[list[float], list[float], list[float], list[bool]]:
    """正向递推 30 天：总需求(override 优先) / 手工入库 / 期末库存 / 该日是否有手改。"""
    demands: list[float] = []
    ins: list[float] = []
    endings: list[float] = []
    manuals: list[bool] = []
    prev = plan.on_hand
    for d in window:
        day = day_map.get(d)
        sys_d = fcast.get(_month_key(d), 0.0) / _month_days(d)
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

def _build_plan_out(
    plan: InventoryPlan,
    base: date,
    safe: float,
    excess: float,
    day_map: dict[date, InventoryDay] | None = None,
) -> InventoryPlanOut:
    hist = _parse_month_qty(plan.hist_json)
    fcast = _parse_month_qty(plan.fcast_json)
    fcast_map = {f.m: f.q for f in fcast}
    cov, cov_label = _cov_of(hist)
    window = _window(base)
    if day_map is None:
        day_map = {d.date: d for d in plan.days}

    demands, ins, endings, manuals = _simulate_ending(plan, day_map, window, fcast_map)
    avg_daily = sum(demands) / len(demands) if demands else 0.0
    ss = avg_daily * plan.lead_time_days * (1.0 + (cov or 0.0))

    days_out: list[InventoryCellOut] = []
    for i, d in enumerate(window):
        day = day_map.get(d)
        doh, capped = _doh_given_ending(endings[i], i, demands, ins)
        status_key = _status_of(endings[i], doh, capped, ss, safe, excess)
        sys_d = fcast_map.get(_month_key(d), 0.0) / _month_days(d)
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

    return InventoryPlanOut(
        id=plan.id,
        project_id=plan.project_id,
        project_code=plan.project.code,
        project_name=plan.project.name,
        base=plan.base,
        material_id=plan.material_id,
        pn=plan.material.pn,
        material_name=plan.material.name,
        lead_time_days=plan.lead_time_days,
        on_hand=plan.on_hand,
        cov=round(cov, 4) if cov is not None else None,
        cov_label=cov_label,
        avg_daily=_round_cell(avg_daily),
        ss=_round_cell(ss),
        hist=hist,
        fcast=fcast,
        days=days_out,
    )


def _filter_params(
    project_ids: str = "",
    bases: str = "",
    pns: str = "",
) -> tuple[list[int], list[str], list[str]]:
    def split(v: str) -> list[str]:
        return [s.strip() for s in v.split(",") if s.strip()]

    pid_list: list[int] = []
    for s in split(project_ids):
        try:
            pid_list.append(int(s))
        except ValueError:
            continue
    return pid_list, split(bases), split(pns)


def _load_plans(db: Session, project_ids: list[int], bases: list[str], pns: list[str]) -> list[InventoryPlan]:
    q = select(InventoryPlan).options(*_DAY_LOAD)
    if project_ids:
        q = q.where(InventoryPlan.project_id.in_(project_ids))
    if bases:
        q = q.where(InventoryPlan.base.in_(bases))
    if pns:
        q = q.join(InventoryPlan.material).where(Material.pn.in_(pns))
    rows = db.execute(q).scalars().all()
    return list(rows)


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------

@router.get("/plans", response_model=list[InventoryPlanOut], summary="推算单元列表（含 30 天矩阵）")
def list_plans(
    project_ids: str = Query("", description="项目 ID，逗号分隔；空 = 全部"),
    bases: str = Query("", description="基地，逗号分隔；空 = 全部"),
    pns: str = Query("", description="物料 PN，逗号分隔；空 = 全部"),
    safe: float = Query(INV_SAFE_DOH_DEFAULT, gt=0, description="目标安全天数"),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0, description="过剩库存天数"),
    db: Session = Depends(get_db),
) -> list[InventoryPlanOut]:
    today = date.today()
    pids, bs, ps = _filter_params(project_ids, bases, pns)
    plans = _load_plans(db, pids, bs, ps)
    out: list[InventoryPlanOut] = []
    for p in plans:
        day_map = {d.date: d for d in p.days}
        out.append(_build_plan_out(p, today, safe, excess, day_map))
    # 便于阅读的排序：项目 → 基地 → PN
    out.sort(key=lambda x: (x.project_id, x.base, x.pn))
    return out


@router.get("/summary", response_model=InventorySummary, summary="遗留 KPI 风险概览（按 PN 去重，暂未接入 UI）")
def inventory_summary(
    project_ids: str = Query("", description="项目 ID，逗号分隔；空 = 全部"),
    bases: str = Query("", description="基地，逗号分隔；空 = 全部"),
    pns: str = Query("", description="物料 PN，逗号分隔；空 = 全部"),
    safe: float = Query(INV_SAFE_DOH_DEFAULT, gt=0),
    excess: float = Query(INV_EXCESS_DOH_DEFAULT, gt=0),
    db: Session = Depends(get_db),
) -> InventorySummary:
    today = date.today()
    pids, bs, ps = _filter_params(project_ids, bases, pns)
    plans = _load_plans(db, pids, bs, ps)

    stockout_pns: set[str] = set()      # 断货高风险 SKU（PN 种类）：任一期末 < SS 或 DOH < 安全天数
    irreversible_pns: set[str] = set()  # 不可逆断货：将归零（未来库存 ≤ 0 或 DOH=0）且剩余覆盖 < LeadTime
    high_cov_pns: set[str] = set()      # 高波动 SKU：COV ≥ 0.8
    manual_cells = 0

    for p in plans:
        day_map = {d.date: d for d in p.days}
        out = _build_plan_out(p, today, safe, excess, day_map)
        if out.cov_label == INV_COV_LABEL_HIGH:
            high_cov_pns.add(out.pn)
        row_stockout = False
        # 不可逆断货（今天视角）：窗口第 1 天的剩余覆盖天数 < LeadTime → 现在下单也来不及补货
        d0 = out.days[0]
        if not d0.doh_capped and d0.doh < p.lead_time_days:
            irreversible_pns.add(out.pn)
        for cell in out.days:
            if cell.status in (INV_STATUS_RED, INV_STATUS_STOCKOUT) or cell.doh < safe:
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
    day_map = {d.date: d for d in plan.days}
    return _build_plan_out(plan, date.today(), INV_SAFE_DOH_DEFAULT, INV_EXCESS_DOH_DEFAULT, day_map)


@router.put("/plans/{plan_id}/days", response_model=InventoryPlanOut, summary="批量改某日单元格（落库即重算全链）")
def update_plan_days(
    plan_id: int,
    cells: list[InventoryDayUpdate],
    db: Session = Depends(get_db),
) -> InventoryPlanOut:
    plan = db.get(InventoryPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"推算单元 {plan_id} 不存在")

    today = date.today()
    window_set = {d: i for i, d in enumerate(_window(today))}
    fcast_map = {f.m: f.q for f in _parse_month_qty(plan.fcast_json)}
    window = _window(today)

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
            cur_demands, cur_ins, _e, _m = _simulate_ending(plan, existing, window, fcast_map)
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
    return _build_plan_out(plan, today, INV_SAFE_DOH_DEFAULT, INV_EXCESS_DOH_DEFAULT, day_map)


@router.post("/import", response_model=InventoryImportResult, summary="Excel 导入库存推算单元")
def import_inventory(
    file_path: str = Query(..., description="服务器本地 Excel 文件绝对路径"),
    db: Session = Depends(get_db),
) -> InventoryImportResult:
    """Excel 列约定（表头行，模板见 README / 导入弹窗提示）：

    项目代码 | 基地 | 物料PN | 采购LeadTime(天) | 初始现有库存 | 历史需求_YYYY-MM ... | 未来预测_YYYY-MM ...

    - 「历史需求_」列数量不限（几列算几列，算 COV 至少 2 列才有意义）；
    - 「未来预测_」列必须覆盖 今天起 30 天（不足则报错行）；月度总量按当月天数摊日均；
    - 推算单元 = (项目代码, 基地, 物料PN)，已存在则更新系统数据并**清空该单元的手工修正**（重新导入即重建推算）。
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

    # 主数据索引
    projects = {p.code: p for p in db.execute(select(Project)).scalars()}
    materials = {m.pn: m for m in db.execute(select(Material)).scalars()}
    existing_plans: dict[tuple[str, str, str], InventoryPlan] = {}  # (project_code, base, pn)
    for p in db.execute(select(InventoryPlan)).scalars():
        existing_plans[(p.project.code, p.base, p.material.pn)] = p

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
        base = str(val(idx_base)).strip() if val(idx_base) is not None else ""
        pn = str(val(idx_pn)).strip() if val(idx_pn) is not None else ""
        if not project_code or not base or not pn:
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
        if last_month_key not in fcast_months:
            result.errors.append(
                f"第 {row_num} 行: 未来预测未覆盖到今天起 30 天（需含 {last_month_key} 月）"
            )
            continue

        key = (project_code, base, pn)
        plan = existing_plans.get(key)
        hist_json = json.dumps([{"m": h.m, "q": h.q} for h in hist_items], ensure_ascii=False)
        fcast_json = json.dumps([{"m": f.m, "q": f.q} for f in fcast_items], ensure_ascii=False)
        if plan is None:
            plan = InventoryPlan(
                project_id=projects[project_code].id,
                base=base,
                material_id=materials[pn].id,
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
