"""供应商细分（能力 × 意愿四象限）。

路由前缀 `/api/supplier-segments`，红黄牌在 `/api/supplier-cards`。

几条硬规矩（见 docs/supplier-segmentation/01-方案草案.md）：

1. **评价单元 = 期间（月）× 物料 PN × 供应商**，不带项目。
2. **12 项只存五档**（1/0.7/0.5/0.3/0），不存原始值 —— 质量绩效 92.3 分、单价 4.15 元
   这类数据留在各自系统，复制一份就会失真、会过期。
3. **得分是写入时的快照**，不是查询时实时算。改权重不回头改历史结论。
4. **红黄牌不改档位数据**，只在算分时把两维归零。牌一解，按原档位重算即恢复。
   若打牌时把 tier_* 写成 0，解牌就永远回不来。
5. 牌是否影响某个月，按「牌生效区间 ∩ 该月区间」判定，不看今天 ——
   10 月的牌不会污染 9 月的评价。

★ 路由顺序：`/summary` `/periods` `/prefill` `/history` `/copy-period` 这些字面量
  必须注册在 `/{segment_id}` 之前，否则会被当成 id 解析（变更管理踩过同样的坑）。
"""

import calendar
import io
import json
import os
import re
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Material, Supplier, SupplierCard, SupplierSegment, SupplierSegmentConfig
from ..scoring import (
    DIM_LABELS,
    FORMULA_VERSION,
    SEGMENT_THRESHOLD,
    SEGMENT_WEIGHTS,
    TIERS,
    equal_weights,
    normalize_tier,
    score,
)
from ..schemas import (
    MONTH_PATTERN,
    SegmentConfigRead,
    SegmentImportResult,
    SegmentConfigUpdate,
    SegmentCopyResult,
    SegmentRead,
    SegmentSummary,
    SegmentUpdate,
    SegmentUpsert,
    SupplierCardCreate,
    SupplierCardRead,
    SupplierCardRelease,
)

router = APIRouter(prefix="/api/supplier-segments", tags=["SupplierSegments"])
card_router = APIRouter(prefix="/api/supplier-cards", tags=["SupplierCards"])

TIER_FIELDS = tuple(f"tier_{k}" for k in ("a1", "a2", "a3", "a4", "a5", "a6", "w1", "w2", "w3", "w4", "w5", "w6"))


# ---------------------------------------------------------------------------
# 期间 / 牌 的小工具
# ---------------------------------------------------------------------------


def _period_bounds(period: str) -> tuple[date, date]:
    """'YYYY-MM' → 该月首日与末日。"""
    year, month = int(period[:4]), int(period[5:7])
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def _overlaps(card: SupplierCard, period: str) -> bool:
    """牌生效区间与该月是否有交集。牌没解 → 一直有效。

    ★ 空区间（effective_to < effective_from）算作废：打新牌时若把生效日往前挪，
      旧牌会被压成空区间而不是「压成一天」—— 压成一天仍会命中那个月，
      导致补录一张红牌后，新月份莫名其妙还是 0 分。
    """
    if card.effective_to is not None and card.effective_to < card.effective_from:
        return False
    first, last = _period_bounds(period)
    if card.effective_from > last:
        return False
    if card.effective_to is not None and card.effective_to < first:
        return False
    return True


def _cards_by_supplier(db: Session, supplier_ids: Optional[list[int]] = None) -> dict[int, list[SupplierCard]]:
    stmt = select(SupplierCard)
    if supplier_ids:
        stmt = stmt.where(SupplierCard.supplier_id.in_(supplier_ids))
    out: dict[int, list[SupplierCard]] = {}
    for card in db.execute(stmt.order_by(SupplierCard.effective_from.desc())).scalars().all():
        out.setdefault(card.supplier_id, []).append(card)
    return out


