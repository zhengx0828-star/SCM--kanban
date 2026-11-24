"""供应商红黄绿（地图点位颜色）判定 —— 实时算，不落库。

口径（2026-11-03 用户确认，简化版）
====================================
  红（凡影响交付）：红牌 / 黄牌 / 已断货 / 供需缺口 / 库存跌破安全线 / 人工标红
  黄（不影响交付）：有进行中的变更 / 唯一货源（独供，但当前有货）
  绿：其余。**没有台账的供应商也是绿** —— 用户明确「只要在地图上的就是绿的」，
      这是刻意的简化口径，代价是「没数据」会被读成「没问题」，故 tooltip 另行标注。

四条硬约束（改动前必读）
========================
1. **不复制阈值**：库存四档来自 `inventory._assemble`，缺口来自 `alerts._supply_items`，
   牌来自 `segments._active_card_today`，独供来自 `share._load_all_records`。
   改阈值只改原模块，这里跟着变。
2. **缺口与变更是「项目 × 物料」级**，落到该物料在该项目下的全部在供供应商。
   变更单若填了 `supplier_id` 只算那一家；但变更表单目前没有这个字段，实际都按物料推断。
3. **人工 `risk_level` 只能加红**：人工红而自动未判红时补一条 `manual_red`；
   人工黄/绿不参与（否则等于允许把自动判出的红刷绿）。
4. 实时计算、不落库：台账补了，颜色下一次请求就变，不会「已修好还红着」。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .models import Change, Project, ProjectSupplyRelation, Supplier, SupplierCard, SupplyRelation
from .routers.alerts import _default_base_month, _horizon_months, _supply_items
from .routers.inventory import _assemble
from .routers.segments import _active_card_today
from .routers.share import _load_all_records
from .schemas import (
    ALERT_HORIZON_DEFAULT,
    INV_EXCESS_DOH_DEFAULT,
    INV_DOH_BUCKET_STOCKOUT,
    INV_DOH_BUCKET_URGENT,
    INV_Z_DEFAULT,
    SupplierRiskRead,
    SupplierRiskReason,
)

RED = "red"
YELLOW = "yellow"
GREEN = "green"

# 同一类原因最多展开 2 条明细，其余折成「另 N 项」
_MAX_SAMPLES = 2


class _Hits:
    """一个供应商命中的全部规则（按 code 聚合，一个 code 只出一条 reason）。"""

    def __init__(self) -> None:
        self._h: dict[str, dict] = {}

    def add(self, code: str, label: str, level: str, detail: str) -> None:
        h = self._h.setdefault(code, {"label": label, "level": level, "items": [], "count": 0})
        h["count"] += 1
        if len(h["items"]) < _MAX_SAMPLES:
            h["items"].append(detail)

    @property
    def level(self) -> str:
        if any(h["level"] == RED for h in self._h.values()):
            return RED
        return YELLOW if self._h else GREEN

    def reasons(self) -> list[SupplierRiskReason]:
        rank = {RED: 0, YELLOW: 1}
        ordered = sorted(self._h.items(), key=lambda kv: (rank.get(kv[1]["level"], 9), -kv[1]["count"]))
        out: list[SupplierRiskReason] = []
        for code, h in ordered:
            extra = h["count"] - len(h["items"])
            detail = "；".join(h["items"])
            if extra > 0:
                detail = f"{detail}（另 {extra} 项）"
            out.append(SupplierRiskReason(code=code, label=h["label"], detail=detail))
        return out


def _suppliers_by_project_material(db: Session) -> dict[tuple[int, int], set[int]]:
    """(项目, 物料) → 该项目该物料下的供应商集合。缺口/变更按物料推断要用。"""
    rows = db.execute(
        select(
            ProjectSupplyRelation.project_id,
            SupplyRelation.material_id,
            SupplyRelation.supplier_id,
        ).join(SupplyRelation, ProjectSupplyRelation.supply_relation_id == SupplyRelation.id)
    ).all()
    out: dict[tuple[int, int], set[int]] = defaultdict(set)
    for pid, mid, sid in rows:
        out[(pid, mid)].add(sid)
    return out


def _active_changes(db: Session, sup_by_pm: dict[tuple[int, int], set[int]]) -> dict[int, list[str]]:
    """进行中的变更（未归档、未作废）→ 供应商。填了 supplier_id 只算那家，否则按物料推断。"""
    rows = (
        db.execute(
            select(Change)
            .options(joinedload(Change.change_type))
            .where(
                Change.status == "active",
                Change.is_removed.is_(False),
                Change.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    out: dict[int, list[str]] = defaultdict(list)
    for ch in rows:
        type_name = ch.change_type.name if ch.change_type else "变更"
        label = f"{ch.title}（{type_name}）"
        targets = {ch.supplier_id} if ch.supplier_id else sup_by_pm.get((ch.project_id, ch.material_id), set())
        for sid in targets:
            out[sid].append(label)
    return out


def _sole_materials(db: Session, month: str) -> dict[int, list[str]]:
    """该月独供记录 → 供应商 → [物料]。独供是项目 × 物料级，供应商唯一。"""
    out: dict[int, list[str]] = defaultdict(list)
    for rec in _load_all_records(db, month):
        if not rec.is_sole:
            continue
        rel = rec.supply_relation
        if rel is None or rel.material is None:
            continue
        out[rel.supplier_id].append(f"{rel.material.pn} {rel.material.name}".strip())
    return out


def assess_supplier_risk(
    db: Session,
    base_month: Optional[str] = None,
    horizon: Optional[int] = None,
) -> dict[int, SupplierRiskRead]:
    """返回 {supplier_id: SupplierRiskRead}。所有供应商都有值（无命中即绿）。"""
    suppliers = list(db.execute(select(Supplier)).scalars().all())
    if not suppliers:
        return {}

    hits: dict[int, _Hits] = {s.id: _Hits() for s in suppliers}
    stats: dict[int, dict[str, int]] = {s.id: defaultdict(int) for s in suppliers}  # type: ignore[assignment]

    projects = list(db.execute(select(Project)).scalars().all())
    project_ids = [p.id for p in projects]
    sup_by_pm = _suppliers_by_project_material(db)
    month = base_month or _default_base_month(db)

    # ---- 1. 红黄牌（供应商级） ----
    cards: dict[int, list[SupplierCard]] = defaultdict(list)
    for card in db.execute(select(SupplierCard)).scalars().all():
        cards[card.supplier_id].append(card)
    for s in suppliers:
        card = _active_card_today(cards, s.id)
        if card is None:
            continue
        if card.card == RED:
            hits[s.id].add("card_red", "红牌生效", RED, card.reason)
            stats[s.id]["card_red"] = 1
        else:
            # 用户口径（2026-11-03）：红黄牌都是红色，黄牌不降级成黄
            hits[s.id].add("card_yellow", "黄牌生效", RED, card.reason)
            stats[s.id]["card_yellow"] = 1

    # ---- 2. 库存（推算单元自带 supplier_id，可精确归因） ----
    stockout_units: dict[int, int] = defaultdict(int)
    red_units: dict[int, int] = defaultdict(int)
    if project_ids:
        outs = _assemble(db, project_ids, [], [], [], INV_Z_DEFAULT, INV_EXCESS_DOH_DEFAULT)
        for unit in outs:
            if unit.doh_bucket == INV_DOH_BUCKET_STOCKOUT:
                stockout_units[unit.supplier_id] += 1
            elif unit.doh_bucket == INV_DOH_BUCKET_URGENT:
                red_units[unit.supplier_id] += 1
    for sid, n in stockout_units.items():
        if sid in hits:
            hits[sid].add("stockout", "已断货", RED, f"{n} 个推算单元期末库存为 0")
            stats[sid]["stockout_units"] = n
    for sid, n in red_units.items():
        if sid in hits:
            hits[sid].add("low_stock", "库存跌破安全线", RED, f"{n} 个推算单元低于安全库存或安全天数")
            stats[sid]["low_stock_units"] = n

    # ---- 3. 供需缺口（物料级 → 该项目该物料的全部供应商） ----
    months = _horizon_months(month, horizon if horizon is not None else ALERT_HORIZON_DEFAULT)
    if project_ids and months:
        items, _ = _supply_items(db, projects, project_ids, months)
        worst_by_pm: dict[tuple[int, int], str] = {}
        for it in items:
            if it.kind != "shortage" or it.ref.project_id is None or it.ref.material_id is None:
                continue
            key = (it.ref.project_id, it.ref.material_id)
            if key not in worst_by_pm:
                worst_by_pm[key] = it.title
        for key, title in worst_by_pm.items():
            for sid in sup_by_pm.get(key, ()):
                if sid not in hits:
                    continue
                hits[sid].add("shortage", "供需缺口", RED, title)
                stats[sid]["shortage_materials"] += 1

    # ---- 4. 进行中的变更（物料级推断，填了供应商则精确） ----
    for sid, labels in _active_changes(db, sup_by_pm).items():
        if sid not in hits:
            continue
        for label in labels:
            # 用户口径（2026-11-03）：有变更就是黄，不算影响交付
            hits[sid].add("change", "有进行中的变更", YELLOW, label)
        stats[sid]["active_changes"] = len(labels)

    # ---- 5. 唯一货源（独供）：交付没问题，但没备份 → 黄 ----
    # 库存已跌破 / 已断货的走上面的红规则，不再重复记一条黄理由
    for sid, materials in _sole_materials(db, month).items():
        if sid not in hits:
            continue
        if stockout_units.get(sid, 0) > 0 or red_units.get(sid, 0) > 0:
            continue
        sample = materials[0] if materials else "在供物料"
        extra = f" 等 {len(materials)} 个物料" if len(materials) > 1 else ""
        hits[sid].add("sole", "唯一货源", YELLOW, f"{sample}{extra}仅此一家供应")
        stats[sid]["sole_materials"] = len(materials)

    # ---- 6. 人工只能加红 ----
    for s in suppliers:
        if s.risk_level == RED and hits[s.id].level != RED:
            hits[s.id].add("manual_red", "人工标红", RED, "人工标记为高风险（只允许加红）")

    return {
        s.id: SupplierRiskRead(
            level=hits[s.id].level,
            reasons=hits[s.id].reasons(),
            stats={k: v for k, v in stats[s.id].items() if v},
        )
        for s in suppliers
    }
