"""份额管理路由（项目 × L2 供应关系 × 月份快照）。

份额是项目级数据：同一物料×供应商在不同项目中份额可不同（L3 维度）。
核心计算逻辑（规则页「份额管理」SOP 同步维护）：
- QDC 离散五档：1 / 0.7 / 0.5 / 0.3 / 0
- 权重动态规则（按项目内同物料判定）：Q 一致 → 成本配比（Q20%·D10%·C70%）；Q 不一致 → 质量配比（Q70%·D10%·C20%）
- 加权分 = Q·wQ + D·wD + C·wC
- 计算配额 = 加权分 ÷ Σ(同项目同物料加权分)
- 建议配额 = 计算配额四舍五入取整（整数百分比）；99%/101% 偏差可接受，不补齐
- 独供 = 同项目同物料仅 1 家供应商（自动推导）
- 份额波动预警：本月系统份额相对上期变化 ≥ ±30%（≥ 上期×1.3 或 ≤ 上期×0.7；上期为 0 时本月从无到有视为波动）
- 建议偏差预警：|本月系统份额 − 上月建议配额| > 5 个百分点
- 风险归类口径：一条记录可能命中多种风险，只归入最高优先级一类（独供 > 波动 > 偏差 > 错配），
  KPI 卡计数、项目卡标注与风险排行三者同口径（保证数字一一对应）
- 多基地份额：每条记录 self-contained 的 [{base, share, lines}]；
  份额 = Σ(基地份额 × 基地拉线数) ÷ Σ(基地拉线数)（基地份额约定 0-1 小数，
  全部 ≤1 时视为小数口径 ×100，自动按比例归一为 %）。

接口：
- GET    /api/share/projects                   有份额数据的项目列表
- GET    /api/share/summary?project_id=&month=   KPI 汇总（4 卡 + 计数）
- GET    /api/share/risks?project_id=&month=&top= 风险排行（独供 > 波动 > 偏差 > 错配）
- GET    /api/share/quadrant?project_id=&month=  份额 × 评分四象限散点
- GET    /api/share/records?project_id=&month=&keyword= 明细列表
- POST   /api/share/records                       手动新增记录
- PUT    /api/share/records/{id}                 手动修改（重算 + 标记 edited_manually）
- POST   /api/share/import                        Excel 导入（浏览器选择文件上传，openpyxl，校验合法性）
- POST   /api/share/rollover?from=&to=           月末结转：本月→上月、建议→quota_prev
"""

import json
from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Material, Project, ProjectSupplyRelation, ShareRecord, Supplier, SupplyRelation
from ..schemas import (
    MONTH_PATTERN,
    QDC_SCORES,
    RISK_DEVIATION_PT,
    RISK_FLUCTUATION_RATIO,
    WEIGHT_SCHEMES,
    ShareImportResult,
    ShareQuadrantPoint,
    ShareRecordCreate,
    ShareRecordList,
    ShareRecordRead,
    ShareRecordUpdate,
    ShareRiskItem,
    ShareSummary,
)

router = APIRouter(prefix="/api/share", tags=["Share"])

_SHARE_LOAD = (
    selectinload(ShareRecord.project),
    selectinload(ShareRecord.supply_relation).selectinload(SupplyRelation.material),
    selectinload(ShareRecord.supply_relation).selectinload(SupplyRelation.supplier),
)


def _parse_bases(raw: str | None) -> list[dict]:
    """bases JSON 文本 → 列表（容错：空/非法返回 []）。"""
    if not raw:
        return []
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _validate_qdc(q: Optional[float], d: Optional[float], c: Optional[float]) -> list[str]:
    """校验 QDC 五档合法性，返回错误列表（空 = 合法）。"""
    errors: list[str] = []
    for name, val in (("Q", q), ("D", d), ("C", c)):
        if val is not None and val not in QDC_SCORES:
            errors.append(f"{name} 评分 {val} 非法，仅允许五档：1 / 0.7 / 0.5 / 0.3 / 0")
    return errors


def _is_decimal_scale(values: list) -> bool:
    """一组份额值是否「整体按 0-1 小数口径」填写（如 0.71 表示 71%）。

    判据：存在非零值，且所有非零值都 ≤1（0 在两种口径下含义相同，忽略）。
    用途：客户 ERP 导出的份额/基地配额常写成 0.71 这种比例值，需要统一 ×100
    后再参与计算与展示，否则会出现「算的是 0.71%、看的是 0.71%」但用户本意是 71% 的静默错。
    混用（既有 ≤1 又有 >1）返回 False，由调用方报错拦掉。
    """
    nonzero = [float(v) for v in values if v is not None and float(v) != 0]
    if not nonzero:
        return False
    return all(0 < v <= 1 for v in nonzero)


def _mixed_share_scale(bases: list[dict]) -> bool:
    """该记录的基地份额是否「小数与百分数混用」。

    「全 ≤1 视为小数 ×100」是记录级启发式：同一条记录里既写 0.5 又写 50 时，
    0.5 会被当成 0.5%（差 100 倍）且不报错。这种静默错必须拦掉。
    """
    vals: list[float] = []
    for b in bases:
        share = b.get("share")
        if share is None:
            continue
        try:
            vals.append(float(share))
        except (TypeError, ValueError):
            continue
    return bool(vals) and any(v > 1 for v in vals) and any(0 < v <= 1 for v in vals)


def _bases_scale_error(where: str) -> HTTPException:
    """口径混用的统一错误（422 + 中文原因）。"""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"{where}基地份额口径混用：请统一口径，不要既有 0.5 这类 0-1 小数、又有 50 这类 0-100 百分数",
    )


def _auto_share_from_bases(bases: list[dict]) -> Optional[float]:
    """从 share_record.bases 自带的 lines + share 自动算份额（%）。

    公式：份额 = Σ(b.share × b.lines) ÷ Σ(b.lines)
    - 分母只含**这一条记录自己**的基地 → 只在部分基地供货的供应商会被高估
      （基地A 60%/2 线、基地B 不供货 → 得 60，而按物料 5 条线应为 24）。
      所以只用于**单记录**场景（手动新增 / 手改，没有全物料视图）；
      Excel 导入走物料级分母，见 `import_share_records` 里的 `base_lines` 聚合。
    - 基地份额全部 ≤1 视为小数口径 ×100；也兼容直接录百分比（>1）的口径；
    - 两种口径混用不允许（调用方需先用 `_mixed_share_scale` 拦掉，避免静默错 100 倍）；
    - 至少一个基地有份额值且总拉线 > 0 才算；
    - 返回 round 到 2 位（百分比）。
    """
    valued: list[tuple[float, int]] = []
    total_lines = 0
    for b in bases:
        lines = b.get("lines")
        if not isinstance(lines, int) or lines < 1:
            continue
        total_lines += lines
        share = b.get("share")
        if share is None:
            continue
        try:
            s = float(share)
        except (TypeError, ValueError):
            continue
        if s < 0 or s > 100:
            continue
        valued.append((s, lines))
    if not valued or total_lines <= 0:
        return None
    scale = 100 if max(s for s, _ in valued) <= 1 else 1
    return round(sum(s * l for s, l in valued) / total_lines * scale, 2)


def _sum_lines_from_bases(bases: list[dict]) -> int:
    """该记录自身所有基地的拉线合计（四象限点大小）。"""
    return sum(int(b.get("lines") or 0) for b in bases if isinstance(b.get("lines"), int))


def _material_lines_by_base(
    db: Session,
    project_id: int,
    material_id: int,
    month: str,
    extra: Optional[list[dict]] = None,
    exclude_id: Optional[int] = None,
) -> dict[str, int]:
    """该（项目 × 月份 × 物料）下已登记的「基地 → 拉线数」。

    拉线数是**基地**属性（这个基地有几条产线），同一基地所有供应商共用同一个数。
    手改单条记录时也算不出全貌 —— 必须把同物料其它记录的基地一起汇总，
    否则只供部分基地的供应商会被算成 100%（与 Excel 导入的口径不一致）。
    """
    stmt = (
        select(ShareRecord)
        .join(SupplyRelation, ShareRecord.supply_relation_id == SupplyRelation.id)
        .where(
            ShareRecord.project_id == project_id,
            ShareRecord.month == month,
            SupplyRelation.material_id == material_id,
        )
    )
    out: dict[str, int] = {}
    for r in db.execute(stmt).scalars().all():
        if exclude_id is not None and r.id == exclude_id:
            continue
        for b in _parse_bases(r.bases):
            name, lines = b.get("base"), b.get("lines")
            if name and isinstance(lines, int) and lines > 0:
                out[name] = max(out.get(name, 0), lines)
    for b in extra or []:
        name, lines = b.get("base"), b.get("lines")
        if name and isinstance(lines, int) and lines > 0:
            out[name] = max(out.get(name, 0), lines)
    return out