def _card_for(cards: dict[int, list[SupplierCard]], supplier_id: int, period: str) -> Optional[SupplierCard]:
    """该供应商在该月生效的牌；多张重叠时取生效日最晚的一张（打新牌会关闭旧牌）。"""
    for card in cards.get(supplier_id, []):
        if _overlaps(card, period):
            return card
    return None


def _active_card_today(cards: dict[int, list[SupplierCard]], supplier_id: int) -> Optional[SupplierCard]:
    today = date.today()
    for card in cards.get(supplier_id, []):
        if card.effective_from <= today and (card.effective_to is None or card.effective_to >= today):
            return card
    return None


# ---------------------------------------------------------------------------
# 配置（单行，零 seed）
# ---------------------------------------------------------------------------


def _load_config(db: Session) -> tuple[float, dict[str, dict[str, float]], str]:
    """读配置；没有行就返回代码默认值（不写库，守 lifespan 不写 seed 的纪律）。"""
    row = db.get(SupplierSegmentConfig, 1)
    if row is None:
        return SEGMENT_THRESHOLD, SEGMENT_WEIGHTS, "business"
    weights = json.loads(row.weights) if row.weights else SEGMENT_WEIGHTS
    return float(row.threshold), weights, row.preset


@router.get("/config", response_model=SegmentConfigRead, summary="读取阈值 / 权重")
def read_config(db: Session = Depends(get_db)) -> SegmentConfigRead:
    threshold, weights, preset = _load_config(db)
    return SegmentConfigRead(threshold=threshold, weights=weights, preset=preset)


@router.put("/config", response_model=SegmentConfigRead, summary="更新阈值 / 权重")
def update_config(payload: SegmentConfigUpdate, db: Session = Depends(get_db)) -> SegmentConfigRead:
    threshold, weights, preset = _load_config(db)
    if payload.threshold is not None:
        threshold = payload.threshold
    if payload.weights is not None:
        weights = payload.weights
    if payload.preset is not None:
        preset = payload.preset
        if preset == "equal":
            weights = equal_weights()
        elif payload.weights is None:
            # 仅把 preset 拨回 business 且没同时给权重 → 用代码里的业务权重
            weights = SEGMENT_WEIGHTS

    row = db.get(SupplierSegmentConfig, 1)
    if row is None:
        row = SupplierSegmentConfig(id=1, threshold=threshold, weights=json.dumps(weights), preset=preset)
        db.add(row)
    else:
        row.threshold = threshold
        row.weights = json.dumps(weights)
        row.preset = preset
    db.commit()
    return SegmentConfigRead(threshold=threshold, weights=weights, preset=preset)


# ---------------------------------------------------------------------------
# 打分写回
# ---------------------------------------------------------------------------


def _apply_score(row: SupplierSegment, card: Optional[SupplierCard], weights: dict, threshold: float) -> None:
    """按当前档位 + 牌重算并写回快照字段。**不改 tier_*。**"""
    tiers = {key: getattr(row, f"tier_{key}") for key in DIM_LABELS}
    result = score(tiers, weights, card.card if card else None, threshold)
    row.cap_score = result.cap
    row.will_score = result.will
    row.quadrant = result.quadrant
    row.card_snapshot = result.card
    row.cap_filled = result.cap_filled
    row.will_filled = result.will_filled
    row.weight_snapshot = json.dumps(weights)
    row.formula_version = FORMULA_VERSION


def _recalc_supplier(db: Session, supplier_id: int) -> int:
    """重算该供应商所有月份的评价。

    看似「全量重算」会破坏历史，其实不会：牌是否命中某个月由
    `_overlaps(牌区间, 月份)` 判定，区间外的月份自然回到原分数。
    解牌只影响解除日之后的月份，历史月份仍记 0 分。
    """
    threshold, weights, _ = _load_config(db)
    cards = _cards_by_supplier(db, [supplier_id])
    rows = db.execute(select(SupplierSegment).where(SupplierSegment.supplier_id == supplier_id)).scalars().all()
    for row in rows:
        _apply_score(row, _card_for(cards, supplier_id, row.period), weights, threshold)
    return len(rows)


