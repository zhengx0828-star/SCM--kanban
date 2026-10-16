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
- PUT    /api/projects/{id}/bom              批量维护某物料的 BOM 用量系数
- GET    /api/projects/{id}/materials        项目下关联的物料（去重）
- GET    /api/projects/{id}/suppliers        项目下关联的供应商（去重，含点位字段）
- GET    /api/projects/demand-import-template 下载供需管理 Excel 导入模板（两个 sheet）
"""

import io
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import (
    Change,
    InventoryDay,
    InventoryPlan,
    Material,
    Project,
    ProjectDemandVersion,
    ProjectSupplyRelation,
    ShareRecord,
    Supplier,
    SupplyRelation,
)
from ..schemas import (
    DemandVersionCreate,
    DemandVersionRead,
    MaterialRead,
    ProjectBomUpdate,
    ProjectCreate,
    ProjectDemandUpdate,
    ProjectDemandVersionSummary,
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


# --------------------------------------------------------------------------- #
#  客户需求版本（只增不改的快照序列）辅助函数                                    #
# --------------------------------------------------------------------------- #


def _version_to_read(ver: ProjectDemandVersion) -> DemandVersionRead:
    """需求版本 ORM → 响应模型（附 12 月合计，供版本下拉直接显示）。"""
    months = _json_to_list(ver.demand) or []
    return DemandVersionRead(
        id=ver.id,
        project_id=ver.project_id,
        seq=ver.seq,
        version_no=ver.version_no,
        label=ver.label,
        demand=_json_to_list(ver.demand),
        source=ver.source,
        effective_date=ver.effective_date,
        is_current=ver.is_current,
        note=ver.note,
        created_by=ver.created_by,
        year_total=round(sum(months), 2),
        created_at=ver.created_at,
    )


def _versions_of(db: Session, project_id: int) -> list[ProjectDemandVersion]:
    """某项目的全部版本，按 seq 倒序（新版在前）。排序一律用 seq，不用 version_no。"""
    return list(
        db.execute(
            select(ProjectDemandVersion)
            .where(ProjectDemandVersion.project_id == project_id)
            .order_by(ProjectDemandVersion.seq.desc())
        ).scalars().all()
    )


def _suggest_version_no(versions: list[ProjectDemandVersion]) -> str:
    """按上一版 +0.1 建议版本号（如 1.0 → 1.1）；上一版号不可解析时退回「seq+1.0」。

    仅作**建议**：调用方可以传自己的 version_no（如直接跳到 2.0）。
    """
    if not versions:
        return "1.0"
    top = versions[0]
    try:
        return f"{round(float(top.version_no) + 0.1, 1):.1f}"
    except (TypeError, ValueError):
        return f"{top.seq + 1}.0"


def _demand_version_create(
    db: Session,
    project_id: int,
    *,
    demand_json: str | None,
    version_no: str | None,
    label: str | None,
    source: str,
    effective_date,
    note: str | None,
    set_current: bool,
) -> ProjectDemandVersion:
    """追加一个需求版本；`set_current` 或「项目首版」时置为当前版并回写投影。

    ★ 顺序很重要：先以 is_current=0 插入并 flush，再清旧当前版、最后置新当前版 ——
      部分唯一索引 `uq_demand_version_current` 在每条语句后校验，顺序错了会撞唯一约束。
    ★ flush 不能省：sessionmaker(autoflush=False)，不 flush 的话后面的 SELECT 看不到新行。
    """
    versions = _versions_of(db, project_id)
    next_seq = (versions[0].seq + 1) if versions else 1
    ver = ProjectDemandVersion(
        project_id=project_id,
        seq=next_seq,
        version_no=(version_no or "").strip() or _suggest_version_no(versions),
        label=(label or "").strip() or ("初始版" if not versions else "手工录入"),
        demand=demand_json,
        source=source,
        effective_date=effective_date,
        note=note,
        is_current=False,
    )
    db.add(ver)
    db.flush()

    # 项目首版强制为当前版，否则不允许出现「有版本但没有当前版」的项目
    if set_current or not versions:
        db.execute(
            update(ProjectDemandVersion)
            .where(
                ProjectDemandVersion.project_id == project_id,
                ProjectDemandVersion.is_current.is_(True),
                ProjectDemandVersion.id != ver.id,
            )
            .values(is_current=False)
        )
        ver.is_current = True

    db.commit()
    db.refresh(ver)

    if ver.is_current:
        _write_demand_projection(db, project_id, demand_json)
    return ver


def _write_demand_projection(db: Session, project_id: int, demand_json: str | None) -> None:
    """把当前版需求回写到 `project_supply_relations.demand`（兼容层 / 投影副本）。

    版本表是唯一真相源，这里只是让既有消费方（供需首页聚合、物料弹窗、库存信号塔
    按 BOM 折算、Excel 导入、需求折线）无需改动即可继续读到「当前版」。
    """
    db.execute(
        update(ProjectSupplyRelation)
        .where(ProjectSupplyRelation.project_id == project_id)
        .values(demand=demand_json)
    )
    db.commit()


def _ensure_current_version(db: Session, project_id: int) -> None:
    """兜底：保证项目存在当前版（老数据迁移后仍可能为空 —— 不造假数据，直接跳过）。"""
    current = db.execute(
        select(ProjectDemandVersion).where(
            ProjectDemandVersion.project_id == project_id,
            ProjectDemandVersion.is_current.is_(True),
        )
    ).scalars().first()
    if current is not None:
        return
    fallback = db.execute(
        select(ProjectDemandVersion)
        .where(ProjectDemandVersion.project_id == project_id)
        .order_by(ProjectDemandVersion.seq.desc())
    ).scalars().first()
    if fallback is not None:
        fallback.is_current = True
        db.commit()


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
    # Project 只声明了 supply_links 一条 ORM relationship，share_records / inventory_plans
    # 都没有级联；SQLite 外键虽已开启，也依赖 ondelete 声明与表定义一致。这里显式清理，
    # 避免留下孤儿行 —— 孤儿行的 project_id 会被 rowid 复用，让「新建项目」静默继承旧数据。
    plan_ids = list(
        db.execute(select(InventoryPlan.id).where(InventoryPlan.project_id == project_id)).scalars().all()
    )
    if plan_ids:
        db.execute(delete(InventoryDay).where(InventoryDay.plan_id.in_(plan_ids)))
        db.execute(delete(InventoryPlan).where(InventoryPlan.id.in_(plan_ids)))
    db.execute(delete(ShareRecord).where(ShareRecord.project_id == project_id))
    # 客户需求版本链（只增不改，但项目都没了就一起清，避免孤儿行被新项目复用 project_id 时继承）
    db.execute(delete(ProjectDemandVersion).where(ProjectDemandVersion.project_id == project_id))

    # ★ 记录本项目挂载过的供应关系，供删项目后清理孤儿主数据（L2/L1）。
    #   必须在 db.delete(project) 之前取，级联删掉 project_supply_relations 后就查不到了。
    affected_relation_ids = set(
        db.execute(
            select(ProjectSupplyRelation.supply_relation_id).where(
                ProjectSupplyRelation.project_id == project_id
            )
        ).scalars().all()
    )

    db.delete(project)  # 级联删除 project_supply_relations
    db.flush()  # 先落库级联删除，后续「是否仍被引用」的判定才准确

    _purge_orphan_master_data(db, affected_relation_ids)
    db.commit()


def _purge_orphan_master_data(db: Session, relation_ids: set[int]) -> None:
    """清理删项目后变成孤儿的主数据（L2 供应关系 / L1 物料 / L1 供应商）。

    严格按「是否还有其他项目引用」判定，**绝不删除仍被任何项目使用的主数据**。
    - L2：删掉的项目的明细已清空后，若某供应关系已无任何 project_supply_relations 引用，
          则该关系是孤儿，删除（其 share_records 由 ORM 级联一并清理）。
    - L1 物料：删完孤儿关系后，若某物料已无任何 supply_relations，且不被 inventory_plans /
              changes 引用，则删除（避免误伤库存档案 / 变更单）。
    - L1 供应商：同理，且额外检查 inventory_plans 引用（suppliers 删除有 409 保护，这里同口径）。
    """
    if not relation_ids:
        return

    # --- L2：筛选出已无任何项目引用的供应关系 ---
    orphan_rel_ids: list[int] = []
    for rel_id in relation_ids:
        still_referenced = db.execute(
            select(func.count()).select_from(ProjectSupplyRelation).where(
                ProjectSupplyRelation.supply_relation_id == rel_id
            )
        ).scalar_one()
        if still_referenced == 0:
            orphan_rel_ids.append(rel_id)

    if not orphan_rel_ids:
        return

    # 收集这些孤儿关系涉及的物料 / 供应商，删除后再分别判定是否还有其他关系在用
    orphan_candidates = db.execute(
        select(SupplyRelation.material_id, SupplyRelation.supplier_id).where(
            SupplyRelation.id.in_(orphan_rel_ids)
        )
    ).all()

    # 删除孤儿供应关系（share_records 走 ORM relationship 级联）
    for rel in db.execute(select(SupplyRelation).where(SupplyRelation.id.in_(orphan_rel_ids))).scalars().all():
        db.delete(rel)
    db.flush()

    material_ids = {m for m, _ in orphan_candidates}
    supplier_ids = {s for _, s in orphan_candidates}

    # --- L1 物料：无任何供应关系，且不被库存档案 / 变更单引用才删 ---
    for material_id in material_ids:
        rel_count = db.execute(
            select(func.count()).select_from(SupplyRelation).where(SupplyRelation.material_id == material_id)
        ).scalar_one()
        if rel_count:
            continue
        plan_count = db.execute(
            select(func.count()).select_from(InventoryPlan).where(InventoryPlan.material_id == material_id)
        ).scalar_one()
        if plan_count:
            continue
        change_count = db.execute(
            select(func.count()).select_from(Change).where(Change.material_id == material_id)
        ).scalar_one()
        if change_count:
            continue
        material = db.get(Material, material_id)
        if material is not None:
            db.delete(material)

    # --- L1 供应商：无任何供应关系，且不被库存档案引用才删 ---
    for supplier_id in supplier_ids:
        rel_count = db.execute(
            select(func.count()).select_from(SupplyRelation).where(SupplyRelation.supplier_id == supplier_id)
        ).scalar_one()
        if rel_count:
            continue
        plan_count = db.execute(
            select(func.count()).select_from(InventoryPlan).where(InventoryPlan.supplier_id == supplier_id)
        ).scalar_one()
        if plan_count:
            continue
        supplier = db.get(Supplier, supplier_id)
        if supplier is not None:
            db.delete(supplier)


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
    """底表一行式录入：PN/物料名称/供应商名称/供应商代码 → 自动建主数据 → 挂载到项目。

    ★ 关于全局主数据名称（2026-10-14 事故修复）：
    物料按 PN、供应商按 code 是**全项目共用的一条**，项目只是引用它。
    早期实现只要名称不一致就无条件改名，结果 Excel 批量导入 EP1 时把共用的「191 模组侧板」
    改成了「CCS」，LFP3 页面上显示的 191 名称跟着变 —— 用户视角就是"我导 EP1，LFP3 自己变了"。
    现在由 `sync_master_names` 控制：批量导入传 False（只复用、绝不改名），手动快速录入默认 True。
    """
    _get_project(db, project_id)

    # 1. 物料：按 pn 查找，不存在则创建
    material = db.execute(select(Material).where(Material.pn == payload.pn)).scalars().first()
    if material is None:
        material = Material(pn=payload.pn, name=payload.material_name)
        db.add(material)
        db.flush()
    elif payload.sync_master_names and material.name != payload.material_name:
        material.name = payload.material_name  # 同步最新物料名称（**会改到所有引用该物料的项目**，故仅手动录入允许）
        db.flush()

    # 2. 供应商：按 code 查找（兜底按名称），不存在则创建
    supplier = db.execute(select(Supplier).where(Supplier.code == payload.supplier_code)).scalars().first()
    if supplier is None:
        supplier = db.execute(select(Supplier).where(Supplier.name == payload.supplier_name)).scalars().first()
    if supplier is None:
        supplier = Supplier(code=payload.supplier_code, name=payload.supplier_name)
        db.add(supplier)
        db.flush()
    elif payload.sync_master_names and supplier.name != payload.supplier_name:
        supplier.name = payload.supplier_name  # 同上：仅手动录入才允许改全局主数据
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

    data = payload.model_dump(exclude={"pn", "material_name", "supplier_name", "supplier_code", "sync_master_names"})
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

    ★ 2026-10-16 起语义升级为「**生成新版本 + 设为当前版**」（需求版本化）：
      - 不再就地覆盖 —— 每次保存追加一条完整 12 月快照，历史版本永久保留；
      - 当前版随 12 月数据一起，投影回写到该项目各供应明细行的 `demand` 字段，
        因此老调用方（前端保存按钮、Excel 导入）无需改动即可继续工作；
      - 可选的 `version_no / label / effective_date / source` 用于把版本信息一起带进来，
        不传则由服务端按「上一版 +0.1」自动生成。
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

    _demand_version_create(
        db,
        project_id,
        demand_json=_list_to_json(payload.demand),
        version_no=payload.version_no,
        label=payload.label,
        source=payload.source,
        effective_date=payload.effective_date,
        note=None,
        set_current=True,
    )

    stmt = select(ProjectSupplyRelation).options(*_LINK_LOAD).where(
        ProjectSupplyRelation.project_id == project_id,
    )
    updated = db.execute(stmt).scalars().all()
    return [_link_to_read(l) for l in updated]


# --------------------------------------------------------------------------- #
#  客户需求版本链（只增不改）                                                    #
# --------------------------------------------------------------------------- #


@router.get(
    "/demand-version-summary",
    response_model=list[ProjectDemandVersionSummary],
    summary="各项目的需求版本摘要（首页项目卡片 / 客户需求区块用，一次拿全部）",
)
def demand_version_summary(
    db: Session = Depends(get_db),
    project_ids: Optional[str] = Query(None, description="逗号分隔的项目 ID；不传 = 全部项目"),
) -> list[ProjectDemandVersionSummary]:
    """首页多项目同屏，逐项目拉版本列表会有 N 次请求，故提供批量摘要。

    没有版本的项目也会出现在结果里（`version_count = 0`），
    前端据此渲染「尚未录入需求」的空态，而不是当成接口失败。
    """
    if project_ids:
        ids = [int(x) for x in project_ids.split(",") if x.strip().lstrip("-").isdigit()]
        if not ids:
            return []
    else:
        ids = list(db.execute(select(Project.id).order_by(Project.id)).scalars().all())
    if not ids:
        return []

    rows = db.execute(
        select(ProjectDemandVersion)
        .where(ProjectDemandVersion.project_id.in_(ids))
        .order_by(ProjectDemandVersion.project_id, ProjectDemandVersion.seq.desc())
    ).scalars().all()
    grouped: dict[int, list[ProjectDemandVersion]] = {}
    for v in rows:
        grouped.setdefault(v.project_id, []).append(v)  # 已按 seq 倒序

    out: list[ProjectDemandVersionSummary] = []
    for pid in ids:
        vers = grouped.get(pid, [])
        if not vers:
            out.append(ProjectDemandVersionSummary(project_id=pid, version_count=0))
            continue
        current = next((v for v in vers if v.is_current), vers[0])  # 兜底取最新一版
        prev = next((v for v in vers if v.seq < current.seq), None)
        cur_total = round(sum(_json_to_list(current.demand) or []), 2)
        prev_total = round(sum(_json_to_list(prev.demand) or []), 2) if prev else None
        delta = round(cur_total - prev_total, 2) if prev_total is not None else None
        delta_pct = (
            round(delta / prev_total * 100, 2)
            if (delta is not None and prev_total)
            else None
        )
        out.append(
            ProjectDemandVersionSummary(
                project_id=pid,
                version_count=len(vers),
                current_version_no=current.version_no,
                current_label=current.label,
                current_effective_date=current.effective_date,
                current_year_total=cur_total,
                prev_year_total=prev_total,
                delta=delta,
                delta_pct=delta_pct,
            )
        )
    return out


@router.get(
    "/{project_id}/demand-versions",
    response_model=list[DemandVersionRead],
    summary="查询项目的客户需求版本链（新版在前）",
)
def list_demand_versions(project_id: int, db: Session = Depends(get_db)) -> list[DemandVersionRead]:
    _get_project(db, project_id)
    _ensure_current_version(db, project_id)
    return [_version_to_read(v) for v in _versions_of(db, project_id)]


@router.post(
    "/{project_id}/demand-versions",
    response_model=DemandVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="新建一个客户需求版本（只增不改；首版自动成为当前版）",
)
def create_demand_version(
    project_id: int, payload: DemandVersionCreate, db: Session = Depends(get_db)
) -> DemandVersionRead:
    _get_project(db, project_id)
    ver = _demand_version_create(
        db,
        project_id,
        demand_json=_list_to_json(payload.demand),
        version_no=payload.version_no,
        label=payload.label,
        source=payload.source,
        effective_date=payload.effective_date,
        note=payload.note,
        set_current=payload.set_current,
    )
    return _version_to_read(ver)


@router.post(
    "/{project_id}/demand-versions/{version_id}/set-current",
    response_model=DemandVersionRead,
    summary="把某个客户需求版本设为当前版（全站供需计算随之切换）",
)
def set_current_demand_version(
    project_id: int, version_id: int, db: Session = Depends(get_db)
) -> DemandVersionRead:
    _get_project(db, project_id)
    ver = db.execute(
        select(ProjectDemandVersion).where(
            ProjectDemandVersion.id == version_id,
            ProjectDemandVersion.project_id == project_id,
        )
    ).scalars().first()
    if ver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"需求版本 {version_id} 不存在")

    if ver.is_current:
        return _version_to_read(ver)

    # ★ 先清旧当前版，再置新当前版 —— 部分唯一索引逐语句校验，顺序反了会撞约束
    db.execute(
        update(ProjectDemandVersion)
        .where(
            ProjectDemandVersion.project_id == project_id,
            ProjectDemandVersion.is_current.is_(True),
        )
        .values(is_current=False)
    )
    ver.is_current = True
    db.commit()
    db.refresh(ver)

    # 切换当前版 = 切换全站口径，同步把投影回写
    _write_demand_projection(db, project_id, ver.demand)
    return _version_to_read(ver)


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


# --------------------------------------------------------------------------- #
#  供需管理 Excel 导入模板                                                      #
# --------------------------------------------------------------------------- #
#
# 与「供应商列表」的四元组模板**职责不同**：
#   · 供应商列表模板 = 建关系（PN · 物料名 · 供应商名 · 供应商代码），建 L1/L2 主数据并挂载
#   · 本模板       = 录数值（需求 · BOM · 产能），只写项目明细（L3）扩展字段，
#                    **不会新建物料-供应商关系**——关系不存在时导入会报错跳过。
#
# 两个 sheet：
#   `客户需求`        项目代码 | 1月 … 12月 | 版本号 | 版本说明 | 生效日期
#                     （项目级，一行一个项目；末尾三列可选，留空由服务端自动编号）
#   `物料BOM与产能`   项目代码 | 物料PN | 物料名称 | BOM系数 | 供应商代码 | 供应商名称 |
#                     产能_1月 … 产能_12月            （一行 = 项目×物料×供应商）
#
# ★ 2026-10-16 需求版本化后：「客户需求」sheet 的导入语义已从「覆盖」升级为
#   「生成新版本 + 设为当前版」，末尾三列用于给这一版打标签。

_DEMAND_TEMPLATE_MONTHS = [f"{i}月" for i in range(1, 13)]


@router.get("/demand-import-template", summary="下载供需管理 Excel 导入模板（客户需求 + 物料BOM与产能）")
def demand_import_template() -> Response:
    """给同事填的**空白 Excel**，列名与前端导入解析规则一字不差。

    示例行故意用了**不存在的项目代码**（PRJ-示例），万一被误导入也只会报「找不到项目」
    并跳过，不会往库里写脏数据。填写时直接删掉灰色示例行即可。
    """
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")

    wb = openpyxl.Workbook()
    head_fill = PatternFill("solid", fgColor="F1EFE8")
    head_font = Font(bold=True, size=10)
    demo_font = Font(color="9A9A94", size=10, italic=True)
    note_font = Font(size=9, color="9A9A94")
    center = Alignment(horizontal="center", vertical="center")

    # ---- sheet 1：客户需求（项目级 · 1-12 月）----
    # 末尾三列是**需求版本化**（2026-10-16）新增的可选元信息：留空则由服务端自动编号。
    # 导入语义已升级为「生成新版本」，不再覆盖当前需求。
    ws1 = wb.active
    ws1.title = "客户需求"
    cols1 = ["项目代码", *_DEMAND_TEMPLATE_MONTHS, "版本号", "版本说明", "生效日期"]
    for i, label in enumerate(cols1, start=1):
        cell = ws1.cell(row=1, column=i, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = center
    demo1 = ["PRJ-示例", 500, 600, 550, 500, 480, 500, 520, 560, 700, 800, 780, 900,
             "1.0", "初始版 / 客户 FY26 预测", "2026-06-01"]
    for i, val in enumerate(demo1, start=1):
        ws1.cell(row=2, column=i, value=val).font = demo_font
    ws1.cell(
        row=4, column=1,
        value="填写说明：① 一行 = 一个项目；项目代码必须是系统里已存在的（见「供应商列表 · 项目」）。"
              "② 1-12 月填客户需求量，留空 = 0。③ 需求是项目级数据，录一次自动同步到该项目下所有物料明细行。"
              "④ 末尾三列（版本号 / 版本说明 / 生效日期）可留空 —— 留空由系统自动编号；"
              "【重要】导入不会覆盖现有需求，而是**生成一个新的版本**并置为当前版，历史版本永久保留。"
              "⑤ 灰色示例行务必删除。",
    ).font = note_font
    ws1.column_dimensions["A"].width = 16
    for i in range(2, 14):
        ws1.column_dimensions[get_column_letter(i)].width = 9
    known = [("N", 10), ("O", 26), ("P", 13)]
    for col, w in known:
        ws1.column_dimensions[col].width = w
    ws1.freeze_panes = "B2"

    # ---- sheet 2：物料BOM与产能（项目 × 物料 × 供应商）----
    ws2 = wb.create_sheet("物料BOM与产能")
    cols2 = ["项目代码", "物料PN", "物料名称", "BOM系数", "供应商代码", "供应商名称", *(f"产能_{m}" for m in _DEMAND_TEMPLATE_MONTHS)]
    for i, label in enumerate(cols2, start=1):
        cell = ws2.cell(row=1, column=i, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = center
    demo2 = ["PRJ-示例", "110205-00031", "车规级 MCU 主控芯片", 2, "SUP-001", "示例供应商",
             3000, 3200, 3000, 2800, 2600, 2800, 2900, 3100, 3600, 4000, 4200, 4500]
    for i, val in enumerate(demo2, start=1):
        ws2.cell(row=2, column=i, value=val).font = demo_font
    ws2.cell(
        row=4, column=1,
        value="填写说明：① 一行 = 一个「项目 × 物料 × 供应商」，即一条已有的供应明细。"
              "② 项目代码 / 物料PN / 供应商代码（以及该物料-供应商关系）必须已存在，否则该行报错跳过。"
              "③ BOM系数 = 1 台产品需要几个该物料；同一项目同一物料的各行请填相同值。"
              "④ 产能_1月 … 产能_12月 = 该供应商该物料的月度产能，留空 = 0。⑤ 灰色示例行务必删除。",
    ).font = note_font
    for col, w in zip(["A", "B", "C", "D", "E", "F"], [16, 16, 24, 10, 14, 20]):
        ws2.column_dimensions[col].width = w
    for i in range(7, 19):
        ws2.column_dimensions[get_column_letter(i)].width = 9
    ws2.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = "supply-demand-import-template.xlsx"
    from urllib.parse import quote

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
        },
    )
