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
- POST   /api/share/import                        Excel 导入（openpyxl，校验合法性）
- POST   /api/share/rollover?from=&to=           月末结转：本月→上月、建议→quota_prev
"""

import json
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Material, Project, ShareRecord, Supplier, SupplyRelation
from ..schemas import (
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


def _auto_share_from_bases(bases: list[dict]) -> Optional[float]:
    """从 share_record.bases 自带的 lines + share 自动算份额（%）。

    公式：份额 = Σ(b.share × b.lines) ÷ Σ(b.lines)
    - 基地配额约定 0-1 小数，全部 ≤1 视为小数口径 ×100；
    - 也兼容直接录百分比（>1）的口径；
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
    latest_month = db.execute(select(func.max(ShareRecord.month))).scalar_one_or_none()
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
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="月份（YYYY-MM）"),
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
    for r in records:
        risk_type = _risk_chain_type(r)
        if risk_type == "sole":
            sole_materials += 1
        elif risk_type == "fluctuation":
            fluctuation_alerts += 1
        elif risk_type == "deviation":
            deviation_alerts += 1
        # mismatch 无 KPI 卡，不入卡计数
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
        sticky_suppliers=sticky,
    )


@router.get("/risks", response_model=list[ShareRiskItem], summary="风险排行（独供 > 波动 > 偏差 > 错配）")
def share_risks(
    project_id: int = Query(..., description="项目 ID"),
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="月份（YYYY-MM）"),
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
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="月份（YYYY-MM）"),
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
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="月份（YYYY-MM）"),
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
    # 有 bases 且未显式传 share_current → 按各基地 (share × lines) 公式自动算
    if record.bases and payload.share_current is None:
        auto = _auto_share_from_bases(_parse_bases(record.bases))
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

    if payload.share_current is not None:
        record.share_current = payload.share_current
    if payload.q_score is not None:
        record.q_score = payload.q_score
    if payload.d_score is not None:
        record.d_score = payload.d_score
    if payload.c_score is not None:
        record.c_score = payload.c_score
    if bases_changed:
        record.bases = json.dumps([b.model_dump() for b in payload.bases], ensure_ascii=False)
    if payload.remark is not None:
        record.remark = payload.remark

    if bases_changed and not manual_override:
        # 只改基地字段 = 清除手改标记，按该记录自身 base.lines 自动重算份额
        record.edited_manually = False
        auto = _auto_share_from_bases(_parse_bases(record.bases))
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
    project_id: int = Query(..., description="项目 ID"),
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="目标月份（YYYY-MM）"),
    file_path: str = Query(..., description="服务器本地 Excel 文件绝对路径"),
    db: Session = Depends(get_db),
) -> ShareImportResult:
    """从本地 Excel 导入（openpyxl 只读模式）。

    列约定（表头行）：
      物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C |
      基地A_份额 | 基地A_线数 | 基地B_份额 | 基地B_线数 | ...

    规则：
    - 按 (pn, supplier_code) 定位供应关系，不存在则报错跳过
    - 校验：份额 ∈ [0,100]、QDC 五档、同项目同物料份额和 ≈ 100%（容差 ±1%）
    - 基地列按成对解析：「基地X_份额」+「基地X_线数」两列合并为一条 base；
      仅有份额无线数 → 跳过该基地；仅无线数有份额 → 报错误行；
      基地名去重；空值忽略
    - 「本月份额」可留空：有基地数据时按 Σ(份额 × 拉线) ÷ Σ拉线 自动算
    - 手动修改过的记录（edited_manually=true）不覆盖，跳过
    """
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")

    import os
    import re

    if db.get(Project, project_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 不存在")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"文件不存在: {file_path}")

    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if header is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel 为空")

    def col_idx(name: str) -> Optional[int]:
        for i, h in enumerate(header):
            if h and name in str(h):
                return i
        return None

    idx_pn = col_idx("物料PN") or col_idx("物料") or 0
    idx_scode = col_idx("供应商代码")
    idx_share = col_idx("本月份额") or col_idx("本月系统份额")
    idx_q = col_idx("Q")
    idx_d = col_idx("D")
    idx_c = col_idx("C")

    # 基地列：表头形如「基地X_份额」「基地X_线数」，成对解析
    known_idx = {i for i in (idx_pn, idx_scode, idx_share, idx_q, idx_d, idx_c) if i is not None}
    base_cols: dict[str, dict[str, int]] = {}  # base_name -> {"share": col, "lines": col}
    base_pat = re.compile(r"^([^_]+)_(份额|线数)$")
    for i, h in enumerate(header):
        if i in known_idx:
            continue
        hs = str(h).strip() if h else ""
        m = base_pat.match(hs)
        if not m:
            continue
        bname, kind = m.group(1).strip(), m.group(2)
        if not bname:
            continue
        base_cols.setdefault(bname, {})[kind] = i

    result = ShareImportResult()
    prev_month = _prev_month(month)
    relation_map: dict[tuple[str, str], SupplyRelation] = {}
    # 预加载该月全部记录（含手改标记）
    existing_records = {
        (r.supply_relation.material.pn, r.supply_relation.supplier.code): r
        for r in _load_records(db, project_id, month)
    }
    prev_records = {
        (r.supply_relation.material.pn, r.supply_relation.supplier.code): r
        for r in _load_records(db, project_id, prev_month)
    }

    all_relations = db.execute(
        select(SupplyRelation).options(selectinload(SupplyRelation.material), selectinload(SupplyRelation.supplier))
    ).scalars().all()
    for rel in all_relations:
        relation_map[(rel.material.pn, rel.supplier.code)] = rel

    rows: list[tuple[dict, tuple[str, str]]] = []
    row_num = 1  # 数据从第 2 行开始
    for row in rows_iter:
        row_num += 1
        if not row or all(v is None or str(v).strip() == "" for v in row):
            continue
        pn = str(row[idx_pn]).strip() if idx_pn is not None and row[idx_pn] is not None else ""
        scode = str(row[idx_scode]).strip() if idx_scode is not None and row[idx_scode] is not None else ""
        if not pn or not scode:
            continue
        key = (pn, scode)
        if key not in relation_map:
            result.errors.append(f"第 {row_num} 行: 未找到供应关系（PN={pn}, 供应商={scode}）")
            continue
        try:
            share = float(row[idx_share]) if idx_share is not None and row[idx_share] is not None else None
            q = float(row[idx_q]) if idx_q is not None and row[idx_q] is not None else None
            d = float(row[idx_d]) if idx_d is not None and row[idx_d] is not None else None
            c = float(row[idx_c]) if idx_c is not None and row[idx_c] is not None else None
        except (TypeError, ValueError):
            result.errors.append(f"第 {row_num} 行: 份额/评分不是数字")
            continue
        if share is not None and not (0 <= share <= 100):
            result.errors.append(f"第 {row_num} 行: 份额 {share} 越界（应为 0-100）")
            continue
        errors = _validate_qdc(q, d, c)
        if errors:
            result.errors.append(f"第 {row_num} 行: {'；'.join(errors)}")
            continue
        # 基地列：成对解析「基地X_份额」+「基地X_线数」
        bases_data: list[dict] = []
        base_bad = False
        for bname, cols in base_cols.items():
            share_raw = row[cols["share"]] if "share" in cols and cols["share"] < len(row) else None
            lines_raw = row[cols["lines"]] if "lines" in cols and cols["lines"] < len(row) else None
            share_text = str(share_raw).strip() if share_raw is not None else ""
            lines_text = str(lines_raw).strip() if lines_raw is not None else ""
            if not share_text and not lines_text:
                continue  # 整对都空：跳过
            if share_text and not lines_text:
                result.errors.append(f"第 {row_num} 行: 基地「{bname}」有份额无线数，请补拉线数量")
                base_bad = True
                break
            if lines_text and not share_text:
                result.errors.append(f"第 {row_num} 行: 基地「{bname}」有拉线数无份额，请补配额值")
                base_bad = True
                break
            try:
                sval = float(share_text)
                lval = int(float(lines_text))
            except (TypeError, ValueError):
                result.errors.append(f"第 {row_num} 行: 基地「{bname}」份额/线数不是数字")
                base_bad = True
                break
            if not (0 <= sval <= 100):
                result.errors.append(f"第 {row_num} 行: 基地「{bname}」份额 {sval} 越界（0-1 小数或 0-100）")
                base_bad = True
                break
            if lval < 1:
                result.errors.append(f"第 {row_num} 行: 基地「{bname}」拉线数量 {lval} 必须 ≥ 1")
                base_bad = True
                break
            bases_data.append({"base": bname, "share": sval, "lines": lval})
        if base_bad:
            continue
        rows.append((
            {"share_current": share, "q_score": q, "d_score": d, "c_score": c,
             "bases": bases_data if bases_data else None},
            key,
        ))

    # 仅录基地数据（本月份额留空）→ 先按各基地 (share × lines) 公式自动算份额
    for data, _ in rows:
        if data["bases"] and data["share_current"] is None:
            auto = _auto_share_from_bases(data["bases"])
            if auto is not None:
                data["share_current"] = auto

    # 同项目同物料份额和 ≈ 100% 校验
    share_by_material: dict[str, float] = defaultdict(float)
    for data, key in rows:
        if data["share_current"] is not None:
            share_by_material[key[0]] += data["share_current"]
    for pn, total in share_by_material.items():
        if total is not None and abs(total - 100) > 1:
            result.errors.append(f"物料 {pn}: 同项目同物料份额和 {total:.1f} ≠ 100%（容差 ±1%）")

    if result.errors:
        # 有错误则不写入任何行（原子性）
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="；".join(result.errors[:20]))

    for data, key in rows:
        existing = existing_records.get(key)
        if existing is not None and existing.edited_manually:
            result.skipped += 1
            continue
        rel = relation_map[key]
        prev = prev_records.get(key)
        if existing is not None:
            # 更新（不覆盖手改值；基地配额列有值时同步覆盖基地快照）
            existing.share_current = data["share_current"] if data["share_current"] is not None else existing.share_current
            existing.q_score = data["q_score"] if data["q_score"] is not None else existing.q_score
            existing.d_score = data["d_score"] if data["d_score"] is not None else existing.d_score
            existing.c_score = data["c_score"] if data["c_score"] is not None else existing.c_score
            if data["bases"]:
                existing.bases = json.dumps(data["bases"], ensure_ascii=False)
            result.updated += 1
            _recompute_project_material(db, project_id, rel.material_id, month)
        else:
            record = ShareRecord(
                project_id=project_id,
                supply_relation_id=rel.id,
                month=month,
                share_current=data["share_current"],
                share_prev=prev.share_current if prev else None,
                quota_prev=prev.quota_suggested if prev else None,
                q_score=data["q_score"],
                d_score=data["d_score"],
                c_score=data["c_score"],
                bases=json.dumps(data["bases"], ensure_ascii=False) if data["bases"] else None,
            )
            db.add(record)
            result.imported += 1
            _recompute_project_material(db, project_id, rel.material_id, month)

    db.commit()
    return result


@router.post("/rollover", response_model=ShareSummary, summary="月末结转：本月 → 下月空档")
def share_rollover(
    project_id: int = Query(..., description="项目 ID"),
    from_month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="结转源月份（YYYY-MM）"),
    to_month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="目标月份（YYYY-MM，应为下月）"),
    db: Session = Depends(get_db),
) -> ShareSummary:
    """将 from_month 的记录结转生成 to_month 空档：
    - 新记录：share_current=None（待录），share_prev=源月 share_current，quota_prev=源月 quota_suggested
    - 已有 to_month 记录则跳过（不覆盖）
    - bases 不结转（每条记录自己填写多基地快照）
    """
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