def _share_from_base_lines(bases: list[dict], lines_by_base: dict[str, int]) -> Optional[float]:
    """份额 = Σ(该供应商在该基地的份额 × 该基地拉线数) ÷ Σ 该物料全部基地的拉线数。

    缺席的基地按 0 计 —— 这样只要各基地内部份额合计 100%，物料级份额必然合计 100%。
    """
    denom = sum(v for v in lines_by_base.values() if v > 0)
    if denom <= 0:
        return None
    scale = 100.0 if _is_decimal_scale([b.get("share") for b in bases]) else 1.0
    num = 0.0
    hit = False
    for b in bases:
        s, name = b.get("share"), b.get("base")
        if s is None or name not in lines_by_base:
            continue
        num += float(s) * scale * lines_by_base[name]
        hit = True
    return round(num / denom, 2) if hit else None


def _compute_record(record: ShareRecord, all_for_material: list[ShareRecord]) -> None:
    """按规则计算某条记录的加权分 / 权重方案。

    all_for_material：同项目同物料同月的全部记录（用于 Q 一致性判断）。
    """
    if record.q_score is None or record.d_score is None or record.c_score is None:
        return  # 评分不全则不计算

    # 1) 权重动态规则：同项目同物料供应商 Q 一致 → cost；不一致 → quality
    qs = [r.q_score for r in all_for_material if r.q_score is not None]
    q_all_equal = len(set(qs)) <= 1 if qs else True
    scheme = "cost" if q_all_equal else "quality"
    w = WEIGHT_SCHEMES[scheme]

    # 2) 加权分 = Q·wQ + D·wD + C·wC
    record.weighted_score = round(record.q_score * w["q"] + record.d_score * w["d"] + record.c_score * w["c"], 4)
    record.weight_scheme = scheme


def _compute_quota(records: list[ShareRecord]) -> None:
    """同项目同物料同月：计算配额 = 加权分 ÷ Σ(加权分)；建议配额 = 四舍五入取整。"""
    scored = [r for r in records if r.weighted_score is not None]
    total = sum(r.weighted_score for r in scored)
    if total <= 0:
        return
    for r in records:
        if r.weighted_score is None:
            continue
        quota = r.weighted_score / total * 100
        r.quota_suggested = round(quota)  # 四舍五入取整（整数百分比）


