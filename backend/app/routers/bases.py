"""L1 基地主数据路由（我方生产基地 / 仓库）。

库存信号塔的推算单元按「项目 × 物料 × 供应商 × 基地」建立，其中的基地必须是
受控主数据，避免出现「常州 / 常州市 / 常州基地」这类同义异名导致同一实体被拆成多行。

- GET    /api/bases       基地列表（含被库存档案引用的计数）
- POST   /api/bases       新增基地
- PATCH  /api/bases/{id}  更新基地
- DELETE /api/bases/{id}  删除基地（被库存档案引用时拒绝，避免产生孤儿档案）
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BaseSite, InventoryPlan
from ..schemas import BaseSiteCreate, BaseSiteRead, BaseSiteUpdate

router = APIRouter(prefix="/api/bases", tags=["Bases"])


def _get_base(db: Session, base_id: int) -> BaseSite:
    site = db.get(BaseSite, base_id)
    if site is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"基地 {base_id} 不存在")
    return site


def _ensure_unique(db: Session, code: Optional[str], name: Optional[str], exclude_id: Optional[int] = None) -> None:
    """基地编码唯一；名称也做唯一约束（同名会让用户无法分辨）。"""
    for column, value, label in ((BaseSite.code, code, "基地编码"), (BaseSite.name, name, "基地名称")):
        if not value:
            continue
        stmt = select(BaseSite).where(column == value)
        if exclude_id is not None:
            stmt = stmt.where(BaseSite.id != exclude_id)
        if db.execute(stmt).scalars().first() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{label}已存在：{value}")


def _to_read(site: BaseSite, plan_count: int = 0) -> BaseSiteRead:
    read = BaseSiteRead.model_validate(site)
    read.plan_count = plan_count
    return read


@router.get("", response_model=list[BaseSiteRead], summary="基地列表")
def list_bases(db: Session = Depends(get_db)) -> list[BaseSiteRead]:
    counts = dict(
        db.execute(
            select(InventoryPlan.base_id, func.count(InventoryPlan.id)).group_by(InventoryPlan.base_id)
        ).all()
    )
    sites = db.execute(select(BaseSite).order_by(BaseSite.id)).scalars().all()
    return [_to_read(s, counts.get(s.id, 0)) for s in sites]


@router.post("", response_model=BaseSiteRead, status_code=status.HTTP_201_CREATED, summary="新增基地")
def create_base(payload: BaseSiteCreate, db: Session = Depends(get_db)) -> BaseSiteRead:
    _ensure_unique(db, payload.code, payload.name)
    site = BaseSite(**payload.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    return _to_read(site, 0)


@router.patch("/{base_id}", response_model=BaseSiteRead, summary="更新基地")
def update_base(base_id: int, payload: BaseSiteUpdate, db: Session = Depends(get_db)) -> BaseSiteRead:
    site = _get_base(db, base_id)
    data = payload.model_dump(exclude_unset=True)
    _ensure_unique(db, data.get("code"), data.get("name"), exclude_id=base_id)
    for key, value in data.items():
        setattr(site, key, value)
    db.commit()
    db.refresh(site)
    count = db.execute(
        select(func.count(InventoryPlan.id)).where(InventoryPlan.base_id == base_id)
    ).scalar_one()
    return _to_read(site, count)


@router.delete("/{base_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除基地")
def delete_base(base_id: int, db: Session = Depends(get_db)) -> None:
    site = _get_base(db, base_id)
    count = db.execute(
        select(func.count(InventoryPlan.id)).where(InventoryPlan.base_id == base_id)
    ).scalar_one()
    if count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"基地「{site.name}」仍被 {count} 条库存档案引用，请先处理这些档案",
        )
    db.delete(site)
    db.commit()
