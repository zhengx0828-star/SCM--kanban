"""L1 供应商主数据 RESTful 路由（不含项目信息，跨模块共享）。

- GET    /api/suppliers       全量查询（含供应物料列表，Dashboard 地图直接消费）
- POST   /api/suppliers       新增供应商主数据（仅身份字段）
- PATCH  /api/suppliers/{id}  更新供应商（补全地图字段等）
- DELETE /api/suppliers/{id}  删除供应商（级联删除供应关系及项目明细）
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Supplier, SupplyRelation
from ..schemas import SupplierCreate, SupplierRead, SupplierUpdate

router = APIRouter(prefix="/api/suppliers", tags=["Suppliers"])

# 供应商列表时完整加载供应关系（rel.material）
_SUPPLIER_LOAD = selectinload(Supplier.supply_relations).selectinload(SupplyRelation.material)


def _ensure_code_unique(db: Session, code: str, exclude_id: int | None = None) -> None:
    stmt = select(Supplier).where(Supplier.code == code)
    if exclude_id is not None:
        stmt = stmt.where(Supplier.id != exclude_id)
    if db.execute(stmt).scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"供应商代码已存在：{code}")


@router.get("", response_model=list[SupplierRead], summary="查询全部供应商（地图点位 + 主数据）")
def list_suppliers(db: Session = Depends(get_db)) -> list[Supplier]:
    stmt = select(Supplier).options(_SUPPLIER_LOAD).order_by(Supplier.created_at.desc())
    return list(db.execute(stmt).scalars().all())


@router.post("", response_model=SupplierRead, status_code=status.HTTP_201_CREATED, summary="新增供应商主数据")
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)) -> Supplier:
    _ensure_code_unique(db, payload.code)
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    stmt = select(Supplier).options(_SUPPLIER_LOAD).where(Supplier.id == supplier.id)
    supplier = db.execute(stmt).scalars().one()
    return supplier


@router.patch("/{supplier_id}", response_model=SupplierRead, summary="更新供应商（补全地图字段）")
def update_supplier(supplier_id: int, payload: SupplierUpdate, db: Session = Depends(get_db)) -> Supplier:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应商 {supplier_id} 不存在")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(supplier, key, value)
    db.commit()
    stmt = select(Supplier).options(_SUPPLIER_LOAD).where(Supplier.id == supplier.id)
    supplier = db.execute(stmt).scalars().one()
    return supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除供应商")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)) -> None:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应商 {supplier_id} 不存在")
    db.delete(supplier)  # 级联删除供应关系与项目明细
    db.commit()