def _recompute_project_material(db: Session, project_id: int, material_id: int, month: str) -> None:
    """重算某项目某物料某月的全部记录（加权分 → 建议配额），并更新独供标记。"""
    rows = list(
        db.execute(
            select(ShareRecord)
            .join(SupplyRelation)
            .where(
                ShareRecord.project_id == project_id,
                SupplyRelation.material_id == material_id,
                ShareRecord.month == month,
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return
    # 独供：同项目同物料仅 1 家供应商
    is_sole = len(rows) == 1
    for r in rows:
        r.is_sole = is_sole
        _compute_record(r, rows)
    _compute_quota(rows)
    db.flush()


def _is_fluctuation(current: Optional[float], prev: Optional[float]) -> bool:
    """份额波动预警：本月系统份额相对上期变化 ≥ ±30%（规则页 SOP 同步维护）。

    - current / prev 任一为空（如无上月记录）→ 不判定（新供应商首月不误报）；
    - prev == 0：本月从无到有（>0）视为重大变化触发；本月仍为 0 无变化不触发；
    - 否则：cur ≥ prev × 1.3（涨）或 cur ≤ prev × 0.7（跌）即触发。
    """
    if current is None or prev is None:
        return False
    if prev == 0:
        return current > 0
    return current >= prev * (1 + RISK_FLUCTUATION_RATIO) or current <= prev * (1 - RISK_FLUCTUATION_RATIO)


def _fluctuation_detail(current: float, prev: float) -> str:
    """份额波动风险条目的 detail 文案（方向化）。"""
    if prev == 0:
        return f"份额波动：上期为 0，本月新供 {current:g}%（从无到有）"
    pct = (current - prev) / prev * 100
    direction = "涨" if pct > 0 else "跌"
    return f"份额波动：{prev:g}% → {current:g}%（{direction} {abs(pct):.1f}%，相对变化 ≥ ±30%）"


def _is_mismatch(record: ShareRecord) -> bool:
    """份额×评分错配：份额 ≥ 50% 且加权分 < 0.5（最差的拿最多活）。"""
    return (
        record.share_current is not None
        and record.share_current >= 50
        and record.weighted_score is not None
        and record.weighted_score < 0.5
    )


def _risk_chain_type(record: ShareRecord) -> Optional[str]:
    """该记录的最高优先级风险类型（sole/fluctuation/deviation/mismatch），无风险返回 None。

    口径（规则页「份额管理 · 风险归类」同步维护）：一条记录可能同时命中多种风险
    （如既波动又偏差），只归入最高优先级一类：独供 > 波动 > 偏差 > 错配。
    KPI 卡计数、项目卡标注、风险排行三者都用此函数，保证页面数字一一对应。
    """
    if record.is_sole:
        return "sole"
    if _is_fluctuation(record.share_current, record.share_prev):
        return "fluctuation"
    if (
        record.share_current is not None
        and record.quota_prev is not None
        and abs(record.share_current - record.quota_prev) > RISK_DEVIATION_PT
    ):
        return "deviation"
    if _is_mismatch(record):
        return "mismatch"
    return None


# 风险类型 → 级别：独供 / 波动 = 高优先级（排行靠前），偏差 / 错配 = 关注
_RISK_TYPE_LEVEL = {"sole": "high", "fluctuation": "high", "deviation": "medium", "mismatch": "medium"}


def _risk_item(record: ShareRecord, project_id: int) -> Optional[ShareRiskItem]:
    """按最高优先级归类，构造风险排行条目；无风险返回 None。"""
    risk_type = _risk_chain_type(record)
    if risk_type is None:
        return None
    rel = record.supply_relation
    pn = rel.material.pn if rel.material else ""
    mname = rel.material.name if rel.material else ""
    sname = rel.supplier.name if rel.supplier else ""
    scode = rel.supplier.code if rel.supplier else ""
    if risk_type == "sole":
        detail = "独供：同项目同物料仅此一家供应商"
    elif risk_type == "fluctuation":
        detail = _fluctuation_detail(record.share_current or 0, record.share_prev or 0)
    elif risk_type == "deviation":
        detail = f"建议偏差 {abs(record.share_current - record.quota_prev):.0f}pt > {RISK_DEVIATION_PT}pt"
    else:
        detail = "份额高但评分低（份额×评分错配）"
    return ShareRiskItem(
        record_id=record.id,
        project_id=project_id,
        pn=pn,
        material_name=mname,
        supplier_name=sname,
        supplier_code=scode,
        share_current=record.share_current,
        share_prev=record.share_prev,
        weighted_score=record.weighted_score,
        risk_type=risk_type,
        risk_level=_RISK_TYPE_LEVEL[risk_type],
        detail=detail,
    )


def _to_read(record: ShareRecord) -> ShareRecordRead:
    """ORM → 视图（含派生风险信号）。"""
    rel = record.supply_relation
    material = rel.material if rel.material else None
    supplier = rel.supplier if rel.supplier else None

    bases = _parse_bases(record.bases)
    risk_sole = record.is_sole
    risk_fluctuation = _is_fluctuation(record.share_current, record.share_prev)
    risk_deviation = bool(
        record.share_current is not None
        and record.quota_prev is not None
        and abs(record.share_current - record.quota_prev) > RISK_DEVIATION_PT
    )
    return ShareRecordRead(
        id=record.id,
        project_id=record.project_id,
        project_name=record.project.name if record.project else "",
        supply_relation_id=record.supply_relation_id,
        month=record.month,
        pn=material.pn if material else "",
        material_name=material.name if material else "",
        supplier_name=supplier.name if supplier else "",
        supplier_code=supplier.code if supplier else "",
        share_current=record.share_current,
        share_prev=record.share_prev,
        quota_prev=record.quota_prev,
        quota_suggested=record.quota_suggested,
        is_sole=record.is_sole,
        q_score=record.q_score,
        d_score=record.d_score,
        c_score=record.c_score,
        weighted_score=record.weighted_score,
        weight_scheme=record.weight_scheme,
        bases=bases,
        edited_manually=record.edited_manually,
        remark=record.remark,
        risk_sole=risk_sole,
        risk_fluctuation=risk_fluctuation,
        risk_deviation=risk_deviation,
    )


def _load_records(db: Session, project_id: int, month: str) -> list[ShareRecord]:
    """加载某项目某月的全部份额记录（含物料/供应商/项目）。"""
    return list(
        db.execute(
            select(ShareRecord)
            .options(*_SHARE_LOAD)
            .where(ShareRecord.project_id == project_id, ShareRecord.month == month)
        )
        .scalars()
        .all()
    )


@router.get("/projects", response_model=list[dict], summary="全部项目列表（含无份额数据的项目）")
def share_projects(db: Session = Depends(get_db)) -> list[dict]:
    """返回全部项目（id + code + name + 有数据的月份列表），供入口页选择。

    包含无份额数据的项目，以便用户能为新项目录入份额。
    """
    # 全部项目
    all_projects = list(db.execute(select(Project).order_by(Project.code)).scalars().all())
    # 各项目有数据的月份
    months_by_project: dict[int, set[str]] = defaultdict(set)
    rows = db.execute(select(ShareRecord.project_id, ShareRecord.month)).all()
    for pid, month in rows:
        months_by_project[pid].add(month)
    return [
        {
            "project_id": p.id,
            "code": p.code,
            "name": p.name,
            "months": sorted(months_by_project.get(p.id, set())),
        }
        for p in all_projects
    ]


@router.get("/dashboard-stats", response_model=dict, summary="Dashboard 联动：份额波动 / 重点独供 汇总（跨项目、最新月）")
def share_dashboard_stats(db: Session = Depends(get_db)) -> dict:
    """Dashboard 顶部统计卡 + 份额页项目卡标注 的数据源。

    - 取「最新有份额数据的月份」；
    - 顶层 fluctuation_materials / sole_materials：跨全部项目、**按物料 PN 去重**的物料数
      （Dashboard 顶部卡语义 = 物料数）；
    - by_project：**按记录计数、与份额页 KPI/风险排行同口径**（每条记录只归最高优先级风险）
      —— 供份额页项目卡「波动 N / 独供 M」chip 与 Dashboard 点击自动定位使用，
      保证选中项目后 chip 数字 = KPI 卡 = 风险排行对应筛选条数。
    """
    # 默认月 = 「≤ 当前自然月的最大月份」。旧写法直接取 max(month)，只要库里有一条未来
    # 月份（或脏月份）的记录，Dashboard 就整片落到空月份、把当月风险全部归零。
    today = date.today()
    cur_month = f"{today.year:04d}-{today.month:02d}"
    latest_month = db.execute(
        select(func.max(ShareRecord.month)).where(ShareRecord.month <= cur_month)
    ).scalar_one_or_none()
    if latest_month is None:
        return {"month": None, "fluctuation_materials": 0, "sole_materials": 0, "by_project": []}

    records = _load_all_records(db, latest_month)

    # 顶层：跨项目按物料 PN 去重（Dashboard 卡 = 波动物料 / 独供物料 的种数）
    fluctuation_pns: set[str] = set()
    sole_pns: set[str] = set()
    # by_project：记录级（同口径链式归类），供项目卡 chip / 自动定位
    project_info: dict[int, tuple[str, str]] = {}
    per_project_fluct: dict[int, int] = defaultdict(int)
    per_project_sole: dict[int, int] = defaultdict(int)

    for r in records:
        rel = r.supply_relation
        pn = rel.material.pn if rel.material else ""
        if not pn:
            continue
        pid = r.project_id
        if pid not in project_info:
            project_info[pid] = (
                r.project.code if r.project else "",
                r.project.name if r.project else "",
            )
        if r.is_sole:
            sole_pns.add(pn)
        if _is_fluctuation(r.share_current, r.share_prev):
            fluctuation_pns.add(pn)
        risk_type = _risk_chain_type(r)
        if risk_type == "sole":
            per_project_sole[pid] += 1
        elif risk_type == "fluctuation":
            per_project_fluct[pid] += 1

    by_project = [
        {
            "project_id": pid,
            "code": project_info[pid][0],
            "name": project_info[pid][1],
            "fluctuation_materials": per_project_fluct[pid],
            "sole_materials": per_project_sole[pid],
        }
        for pid in sorted(project_info)
    ]

    return {
        "month": latest_month,
        "fluctuation_materials": len(fluctuation_pns),
        "sole_materials": len(sole_pns),
        "by_project": by_project,
    }


def _load_all_records(db: Session, month: str) -> list[ShareRecord]:
    """加载某月全部项目下的份额记录（跨项目，供 Dashboard 汇总）。"""
    return list(
        db.execute(
            select(ShareRecord).options(*_SHARE_LOAD).where(ShareRecord.month == month)
        )
        .scalars()
        .all()
    )


@router.get("/summary", response_model=ShareSummary, summary="KPI 汇总（项目 × 月）")
def share_summary(
    project_id: int = Query(..., description="项目 ID"),
    month: str = Query(..., pattern=MONTH_PATTERN, description="月份（YYYY-MM）"),
    db: Session = Depends(get_db),
) -> ShareSummary:
    records = _load_records(db, project_id, month)
    project = db.get(Project, project_id)
    # 按物料分组（口径说明：total_materials / sticky 用物料维度）
    by_material: dict[int, list[ShareRecord]] = defaultdict(list)
    for r in records:
        by_material[r.supply_relation.material_id].append(r)

    # 风险计数与风险排行同口径：每条记录只归入最高优先级风险（_risk_chain_type），
    # 保证 KPI 卡数字 = 风险排行对应筛选的条数（不再独立累加造成重复计数）
    sole_materials = 0
    fluctuation_alerts = 0
    deviation_alerts = 0
    mismatch_alerts = 0
    for r in records:
        risk_type = _risk_chain_type(r)
        if risk_type == "sole":
            sole_materials += 1
        elif risk_type == "fluctuation":
            fluctuation_alerts += 1
        elif risk_type == "deviation":
            deviation_alerts += 1
        elif risk_type == "mismatch":
            mismatch_alerts += 1
    # 高粘性供应商：当月覆盖物料数 ≥ 3
    supplier_material_count: dict[int, set[int]] = defaultdict(set)
    for r in records:
        supplier_material_count[r.supply_relation.supplier_id].add(r.supply_relation.material_id)
    sticky = sum(1 for ms in supplier_material_count.values() if len(ms) >= 3)

    return ShareSummary(
        project_id=project_id,
        project_name=project.name if project else "",
        month=month,
        total_materials=len(by_material),
        total_relations=len(records),
        sole_materials=sole_materials,
        fluctuation_alerts=fluctuation_alerts,
        deviation_alerts=deviation_alerts,
        mismatch_alerts=mismatch_alerts,
        sticky_suppliers=sticky,
    )


@router.get("/risks", response_model=list[ShareRiskItem], summary="风险排行（独供 > 波动 > 偏差 > 错配）")
def share_risks(
    project_id: int = Query(..., description="项目 ID"),
    month: str = Query(..., pattern=MONTH_PATTERN, description="月份（YYYY-MM）"),
    top: int = Query(10, ge=1, le=100, description="返回条数"),
    db: Session = Depends(get_db),
) -> list[ShareRiskItem]:
    records = _load_records(db, project_id, month)
    # 每条记录只归入最高优先级风险（独供 > 波动 > 偏差 > 错配），与 KPI 卡计数同口径
    items: list[ShareRiskItem] = []
    for r in records:
        item = _risk_item(r, project_id)
        if item is not None:
            items.append(item)

    # 排序：high 在前，同级别按份额倒序
    items.sort(key=lambda x: (0 if x.risk_level == "high" else 1, -(x.share_current or 0)))
    return items[:top]


@router.get("/quadrant", response_model=list[ShareQuadrantPoint], summary="份额 × 评分四象限散点")
def share_quadrant(
    project_id: int = Query(..., description="项目 ID"),
    month: str = Query(..., pattern=MONTH_PATTERN, description="月份（YYYY-MM）"),
    db: Session = Depends(get_db),
) -> list[ShareQuadrantPoint]:
    records = _load_records(db, project_id, month)
    # 点大小 = 该条记录自身各基地拉线合计（每条 self-contained；无基地时 0）
    points: list[ShareQuadrantPoint] = []
    for r in records:
        rel = r.supply_relation
        bases = _parse_bases(r.bases)
        points.append(ShareQuadrantPoint(
            pn=rel.material.pn if rel.material else "",
            material_name=rel.material.name if rel.material else "",
            supplier_name=rel.supplier.name if rel.supplier else "",
            share=r.share_current or 0,
            score=r.weighted_score or 0,
            lines=_sum_lines_from_bases(bases),
            is_sole=r.is_sole,
            project_id=project_id,
        ))
    return points


@router.get("/records", response_model=ShareRecordList, summary="份额明细列表")
def share_records(
    project_id: int = Query(..., description="项目 ID"),
    month: str = Query(..., pattern=MONTH_PATTERN, description="月份（YYYY-MM）"),
    keyword: Optional[str] = Query(None, description="按物料 PN/名称/供应商名称/代码搜索"),
    db: Session = Depends(get_db),
) -> ShareRecordList:
    stmt = (
        select(ShareRecord)
        .join(SupplyRelation)
        .join(Material)
        .join(Supplier)
        .options(*_SHARE_LOAD)
        .where(ShareRecord.project_id == project_id, ShareRecord.month == month)
    )
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(or_(Material.pn.like(like), Material.name.like(like), Supplier.name.like(like), Supplier.code.like(like)))
    stmt = stmt.order_by(Material.pn, Supplier.code)
    rows = db.execute(stmt).scalars().all()
    return ShareRecordList(items=[_to_read(r) for r in rows], total=len(rows))


@router.post("/records", response_model=ShareRecordRead, status_code=status.HTTP_201_CREATED, summary="手动新增份额记录")
def create_share_record(payload: ShareRecordCreate, db: Session = Depends(get_db)) -> ShareRecordRead:
    errors = _validate_qdc(payload.q_score, payload.d_score, payload.c_score)
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="；".join(errors))

    if db.get(Project, payload.project_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {payload.project_id} 不存在")
    rel = db.get(SupplyRelation, payload.supply_relation_id)
    if rel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应关系 {payload.supply_relation_id} 不存在")

    # 只能给「该项目已挂载的供应关系」录份额，否则会写出统计孤岛：
    # 份额记录挂在项目下，但该项目根本没有这条供应关系，供需/库存侧永远看不到。
    link = db.execute(
        select(ProjectSupplyRelation).where(
            ProjectSupplyRelation.project_id == payload.project_id,
            ProjectSupplyRelation.supply_relation_id == payload.supply_relation_id,
        )
    ).scalars().first()
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该项目未挂载该供应关系，请先在「供需管理」中挂载后再录入份额",
        )

    if payload.bases and _mixed_share_scale([b.model_dump() for b in payload.bases]):
        raise _bases_scale_error("本条记录")

    existing = db.execute(
        select(ShareRecord).where(
            ShareRecord.project_id == payload.project_id,
            ShareRecord.supply_relation_id == payload.supply_relation_id,
            ShareRecord.month == payload.month,
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该项目×物料×供应商在当月已有份额记录")

    # 上期份额/上月建议自动带入：同项目同供应关系上月记录
    prev_month = _prev_month(payload.month)
    prev = db.execute(
        select(ShareRecord).where(
            ShareRecord.project_id == payload.project_id,
            ShareRecord.supply_relation_id == payload.supply_relation_id,
            ShareRecord.month == prev_month,
        )
    ).scalars().first()

    record = ShareRecord(
        project_id=payload.project_id,
        supply_relation_id=payload.supply_relation_id,
        month=payload.month,
        share_current=payload.share_current,
        share_prev=prev.share_current if prev else None,
        quota_prev=prev.quota_suggested if prev else None,
        q_score=payload.q_score,
        d_score=payload.d_score,
        c_score=payload.c_score,
        bases=json.dumps([b.model_dump() for b in payload.bases], ensure_ascii=False) if payload.bases is not None else None,
        remark=payload.remark,
    )
    # 有 bases 且未显式传 share_current → 按「基地份额 × 基地拉线数」自动算
    # 分母取该物料全部基地（含其它供应商已登记的基地），不是这条记录自己的线数
    if record.bases and payload.share_current is None:
        bl = _parse_bases(record.bases)
        lines_by_base = _material_lines_by_base(db, payload.project_id, rel.material_id, payload.month, extra=bl)
        auto = _share_from_base_lines(bl, lines_by_base)
        if auto is not None:
            record.share_current = auto
    db.add(record)
    db.flush()
    _recompute_project_material(db, payload.project_id, rel.material_id, payload.month)
    db.commit()

    loaded = db.execute(select(ShareRecord).options(*_SHARE_LOAD).where(ShareRecord.id == record.id)).scalars().one()
    return _to_read(loaded)


@router.put("/records/{record_id}", response_model=ShareRecordRead, summary="手动修改份额记录（自动重算）")
def update_share_record(record_id: int, payload: ShareRecordUpdate, db: Session = Depends(get_db)) -> ShareRecordRead:
    record = db.get(ShareRecord, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"份额记录 {record_id} 不存在")

    errors = _validate_qdc(payload.q_score, payload.d_score, payload.c_score)
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="；".join(errors))

    manual_override = payload.share_current is not None
    bases_changed = payload.bases is not None

    bases_payload: Optional[list[dict]] = None
    if payload.bases is not None:
        bases_payload = [b.model_dump() for b in payload.bases]
        if _mixed_share_scale(bases_payload):
            raise _bases_scale_error(f"份额记录 {record_id} ")
        # 与 Excel 导入保持一致：整条记录全 ≤1 的小数 → ×100 入库，
        # 避免出现「参与计算的份额是 50%、页面显示 0.5%」的口径割裂
        if _is_decimal_scale([b.get("share") for b in bases_payload]):
            for b in bases_payload:
                if b.get("share") is not None:
                    b["share"] = round(b["share"] * 100, 2)

    if payload.share_current is not None:
        record.share_current = payload.share_current
    if payload.q_score is not None:
        record.q_score = payload.q_score
    if payload.d_score is not None:
        record.d_score = payload.d_score
    if payload.c_score is not None:
        record.c_score = payload.c_score
    if bases_changed and bases_payload is not None:
        record.bases = json.dumps(bases_payload, ensure_ascii=False)
    if payload.remark is not None:
        record.remark = payload.remark

    if bases_changed and not manual_override:
        # 只改基地字段 = 清除手改标记，按「该物料全部基地」的线数重新算份额
        record.edited_manually = False
        rel_for_calc = db.get(SupplyRelation, record.supply_relation_id)
        bl = _parse_bases(record.bases)
        if rel_for_calc is not None:
            lines_by_base = _material_lines_by_base(
                db, record.project_id, rel_for_calc.material_id, record.month,
                extra=bl, exclude_id=record.id,
            )
            auto = _share_from_base_lines(bl, lines_by_base)
        else:
            auto = _auto_share_from_bases(bl)
        if auto is not None:
            record.share_current = auto
    else:
        # 显式改份额（或其他字段）= 手改覆盖
        record.edited_manually = True

    rel = db.get(SupplyRelation, record.supply_relation_id)
    db.flush()
    if rel is not None:
        _recompute_project_material(db, record.project_id, rel.material_id, record.month)
    db.commit()

    loaded = db.execute(select(ShareRecord).options(*_SHARE_LOAD).where(ShareRecord.id == record.id)).scalars().one()
    return _to_read(loaded)


@router.delete("/records/{record_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除份额记录（不可逆，剩余记录自动重算）")
def delete_share_record(record_id: int, db: Session = Depends(get_db)) -> Response:
    record = db.get(ShareRecord, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"份额记录 {record_id} 不存在")

    # 取出物料信息用于删除后重算该项目×物料的剩余记录
    rel = db.get(SupplyRelation, record.supply_relation_id)
    material_id = rel.material_id if rel is not None else None
    project_id = record.project_id
    month = record.month

    db.delete(record)
    db.flush()
    if material_id is not None:
        _recompute_project_material(db, project_id, material_id, month)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/import", response_model=ShareImportResult, summary="Excel 导入份额数据")
async def import_share_records(
    request: Request,
    project_id: int = Query(..., description="默认项目 ID（文件里没写项目时用它）"),
    month: str = Query(..., pattern=MONTH_PATTERN, description="默认目标月份（YYYY-MM；文件里没写月份时用它）"),
    file_path: Optional[str] = Query(None, description="兼容旧调用：服务器本地 Excel 绝对路径（浏览器上传时无需）"),
    db: Session = Depends(get_db),
) -> ShareImportResult:
    """Excel 导入（openpyxl 只读模式），浏览器「选择文件」上传请求体（application/octet-stream）。

    列约定（表头行，按列名匹配、不看顺序）：
      物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C |
      基地A_份额 | 基地A_线数 | 基地B_份额 | 基地B_线数 | ...                    ← 宽表（基地写在列名里）
      物料PN | 物料名称 | 供应商代码 | 供应商名称 | 段 | 基地 | 拉线数 | 基地份额 | 本月份额 | Q | D | C   ← 长表
    可选列：项目代码 / 月份 —— 填了就能在同一个文件里混多个项目、多个月份。

    表头可以有多套（表头不同的块各归各的）：
      - 多个 sheet 各一行表头；同一 sheet 里几块表头上下堆叠；块间基地列 / 列数 / 列顺序都可以不同；
      - 表头之前可以有标题行（如「2026-11 份额表」），按列名识别表头，不看第几行。

    项目 / 月份的确定顺序（先到先得）：
      1. 行内「项目代码」「月份」两列；
      2. sheet 名（如 `LFP3-2026-11`、`LFP3 2026年11月`）：用 **库里的项目代码** 匹配，月份取 20xx-xx；
      3. 接口参数里的默认项目与月份。
    项目代码在库里查不到 → 报错，不会静默落到默认项目（那会直接把别人的数写进这个项目）。

    规则：
    - PN / 供应商代码在主档里没有 → 按文件里的名称自动建档并挂到该行所属项目（只复用、绝不改名）
    - 校验：份额 ∈ [0,100]、QDC 五档、**按（项目 × 月份 × 物料）** 份额和 ≈ 100%（容差 ±1%）
    - 份额口径兼容 0-100 与 0-1 小数；整批全 ≤1 视为小数口径；混填报错（避免静默错 100 倍）
    - 基地列成对解析（份额 + 拉线数），前缀「基地」可省；缺一列在表头级报错
    - 「本月份额」可留空：有基地数据时按 Σ(基地份额 × 拉线数) ÷ 该物料全部基地的拉线数 自动算
    - 手动修改过的记录（edited_manually=true）不覆盖，跳过
    - 整批原子：任一行有错，一行都不写
    """
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")

    import io
    import os
    import re

    default_project = db.get(Project, project_id)
    if default_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 不存在")

    # Excel 来源：优先请求体（浏览器「选择文件」上传）；为空时回退服务器本地路径
    content = await request.body()
    if content:
        try:
            wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel 文件解析失败，请确认为有效的 .xlsx / .xls 文件")
    elif file_path:
        if not os.path.exists(file_path):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"文件不存在: {file_path}")
        wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未收到 Excel 文件：请先在弹窗中选择文件再导入")

    def _txt(v) -> str:
        return "" if v is None else str(v).strip()

    # ---------- 表头解析（按块，不按整表） ----------
    base_pat = re.compile(r"^(?P<name>.+?)_?(?P<kind>份额|拉线数|线数|条数)$")
    base_kind = {"份额": "share", "线数": "lines", "条数": "lines", "拉线数": "lines"}
    TOTAL_LIKE = ("本月", "系统", "总", "合计")

    def col_sub(hdr, name: str) -> Optional[int]:
        for i, h in enumerate(hdr):
            if h and name in str(h):
                return i
        return None

    def col_exact(hdr, *names: str) -> Optional[int]:
        """按整格精确匹配列名（不用子串，避免「基地C份额」被 "C" 命中这类串味）。"""
        for i, h in enumerate(hdr):
            if h is not None and str(h).strip() in names:
                return i
        return None

    def parse_header(hdr) -> dict:
        idx_share = col_sub(hdr, "本月份额")
        if idx_share is None:
            idx_share = col_sub(hdr, "本月系统份额")
        idx_pn = col_sub(hdr, "物料PN")
        if idx_pn is None:
            idx_pn = col_sub(hdr, "物料")
        if idx_pn is None:
            idx_pn = 0
        ctx: dict = {
            "pn": idx_pn,
            "mname": col_exact(hdr, "物料名称", "名称"),
            "scode": col_sub(hdr, "供应商代码"),
            "sname": col_exact(hdr, "供应商名称", "供应商"),
            "share": idx_share,
            # 可选：行级项目 / 月份，用于一份文件混多个项目、多个月份
            "pcode": col_exact(hdr, "项目代码", "项目编码", "项目"),
            "pmonth": col_exact(hdr, "月份", "数据月份", "份额月份"),
        }
        # 长表那几列是唯一列名，先占位，避免被基地正则（「基地份额」也能匹配成基地名「基地」）抢走
        ctx["base"] = col_exact(hdr, "基地", "基地名称")
        ctx["lines"] = col_exact(hdr, "拉线数", "线数", "条数")
        ctx["bshare"] = col_exact(hdr, "基地份额", "基地配额")
        ctx["seg"] = col_exact(hdr, "段", "工艺段", "模块")
        used = {i for i in ctx.values() if isinstance(i, int)}

        # 基地列：必须在评分列之前识别 —— 否则列序一换（「C份额」排在「C」前面），
        # 评分列按子串找就会被「C份额」命中，整块 QDC 串味。
        bases: dict[str, dict[str, int]] = {}
        for i, h in enumerate(hdr):
            if i in used:
                continue
            hs = str(h).strip() if h else ""
            m = base_pat.match(hs)
            if not m:
                continue
            bname = (m.group("name") or "").strip()
            # 排除「本月系统份额」这类总列（kind 也是「份额」）被误当成基地
            if not bname or bname.startswith(TOTAL_LIKE):
                continue
            # ⚠️ kind 是正则捕获的中文词，必须归一成英文键再存，
            # 否则下面取值时用 cols["share"] / cols["lines"] 永远取不到 → 基地整列被静默丢弃。
            bases.setdefault(bname, {})[base_kind[m.group("kind")]] = i
            used.add(i)
        ctx["bases"] = bases

        # QDC 评分列：先整格精确匹配，再在「未被占用的列」里按缩写兜底（Q分 / 质量Q 这类写法）
        def find_score(letter: str) -> Optional[int]:
            i = col_exact(hdr, letter, f"{letter}分", f"{letter}评分")
            if i is not None:
                return i
            for j, h in enumerate(hdr):
                if j in used:
                    continue
                if h and letter in str(h):
                    return j
            return None

        ctx["q"] = find_score("Q")
        ctx["d"] = find_score("D")
        ctx["c"] = find_score("C")
        # 长表：基地降级为数据列，列数固定，段与基地随便加
        ctx["long"] = ctx["base"] is not None and ctx["lines"] is not None and ctx["bshare"] is not None
        return ctx

    HEADER_PN = ("物料PN", "PN", "物料")
    HEADER_OTHER = ("供应商代码", "物料名称", "本月份额", "本月系统份额")

    def is_header_row(row) -> bool:
        """表头行判定：同时出现 PN 列名与另一个列名。"""
        texts = {_txt(v) for v in row}
        return any(t in texts for t in HEADER_PN) and any(t in texts for t in HEADER_OTHER)

    result = ShareImportResult()

    def check_header(block: dict, where: str) -> None:
        """宽表表头自检：基地份额与拉线数必须成对，缺一列时直接说清楚缺哪一列。"""
        if block["long"] or not block["bases"]:
            return
        for bname, cols in block["bases"].items():
            if "share" in cols and "lines" in cols:
                continue
            missing = f"{bname}拉线数" if "share" in cols else f"{bname}份额"
            result.errors.append(
                f"{where}（表头）: 基地「{bname}」缺少「{missing}」列 —— 基地份额与拉线数必须成对出现"
            )

    # ---------- 项目 / 月份识别 ----------
    # 一份文件里可以混多个项目、多个月份：行内列 > sheet 名 > 接口默认值。
    # sheet 名匹配用**库里的项目代码或项目名称**（最长优先），不做自由正则拆分 ——
    # 「LFP2026-11」这种名字正则拆会得到 LFP，而真实项目是 LFP3。
    # 实际库里 code 常是 ABC/BBC 这种内部码、name 才是 LFP3/EP1，所以两套都要认；代码优先（唯一）。
    all_projects = db.execute(select(Project)).scalars().all()
    project_by_id_map = {p.id: p for p in all_projects}
    alias_map: dict[str, Project] = {}
    for p in all_projects:
        c = (p.code or "").strip().lower()
        if c:
            alias_map[c] = p
    for p in all_projects:
        n = (p.name or "").strip().lower()
        if n and n not in alias_map:
            alias_map[n] = p
    sorted_aliases = sorted(alias_map, key=len, reverse=True)

    # 月份两位优先：写成 (0?[1-9]|1[0-2]) 时 "2026-11" 会先命中 "1" → 变成 1 月
    YM_RE = re.compile(r"(20\d{2})\s*[-_/.年]?\s*(1[0-2]|0?[1-9])\s*月?(?!\d)")

    def norm_month(v) -> Optional[str]:
        """把 2026-11 / 2026/11 / 202611 / 2026年11月 / datetime 统一成 YYYY-MM。"""
        if v is None:
            return None
        if hasattr(v, "year") and hasattr(v, "month"):
            return f"{v.year}-{int(v.month):02d}"
        s = str(v).strip()
        if not s:
            return None
        m = re.fullmatch(r"(20\d{2})\s*[-_/.年]?\s*(1[0-2]|0?[1-9])\s*月?", s)
        if not m:
            return None
        return f"{int(m.group(1))}-{int(m.group(2)):02d}"

    def project_aliases_text() -> str:
        return " / ".join(
            f"{p.code}（{p.name}）" if (p.code or "").strip() and (p.name or "").strip() else (p.code or p.name or f"#{p.id}")
            for p in all_projects
        ) or "（库里没有项目）"

    def detect_from_title(title: str) -> tuple[Optional[Project], Optional[str]]:
        t = (title or "").strip().lower()
        if not t:
            return None, None
        mon = None
        m = YM_RE.search(t)
        if m:
            mon = f"{int(m.group(1))}-{int(m.group(2)):02d}"
        proj = None
        for alias in sorted_aliases:
            if alias and alias in t:
                proj = alias_map[alias]
                break
        return proj, mon

    def label_of(pid: int, mon: str) -> str:
        p = project_by_id_map.get(pid)
        if p is None:
            return f"项目{pid} {mon}"
        return f"{(p.name or p.code or ('项目%d' % pid))} {mon}"

    def cell_of(ctx: dict, row, field: str):
        """按当前块的表头取单元格（列号随块变化）。"""
        i = ctx.get(field)
        return row[i] if i is not None and i < len(row) else None

    def resolve_target(ctx: dict, row, sheet_pid: int, sheet_month: str) -> tuple[int, str, Optional[str]]:
        """行级「项目代码」「月份」列优先，其次 sheet 级（sheet 名解析），最后接口参数。

        返回 (项目 ID, 月份, 错误文案)。错误交给调用方决定报不报 ——
        预扫描只关心拉线数，不该重复报同一行两次。
        """
        pid, mon = sheet_pid, sheet_month
        pcode_text = _txt(cell_of(ctx, row, "pcode"))
        if pcode_text:
            proj = alias_map.get(pcode_text.lower())
            if proj is None:
                return pid, mon, f"项目「{pcode_text}」不存在，可用：{project_aliases_text()}"
            pid = proj.id
        pmonth_text = _txt(cell_of(ctx, row, "pmonth"))
        if pmonth_text:
            parsed = norm_month(pmonth_text)
            if parsed is None:
                return pid, mon, f"月份「{pmonth_text}」看不懂，请写成 2026-11 / 2026/11 / 202611"
            mon = parsed
        return pid, mon, None

    # ---------- 逐 sheet、逐行切块 ----------
    sheets = list(wb.worksheets)
    multi_sheet = len(sheets) > 1

    def where_of(sheet_title: str, row_num: int) -> str:
        return f"{sheet_title} 第 {row_num} 行" if multi_sheet else f"第 {row_num} 行"

    # (sheet 名, 行号, 该块表头, 数据行, sheet 级默认项目, sheet 级默认月份)
    blocks: list[tuple[str, int, dict, tuple, int, str]] = []
    for sheet in sheets:
        sheet_proj, sheet_mon = detect_from_title(sheet.title)
        sheet_pid = sheet_proj.id if sheet_proj else default_project.id
        sheet_month = sheet_mon or month
        ctx: Optional[dict] = None
        for row_num, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            if not row or all(_txt(v) == "" for v in row):
                continue
            if is_header_row(row):
                ctx = parse_header(row)
                check_header(ctx, where_of(sheet.title, row_num))
                continue
            if ctx is None:
                # 表头之前的标题行 / 说明行（如「2026-11 份额」），跳过
                continue
            blocks.append((sheet.title, row_num, ctx, row, sheet_pid, sheet_month))

    if not blocks and not result.errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="没找到可导入的数据：每个 sheet 都要有一行表头（含「物料PN」「供应商代码」「本月份额」等列名），表头下面才是数据行",
        )

    relation_map: dict[tuple[str, str], SupplyRelation] = {}
    all_relations = db.execute(
        select(SupplyRelation).options(selectinload(SupplyRelation.material), selectinload(SupplyRelation.supplier))
    ).scalars().all()
    for rel in all_relations:
        relation_map[(rel.material.pn, rel.supplier.code)] = rel

    # ---------- 基地拉线数（**基地**属性，不是供应商属性）----------
    # 拉线数 = 这个基地有几条产线，同一基地的所有供应商共用同一个数。所以：
    #   ① 同一基地被填了两个不同的数 → 直接报错。以前取 max，等于悄悄替用户改数；
    #   ② 同一基地只在任意一行填一次即可，其余供应商的行留空自动继承（长表、宽表都一样）。
    base_lines: dict[tuple[int, str, str, str], int] = {}
    base_lines_src: dict[tuple[int, str, str, str], str] = {}
    for sheet_title, row_num, ctx, row, sheet_pid, sheet_month in blocks:
        where = where_of(sheet_title, row_num)
        pid, mon, err = resolve_target(ctx, row, sheet_pid, sheet_month)
        if err:
            continue  # 这条错主循环会报，别重复
        pn = _txt(row[ctx["pn"]]) if ctx["pn"] is not None and ctx["pn"] < len(row) else ""
        if not pn:
            continue
        pairs: list[tuple[str, str]] = []
        if ctx["long"]:
            pairs.append((_txt(cell_of(ctx, row, "base")), _txt(cell_of(ctx, row, "lines"))))
        else:
            for bname, cols in ctx["bases"].items():
                raw = row[cols["lines"]] if "lines" in cols and cols["lines"] < len(row) else None
                pairs.append((bname, _txt(raw)))
        for bname, text in pairs:
            if not bname or not text:
                continue
            try:
                val = int(float(text))
            except (TypeError, ValueError):
                continue  # 非数字留给主循环报
            k = (pid, mon, pn, bname)
            if k in base_lines and base_lines[k] != val:
                result.errors.append(
                    f"{where}: 基地「{bname}」的拉线数前后不一致（{base_lines_src[k]} 写 {base_lines[k]}，这里写 {val}）"
                    "—— 拉线数是基地的产线数，同一基地只能填一个数"
                )
                continue
            base_lines[k] = val
            base_lines_src[k] = where

    # 该（项目 × 月份）已有记录惰性加载：文件可能跨项目跨月，不能只预载默认那一个
    rec_cache: dict[tuple[int, str], dict[tuple[str, str], ShareRecord]] = {}

    def records_of(pid: int, mon: str) -> dict[tuple[str, str], ShareRecord]:
        k = (pid, mon)
        if k not in rec_cache:
            rec_cache[k] = {
                (r.supply_relation.material.pn, r.supply_relation.supplier.code): r
                for r in _load_records(db, pid, mon)
            }
        return rec_cache[k]

    counters: dict[tuple[int, str], dict[str, int]] = defaultdict(
        lambda: {
            "imported": 0, "updated": 0, "skipped": 0,
            "created_materials": 0, "created_suppliers": 0, "created_links": 0,
        }
    )

    def _ensure_relation(pn: str, scode: str, mname: str, sname: str, seg: str, pid: int) -> Optional[SupplyRelation]:
        """文件里出现了主档没有的 PN / 供应商代码 → 按文件名称自动建档，并挂到该行所属项目。

        与 /projects/{id}/relations/quick-add 同语义：物料按 PN、供应商按代码全局唯一，
        导入只「复用或新建」，**绝不改名**（改名会串到引用同一主数据的其他项目）。
        """
        material = db.execute(select(Material).where(Material.pn == pn)).scalars().first()
        if material is None:
            if not mname:
                return None
            material = Material(pn=pn, name=mname, segment=seg or None)
            db.add(material)
            db.flush()
            counters[(pid, "")]["created_materials"] += 1
        elif seg and not material.segment:
            material.segment = seg
        supplier = db.execute(select(Supplier).where(Supplier.code == scode)).scalars().first()
        if supplier is None:
            if not sname:
                return None
            supplier = Supplier(code=scode, name=sname)
            db.add(supplier)
            db.flush()
            counters[(pid, "")]["created_suppliers"] += 1
        rel = db.execute(
            select(SupplyRelation).where(
                SupplyRelation.material_id == material.id,
                SupplyRelation.supplier_id == supplier.id,
            )
        ).scalars().first()
        if rel is None:
            rel = SupplyRelation(material_id=material.id, supplier_id=supplier.id)
            db.add(rel)
            db.flush()
        link = db.execute(
            select(ProjectSupplyRelation).where(
                ProjectSupplyRelation.project_id == pid,
                ProjectSupplyRelation.supply_relation_id == rel.id,
            )
        ).scalars().first()
        if link is None:
            db.add(ProjectSupplyRelation(project_id=pid, supply_relation_id=rel.id))
            db.flush()
            counters[(pid, "")]["created_links"] += 1
        return rel

    # 行键统一为（项目, 月份, PN, 供应商代码）：同一份文件里跨项目/跨月的行互不干扰
    Key = tuple[int, str, str, str]
    rows: list[tuple[dict, Key]] = []
    long_merged: dict[Key, dict] = {}
    long_order: list[Key] = []
    long_segs: dict[str, set[str]] = defaultdict(set)  # pn → 该物料在文件里出现过的段（段是物料属性，不随项目变）
    long_base_total: dict[tuple[int, str, str, str, str], float] = defaultdict(float)
    long_bshare_vals: list[float] = []  # 整批基地份额原值，用于口径判定
    long_mode_any = False
    wide_merged: dict[Key, dict] = {}
    wide_order: list[Key] = []

    for sheet_title, row_num, ctx, row, sheet_pid, sheet_month in blocks:
        where = where_of(sheet_title, row_num)

        def cell(field: str):
            """按当前块的表头取单元格（列号随块变化）。"""
            i = ctx.get(field)
            return row[i] if i is not None and i < len(row) else None

        pn = _txt(row[ctx["pn"]]) if ctx["pn"] is not None and ctx["pn"] < len(row) else ""
        scode = _txt(cell("scode"))
        if not pn or not scode:
            continue

        # 行级项目 / 月份优先，其次 sheet 级（sheet 名解析结果），最后接口默认值
        pid, mon, target_err = resolve_target(ctx, row, sheet_pid, sheet_month)
        if target_err:
            result.errors.append(f"{where}: {target_err}")
            continue

        key: Key = (pid, mon, pn, scode)
        rel_key = (pn, scode)
        if rel_key not in relation_map:
            rel = _ensure_relation(pn, scode, _txt(cell("mname")), _txt(cell("sname")), _txt(cell("seg")), pid)
            if rel is None:
                result.errors.append(
                    f"{where}: PN={pn} / 供应商代码={scode} 在主数据里不存在，"
                    "且文件未填物料名称或供应商名称，无法自动建档"
                )
                continue
            relation_map[rel_key] = rel

        if ctx["long"]:
            long_mode_any = True
            rel = relation_map[rel_key]
            base_name = _txt(cell("base"))
            seg_name = _txt(cell("seg"))
            bshare_text = _txt(cell("bshare"))
            lines_text = _txt(cell("lines"))
            if not base_name:
                result.errors.append(f"{where}: 基地为空，请填写基地名称")
                continue
            if not bshare_text and not lines_text:
                continue  # 该行没填基地数据
            if not bshare_text:
                result.errors.append(f"{where}: 基地「{base_name}」有拉线数无份额，请补配额值")
                continue
            if not lines_text:
                # 拉线数是基地属性：前面任意一行填过就直接用，不要求每家供应商都写一遍
                inherited = base_lines.get((pid, mon, pn, base_name))
                if inherited is None:
                    result.errors.append(
                        f"{where}: 基地「{base_name}」还没有拉线数 —— 同一基地只需在任意一行填一次，"
                        "其余供应商的行可以留空"
                    )
                    continue
                lines_text = str(inherited)
            try:
                bshare = float(bshare_text)
                blines = int(float(lines_text))
            except (TypeError, ValueError):
                result.errors.append(f"{where}: 基地「{base_name}」份额/拉线数不是数字")
                continue
            if not (0 <= bshare <= 100):
                result.errors.append(f"{where}: 基地「{base_name}」份额 {bshare} 越界（0-1 小数或 0-100）")
                continue
            if blines < 1:
                result.errors.append(f"{where}: 基地「{base_name}」拉线数 {blines} 必须 ≥ 1")
                continue
            try:
                share = float(cell("share")) if cell("share") is not None else None
                q = float(cell("q")) if cell("q") is not None else None
                d = float(cell("d")) if cell("d") is not None else None
                c = float(cell("c")) if cell("c") is not None else None
            except (TypeError, ValueError):
                result.errors.append(f"{where}: 份额/评分不是数字")
                continue
            if share is not None and not (0 <= share <= 100):
                result.errors.append(f"{where}: 份额 {share} 越界（应为 0-100）")
                continue
            qdc_errors = _validate_qdc(q, d, c)
            if qdc_errors:
                result.errors.append(f"{where}: {'；'.join(qdc_errors)}")
                continue
            # 段是物料属性：文件里的段必须与物料主档一致；主档没段则本次自动建档。
            mat_seg = (rel.material.segment or "").strip()
            if seg_name and mat_seg and seg_name != mat_seg:
                result.errors.append(
                    f"{where}: 物料 {pn} 的段是「{mat_seg}」，文件写的是「{seg_name}」——一个物料只能属于一个段"
                )
                continue
            if seg_name and not mat_seg:
                rel.material.segment = seg_name
            eff_seg = seg_name or mat_seg
            long_segs[pn].add(eff_seg)

            item = long_merged.get(key)
            if item is None:
                item = {"share": None, "q": None, "d": None, "c": None, "bases": {}}
                long_merged[key] = item
                long_order.append(key)
            for fld, label, val in (("share", "本月份额", share), ("q", "Q", q), ("d", "D", d), ("c", "C", c)):
                if val is None:
                    continue
                if item[fld] is not None and item[fld] != val:
                    result.errors.append(
                        f"{where}: 同一供应商（{pn} / {scode}）多行填了不同的{label}（{item[fld]} / {val}）"
                    )
                elif item[fld] is None:
                    item[fld] = val
            base_key = (eff_seg, base_name)
            if base_key in item["bases"]:
                result.errors.append(
                    f"{where}: 物料 {pn} · {scode} 在「{eff_seg or '未分段'} / {base_name}」重复出现，请合并成一行"
                )
                continue
            item["bases"][base_key] = {"base": base_name, "share": bshare, "lines": blines}
            long_bshare_vals.append(bshare)
            long_base_total[(pid, mon, pn, eff_seg, base_name)] += bshare
            continue

        try:
            share = float(cell("share")) if cell("share") is not None else None
            q = float(cell("q")) if cell("q") is not None else None
            d = float(cell("d")) if cell("d") is not None else None
            c = float(cell("c")) if cell("c") is not None else None
        except (TypeError, ValueError):
            result.errors.append(f"{where}: 份额/评分不是数字")
            continue
        if share is not None and not (0 <= share <= 100):
            result.errors.append(f"{where}: 份额 {share} 越界（应为 0-100）")
            continue
        errors = _validate_qdc(q, d, c)
        if errors:
            result.errors.append(f"{where}: {'；'.join(errors)}")
            continue
        # 基地列：成对解析「基地X_份额」+「基地X_线数」
        bases_data: list[dict] = []
        base_bad = False
        for bname, cols in ctx["bases"].items():
            share_raw = row[cols["share"]] if "share" in cols and cols["share"] < len(row) else None
            lines_raw = row[cols["lines"]] if "lines" in cols and cols["lines"] < len(row) else None
            share_text = _txt(share_raw)
            lines_text = _txt(lines_raw)
            if not share_text and not lines_text:
                continue  # 整对都空：跳过
            if not share_text:
                result.errors.append(f"{where}: 基地「{bname}」有拉线数无份额，请补配额值")
                base_bad = True
                break
            if not lines_text:
                # 拉线数是基地属性：前面任意一行填过就直接用
                inherited = base_lines.get((pid, mon, pn, bname))
                if inherited is None:
                    result.errors.append(
                        f"{where}: 基地「{bname}」还没有拉线数 —— 同一基地只需在任意一列填一次，其余留空即可"
                    )
                    base_bad = True
                    break
                lines_text = str(inherited)
            try:
                sval = float(share_text)
                lval = int(float(lines_text))
            except (TypeError, ValueError):
                result.errors.append(f"{where}: 基地「{bname}」份额/线数不是数字")
                base_bad = True
                break
            if not (0 <= sval <= 100):
                result.errors.append(f"{where}: 基地「{bname}」份额 {sval} 越界（0-1 小数或 0-100）")
                base_bad = True
                break
            if lval < 1:
                result.errors.append(f"{where}: 基地「{bname}」拉线数量 {lval} 必须 ≥ 1")
                base_bad = True
                break
            bases_data.append({"base": bname, "share": sval, "lines": lval})
        if base_bad:
            continue
        if bases_data and _mixed_share_scale(bases_data):
            result.errors.append(
                f"{where}: 基地份额口径混用（同一行既有 ≤1 的小数又有 >1 的百分数），"
                "请统一口径（0-1 小数 或 0-100 百分数，不要混）"
            )
            continue
        # 基地份额口径归一：整条记录全 ≤1 的小数 → ×100 后入库，
        # 保证「参与计算的 %」与「前端显示的 %」一致（否则会出现算的是 50%、页面显示 0.5%）
        if _is_decimal_scale([b.get("share") for b in bases_data]):
            for b in bases_data:
                if b.get("share") is not None:
                    b["share"] = round(b["share"] * 100, 2)
        item = wide_merged.get(key)
        if item is None:
            item = {"share": share, "q": q, "d": d, "c": c, "bases": {}}
            wide_merged[key] = item
            wide_order.append(key)
        for fld, label, val in (("share", "本月份额", share), ("q", "Q", q), ("d", "D", d), ("c", "C", c)):
            if val is None:
                continue
            if item[fld] is not None and item[fld] != val:
                result.errors.append(
                    f"{where}: 同一供应商（{pn} / {scode}）多行填了不同的{label}（{item[fld]} / {val}）"
                )
            elif item[fld] is None:
                item[fld] = val
        for b in bases_data:
            if b["base"] in item["bases"]:
                result.errors.append(
                    f"{where}: 物料 {pn} · {scode} 在基地「{b['base']}」重复出现，请合并成一行"
                )
                continue
            item["bases"][b["base"]] = b

    # 宽表收尾：按 (项目, 月份, PN, 供应商) 聚合，多行的基地合并成一条记录的 bases 快照
    for key in wide_order:
        item = wide_merged[key]
        rows.append((
            {"share_current": item["share"], "q_score": item["q"], "d_score": item["d"],
             "c_score": item["c"], "bases": list(item["bases"].values()) or None},
            key,
        ))

    if long_mode_any:
        # ---- 长表收尾：口径归一 → 分段/分基地校验 → 聚合成份额记录 ----
        nonzero_bshare = [v for v in long_bshare_vals if v != 0]
        if nonzero_bshare:
            if _is_decimal_scale(nonzero_bshare):
                # 整批 ≤1 视为 0-1 小数口径：×100 后入库，保证「算的 %」与「页面显示的 %」一致
                for item in long_merged.values():
                    for b in item["bases"].values():
                        b["share"] = round(b["share"] * 100, 2)
                long_base_total = defaultdict(
                    float, {k: round(v * 100, 2) for k, v in long_base_total.items()}
                )
            elif any(0 < v <= 1 for v in nonzero_bshare) and any(v > 1 for v in nonzero_bshare):
                result.errors.append(
                    "基地份额列口径混用：文件中既有 ≤1 的小数（如 0.5）又有 >1 的百分数（如 50），请统一口径"
                )
        # 一个物料只能属于一个段 —— 同一 PN 跨段会让「同项目同物料份额和 = 100%」失去意义
        for pn, segs in long_segs.items():
            if len(segs) > 1:
                result.errors.append(
                    f"物料 {pn}: 同时出现在多个段（{' / '.join(sorted(s or '未填段' for s in segs))}），"
                    "一个物料只能属于一个段，请拆成不同物料 PN"
                )
        # 同一段内每个基地的供应商份额合计必须 = 100%（按项目 × 月份分开算）
        for (pid, mon, pn, seg, base), total in long_base_total.items():
            if abs(total - 100) > 1:
                result.errors.append(
                    f"{label_of(pid, mon)} · 物料 {pn} · {seg or '未分段'} · 基地「{base}」: "
                    f"各供应商基地份额合计 {total:.1f}% ≠ 100%（容差 ±1%）"
                )
        # 聚合成一条份额记录：bases 仍是 [{base, share, lines}]，模型与前端零改动
        for key in long_order:
            item = long_merged[key]
            rows.append((
                {"share_current": item["share"], "q_score": item["q"], "d_score": item["d"],
                 "c_score": item["c"], "bases": list(item["bases"].values()) or None},
                key,
            ))

    # 「本月份额」口径归一：整批非零份额全部 ≤1 → 视为 0-1 小数口径 ×100。
    # 客户 ERP 导出的份额常是 0.71 这种比例值（= 71%）；不归一会被当成 0.71% 而报「份额和 ≠ 100%」。
    # 部分行小数、部分行百分数 → 口径无法判断，直接拒绝（避免静默错 100 倍）。
    shares_in_file = [d["share_current"] for d, _ in rows if d["share_current"] not in (None, 0)]
    if shares_in_file:
        if _is_decimal_scale(shares_in_file):
            for data, _ in rows:
                if data["share_current"] is not None:
                    data["share_current"] = round(data["share_current"] * 100, 2)
        elif any(0 < v <= 1 for v in shares_in_file) and any(v > 1 for v in shares_in_file):
            result.errors.append(
                "份额列口径混用：文件中既有 ≤1 的小数（如 0.71）又有 >1 的百分数（如 71），"
                "请统一口径（0-1 小数 或 0-100 百分数）"
            )

    # 仅录基地数据（本月份额留空）→ 按各基地份额与基地拉线数自动算物料级份额。
    # ★ 分母必须是「该（项目 × 月份 × 物料）**全部**基地的拉线数之和」，不是这家供应商自己 bases 的拉线数之和。
    #   按记录自算会把只在部分基地供货的供应商高估：基地A 60%（2 线）、基地B 不供货 →
    #   自算得 60，按物料 5 线算应为 24，于是「同物料份额和」凑不到 100%，整批 422 ——
    #   这就是「一个项目多家基地、各基地供应商组合不同」时导不进去的原因。
    # ★ base_lines 在扫块时已按（项目, 月份, 物料, 基地）收好，且同一基地只允许一个数 ——
    #   这里不再从 rows 里重建，否则「同一基地被填了两个数」会被二次覆盖掉。
    lines_total: dict[tuple[int, str, str], int] = defaultdict(int)
    for (pid, mon, pn, _base), lines in base_lines.items():
        lines_total[(pid, mon, pn)] += lines

    for data, key in rows:
        if data["share_current"] is not None or not data["bases"]:
            continue
        pid, mon, pn, _scode = key
        denom = lines_total.get((pid, mon, pn), 0)
        if denom <= 0:
            continue
        weighted = sum(b["share"] * base_lines[(pid, mon, pn, b["base"])] for b in data["bases"])
        data["share_current"] = round(weighted / denom, 2)

    # 同项目同月份同物料份额和 ≈ 100% 校验
    share_by_material: dict[tuple[int, str, str], float] = defaultdict(float)
    for data, key in rows:
        if data["share_current"] is not None:
            pid, mon, pn, _scode = key
            share_by_material[(pid, mon, pn)] += data["share_current"]
    for (pid, mon, pn), total in share_by_material.items():
        if abs(total - 100) > 1:
            result.errors.append(
                f"{label_of(pid, mon)} · 物料 {pn}: 同物料份额和 {total:.1f} ≠ 100%（容差 ±1%）"
            )

    if result.errors:
        # 有错误则不写入任何行（原子性）；此时自动建档的 flush 尚未 commit，随会话回滚
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="；".join(result.errors[:20]))

    touched: set[tuple[int, str, int]] = set()  # (项目, 月份, 物料)
    for data, key in rows:
        pid, mon, pn, scode = key
        existing = records_of(pid, mon).get((pn, scode))
        c = counters[(pid, mon)]
        if existing is not None and existing.edited_manually:
            c["skipped"] += 1
            continue
        rel = relation_map[(pn, scode)]
        prev = records_of(pid, _prev_month(mon)).get((pn, scode))
        touched.add((pid, mon, rel.material_id))
        if existing is not None:
            # 更新（不覆盖手改值；基地配额列有值时同步覆盖基地快照）
            existing.share_current = data["share_current"] if data["share_current"] is not None else existing.share_current
            existing.q_score = data["q_score"] if data["q_score"] is not None else existing.q_score
            existing.d_score = data["d_score"] if data["d_score"] is not None else existing.d_score
            existing.c_score = data["c_score"] if data["c_score"] is not None else existing.c_score
            if data["bases"]:
                existing.bases = json.dumps(data["bases"], ensure_ascii=False)
            c["updated"] += 1
        else:
            record = ShareRecord(
                project_id=pid,
                supply_relation_id=rel.id,
                month=mon,
                share_current=data["share_current"],
                share_prev=prev.share_current if prev else None,
                quota_prev=prev.quota_suggested if prev else None,
                q_score=data["q_score"],
                d_score=data["d_score"],
                c_score=data["c_score"],
                bases=json.dumps(data["bases"], ensure_ascii=False) if data["bases"] else None,
            )
            db.add(record)
            c["imported"] += 1

    # 统一重算：新增的记录此刻还是 pending 对象，而 Session 是 autoflush=False，
    # 必须先 flush，_recompute_project_material 的 SELECT 才能看到它们；
    # 否则新增行不会写加权分 / 建议配额（表现为导入首月这些字段全 NULL，要再导一次才补算）。
    if touched:
        db.flush()
        for pid, mon, material_id in sorted(touched):
            _recompute_project_material(db, pid, material_id, mon)

    # 自动建档计数挂在 (pid, "") 上，最后按项目合并进各自的 (pid, 月份)
    created_by_project: dict[int, dict[str, int]] = defaultdict(lambda: {"m": 0, "s": 0, "l": 0})
    for (pid, mon), c in counters.items():
        if mon == "":
            created_by_project[pid]["m"] += c["created_materials"]
            created_by_project[pid]["s"] += c["created_suppliers"]
            created_by_project[pid]["l"] += c["created_links"]

    db.commit()

    # 结果按（项目 × 月份）分组：一份文件跨项目时，弹窗要能说清哪条归谁
    totals = {"imported": 0, "updated": 0, "skipped": 0, "m": 0, "s": 0, "l": 0}
    for (pid, mon), c in sorted(counters.items()):
        if mon == "":
            continue
        proj = project_by_id_map.get(pid)
        result.by_project.append({
            "project_id": pid,
            "project_code": (proj.code if proj else "") or "",
            "project_name": proj.name if proj else "",
            "month": mon,
            "imported": c["imported"],
            "updated": c["updated"],
            "skipped": c["skipped"],
            "created_materials": created_by_project[pid]["m"],
            "created_suppliers": created_by_project[pid]["s"],
            "created_links": created_by_project[pid]["l"],
        })
        totals["imported"] += c["imported"]
        totals["updated"] += c["updated"]
        totals["skipped"] += c["skipped"]
    totals["m"] = sum(v["m"] for v in created_by_project.values())
    totals["s"] = sum(v["s"] for v in created_by_project.values())
    totals["l"] = sum(v["l"] for v in created_by_project.values())

    result.imported = totals["imported"]
    result.updated = totals["updated"]
    result.skipped = totals["skipped"]
    result.created_materials = totals["m"]
    result.created_suppliers = totals["s"]
    result.created_links = totals["l"]
    return result


