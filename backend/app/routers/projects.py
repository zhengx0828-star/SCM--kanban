"""L3 项目路由（项目是一等公民 + 项目下供应明细管理）。

- GET    /api/projects                       分页查询项目
- POST   /api/projects                       新增项目
- PATCH  /api/projects/{id}                  更新项目
- DELETE /api/projects/{id}                  删除项目（级联删除项目明细）
- GET    /api/projects/{id}/relations        项目下的供应明细（四元组 + 项目字段）
- POST   /api/projects/{id}/relations        挂一条供应关系到项目（带项目专属字段）
- PATCH  /api/projects/{id}/relations/{link_id}   维护项目专属字段
- DELETE /api/projects/{id}/relations/{link_id}   解除项目-供应关系
- PUT    /api/projects/{id}/demand           批量维护某物料的客户需求（1-12月）
- GET    /api/projects/{id}/materials        项目下关联的物料（去重）
- GET    /api/projects/{id}/suppliers        项目下关联的供应商（去重，含点位字段）
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Material, Project, ProjectSupplyRelation, Supplier, SupplyRelation
from ..schemas import (
    MaterialRead,
    ProjectBomUpdate,
    ProjectCreate,
    ProjectDemandUpdate,
    ProjectList,
    ProjectRead,
    ProjectSupplyRelationCreate,
    ProjectSupplyRelationQuickCreate,
    ProjectSupplyRelationRead,
    ProjectSupplyRelationUpdate,
    ProjectUpdate,
    SupplierMaterialBrief,
    SupplierRead,
)

router = APIRouter(prefix="/api/projects", tags=["Projects"])

# 项目明细完整加载：供应关系 + 物料 + 供应商
_LINK_LOAD = (
    selectinload(ProjectSupplyRelation.supply_relation).selectinload(SupplyRelation.material),
    selectinload(ProjectSupplyRelation.supply_relation).selectinload(SupplyRelation.supplier),
)


def _get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 不存在")
    return project


def _get_link(db: Session, project_id: int, link_id: int) -> ProjectSupplyRelation:
    link = db.execute(
        select(ProjectSupplyRelation).where(
            ProjectSupplyRelation.id == link_id,
            ProjectSupplyRelation.project_id == project_id,
        )
    ).scalars().first()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目明细 {link_id} 不存在")
    return link


def _ensure_code_unique(db: Session, code: str, exclude_id: Optional[int] = None) -> None:
    stmt = select(Project).where(Project.code == code)
    if exclude_id is not None:
        stmt = stmt.where(Project.id != exclude_id)
    if db.execute(stmt).scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"项目代码已存在：{code}")


def _json_to_list(raw: str | None) -> list[float] | None:
    """DB 中 JSON 文本 → list[float]（无效/空返回 None）。"""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return [float(x) for x in parsed] if isinstance(parsed, list) else None
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def _list_to_json(values: list[float] | None) -> str | None:
    """list[float] → JSON 文本（供 DB 存储）。"""
    return json.dumps(values) if values is not None else None


def _link_to_read(link: ProjectSupplyRelation) -> ProjectSupplyRelationRead:
    """项目明细 ORM → 响应模型（四元组 + 项目字段）。"""
    rel = link.supply_relation
    return ProjectSupplyRelationRead(
        id=link.id,
        project_id=link.project_id,
        supply_relation_id=link.supply_relation_id,
        pn=rel.material.pn,
        material_name=rel.material.name,
        supplier_name=rel.supplier.name,
        supplier_code=rel.supplier.code,
        role=link.role,
        is_primary=link.is_primary,
        unit_price=link.unit_price,
        quota=link.quota,
        lead_time=link.lead_time,
        valid_from=link.valid_from,
        valid_to=link.valid_to,
        demand=_json_to_list(link.demand),
        capacity=_json_to_list(link.capacity),
        bom_factor=link.bom_factor,
        remark=link.remark,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


@router.get("", response_model=ProjectList, summary="分页查询项目")
def list_projects(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    keyword: Optional[str] = Query(None, description="按项目代码 / 名称 / 负责人模糊搜索"),
) -> ProjectList:
    conditions: list = []
    if keyword:
        like = f"%{keyword}%"
        conditions.append(or_(Project.code.like(like), Project.name.like(like), Project.owner.like(like)))

    total = db.execute(select(func.count()).select_from(Project).where(*conditions)).scalar_one()
    stmt = (
        select(Project)
        .options(selectinload(Project.supply_links))
        .where(*conditions)
        .order_by(Project.created_at.desc(), Project.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = db.execute(stmt).scalars().all()

    result: list[ProjectRead] = []
    for p in items:
        read = ProjectRead.model_validate(p)
        read.relation_count = len(p.supply_links)
        result.append(read)

    return ProjectList(
        items=result,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED, summary="新增项目")
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectRead:
    _ensure_code_unique(db, payload.code)
    project = Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    read = ProjectRead.model_validate(project)
    read.relation_count = 0
    return read


@router.patch("/{project_id}", response_model=ProjectRead, summary="更新项目")
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)) -> ProjectRead:
    project = _get_project(db, project_id)
    data = payload.model_dump(exclude_unset=True)
    if "code" in data:
        _ensure_code_unique(db, data["code"], exclude_id=project_id)
    for key, value in data.items():
        setattr(project, key, value)
    db.commit()
    stmt = select(Project).options(selectinload(Project.supply_links)).where(Project.id == project.id)
    project = db.execute(stmt).scalars().one()
    read = ProjectRead.model_validate(project)
    read.relation_count = len(project.supply_links)
    return read


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除项目")
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = _get_project(db, project_id)
    db.delete(project)  # 级联删除项目明细
    db.commit()


@router.get("/{project_id}/relations", response_model=list[ProjectSupplyRelationRead], summary="查询项目下的供应明细")
def list_project_relations(project_id: int, db: Session = Depends(get_db)) -> list[ProjectSupplyRelationRead]:
    _get_project(db, project_id)
    stmt = (
        select(ProjectSupplyRelation)
        .options(*_LINK_LOAD)
        .where(ProjectSupplyRelation.project_id == project_id)
        .order_by(ProjectSupplyRelation.is_primary.desc(), ProjectSupplyRelation.id.desc())
    )
    links = db.execute(stmt).scalars().all()
    return [_link_to_read(l) for l in links]


@router.get("/{project_id}/materials", response_model=list[MaterialRead], summary="查询项目下关联的物料（去重，供需管理等模块用）")
def list_project_materials(project_id: int, db: Session = Depends(get_db)) -> list[MaterialRead]:
    """该项目挂载的供应关系所关联的物料（按 PN 去重）。

    供「供需管理」等模块的物料选择器使用，与供应商列表物料 Tab 同一主数据源。
    """
    _get_project(db, project_id)

    stmt = (
        select(Material)
        .join(SupplyRelation, SupplyRelation.material_id == Material.id)
        .join(ProjectSupplyRelation, ProjectSupplyRelation.supply_relation_id == SupplyRelation.id)
        .where(ProjectSupplyRelation.project_id == project_id)
        .order_by(Material.created_at.desc(), Material.id.desc())
    )
    rows = db.execute(stmt).scalars().all()
    seen: set[int] = set()
    result: list[MaterialRead] = []
    for m in rows:
        if m.id in seen:
            continue
        seen.add(m.id)
        read = MaterialRead.model_validate(m)
        # 该项目下该物料的供应商数量（供应关系条数）
        supplier_count = db.execute(
            select(func.count(SupplyRelation.id))
            .join(ProjectSupplyRelation, ProjectSupplyRelation.supply_relation_id == SupplyRelation.id)
            .where(
                ProjectSupplyRelation.project_id == project_id,
                SupplyRelation.material_id == m.id,
            )
        ).scalar_one()
        read.supplier_count = supplier_count
        result.append(read)
    return result


@router.get("/{project_id}/suppliers", response_model=list[SupplierRead], summary="查询项目下关联的供应商（地图切片用，含点位字段）")
def list_project_suppliers(project_id: int, db: Session = Depends(get_db)) -> list[SupplierRead]:
    """该项目挂载的供应关系所关联的供应商（去重）。

    数据与「供应商列表」主数据同源（同一 suppliers 表），
    供 Dashboard 地图按项目切片显示：选中项目 → 只画该项目下的供应商点位。

    注意：响应里每个供应商的 `materials` 字段**只包含该项目下关联的物料**（去重），
    与「供应商列表」全量 supplier.materials 不同——避免在不同项目下误带出其他项目的物料。
    """
    _get_project(db, project_id)

    # 一次性查该项目下所有 ProjectSupplyRelation（带 supply_relation + material + supplier）
    link_stmt = (
        select(ProjectSupplyRelation)
        .options(*_LINK_LOAD)
        .where(ProjectSupplyRelation.project_id == project_id)
    )
    links = list(db.execute(link_stmt).scalars().all())

    # 按 supplier_id 聚合：去重供应商；每个供应商只保留该项目下关联的物料
    by_supplier: dict[int, tuple[Supplier, list[Material]]] = {}
    for link in links:
        rel = link.supply_relation
        sid = rel.supplier_id
        if sid not in by_supplier:
            by_supplier[sid] = (rel.supplier, [])
        mats = by_supplier[sid][1]
        if not any(m.id == rel.material_id for m in mats):
            mats.append(rel.material)

    # 构造响应：materials 限定为该项目下的物料（覆盖 ORM 上的 @property）
    result: list[SupplierRead] = []
    for sid, (supplier, mats) in by_supplier.items():
        read = SupplierRead.model_validate(supplier)
        read.materials = [SupplierMaterialBrief.model_validate(m) for m in mats]
        result.append(read)
    return result


@router.post(
    "/{project_id}/relations",
    response_model=ProjectSupplyRelationRead,
    status_code=status.HTTP_201_CREATED,
    summary="挂供应关系到项目（带项目专属字段）",
)
def create_project_relation(
    project_id: int, payload: ProjectSupplyRelationCreate, db: Session = Depends(get_db)
) -> ProjectSupplyRelationRead:
    _get_project(db, project_id)
    rel = db.get(SupplyRelation, payload.supply_relation_id)
    if rel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"供应关系 {payload.supply_relation_id} 不存在")

    existing = db.execute(
        select(ProjectSupplyRelation).where(
            ProjectSupplyRelation.project_id == project_id,
            ProjectSupplyRelation.supply_relation_id == payload.supply_relation_id,
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该供应关系已挂载到此项目")

    data = payload.model_dump(exclude={"supply_relation_id"})
    data["demand"] = _list_to_json(data.get("demand"))
    data["capacity"] = _list_to_json(data.get("capacity"))
    link = ProjectSupplyRelation(project_id=project_id, supply_relation_id=payload.supply_relation_id, **data)
    db.add(link)
    db.commit()
    stmt = select(ProjectSupplyRelation).options(*_LINK_LOAD).where(ProjectSupplyRelation.id == link.id)
    link = db.execute(stmt).scalars().one()
    return _link_to_read(link)


@router.post(
    "/{project_id}/relations/quick-add",
    response_model=ProjectSupplyRelationRead,
    status_code=status.HTTP_201_CREATED,
    summary="快速录入项目明细（输入四元组，自动创建/复用主数据并挂载）",
)
def quick_add_project_relation(
    project_id: int, payload: ProjectSupplyRelationQuickCreate, db: Session = Depends(get_db)
) -> ProjectSupplyRelationRead:
    """底表一行式录入：PN/物料名称/供应商名称/供应商代码 → 自动建主数据 → 挂载到项目。"""
    _get_project(db, project_id)

    # 1. 物料：按 pn 查找，不存在则创建
    material = db.execute(select(Material).where(Material.pn == payload.pn)).scalars().first()
    if material is None:
        material = Material(pn=payload.pn, name=payload.material_name)
        db.add(material)
        db.flush()
    elif material.name != payload.material_name:
        material.name = payload.material_name  # 同步最新物料名称
        db.flush()

    # 2. 供应商：按 code 查找（兜底按名称），不存在则创建
    supplier = db.execute(select(Supplier).where(Supplier.code == payload.supplier_code)).scalars().first()
    if supplier is None:
        supplier = db.execute(select(Supplier).where(Supplier.name == payload.supplier_name)).scalars().first()
    if supplier is None:
        supplier = Supplier(code=payload.supplier_code, name=payload.supplier_name)
        db.add(supplier)
        db.flush()
    elif supplier.name != payload.supplier_name:
        supplier.name = payload.supplier_name  # 同步最新供应商名称
        db.flush()

    # 3. 供应关系：按（物料 + 供应商）查找，不存在则创建
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

    # 4. 项目明细：已挂载则 409
    existing = db.execute(
        select(ProjectSupplyRelation).where(
            ProjectSupplyRelation.project_id == project_id,
            ProjectSupplyRelation.supply_relation_id == rel.id,
        )
    ).scalars().first()
    if existing is not None:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该物料-供应商已在此项目中，请勿重复录入")

    data = payload.model_dump(exclude={"pn", "material_name", "supplier_name", "supplier_code"})
    data["demand"] = _list_to_json(data.get("demand"))
    data["capacity"] = _list_to_json(data.get("capacity"))
    link = ProjectSupplyRelation(project_id=project_id, supply_relation_id=rel.id, **data)
    db.add(link)
    db.commit()
    stmt = select(ProjectSupplyRelation).options(*_LINK_LOAD).where(ProjectSupplyRelation.id == link.id)
    link = db.execute(stmt).scalars().one()
    return _link_to_read(link)


@router.patch(
    "/{project_id}/relations/{link_id}",
    response_model=ProjectSupplyRelationRead,
    summary="更新项目供应明细（维护项目专属字段）",
)
def update_project_relation(
    project_id: int, link_id: int, payload: ProjectSupplyRelationUpdate, db: Session = Depends(get_db)
) -> ProjectSupplyRelationRead:
    link = _get_link(db, project_id, link_id)
    data = payload.model_dump(exclude_unset=True)
    if "demand" in data:
        data["demand"] = _list_to_json(data["demand"])
    if "capacity" in data:
        data["capacity"] = _list_to_json(data["capacity"])
    for key, value in data.items():
        setattr(link, key, value)
    db.commit()
    stmt = select(ProjectSupplyRelation).options(*_LINK_LOAD).where(ProjectSupplyRelation.id == link.id)
    link = db.execute(stmt).scalars().one()
    return _link_to_read(link)


@router.put(
    "/{project_id}/demand",
    response_model=list[ProjectSupplyRelationRead],
    summary="批量维护项目的客户需求（1-12月，同步到该项目下所有供应明细）",
)
def update_project_demand(
    project_id: int, payload: ProjectDemandUpdate, db: Session = Depends(get_db)
) -> list[ProjectSupplyRelationRead]:
    """客户需求是「项目级」数据：客户给的是产品总需求，1 台产品需要多少个该物料由 BOM 系数体现。

    录入一次即同步到该项目下所有供应明细行（不区分物料；每行冗余存同一份客户需求）。
    """
    _get_project(db, project_id)

    # 该项目下所有明细
    links = list(
        db.execute(
            select(ProjectSupplyRelation)
            .options(*_LINK_LOAD)
            .where(ProjectSupplyRelation.project_id == project_id)
        ).scalars().all()
    )
    if not links:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 下没有任何供应明细，请先挂载物料-供应商关系")

    demand_json = _list_to_json(payload.demand)
    for link in links:
        link.demand = demand_json
    db.commit()

    stmt = select(ProjectSupplyRelation).options(*_LINK_LOAD).where(
        ProjectSupplyRelation.project_id == project_id,
    )
    updated = db.execute(stmt).scalars().all()
    return [_link_to_read(l) for l in updated]


@router.put(
    "/{project_id}/bom",
    response_model=list[ProjectSupplyRelationRead],
    summary="批量维护某物料的 BOM 用量系数（同步到该项目下该物料所有供应明细）",
)
def update_project_material_bom(
    project_id: int, payload: ProjectBomUpdate, db: Session = Depends(get_db)
) -> list[ProjectSupplyRelationRead]:
    """BOM 用量系数是「项目×物料」级数据：同一项目下同一物料的各家供应商行共享同一系数。

    录入一次即同步到该项目下该物料的所有供应明细行；不同项目对同一物料可填不同系数。
    """
    _get_project(db, project_id)

    links = list(
        db.execute(
            select(ProjectSupplyRelation)
            .options(*_LINK_LOAD)
            .where(
                ProjectSupplyRelation.project_id == project_id,
                ProjectSupplyRelation.supply_relation.has(SupplyRelation.material.has(Material.pn == payload.material_pn)),
            )
        ).scalars().all()
    )
    if not links:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 下没有物料 {payload.material_pn} 的供应明细")

    for link in links:
        link.bom_factor = payload.bom_factor
    db.commit()

    stmt = select(ProjectSupplyRelation).options(*_LINK_LOAD).where(
        ProjectSupplyRelation.project_id == project_id,
        ProjectSupplyRelation.supply_relation.has(SupplyRelation.material.has(Material.pn == payload.material_pn)),
    )
    updated = db.execute(stmt).scalars().all()
    return [_link_to_read(l) for l in updated]


@router.delete("/{project_id}/relations/{link_id}", status_code=status.HTTP_204_NO_CONTENT, summary="解除项目-供应关系")
def delete_project_relation(project_id: int, link_id: int, db: Session = Depends(get_db)) -> None:
    link = _get_link(db, project_id, link_id)
    db.delete(link)
    db.commit()