# ---------------------------------------------------------------------------
# 查询
# ---------------------------------------------------------------------------


def _latest_period(db: Session) -> str:
    latest = db.execute(select(SupplierSegment.period).order_by(SupplierSegment.period.desc()).limit(1)).scalar()
    return latest or date.today().strftime("%Y-%m")


def _to_read(row: SupplierSegment, material: Material, supplier: Supplier, card: Optional[SupplierCard]) -> SegmentRead:
    read = SegmentRead.model_validate(
        {
            **{name: getattr(row, name) for name in TIER_FIELDS},
            "id": row.id,
            "period": row.period,
            "material_id": row.material_id,
            "pn": material.pn,
            "material_name": material.name,
            "segment": material.segment,
            "supplier_id": row.supplier_id,
            "supplier_code": supplier.code,
            "supplier_name": supplier.name,
            "cap_score": row.cap_score,
            "will_score": row.will_score,
            "quadrant": row.quadrant,
            "card_snapshot": row.card_snapshot,
            "cap_filled": row.cap_filled,
            "will_filled": row.will_filled,
            "evaluator": row.evaluator,
            "evaluated_on": row.evaluated_on,
            "note": row.note,
            "updated_at": row.updated_at,
        }
    )
    read.card = card.card if card else None
    return read


@router.get("/periods", response_model=list[str], summary="有数据的期间（倒序）")
def list_periods(db: Session = Depends(get_db)) -> list[str]:
    rows = db.execute(select(SupplierSegment.period).distinct().order_by(SupplierSegment.period.desc())).scalars().all()
    return list(rows)


@router.get("/summary", response_model=SegmentSummary, summary="象限分布概览")
def summary(period: Optional[str] = Query(None, description="默认最新有数据的月份"), db: Session = Depends(get_db)) -> SegmentSummary:
    target = period or _latest_period(db)
    rows = db.execute(select(SupplierSegment).where(SupplierSegment.period == target)).scalars().all()
    by_quadrant = {key: 0 for key in ("partner", "dependent", "nurture", "exit", "incomplete")}
    for row in rows:
        by_quadrant[row.quadrant] = by_quadrant.get(row.quadrant, 0) + 1

    caps = [r.cap_score for r in rows if r.cap_score is not None]
    wills = [r.will_score for r in rows if r.will_score is not None]
    cards = _cards_by_supplier(db)
    supplier_ids = {r.supplier_id for r in rows}
    today_cards = {sid: _active_card_today(cards, sid) for sid in supplier_ids}
    active = [c for c in today_cards.values() if c is not None]

    return SegmentSummary(
        period=target,
        total=len(rows),
        by_quadrant=by_quadrant,
        avg_cap=round(sum(caps) / len(caps), 1) if caps else None,
        avg_will=round(sum(wills) / len(wills), 1) if wills else None,
        incomplete=by_quadrant.get("incomplete", 0),
        card_count=len(active),
        red_card_count=len([c for c in active if c.card == "red"]),
    )


@router.get("", response_model=list[SegmentRead], summary="评价列表")
def list_segments(
    period: Optional[str] = Query(None, description="默认最新有数据的月份"),
    segment: Optional[str] = Query(None, description="工艺段（模组/电芯）"),
    q: Optional[str] = Query(None, description="按 PN / 物料名 / 供应商名 / 代码模糊搜"),
    db: Session = Depends(get_db),
) -> list[SegmentRead]:
    target = period or _latest_period(db)
    stmt = (
        select(SupplierSegment, Material, Supplier)
        .join(Material, Material.id == SupplierSegment.material_id)
        .join(Supplier, Supplier.id == SupplierSegment.supplier_id)
        .where(SupplierSegment.period == target)
    )
    if segment:
        stmt = stmt.where(Material.segment == segment)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Material.pn.like(like) | Material.name.like(like) | Supplier.name.like(like) | Supplier.code.like(like)
        )
    rows = db.execute(stmt.order_by(SupplierSegment.cap_score.desc(), SupplierSegment.id)).all()

    supplier_ids = list({supplier.id for _, _, supplier in rows})
    cards = _cards_by_supplier(db, supplier_ids or None)
    return [_to_read(row, material, supplier, _card_for(cards, row.supplier_id, row.period)) for row, material, supplier in rows]