@router.post("/rollover", response_model=ShareSummary, summary="月末结转：本月 → 下月空档")
def share_rollover(
    project_id: int = Query(..., description="项目 ID"),
    from_month: str = Query(..., pattern=MONTH_PATTERN, description="结转源月份（YYYY-MM）"),
    to_month: str = Query(..., pattern=MONTH_PATTERN, description="目标月份（YYYY-MM，应为下月）"),
    db: Session = Depends(get_db),
) -> ShareSummary:
    """将 from_month 的记录结转生成 to_month 空档：
    - 新记录：share_current=None（待录），share_prev=源月 share_current，quota_prev=源月 quota_suggested
    - 已有 to_month 记录则跳过（不覆盖）
    - bases 不结转（每条记录自己填写多基地快照）
    """
    # 反向/原地结转会把源月的 share_prev 覆盖成「未来月的份额」，静默污染时间轴，直接拒绝。
    if to_month <= from_month:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"结转目标月份 {to_month} 必须晚于来源月份 {from_month}",
        )
    src_records = _load_records(db, project_id, from_month)
    dst_existing = {
        (r.supply_relation.material_id, r.supply_relation.supplier_id)
        for r in _load_records(db, project_id, to_month)
    }
    created = 0
    for src in src_records:
        key = (src.supply_relation.material_id, src.supply_relation.supplier_id)
        if key in dst_existing:
            continue
        db.add(ShareRecord(
            project_id=project_id,
            supply_relation_id=src.supply_relation_id,
            month=to_month,
            share_prev=src.share_current,
            quota_prev=src.quota_suggested,
        ))
        created += 1

    db.commit()
    return share_summary(project_id=project_id, month=to_month, db=db)


def _prev_month(month: str) -> str:
    """YYYY-MM → 上个月。"""
    year, mon = int(month[:4]), int(month[5:7])
    if mon == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{mon - 1:02d}"
