"""L2 供应关系主数据路由（四元组：物料PN · 物料名称 · 供应商名称 · 供应商代码）。

其他模块统一从这里取基础数据；项目维度字段见 /api/projects/{id}/relations。

- GET    /api/supply-relations             分页查询（keyword 搜 PN/物料名/供应商名/供应商代码）
- GET    /api/supply-relations/options     全量（供其他模块下拉/选择器消费）
- POST   /api/supply-relations             新增供应关系（物料 + 供应商，全局唯一）
- DELETE /api/supply-relations/{id}        删除（级联删除项目明细）
- GET    /api/supply-relations/{id}/projects  该四元组被哪些项目引用
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Material, Project, ProjectSupplyRelation, Supplier, SupplyRelation
from ..schemas import (
    SupplyRelationCreate,
    SupplyRelationList,
    SupplyRelationProjectBrief,
    SupplyRelationRead,
)

router = APIRouter(prefix="/api/supply-relations", tags=["Supply Relations"])

# 供应关系完整加载：物料 + 供应商 + 项目明细
_REL_LOAD = (
    selectinload(SupplyRelation.material),
    selectinload(SupplyRelation.supplier),
    selectinload(SupplyRelation.project_links),
)


def _get_relation(db: Session, relation_id: int) -> SupplyRelation:
    relation = db.get(SupplyRelation, relation_id)
    if relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应关系 {relation_id} 不存在")
    return relation


def _to_read(rel: SupplyRelation) -> SupplyRelationRead:
    """ORM → 四元组视图。"""
    return SupplyRelationRead(
        id=rel.id,
        material_id=rel.material_id,
        supplier_id=rel.supplier_id,
        pn=rel.material.pn,
        material_name=rel.material.name,
        supplier_name=rel.supplier.name,
        supplier_code=rel.supplier.code,
        project_count=len(rel.project_links),
        created_at=rel.created_at,
    )


@router.get("/options", response_model=list[SupplyRelationRead], summary="全量供应关系（下拉消费）")
def list_relation_options(db: Session = Depends(get_db)) -> list[SupplyRelationRead]:
    stmt = select(SupplyRelation).options(*_REL_LOAD).order_by(SupplyRelation.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [_to_read(r) for r in rows]


@router.get("", response_model=SupplyRelationList, summary="分页查询供应关系（四元组）")
def list_relations(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    keyword: Optional[str] = Query(None, description="按物料PN / 物料名称 / 供应商名称 / 供应商代码模糊搜索"),
) -> SupplyRelationList:
    conditions: list = []
    if keyword:
        like = f"%{keyword}%"
        conditions.append(
            or_(
                Material.pn.like(like),
                Material.name.like(like),
                Supplier.name.like(like),
                Supplier.code.like(like),
            )
        )

    base = select(SupplyRelation).join(Material).join(Supplier)
    total = db.execute(select(func.count()).select_from(base.subquery()).where(*conditions)).scalar_one()
    stmt = (
        select(SupplyRelation)
        .join(Material)
        .join(Supplier)
        .options(*_REL_LOAD)
        .where(*conditions)
        .order_by(SupplyRelation.created_at.desc(), SupplyRelation.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = db.execute(stmt).scalars().all()

    return SupplyRelationList(
        items=[_to_read(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.post("", response_model=SupplyRelationRead, status_code=status.HTTP_201_CREATED, summary="新增供应关系")
def create_relation(payload: SupplyRelationCreate, db: Session = Depends(get_db)) -> SupplyRelationRead:
    if db.get(Material, payload.material_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"物料 {payload.material_id} 不存在")
    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应商 {payload.supplier_id} 不存在")

    existing = db.execute(
        select(SupplyRelation).where(
            SupplyRelation.material_id == payload.material_id,
            SupplyRelation.supplier_id == payload.supplier_id,
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该物料与供应商的供应关系已存在")

    rel = SupplyRelation(material_id=payload.material_id, supplier_id=payload.supplier_id)
    db.add(rel)
    db.commit()
    stmt = select(SupplyRelation).options(*_REL_LOAD).where(SupplyRelation.id == rel.id)
    rel = db.execute(stmt).scalars().one()
    return _to_read(rel)


@router.delete("/{relation_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除供应关系")
def delete_relation(relation_id: int, db: Session = Depends(get_db)) -> None:
    rel = _get_relation(db, relation_id)
    db.delete(rel)  # 级联删除项目明细
    db.commit()


@router.get("/{relation_id}/projects", response_model=list[SupplyRelationProjectBrief], summary="查询引用该供应关系的项目")
def list_relation_projects(relation_id: int, db: Session = Depends(get_db)) -> list[SupplyRelationProjectBrief]:
    _get_relation(db, relation_id)
    stmt = (
        select(Project, ProjectSupplyRelation)
        .join(ProjectSupplyRelation, ProjectSupplyRelation.project_id == Project.id)
        .where(ProjectSupplyRelation.supply_relation_id == relation_id)
        .order_by(ProjectSupplyRelation.id.desc())
    )
    result: list[SupplyRelationProjectBrief] = []
    for project, link in db.execute(stmt).all():
        brief = SupplyRelationProjectBrief(
            id=project.id,
            code=project.code,
            name=project.name,
            status=project.status,
            role=link.role,
            is_primary=link.is_primary,
        )
        result.append(brief)
    return result
