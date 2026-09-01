"""L1 物料主档路由（PN 唯一，跨项目共享，不含项目信息）。

- GET    /api/materials      分页查询物料（keyword 模糊搜索 PN/名称/分类）
- POST   /api/materials      新增物料
- DELETE /api/materials/{id} 删除物料（级联删除供应关系与项目明细）
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Material, SupplyRelation
from ..schemas import MaterialCreate, MaterialList, MaterialRead

router = APIRouter(prefix="/api/materials", tags=["Materials"])


def _get_material(db: Session, material_id: int) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"物料 {material_id} 不存在")
    return material


def _ensure_pn_unique(db: Session, pn: str, exclude_id: Optional[int] = None) -> None:
    stmt = select(Material).where(Material.pn == pn)
    if exclude_id is not None:
        stmt = stmt.where(Material.id != exclude_id)
    if db.execute(stmt).scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"物料 PN 已存在：{pn}")


@router.get("", response_model=MaterialList, summary="分页查询物料列表")
def list_materials(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    keyword: Optional[str] = Query(None, description="按 PN / 名称 / 分类模糊搜索"),
) -> MaterialList:
    conditions: list = []
    if keyword:
        like = f"%{keyword}%"
        conditions.append(or_(Material.pn.like(like), Material.name.like(like), Material.category.like(like)))

    total = db.execute(select(func.count()).select_from(Material).where(*conditions)).scalar_one()
    stmt = (
        select(Material)
        .where(*conditions)
        .order_by(Material.created_at.desc(), Material.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = db.execute(stmt).scalars().all()

    # 每个物料的供应商数量（供应关系条数）
    counts = dict(
        db.execute(
            select(SupplyRelation.material_id, func.count(SupplyRelation.id))
            .group_by(SupplyRelation.material_id)
        ).all()
    )

    result: list[MaterialRead] = []
    for m in items:
        read = MaterialRead.model_validate(m)
        read.supplier_count = counts.get(m.id, 0)
        result.append(read)

    return MaterialList(
        items=result,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.post("", response_model=MaterialRead, status_code=status.HTTP_201_CREATED, summary="新增物料")
def create_material(payload: MaterialCreate, db: Session = Depends(get_db)) -> MaterialRead:
    _ensure_pn_unique(db, payload.pn)
    material = Material(**payload.model_dump())
    db.add(material)
    db.commit()
    db.refresh(material)
    read = MaterialRead.model_validate(material)
    read.supplier_count = 0
    return read


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除物料")
def delete_material(material_id: int, db: Session = Depends(get_db)) -> None:
    material = _get_material(db, material_id)
    db.delete(material)  # 级联删除供应关系与项目明细
    db.commit()
