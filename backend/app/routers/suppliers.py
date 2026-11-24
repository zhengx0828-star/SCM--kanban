"""L1 供应商主数据 RESTful 路由（不含项目信息，跨模块共享）。

- GET    /api/suppliers       全量查询（含供应物料列表 + 实时红黄绿，Dashboard 地图直接消费）
- POST   /api/suppliers       新增供应商主数据（仅身份字段）
- PATCH  /api/suppliers/{id}  更新供应商（补全地图字段等）
- DELETE /api/suppliers/{id}  删除供应商（级联删除供应关系及项目明细）

★ 地图点位颜色读的是 `risk`（实时判定，见 `supplier_risk.py`），
  不是表里的 `risk_level`（人工标红，只允许加红）。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import InventoryPlan, Supplier, SupplierCard, SupplierSegment, SupplyRelation
from ..schemas import SupplierCreate, SupplierRead, SupplierUpdate
from ..supplier_risk import assess_supplier_risk

router = APIRouter(prefix="/api/suppliers", tags=["Suppliers"])

# 供应商列表时完整加载供应关系（rel.material）
_SUPPLIER_LOAD = selectinload(Supplier.supply_relations).selectinload(SupplyRelation.material)


def _with_risk(rows: list[Supplier], db: Session) -> list[SupplierRead]:
    """把实时红黄绿挂到响应上。全量算一次，再逐家取（不要一家算一次）。"""
    risks = assess_supplier_risk(db)
    out: list[SupplierRead] = []
    for row in rows:
        item = SupplierRead.model_validate(row)
        item.risk = risks.get(row.id)
        out.append(item)
    return out


def _ensure_code_unique(db: Session, code: str, exclude_id: int | None = None) -> None:
    stmt = select(Supplier).where(Supplier.code == code)
    if exclude_id is not None:
        stmt = stmt.where(Supplier.id != exclude_id)
    if db.execute(stmt).scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"供应商代码已存在：{code}")


@router.get("", response_model=list[SupplierRead], summary="查询全部供应商（地图点位 + 主数据 + 实时红黄绿）")
def list_suppliers(db: Session = Depends(get_db)) -> list[SupplierRead]:
    stmt = select(Supplier).options(_SUPPLIER_LOAD).order_by(Supplier.created_at.desc())
    return _with_risk(list(db.execute(stmt).scalars().all()), db)


@router.post("", response_model=SupplierRead, status_code=status.HTTP_201_CREATED, summary="新增供应商主数据")
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)) -> SupplierRead:
    _ensure_code_unique(db, payload.code)
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    stmt = select(Supplier).options(_SUPPLIER_LOAD).where(Supplier.id == supplier.id)
    supplier = db.execute(stmt).scalars().one()
    return _with_risk([supplier], db)[0]


@router.patch("/{supplier_id}", response_model=SupplierRead, summary="更新供应商（补全地图字段）")
def update_supplier(supplier_id: int, payload: SupplierUpdate, db: Session = Depends(get_db)) -> SupplierRead:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应商 {supplier_id} 不存在")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(supplier, key, value)
    db.commit()
    stmt = select(Supplier).options(_SUPPLIER_LOAD).where(Supplier.id == supplier.id)
    supplier = db.execute(stmt).scalars().one()
    return _with_risk([supplier], db)[0]


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除供应商")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)) -> None:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应商 {supplier_id} 不存在")
    # 被引用时不允许删除：否则会连带删掉供应关系与库存档案，且库存页输出层会因
    # supplier 为 None 而 500。基地主数据已有同样的 409 保护，这里补齐。
    plans = db.execute(
        select(func.count()).select_from(InventoryPlan).where(InventoryPlan.supplier_id == supplier_id)
    ).scalar_one()
    if plans:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"供应商「{supplier.name}」仍被 {plans} 条库存档案引用，请先删除这些库存档案",
        )
    rels = db.execute(
        select(func.count()).select_from(SupplyRelation).where(SupplyRelation.supplier_id == supplier_id)
    ).scalar_one()
    if rels:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"供应商「{supplier.name}」仍有 {rels} 条供应关系，请先解除供应关系",
        )
    # 评价档位与红黄牌都挂在 supplier_id 上且外键 CASCADE，删供应商会一并抹掉。
    # 红黄牌的设计前提是「牌期两维归零但不覆盖原档位，解牌可恢复」——被删就恢复不了。
    segments = db.execute(
        select(func.count()).select_from(SupplierSegment).where(SupplierSegment.supplier_id == supplier_id)
    ).scalar_one()
    if segments:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"供应商「{supplier.name}」仍有 {segments} 条细分评价，请先在细分页删除这些评价",
        )
    cards = db.execute(
        select(func.count()).select_from(SupplierCard).where(SupplierCard.supplier_id == supplier_id)
    ).scalar_one()
    if cards:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"供应商「{supplier.name}」仍有 {cards} 条红黄牌记录，请先解除后再删除",
        )
    db.delete(supplier)
    db.commit()