@router.get("/history", response_model=list[SegmentRead], summary="单点跨期轨迹")
def history(
    material_code: str = Query(..., description="物料 PN"),
    supplier_code: str = Query(..., description="供应商代码"),
    db: Session = Depends(get_db),
) -> list[SegmentRead]:
    material = db.execute(select(Material).where(Material.pn == material_code)).scalars().first()
    supplier = db.execute(select(Supplier).where(Supplier.code == supplier_code)).scalars().first()
    if material is None or supplier is None:
        return []
    rows = (
        db.execute(
            select(SupplierSegment)
            .where(SupplierSegment.material_id == material.id, SupplierSegment.supplier_id == supplier.id)
            .order_by(SupplierSegment.period)
        )
        .scalars()
        .all()
    )
    cards = _cards_by_supplier(db, [supplier.id])
    return [_to_read(row, material, supplier, _card_for(cards, supplier.id, row.period)) for row in rows]


@router.get("/prefill", summary="取上期档位（复制上期用）")
def prefill(
    period: str = Query(..., description="目标期间；返回它之前最近一期"),
    material_code: str = Query(...),
    supplier_code: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    material = db.execute(select(Material).where(Material.pn == material_code)).scalars().first()
    supplier = db.execute(select(Supplier).where(Supplier.code == supplier_code)).scalars().first()
    if material is None or supplier is None:
        return {"found": False, "period": None, "tiers": {}}
    row = (
        db.execute(
            select(SupplierSegment)
            .where(
                SupplierSegment.material_id == material.id,
                SupplierSegment.supplier_id == supplier.id,
                SupplierSegment.period < period,
            )
            .order_by(SupplierSegment.period.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if row is None:
        return {"found": False, "period": None, "tiers": {}}
    return {"found": True, "period": row.period, "tiers": {name: getattr(row, name) for name in TIER_FIELDS}}


@router.get("/{segment_id}", response_model=SegmentRead, summary="单条评价")
def get_segment(segment_id: int, db: Session = Depends(get_db)) -> SegmentRead:
    row = db.get(SupplierSegment, segment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"评价 {segment_id} 不存在")
    material = db.get(Material, row.material_id)
    supplier = db.get(Supplier, row.supplier_id)
    cards = _cards_by_supplier(db, [row.supplier_id])
    return _to_read(row, material, supplier, _card_for(cards, row.supplier_id, row.period))


# ---------------------------------------------------------------------------
# 写入
# ---------------------------------------------------------------------------


def _resolve(db: Session, material_code: str, supplier_code: str) -> tuple[Material, Supplier]:
    material = db.execute(select(Material).where(Material.pn == material_code)).scalars().first()
    if material is None:
        raise HTTPException(status_code=422, detail=f"物料 PN 不存在：{material_code}")
    supplier = db.execute(select(Supplier).where(Supplier.code == supplier_code)).scalars().first()
    if supplier is None:
        raise HTTPException(status_code=422, detail=f"供应商代码不存在：{supplier_code}")
    return material, supplier


@router.post("", response_model=SegmentRead, status_code=status.HTTP_201_CREATED, summary="新增 / 覆盖评价")
def upsert_segment(payload: SegmentUpsert, db: Session = Depends(get_db)) -> SegmentRead:
    material, supplier = _resolve(db, payload.material_code, payload.supplier_code)
    threshold, weights, _ = _load_config(db)
    cards = _cards_by_supplier(db, [supplier.id])
    card = _card_for(cards, supplier.id, payload.period)

    row = (
        db.execute(
            select(SupplierSegment).where(
                SupplierSegment.period == payload.period,
                SupplierSegment.material_id == material.id,
                SupplierSegment.supplier_id == supplier.id,
            )
        )
        .scalars()
        .first()
    )
    data = payload.model_dump(exclude={"period", "material_code", "supplier_code"})
    if row is None:
        row = SupplierSegment(period=payload.period, material_id=material.id, supplier_id=supplier.id, **data)
        db.add(row)
    else:
        for key, value in data.items():
            setattr(row, key, value)

    _apply_score(row, card, weights, threshold)
    db.commit()
    db.refresh(row)
    return _to_read(row, material, supplier, card)


@router.put("/{segment_id}", response_model=SegmentRead, summary="修改评价")
def update_segment(segment_id: int, payload: SegmentUpdate, db: Session = Depends(get_db)) -> SegmentRead:
    row = db.get(SupplierSegment, segment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"评价 {segment_id} 不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)

    threshold, weights, _ = _load_config(db)
    cards = _cards_by_supplier(db, [row.supplier_id])
    card = _card_for(cards, row.supplier_id, row.period)
    _apply_score(row, card, weights, threshold)
    db.commit()
    db.refresh(row)

    material = db.get(Material, row.material_id)
    supplier = db.get(Supplier, row.supplier_id)
    return _to_read(row, material, supplier, card)


@router.delete("/{segment_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除评价")
def delete_segment(segment_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(SupplierSegment, segment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"评价 {segment_id} 不存在")
    db.delete(row)
    db.commit()


@router.post("/copy-period", response_model=SegmentCopyResult, summary="整批复制上期到本月")
def copy_period(
    from_period: str = Query(..., description="源期间 YYYY-MM"),
    to_period: str = Query(..., description="目标期间 YYYY-MM"),
    db: Session = Depends(get_db),
) -> SegmentCopyResult:
    if to_period <= from_period:
        raise HTTPException(status_code=422, detail="目标期间必须晚于源期间")

    threshold, weights, _ = _load_config(db)
    source = db.execute(select(SupplierSegment).where(SupplierSegment.period == from_period)).scalars().all()
    existing = {
        (row.material_id, row.supplier_id)
        for row in db.execute(select(SupplierSegment).where(SupplierSegment.period == to_period)).scalars().all()
    }
    copied = 0
    skipped = 0
    cards = _cards_by_supplier(db)
    for row in source:
        if (row.material_id, row.supplier_id) in existing:
            skipped += 1
            continue
        clone = SupplierSegment(
            period=to_period,
            material_id=row.material_id,
            supplier_id=row.supplier_id,
            evaluator=None,
            evaluated_on=None,
            note=f"复制自 {from_period}",
            **{name: getattr(row, name) for name in TIER_FIELDS},
        )
        _apply_score(clone, _card_for(cards, row.supplier_id, to_period), weights, threshold)
        db.add(clone)
        copied += 1
    db.commit()
    return SegmentCopyResult(from_period=from_period, to_period=to_period, copied=copied, skipped=skipped)


# ---------------------------------------------------------------------------
# Excel 导入
# ---------------------------------------------------------------------------

# 表头别名 → 12 个档位键。客户的 ERP 导出列名五花八门，这里收口，
# 不要在别处再写第二套映射。
TIER_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "a1": ("质量绩效", "PN质量绩效", "PN 质量绩效"),
    "a2": ("交付达成率", "交付达成"),
    "a3": ("合格率",),
    "a4": ("成本", "成本档"),
    "a5": ("CFT稽查", "CFT 飞行稽查", "CFT飞行稽查", "稽查"),
    "a6": ("质量服务分", "供应商质量服务分"),
    "w1": ("降价意愿",),
    "w2": ("建库意愿",),
    "w3": ("紧急交付", "紧急交付意愿"),
    "w4": ("沟通态度",),
    "w5": ("回复及时率",),
    "w6": ("产能弹性", "产能"),
}


def _parse_tier_cell(raw) -> Optional[float]:
    """单元格 → 合法档位。空 → None（未评）。

    兼容三种写法：`1` / `0.7` 直接是档位；`100` / `70` / `70%` 是百分数（÷100）。
    不做"就近取整"：0.8 既不是档位也不是百分数，直接报错让人改。
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        text = raw.strip().replace("％", "%").replace("%", "")
        if not text:
            return None
        value = float(text)
    else:
        value = float(raw)
    if value > 1.0 + 1e-9:
        value = value / 100.0
    return normalize_tier(value)


def _cell_text(raw) -> str:
    if raw is None:
        return ""
    if isinstance(raw, datetime):
        return raw.strftime("%Y-%m")
    if isinstance(raw, date):
        return raw.strftime("%Y-%m")
    return str(raw).strip()


@router.post("/import", response_model=SegmentImportResult, summary="Excel 导入评价")
async def import_segments(
    request: Request,
    default_period: Optional[str] = Query(None, pattern=MONTH_PATTERN, description="文件里「期间」为空时用这个"),
    file_path: Optional[str] = Query(None, description="兼容本地脚本：服务器本地 Excel 绝对路径"),
    db: Session = Depends(get_db),
) -> SegmentImportResult:
    """导入 12 项档位表。

    列：期间 | 物料PN | 物料名称 | 供应商代码 | 供应商名称 | 质量绩效 | 交付达成率 | 合格率 |
        成本 | CFT稽查 | 质量服务分 | 降价意愿 | 建库意愿 | 紧急交付 | 沟通态度 | 回复及时率 |
        产能弹性 | 打分人 | 备注

    ★ **有一行错就整批不写**（返回 errors，created/updated 都是 0）。
      批量补录最怕"错一行、进了 49 行"，没人对得出来少的是哪一行。
    """
    try:
        from openpyxl import load_workbook
    except ImportError:  # pragma: no cover
        raise HTTPException(status_code=500, detail="服务端未安装 openpyxl")

    content = await request.body()
    if content:
        try:
            wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        except Exception:
            raise HTTPException(status_code=400, detail="Excel 文件解析失败，请确认为有效的 .xlsx / .xls 文件")
    elif file_path:
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"文件不存在: {file_path}")
        wb = load_workbook(file_path, data_only=True, read_only=True)
    else:
        raise HTTPException(status_code=400, detail="未收到 Excel 文件：请先在弹窗里选择文件")

    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if header is None:
        raise HTTPException(status_code=400, detail="Excel 为空")

    header_map: dict[str, int] = {}
    for i, cell in enumerate(header):
        if cell is None:
            continue
        header_map.setdefault(str(cell).strip(), i)

    def col(*names: str) -> Optional[int]:
        for name in names:
            if name in header_map:
                return header_map[name]
        return None

    idx_period = col("期间", "月份", "评价期间")
    idx_pn = col("物料PN", "物料 PN", "PN", "物料")
    idx_scode = col("供应商代码", "供应商编码")
    idx_evaluator = col("打分人", "评价人")
    idx_note = col("备注", "说明")
    tier_cols = {key: col(*aliases) for key, aliases in TIER_COLUMN_ALIASES.items()}

    if idx_pn is None or idx_scode is None:
        raise HTTPException(status_code=400, detail="表头缺少「物料PN」或「供应商代码」列")
    if idx_period is None and not default_period:
        raise HTTPException(status_code=400, detail="表头缺少「期间」列，且没有指定默认期间")
    missing = [DIM_LABELS[key] for key, index in tier_cols.items() if index is None]
    if missing:
        raise HTTPException(status_code=400, detail=f"表头缺少这些档位列：{'、'.join(missing)}")

    materials = {m.pn: m for m in db.execute(select(Material)).scalars().all()}
    suppliers = {s.code: s for s in db.execute(select(Supplier)).scalars().all()}
    threshold, weights, _ = _load_config(db)
    cards = _cards_by_supplier(db)

    errors: list[str] = []
    parsed: list[dict] = []
    seen: dict[tuple[str, str, str], int] = {}
    row_num = 1

    for raw_row in rows_iter:
        row_num += 1
        if not raw_row or all(v is None or str(v).strip() == "" for v in raw_row):
            continue

        period = _cell_text(raw_row[idx_period]) if idx_period is not None else ""
        if not period:
            period = default_period or ""
        if not re.fullmatch(MONTH_PATTERN, period):
            errors.append(f"第 {row_num} 行: 期间「{period or '空'}」格式不对，应为 YYYY-MM（如 2026-10）")
            continue

        pn = _cell_text(raw_row[idx_pn])
        scode = _cell_text(raw_row[idx_scode])
        if not pn or not scode:
            errors.append(f"第 {row_num} 行: 物料PN 或 供应商代码 为空")
            continue
        material = materials.get(pn)
        if material is None:
            errors.append(f"第 {row_num} 行: 物料 PN「{pn}」不存在，请先在供应商列表建料")
            continue
        supplier = suppliers.get(scode)
        if supplier is None:
            errors.append(f"第 {row_num} 行: 供应商代码「{scode}」不存在（按代码匹配，不按名称）")
            continue

        key = (period, pn, scode)
        if key in seen:
            errors.append(f"第 {row_num} 行: 与第 {seen[key]} 行重复（{period} · {pn} · {scode}），请合并成一行")
            continue
        seen[key] = row_num

        tiers: dict[str, Optional[float]] = {}
        row_ok = True
        for dim, index in tier_cols.items():
            raw = raw_row[index] if index is not None and index < len(raw_row) else None
            try:
                tiers[dim] = _parse_tier_cell(raw)
            except (TypeError, ValueError):
                errors.append(
                    f"第 {row_num} 行: {DIM_LABELS[dim]} 档位「{_cell_text(raw)}」不合法，"
                    f"只能是 {' / '.join(f'{t:g}' for t in reversed(TIERS))}（或 100 / 70 / 50 / 30 / 0）"
                )
                row_ok = False
        if not row_ok:
            continue
        if all(v is None for v in tiers.values()):
            errors.append(f"第 {row_num} 行: 12 项全空，没有可保存的内容")
            continue

        parsed.append(
            {
                "period": period,
                "material": material,
                "supplier": supplier,
                "tiers": tiers,
                "evaluator": _cell_text(raw_row[idx_evaluator]) or None if idx_evaluator is not None else None,
                "note": _cell_text(raw_row[idx_note]) or None if idx_note is not None else None,
            }
        )

    if errors:
        # 整批不写：前端把 errors 逐条列出来，改完重导
        return SegmentImportResult(created=0, updated=0, errors=errors[:30] + ([f"…另有 {len(errors) - 30} 处"] if len(errors) > 30 else []))

    created = 0
    updated = 0
    for item in parsed:
        period = item["period"]
        material = item["material"]
        supplier = item["supplier"]
        card = _card_for(cards, supplier.id, period)
        existing = (
            db.execute(
                select(SupplierSegment).where(
                    SupplierSegment.period == period,
                    SupplierSegment.material_id == material.id,
                    SupplierSegment.supplier_id == supplier.id,
                )
            )
            .scalars()
            .first()
        )
        if existing is None:
            existing = SupplierSegment(period=period, material_id=material.id, supplier_id=supplier.id)
            db.add(existing)
            created += 1
        else:
            updated += 1
        for dim, value in item["tiers"].items():
            setattr(existing, f"tier_{dim}", value)
        if item["evaluator"]:
            existing.evaluator = item["evaluator"]
        if item["note"]:
            existing.note = item["note"]
        _apply_score(existing, card, weights, threshold)

    db.commit()
    return SegmentImportResult(created=created, updated=updated, errors=[])


# ---------------------------------------------------------------------------
# 红黄牌
# ---------------------------------------------------------------------------


def _card_to_read(card: SupplierCard, supplier: Optional[Supplier], today: date) -> SupplierCardRead:
    return SupplierCardRead(
        id=card.id,
        supplier_id=card.supplier_id,
        supplier_code=supplier.code if supplier else "",
        supplier_name=supplier.name if supplier else "",
        card=card.card,
        reason=card.reason,
        effective_from=card.effective_from,
        effective_to=card.effective_to,
        created_by=card.created_by,
        released_by=card.released_by,
        release_reason=card.release_reason,
        active=(
            card.effective_from <= today
            and (card.effective_to is None or card.effective_to >= today)
            and (card.effective_to is None or card.effective_to >= card.effective_from)
        ),
    )


@card_router.get("", response_model=list[SupplierCardRead], summary="红黄牌列表")
def list_cards(
    supplier_id: Optional[int] = Query(None),
    active: bool = Query(False, description="只返当前生效中的牌"),
    db: Session = Depends(get_db),
) -> list[SupplierCardRead]:
    stmt = select(SupplierCard, Supplier).join(Supplier, Supplier.id == SupplierCard.supplier_id)
    if supplier_id:
        stmt = stmt.where(SupplierCard.supplier_id == supplier_id)
    today = date.today()
    items = db.execute(stmt.order_by(SupplierCard.effective_from.desc())).all()
    out = [_card_to_read(card, supplier, today) for card, supplier in items]
    return [c for c in out if c.active] if active else out


@card_router.post("", response_model=SupplierCardRead, status_code=status.HTTP_201_CREATED, summary="打牌")
def create_card(payload: SupplierCardCreate, db: Session = Depends(get_db)) -> SupplierCardRead:
    supplier = db.get(Supplier, payload.supplier_id)
    if supplier is None:
        raise HTTPException(status_code=422, detail=f"供应商 {payload.supplier_id} 不存在")

    today = date.today()
    effective_from = payload.effective_from or today

    # 同一供应商同时最多一张生效牌：打新牌时旧牌在前一天终止（改判，不是叠加）。
    # 若新牌生效日早于旧牌生效日，旧牌会被压成空区间 = 作废（见 _overlaps）。
    open_cards = (
        db.execute(
            select(SupplierCard).where(SupplierCard.supplier_id == payload.supplier_id, SupplierCard.effective_to.is_(None))
        )
        .scalars()
        .all()
    )
    for old in open_cards:
        old.effective_to = effective_from - timedelta(days=1)

    card = SupplierCard(
        supplier_id=payload.supplier_id,
        card=payload.card,
        reason=payload.reason,
        effective_from=effective_from,
        created_by=payload.created_by,
    )
    db.add(card)
    db.flush()
    _recalc_supplier(db, payload.supplier_id)
    db.commit()
    db.refresh(card)
    return _card_to_read(card, supplier, today)


@card_router.put("/{card_id}/release", response_model=SupplierCardRead, summary="解牌")
def release_card(card_id: int, payload: SupplierCardRelease, db: Session = Depends(get_db)) -> SupplierCardRead:
    card = db.get(SupplierCard, card_id)
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"牌 {card_id} 不存在")
    if card.effective_to is not None:
        raise HTTPException(status_code=409, detail="该牌已解除，不能重复解牌")

    today = date.today()
    end = payload.effective_to or today
    if end < card.effective_from:
        raise HTTPException(status_code=422, detail="解除日不能早于生效日")
    card.effective_to = end
    card.released_at = datetime.now()
    card.released_by = payload.released_by
    card.release_reason = payload.release_reason

    db.flush()
    # 重算后，解除日之后的月份自动回到原分数；区间内的月份仍记 0 分
    _recalc_supplier(db, card.supplier_id)
    db.commit()
    db.refresh(card)
    return _card_to_read(card, db.get(Supplier, card.supplier_id), today)
