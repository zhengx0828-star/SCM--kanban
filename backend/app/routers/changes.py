"""变更管理路由（过程数据层）。

口径见 `docs/changes-redesign/02-方案定稿-v0.2.md`。

三个 router（分开是为了避开 FastAPI 路径参数冲突）：
  - `router`      /api/changes/*        变更单 + 聚合 + 归档 + 导入导出
  - `task_router` /api/change-tasks/*   任务级操作（PATCH / DELETE / toggle）
  - `type_router` /api/change-types/*   变更类型字典

⚠️ 路由注册顺序（沿用既有文件的注意点）：
  `/api/changes/{change_id}` 是 int 参数路由，所有**字面量**子路径
  （summary / project-overview / alerts / burndown / owners / archives / import / export）
  必须写在本文件里 `/{change_id}` 之前 —— 否则 `/api/changes/summary` 会被
  当成 id 解析并返回 422。下面代码已按此顺序排列，改动时请勿打乱。

核心设计（★ 与其它模块最大的不同）：
  - 任务没有 status 字段。五色状态（todo/soon/overdue/done/late）全部由
    `plan_end + is_done + done_at + 今天` 推导 —— 时间是自动的标尺，勾选是人给的答案。
  - 进度不落库。完成率 = 已完叶子 ÷ 叶子总数；时间进度 = 已过时长比例；
    **偏差 = 时间进度 − 完成率**，这才是本模块真正要看的数。
"""

from __future__ import annotations

import io
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Change, ChangeArchive, ChangeTask, ChangeType, Material, Project, Supplier
from ..schemas import (
    MAX_TASK_LEVEL,
    NEAR_DUE_DAYS,
    ChangeAlertItem,
    ChangeArchiveRead,
    ChangeBurndown,
    ChangeCreate,
    ChangeDetail,
    ChangeImportResult,
    ChangeList,
    ChangeProjectOverview,
    ChangeRead,
    ChangeSummary,
    ChangeTaskBatchCreate,
    ChangeTaskCreate,
    ChangeTaskNode,
    ChangeTaskToggle,
    ChangeTaskUpdate,
    ChangeTypeCount,
    ChangeTypeCreate,
    ChangeTypeRead,
    ChangeTypeUpdate,
    ChangeUrgentBrief,
    ChangeUpdate,
    BurndownPoint,
    OverdueBucket,
    TaskStateCount,
)

router = APIRouter(prefix="/api/changes", tags=["Changes"])
task_router = APIRouter(prefix="/api/change-tasks", tags=["Change Tasks"])
type_router = APIRouter(prefix="/api/change-types", tags=["Change Types"])


# ===========================================================================
# 工具函数
# ===========================================================================


def _today() -> date:
    return date.today()


# 五色任务构成的固定输出顺序（含 0 值也输出，前端据此画堆叠条）
_TASK_STATE_ORDER: list[tuple[str, str]] = [
    ("todo", "进行中"),
    ("soon", "临期"),
    ("overdue", "超期未完成"),
    ("done", "按时完成"),
    ("late", "迟交完成"),
]

# 超期时长分档（左闭右开，末档无上界）—— 首页「超期深度」
_OVERDUE_BUCKETS: list[tuple[str, int, Optional[int]]] = [
    ("1-3 天", 1, 3),
    ("4-7 天", 4, 7),
    ("8-14 天", 8, 14),
    ("> 14 天", 15, None),
]


def _overdue_bucket(days: int) -> str:
    """超期天数 → 分档标签。越界统一落到首档，保证返回值一定命中 _OVERDUE_BUCKETS。"""
    for label, lo, hi in _OVERDUE_BUCKETS:
        if days >= lo and (hi is None or days <= hi):
            return label
    return _OVERDUE_BUCKETS[0][0]


def _task_state(
    plan_end: Optional[date], is_done: bool, done_at: Optional[datetime], today: date
) -> tuple[str, int, int]:
    """推导任务五色状态。

    返回 (state, overdue_days, late_days)：
      - late    已完成，但完成日 > 计划完成日（复盘用，不算"待处理"）
      - done    已完成且按时
      - overdue 未完成且已过期（红）
      - soon    未完成且距计划完成 ≤ 3 天（黄）
      - todo    未到期（蓝）
    """
    if is_done:
        done_day = done_at.date() if done_at else None
        if done_day and plan_end and done_day > plan_end:
            return "late", 0, (done_day - plan_end).days
        return "done", 0, 0
    if plan_end is None:
        return "todo", 0, 0
    if plan_end < today:
        return "overdue", (today - plan_end).days, 0
    if (plan_end - today).days <= NEAR_DUE_DAYS:
        return "soon", 0, 0
    return "todo", 0, 0


def _leaf_tasks(tasks: list[ChangeTask]) -> list[ChangeTask]:
    """叶子 = 没有子节点的任务。所有统计只数叶子（父项不重复计入）。"""
    parent_ids = {t.parent_id for t in tasks if t.parent_id is not None}
    return [t for t in tasks if t.id not in parent_ids]


def _time_rate(start: Optional[date], end: Optional[date], today: date, chg_status: str) -> float:
    """时间进度（自动的标尺）：已过时长 ÷ 总时长 × 100，夹在 0~100。"""
    if chg_status == "done":
        return 100.0
    if chg_status == "voided":
        return 0.0
    if not start or not end:
        return 0.0
    span = (end - start).days
    if span <= 0:
        return 100.0 if today >= end else 0.0
    passed = (today - start).days
    return round(min(max(passed * 100.0 / span, 0.0), 100.0), 1)


def _load_tasks_map(db: Session, change_ids: list[int]) -> dict[int, list[ChangeTask]]:
    """一次把多张变更单的任务全捞回来，避免 N+1。"""
    if not change_ids:
        return {}
    rows = (
        db.execute(
            select(ChangeTask)
            .where(ChangeTask.change_id.in_(change_ids), ChangeTask.is_removed.is_(False))
            .order_by(ChangeTask.level, ChangeTask.seq, ChangeTask.id)
        )
        .scalars()
        .all()
    )
    out: dict[int, list[ChangeTask]] = {}
    for t in rows:
        out.setdefault(t.change_id, []).append(t)
    return out


def _sync_status_from_tasks(
    db: Session, change: Change, leaves: Optional[list[ChangeTask]] = None
) -> None:
    """把「叶子任务的完成事实」同步成「单子状态」—— 只在 进行中 ⇄ 已完成 之间往返。

    为什么单靠 `auto_complete`（只在勾选那一刻评估）不够，实测踩到两个真实缺口：
      1. **假完成**：单子里当时只有一个任务，勾上 → 立刻 done；随后又加了新任务，
         状态却停在 done —— 加完任务就变"已完成"的单子显然是错的。
      2. **假未完成**：把最后一条没做完的任务删掉 → 叶子全完成，状态不会自己变成 done。

    规则（单一事实来源 = 叶子任务）：
      - 有叶子 且 全部已勾 → done，`completed_at` = 最后一次勾选的时刻
      - 有叶子 且 存在未勾 → active
      - 一个叶子都没有 → 不改（保留用户手动设置的状态，避免空单被反复翻状态）

    **作废单 / 归档单不动**：它们的状态不再随任务变化（归档单本就只读）。
    """
    if change.status == "voided" or change.archived_at is not None:
        return
    if leaves is None:
        leaves = _leaf_tasks(
            db.execute(
                select(ChangeTask).where(
                    ChangeTask.change_id == change.id, ChangeTask.is_removed.is_(False)
                )
            )
            .scalars()
            .all()
        )
    if not leaves:
        return
    if all(t.is_done for t in leaves):
        if change.status == "active":
            change.status = "done"
            done_times = [t.done_at for t in leaves if t.done_at]
            change.completed_at = max(done_times) if done_times else datetime.now()
    elif change.status == "done":
        change.status = "active"
        change.completed_at = None


def _refresh_change_summary(db: Session, change: Change) -> None:
    """从叶子任务回写 `plan_start / plan_end`，并同步单子状态。

    - `plan_start/plan_end` 是冗余汇总字段，供列表排序与卡片预警使用。
    - 状态同步见 `_sync_status_from_tasks`：任务事实变了，单子状态就跟着走
      （勾完自动完成 / 加回未完成任务自动恢复进行中）。
    """
    tasks = (
        db.execute(
            select(ChangeTask).where(ChangeTask.change_id == change.id, ChangeTask.is_removed.is_(False))
        )
        .scalars()
        .all()
    )
    leaves = _leaf_tasks(list(tasks))
    starts = [t.plan_start for t in leaves if t.plan_start]
    ends = [t.plan_end for t in leaves if t.plan_end]
    change.plan_start = min(starts) if starts else None
    change.plan_end = max(ends) if ends else None
    _sync_status_from_tasks(db, change, leaves)


def _get_change_or_404(db: Session, change_id: int) -> Change:
    change = db.get(Change, change_id)
    if change is None or change.is_removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"变更单 {change_id} 不存在")
    return change


def _ensure_editable(change: Change) -> None:
    """归档后只读（用户确认：归档 = 冻结，要改先取消归档）。"""
    if change.archived_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"变更单 {change.id} 已归档，需先取消归档才能修改",
        )


def _to_change_read(change: Change, tasks: list[ChangeTask], today: date) -> ChangeRead:
    """组装单张变更单的响应（含全部派生指标）。"""
    leaves = _leaf_tasks(tasks)
    leaf_total = len(leaves)
    leaf_done = sum(1 for t in leaves if t.is_done)
    overdue = near = late = 0
    for t in leaves:
        st, _od, _ld = _task_state(t.plan_end, t.is_done, t.done_at, today)
        if st == "overdue":
            overdue += 1
        elif st == "soon":
            near += 1
        elif st == "late":
            late += 1

    done_rate = round(leaf_done * 100.0 / leaf_total, 1) if leaf_total else 0.0
    time_rate = _time_rate(change.plan_start, change.plan_end, today, change.status)
    overdue_days = (
        (today - change.plan_end).days
        if (change.plan_end and change.status == "active" and change.plan_end < today)
        else 0
    )
    days_left = (change.plan_end - today).days if change.plan_end else None

    return ChangeRead(
        id=change.id,
        project_id=change.project_id,
        project_code=change.project.code if change.project else "",
        project_name=change.project.name if change.project else "",
        material_id=change.material_id,
        material_pn=change.material.pn if change.material else "",
        material_name=change.material.name if change.material else "",
        change_type_id=change.change_type_id,
        change_type_name=change.change_type.name if change.change_type else "",
        supplier_id=change.supplier_id,
        supplier_name=change.supplier.name if change.supplier else None,
        title=change.title,
        description=change.description,
        owner=change.owner,
        status=change.status,  # type: ignore[arg-type]
        plan_start=change.plan_start,
        plan_end=change.plan_end,
        completed_at=change.completed_at,
        archived_at=change.archived_at,
        remark=change.remark,
        created_at=change.created_at,
        updated_at=change.updated_at,
        leaf_total=leaf_total,
        leaf_done=leaf_done,
        done_rate=done_rate,
        time_rate=time_rate,
        deviation=round(time_rate - done_rate, 1),
        overdue_leaf=overdue,
        near_leaf=near,
        late_leaf=late,
        overdue_days=overdue_days,
        days_left=days_left,
        is_archived=change.archived_at is not None,
    )


def _build_task_tree(
    change: Change, tasks: list[ChangeTask], today: date
) -> list[ChangeTaskNode]:
    """把扁平任务列表拼成树，并算好每个节点的派生状态与叶子统计。"""
    nodes: dict[int, ChangeTaskNode] = {}
    ordered = sorted(tasks, key=lambda t: (t.level, t.seq, t.id))
    for t in ordered:
        owner = t.owner or change.owner
        st, od, ld = _task_state(t.plan_end, t.is_done, t.done_at, today)
        nodes[t.id] = ChangeTaskNode(
            id=t.id,
            change_id=t.change_id,
            parent_id=t.parent_id,
            level=t.level,
            seq=t.seq,
            name=t.name,
            description=t.description,
            owner=owner,
            plan_start=t.plan_start,
            plan_end=t.plan_end,
            is_done=t.is_done,
            done_at=t.done_at,
            remark=t.remark,
            state=st,  # type: ignore[arg-type]
            overdue_days=od,
            late_days=ld,
            leaf_total=0,
            leaf_done=0,
            children=[],
        )

    roots: list[ChangeTaskNode] = []
    for t in ordered:
        node = nodes[t.id]
        parent = nodes.get(t.parent_id) if t.parent_id else None
        if parent is None:
            roots.append(node)
        else:
            parent.children.append(node)

    def aggregate(node: ChangeTaskNode) -> tuple[int, int]:
        if not node.children:
            node.leaf_total = 1
            node.leaf_done = 1 if node.is_done else 0
            return node.leaf_total, node.leaf_done
        total = done = 0
        for child in node.children:
            c_total, c_done = aggregate(child)
            total += c_total
            done += c_done
        node.leaf_total = total
        node.leaf_done = done
        # 有子项的父项：子项全勾 → 父项显示已勾（白名单式自动汇总）
        if total and done == total:
            node.is_done = True
        return total, done

    for root in roots:
        aggregate(root)
    return roots


def _flatten_ids(node: ChangeTaskNode) -> list[int]:
    ids = [node.id]
    for child in node.children:
        ids.extend(_flatten_ids(child))
    return ids


# ===========================================================================
# 变更类型字典（全局，一次维护所有项目共用）
# ===========================================================================


def _type_usage_counts(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(Change.change_type_id, func.count())
        .where(Change.is_removed.is_(False))
        .group_by(Change.change_type_id)
    ).all()
    return {int(tid): int(cnt) for tid, cnt in rows}


def _to_type_read(t: ChangeType, usage: dict[int, int]) -> ChangeTypeRead:
    return ChangeTypeRead(
        id=t.id,
        name=t.name,
        sort_order=t.sort_order,
        is_active=t.is_active,
        remark=t.remark,
        usage_count=usage.get(t.id, 0),
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


@type_router.get("", response_model=list[ChangeTypeRead], summary="变更类型列表")
def list_change_types(
    include_inactive: bool = Query(True, description="是否包含已停用类型"),
    db: Session = Depends(get_db),
) -> list[ChangeTypeRead]:
    """返回**裸数组**（对齐 /api/suppliers 等既有非分页端点）。"""
    stmt = select(ChangeType).order_by(ChangeType.sort_order, ChangeType.id)
    if not include_inactive:
        stmt = stmt.where(ChangeType.is_active.is_(True))
    rows = db.execute(stmt).scalars().all()
    usage = _type_usage_counts(db)
    return [_to_type_read(t, usage) for t in rows]


@type_router.post("", response_model=ChangeTypeRead, status_code=status.HTTP_201_CREATED, summary="新增变更类型")
def create_change_type(payload: ChangeTypeCreate, db: Session = Depends(get_db)) -> ChangeTypeRead:
    name = payload.name.strip()
    exists = db.execute(select(ChangeType).where(ChangeType.name == name)).scalars().first()
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"变更类型已存在：{name}")
    obj = ChangeType(
        name=name,
        sort_order=payload.sort_order,
        is_active=True,
        remark=payload.remark,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _to_type_read(obj, {})


@type_router.patch("/{type_id}", response_model=ChangeTypeRead, summary="修改变更类型")
def update_change_type(
    type_id: int, payload: ChangeTypeUpdate, db: Session = Depends(get_db)
) -> ChangeTypeRead:
    obj = db.get(ChangeType, type_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"变更类型 {type_id} 不存在")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        name = str(data["name"]).strip()
        dup = db.execute(
            select(ChangeType).where(ChangeType.name == name, ChangeType.id != type_id)
        ).scalars().first()
        if dup is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"变更类型已存在：{name}")
        data["name"] = name
    for key, value in data.items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return _to_type_read(obj, _type_usage_counts(db))


@type_router.delete("/{type_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除变更类型（仅零引用可删）")
def delete_change_type(type_id: int, db: Session = Depends(get_db)) -> Response:
    obj = db.get(ChangeType, type_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"变更类型 {type_id} 不存在")
    used = db.execute(
        select(func.count()).select_from(Change).where(Change.change_type_id == type_id)
    ).scalar_one()
    if used:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"类型「{obj.name}」仍被 {used} 张变更单引用，请改为「停用」而不是删除",
        )
    db.delete(obj)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===========================================================================
# 聚合端点（★ 必须注册在 /{change_id} 之前）
# ===========================================================================


def _load_changes(
    db: Session,
    *,
    include_archived: bool = False,
    project_ids: Optional[list[int]] = None,
) -> list[Change]:
    stmt = (
        select(Change)
        .options(
            joinedload(Change.project),
            joinedload(Change.material),
            joinedload(Change.change_type),
            joinedload(Change.supplier),
        )
        .where(Change.is_removed.is_(False))
    )
    if not include_archived:
        stmt = stmt.where(Change.archived_at.is_(None))
    if project_ids:
        stmt = stmt.where(Change.project_id.in_(project_ids))
    return list(db.execute(stmt).scalars().all())


@router.get("/summary", response_model=ChangeSummary, summary="变更全局统计（Dashboard 卡 5 同源）")
def change_summary(db: Session = Depends(get_db)) -> ChangeSummary:
    today = _today()
    changes = _load_changes(db, include_archived=True)
    active_changes = [c for c in changes if c.archived_at is None]
    # ★ 「变更总数」= 有效单（未归档 且 非作废）—— 2026-10-05 用户拍板。
    #   此前 total 含作废，而 type_counts / task_state_counts / overdue_* 都不含，
    #   只能靠统计卡 hint 与饼图结论各写一句「另有 N 张作废未计入」来兜底 ——
    #   同一屏两个数对不上，本质上是用文案掩盖口径不齐。改口径后四者同源。
    effective_changes = [c for c in active_changes if c.status != "voided"]
    tasks_map = _load_tasks_map(db, [c.id for c in active_changes])

    overdue_changes = near_changes = overdue_tasks = near_tasks = 0
    # ★ 以下三项是本轮（2026-10-06）为首页可视化新增，与上面的超期/临期**完全同源**：
    #   同一次叶子遍历里顺手计数，避免再开一遍循环导致口径漂移。
    state_counts: dict[str, int] = {s: 0 for s, _ in _TASK_STATE_ORDER}
    bucket_counts: dict[str, int] = {label: 0 for label, _lo, _hi in _OVERDUE_BUCKETS}
    # 「未指派」只数**未完成**的叶子（todo/soon/overdue）：已完成的事（done/late）
    # 谈不上"没人管"，算进来只会虚高分母。口径写进 docs/changes-redesign/04。
    unassigned_tasks = 0
    max_overdue_days = 0
    for c in active_changes:
        if c.status == "voided":
            continue
        leaves = _leaf_tasks(tasks_map.get(c.id, []))
        c_overdue = c_near = 0
        for t in leaves:
            st, od, _ld = _task_state(t.plan_end, t.is_done, t.done_at, today)
            state_counts[st] = state_counts.get(st, 0) + 1
            if st == "overdue":
                c_overdue += 1
                bucket_counts[_overdue_bucket(od)] += 1
                max_overdue_days = max(max_overdue_days, od)
            elif st == "soon":
                c_near += 1
            if st in ("todo", "soon", "overdue"):
                owner = t.owner or c.owner
                if not (owner and owner.strip()):
                    unassigned_tasks += 1
        overdue_tasks += c_overdue
        near_tasks += c_near
        if c_overdue:
            overdue_changes += 1
        elif c_near:
            near_changes += 1

    type_counts: dict[int, ChangeTypeCount] = {}
    for c in active_changes:
        if c.status == "voided":
            continue
        name = c.change_type.name if c.change_type else "未分类"
        item = type_counts.get(c.change_type_id)
        if item is None:
            type_counts[c.change_type_id] = ChangeTypeCount(
                change_type_id=c.change_type_id, type_name=name, count=1
            )
        else:
            item.count += 1

    return ChangeSummary(
        total=len(effective_changes),
        active=sum(1 for c in active_changes if c.status == "active"),
        done=sum(1 for c in active_changes if c.status == "done"),
        voided=sum(1 for c in active_changes if c.status == "voided"),
        archived=sum(1 for c in changes if c.archived_at is not None),
        overdue_changes=overdue_changes,
        overdue_tasks=overdue_tasks,
        near_changes=near_changes,
        near_tasks=near_tasks,
        # 项目 / 物料 / 类型三个计数**必须与 total 同一个集合**（effective_changes），
        # 否则统计卡会出现「7 张单、8 个物料」这种自相矛盾的同一屏。
        project_count=len({c.project_id for c in effective_changes}),
        material_count=len({c.material_id for c in effective_changes}),
        type_count=len({c.change_type_id for c in effective_changes}),
        type_counts=sorted(type_counts.values(), key=lambda x: (-x.count, x.type_name)),
        task_state_counts=[
            TaskStateCount(state=s, label=label, count=state_counts.get(s, 0))
            for s, label in _TASK_STATE_ORDER
        ],
        overdue_buckets=[OverdueBucket(label=label, count=bucket_counts.get(label, 0)) for label, _lo, _hi in _OVERDUE_BUCKETS],
        unassigned_tasks=unassigned_tasks,
        max_overdue_days=max_overdue_days,
    )


@router.get(
    "/project-overview",
    response_model=list[ChangeProjectOverview],
    summary="项目卡片墙数据（老板视角，按项目聚合）",
)
def change_project_overview(
    include_archived: bool = Query(False, description="是否包含已归档项目"),
    db: Session = Depends(get_db),
) -> list[ChangeProjectOverview]:
    """一个项目一行。返回**裸数组**。

    两种完成率都算（用户确认）：
      - task_done_rate   该项目所有叶子任务
      - change_done_rate 该项目变更单（已完成 ÷ 未作废）
    `most_urgent` = 超期最严重的那张单，供卡片上"最紧急一行"使用。
    """
    today = _today()
    changes = _load_changes(db, include_archived=True)
    if not changes:
        return []

    tasks_map = _load_tasks_map(db, [c.id for c in changes])
    buckets: dict[int, dict[str, Any]] = {}

    for c in changes:
        if c.archived_at is not None and not include_archived:
            continue
        b = buckets.setdefault(
            c.project_id,
            {
                "project": c.project,
                "total": 0,
                "active": 0,
                "done": 0,
                "voided": 0,
                "archived": 0,
                "overdue_changes": 0,
                "overdue_tasks": 0,
                "near_changes": 0,
                "near_tasks": 0,
                "leaf_total": 0,
                "leaf_done": 0,
                "time_rate_sum": 0.0,
                "rate_cnt": 0,
                "type_counts": {},
                "most_urgent": None,
            },
        )
        if c.archived_at is not None:
            b["archived"] += 1
            continue

        if c.status == "voided":
            # ★ 作废单不进 total（与 /summary 同口径：总数只算有效单，2026-10-05 拍板）。
            #   注意：不要在这里 continue 之前动 total，否则 total 会重新含作废，
            #   而下游 `total - voided` 的算法又会重复减一次 → 静默错数。
            b["voided"] += 1
            continue

        b["total"] += 1
        if c.status == "active":
            b["active"] += 1
        elif c.status == "done":
            b["done"] += 1

        leaves = _leaf_tasks(tasks_map.get(c.id, []))
        b["leaf_total"] += len(leaves)
        b["leaf_done"] += sum(1 for t in leaves if t.is_done)
        # 偏差榜用：按「单」平均时间进度（作废单上面已 continue 掉）
        b["time_rate_sum"] += _time_rate(c.plan_start, c.plan_end, today, c.status)
        b["rate_cnt"] += 1

        c_overdue = c_near = 0
        for t in leaves:
            st, _od, _ld = _task_state(t.plan_end, t.is_done, t.done_at, today)
            if st == "overdue":
                c_overdue += 1
            elif st == "soon":
                c_near += 1
        b["overdue_tasks"] += c_overdue
        b["near_tasks"] += c_near
        if c_overdue:
            b["overdue_changes"] += 1
        elif c_near:
            b["near_changes"] += 1

        tname = c.change_type.name if c.change_type else "未分类"
        entry = b["type_counts"].setdefault(c.change_type_id, {"name": tname, "count": 0})
        entry["count"] += 1

        # 最紧急：优先超期天数最大，其次超期叶子数最多
        cur = b["most_urgent"]
        cand_days = (
            (today - c.plan_end).days if (c.plan_end and c.status == "active" and c.plan_end < today) else 0
        )
        if c_overdue > 0 or c_near > 0:
            better = (
                cur is None
                or cand_days > cur.overdue_days
                or (cand_days == cur.overdue_days and c_overdue > cur.overdue_leaf)
            )
            if better:
                b["most_urgent"] = ChangeUrgentBrief(
                    change_id=c.id,
                    title=c.title,
                    owner=c.owner,
                    overdue_days=cand_days,
                    overdue_leaf=c_overdue,
                    material_pn=c.material.pn if c.material else "",
                )

    out: list[ChangeProjectOverview] = []
    for project_id, b in buckets.items():
        project: Optional[Project] = b["project"]
        task_rate = round(b["leaf_done"] * 100.0 / b["leaf_total"], 1) if b["leaf_total"] else 0.0
        # total 已不含作废，所以完成率直接除 total，**不要再减 voided**（会重复减）。
        change_rate = round(b["done"] * 100.0 / b["total"], 1) if b["total"] else 0.0
        # 偏差 = 时间进度 − 完成率，> 0 表示时间跑在人前面（滞后）
        avg_time_rate = round(b["time_rate_sum"] / b["rate_cnt"], 1) if b["rate_cnt"] else 0.0
        avg_deviation = round(avg_time_rate - task_rate, 1)
        type_items = [
            ChangeTypeCount(change_type_id=tid, type_name=info["name"], count=info["count"])
            for tid, info in b["type_counts"].items()
        ]
        out.append(
            ChangeProjectOverview(
                project_id=project_id,
                project_code=project.code if project else "",
                project_name=project.name if project else "",
                total=b["total"],
                active=b["active"],
                done=b["done"],
                voided=b["voided"],
                archived=b["archived"],
                # 未完成叶子任务数 = 叶子总数 − 已完成数（done + late 都算已完成）
                open_tasks=b["leaf_total"] - b["leaf_done"],
                overdue_changes=b["overdue_changes"],
                overdue_tasks=b["overdue_tasks"],
                near_changes=b["near_changes"],
                near_tasks=b["near_tasks"],
                task_done_rate=task_rate,
                change_done_rate=change_rate,
                avg_time_rate=avg_time_rate,
                avg_deviation=avg_deviation,
                type_counts=sorted(type_items, key=lambda x: (-x.count, x.type_name)),
                most_urgent=b["most_urgent"],
            )
        )

    # 默认按超期数降序 —— 有问题的项目自动浮到最前（老板视角的核心排序）
    out.sort(key=lambda x: (-x.overdue_changes, -x.overdue_tasks, -x.near_changes, x.project_code))
    return out


@router.get("/alerts", response_model=list[ChangeAlertItem], summary="预警明细（按严重度排序，必带责任人）")
def change_alerts(
    project_id: Optional[int] = Query(None, description="限定项目"),
    level: str = Query("", description="overdue / near / late / 空=全部（不含 late）"),
    db: Session = Depends(get_db),
) -> list[ChangeAlertItem]:
    """任务级预警清单。返回**裸数组**。

    排序：超期（天数降序）→ 临期（剩余天数升序）→ 迟交（迟交天数降序）。
    无责任人的行 `is_unassigned=True`，前端标灰提示。
    """
    today = _today()
    changes = _load_changes(db, project_ids=[project_id] if project_id else None)
    tasks_map = _load_tasks_map(db, [c.id for c in changes])
    want = {v for v in level.split(",") if v} if level else set()

    items: list[ChangeAlertItem] = []
    for c in changes:
        if c.status == "voided":
            continue
        for t in _leaf_tasks(tasks_map.get(c.id, [])):
            st, od, ld = _task_state(t.plan_end, t.is_done, t.done_at, today)
            if st == "overdue":
                lvl, days = "overdue", od
            elif st == "soon":
                lvl, days = "near", (t.plan_end - today).days if t.plan_end else 0
            elif st == "late":
                lvl, days = "late", ld
            else:
                continue
            if want and lvl not in want:
                continue
            owner = t.owner or c.owner
            items.append(
                ChangeAlertItem(
                    level=lvl,  # type: ignore[arg-type]
                    task_id=t.id,
                    task_name=t.name,
                    task_level=t.level,
                    change_id=c.id,
                    change_title=c.title,
                    project_id=c.project_id,
                    project_code=c.project.code if c.project else "",
                    project_name=c.project.name if c.project else "",
                    material_pn=c.material.pn if c.material else "",
                    material_name=c.material.name if c.material else "",
                    owner=owner,
                    is_unassigned=not bool(owner and owner.strip()),
                    plan_end=t.plan_end,
                    days=days,
                )
            )

    order = {"overdue": 0, "near": 1, "late": 2}
    items.sort(key=lambda x: (order[x.level], -x.days if x.level != "near" else x.days, x.change_id))
    return items


@router.get("/burndown", response_model=ChangeBurndown, summary="燃尽图数据（计划阶梯线 + 实际线）")
def change_burndown(
    change_id: Optional[int] = Query(None, description="单张变更单"),
    project_id: Optional[int] = Query(None, description="整个项目（合并燃尽）"),
    include_archived: bool = Query(False, description="全局口径下是否含已归档单（默认不含）"),
    db: Session = Depends(get_db),
) -> ChangeBurndown:
    """只依赖已录入的数据：计划线按各叶子 `plan_end` 阶梯下降，实际线按 `done_at` 累计。

    只数叶子（父项不重复计入）。**不推算、不补假点**。

    ★ 三个参数都不传 = **全局口径**（首页整体燃尽图），此时默认**排除归档单**：
      归档 = 项目做完冻结，混进来会让曲线在某天突然少掉一堆剩余，看起来像进度暴涨，
      那是假的。作废单在任何口径下都不参与（定稿 §4.2）。
      例外：显式传 `change_id` 时按该单原样统计（哪怕已归档），否则详情抽屉会画不出图。
    """
    load_archived = include_archived or change_id is not None
    changes = _load_changes(
        db,
        include_archived=load_archived,
        project_ids=[project_id] if project_id else None,
    )
    if change_id is not None:
        changes = [c for c in changes if c.id == change_id]
    tasks_map = _load_tasks_map(db, [c.id for c in changes])

    leaves: list[ChangeTask] = []
    for c in changes:
        if c.status == "voided":
            continue
        leaves.extend(_leaf_tasks(tasks_map.get(c.id, [])))

    if not leaves:
        return ChangeBurndown(total=0)

    today = _today()
    starts = [t.plan_start or t.plan_end for t in leaves if (t.plan_start or t.plan_end)]
    ends = [t.plan_end or t.plan_start for t in leaves if (t.plan_end or t.plan_start)]
    if not starts or not ends:
        return ChangeBurndown(total=len(leaves))
    start = min(starts)  # type: ignore[type-var]
    end = max(ends)  # type: ignore[type-var]
    if end < today:
        end = today

    total = len(leaves)
    # ★ 全局口径下跨度可能很大（当前 90 天，未来会更大）→ 超过 180 天改按周取样，
    #   避免一次吐出几百个点。步长回传前端，用于说明"按周取样"。
    step = 1 if (end - start).days <= 180 else 7
    points: list[BurndownPoint] = []

    def _at(d: date) -> BurndownPoint:
        plan_remaining = sum(1 for t in leaves if t.plan_end and t.plan_end > d)
        # ★ 实际线只画到今天为止：未来的日子没人真勾过任务，
        #   继续平着画出一条"永远完不成"的线属于推算，违反数据保真。
        actual = None if d > today else sum(
            1 for t in leaves if not (t.done_at and t.done_at.date() <= d)
        )
        return BurndownPoint(date=d, plan_remaining=plan_remaining, actual_remaining=actual)

    d = start
    while d <= end:
        points.append(_at(d))
        d += timedelta(days=step)
    # 按周取样时补齐末点，保证曲线终点 = 计划最后一天
    if points and points[-1].date != end:
        points.append(_at(end))
    return ChangeBurndown(total=total, start=start, end=end, step=step, points=points)


@router.get("/owners", response_model=list[str], summary="责任人候选（去重，供输入框软提示）")
def change_owners(db: Session = Depends(get_db)) -> list[str]:
    """自由文本责任的"最近用过的名字"，点一下即填 —— 不校验、不强制。"""
    rows_a = db.execute(
        select(Change.owner).where(Change.owner.is_not(None), Change.is_removed.is_(False))
    ).all()
    rows_b = db.execute(
        select(ChangeTask.owner).where(ChangeTask.owner.is_not(None), ChangeTask.is_removed.is_(False))
    ).all()
    counter: dict[str, int] = {}
    for (name,) in list(rows_a) + list(rows_b):
        key = (name or "").strip()
        if key:
            counter[key] = counter.get(key, 0) + 1
    return [k for k, _ in sorted(counter.items(), key=lambda x: (-x[1], x[0]))]


@router.get("/archives", response_model=list[ChangeArchiveRead], summary="已归档列表")
def list_archives(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
) -> list[ChangeArchiveRead]:
    stmt = select(ChangeArchive).order_by(ChangeArchive.archived_at.desc(), ChangeArchive.id.desc())
    if project_id:
        stmt = stmt.where(ChangeArchive.project_id == project_id)
    rows = db.execute(stmt).scalars().all()

    project_ids = {r.project_id for r in rows}
    change_ids = {r.change_id for r in rows if r.change_id}
    projects = (
        {p.id: p for p in db.execute(select(Project).where(Project.id.in_(project_ids))).scalars().all()}
        if project_ids
        else {}
    )
    changes = (
        {c.id: c for c in db.execute(select(Change).where(Change.id.in_(change_ids))).scalars().all()}
        if change_ids
        else {}
    )
    # ★ 读侧加闸：`scope="change"` 的留痕，只有在「那张单确实还处于归档态」时才返回。
    #   成因见 unarchive_project 的注释 —— 整项目取消归档历史上只清 scope=project 的留痕，
    #   会把该项目下「先单独归档过」的单子留成孤儿记录，谎报"已归档"。
    #   这里不删数据，只保证对外显示的一定是真的。
    rows = [
        r
        for r in rows
        if r.scope != "change"
        or (r.change_id is not None and r.change_id in changes and changes[r.change_id].archived_at is not None)
    ]
    return [
        ChangeArchiveRead(
            id=r.id,
            scope=r.scope,  # type: ignore[arg-type]
            project_id=r.project_id,
            project_code=projects[r.project_id].code if r.project_id in projects else "",
            project_name=projects[r.project_id].name if r.project_id in projects else "",
            change_id=r.change_id,
            change_title=changes[r.change_id].title if r.change_id and r.change_id in changes else None,
            archived_at=r.archived_at,
            remark=r.remark,
        )
        for r in rows
    ]


# ===========================================================================
# 变更单 CRUD（注意：本段之后才是 /{change_id} 参数路由）
# ===========================================================================


def _parse_int_csv(raw: str) -> list[int]:
    out: list[int] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


@router.get("", response_model=ChangeList, summary="变更单列表（分页对象）")
def list_changes(
    project_id: str = Query("", description="项目 ID，支持逗号多选；空 = 全部"),
    change_type_id: Optional[int] = Query(None),
    status_filter: str = Query("", alias="status", description="active / done / voided，逗号多选"),
    risk: str = Query("", description="overdue 超期 / near 临期 / late 迟交 / 空 = 全部"),
    archived: str = Query("0", description="0 活跃（默认）/ 1 已归档 / all 全部"),
    q: str = Query("", description="搜索：标题 / 物料PN / 物料名 / 责任人"),
    sort: str = Query("risk", description="risk 超期优先（默认）/ plan_end / created"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, description="上限 100（超出会 422）"),
    db: Session = Depends(get_db),
) -> ChangeList:
    """返回**分页对象** `{items,total,page,page_size,total_pages}`。

    数据规模假设：十几个项目、数百张单 → 全量取回后在内存里过滤排序分页，
    逻辑简单且排序口径（含派生指标）不会与 SQL 打架。
    """
    today = _today()
    project_ids = _parse_int_csv(project_id)
    include_archived = archived in ("1", "all", "true", "True")
    changes = _load_changes(db, include_archived=include_archived, project_ids=project_ids)

    if archived == "1":
        changes = [c for c in changes if c.archived_at is not None]
    elif archived == "all":
        pass
    else:
        changes = [c for c in changes if c.archived_at is None]

    tasks_map = _load_tasks_map(db, [c.id for c in changes])
    items = [_to_change_read(c, tasks_map.get(c.id, []), today) for c in changes]

    if change_type_id:
        items = [i for i in items if i.change_type_id == change_type_id]

    statuses = {s.strip() for s in (status_filter or "").split(",") if s.strip()}
    if statuses:
        items = [i for i in items if i.status in statuses]

    risks = {s.strip() for s in (risk or "").split(",") if s.strip()}
    if risks:
        def match(i: ChangeRead) -> bool:
            if "overdue" in risks and i.overdue_leaf > 0:
                return True
            if "near" in risks and i.near_leaf > 0:
                return True
            if "late" in risks and i.late_leaf > 0:
                return True
            if "done" in risks and i.status == "done":
                return True
            return False

        # ★ 作废单不参与「预警口径」筛选（定稿 §4.2：作废单不参与任何统计与预警）。
        #   不加这一层，`?risk=overdue` 会比 summary / project-overview 多出那些
        #   "作废但仍有超期叶子"的单 → 卡片写 4、接口返回 5，对不上账。
        #   例外：显式传 `status=voided` 专门看作废单时不过滤（否则永远返回空）。
        pool = items if "voided" in statuses else [i for i in items if i.status != "voided"]
        items = [i for i in pool if match(i)]

    key = (q or "").strip().lower()
    if key:
        items = [
            i
            for i in items
            if key in i.title.lower()
            or key in i.material_pn.lower()
            or key in i.material_name.lower()
            or key in (i.owner or "").lower()
            or key in i.project_name.lower()
        ]

    if sort == "plan_end":
        items.sort(key=lambda x: (x.plan_end is None, x.plan_end or date.max, x.id))
    elif sort == "created":
        items.sort(key=lambda x: -x.id)
    else:
        # 默认「超期优先」：超期多的排前，其次临期，再按计划完成日
        items.sort(
            key=lambda x: (
                -x.overdue_leaf,
                -x.near_leaf,
                x.plan_end is None,
                x.plan_end or date.max,
                x.id,
            )
        )

    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start : start + page_size]
    return ChangeList(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if page_size else 0,
    )


@router.post("", response_model=ChangeRead, status_code=status.HTTP_201_CREATED, summary="新建变更单")
def create_change(payload: ChangeCreate, db: Session = Depends(get_db)) -> ChangeRead:
    if db.get(Project, payload.project_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {payload.project_id} 不存在")
    if db.get(Material, payload.material_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"物料 {payload.material_id} 不存在")
    if db.get(ChangeType, payload.change_type_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"变更类型 {payload.change_type_id} 不存在")

    change = Change(
        project_id=payload.project_id,
        material_id=payload.material_id,
        change_type_id=payload.change_type_id,
        supplier_id=payload.supplier_id,
        title=payload.title.strip(),
        description=payload.description,
        owner=payload.owner,
        status="active",
        remark=payload.remark,
    )
    db.add(change)
    db.commit()
    change = (
        db.execute(
            select(Change)
            .options(
                joinedload(Change.project),
                joinedload(Change.material),
                joinedload(Change.change_type),
                joinedload(Change.supplier),
            )
            .where(Change.id == change.id)
        )
        .scalars()
        .one()
    )
    return _to_change_read(change, [], _today())


@router.post("/import", response_model=ChangeImportResult, summary="Excel 双 sheet 导入")
def import_changes(
    file_path: str = Query(..., description="服务器本地 Excel 文件绝对路径（前后端同机）"),
    db: Session = Depends(get_db),
) -> ChangeImportResult:
    """模板两个 sheet：`变更单` + `待办项`（层级用「父项行号」表达）。

    匹配规则（用户确认）：
      - 变更单按**序号**匹配；序号留空 = 新建（再退一步用 项目代码+物料PN+标题 兜底匹配）
      - 待办项按 变更单 + 任务名 + 父项 匹配；父项行号指向 `待办项` sheet 内的 Excel 行号
    先校验、后写入；所有错误集中返回，不静默跳过。
    """
    try:
        import openpyxl
    except ImportError:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")

    import os

    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"文件不存在: {file_path}")

    result = ChangeImportResult()
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)

    def sheet_rows(name: str) -> list[list[Any]]:
        if name not in wb.sheetnames:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Excel 缺少「{name}」工作表")
        ws = wb[name]
        return [list(r) for r in ws.iter_rows(values_only=True)]

    def header_index(header: list[Any], *names: str) -> Optional[int]:
        for i, h in enumerate(header):
            hs = str(h).strip() if h is not None else ""
            if any(n in hs for n in names):
                return i
        return None

    def cell(row: list[Any], idx: Optional[int]) -> Any:
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    def as_text(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, datetime):
            return v.date().isoformat()
        if isinstance(v, date):
            return v.isoformat()
        return str(v).strip()

    def as_date(v: Any) -> Optional[date]:
        if v is None or v == "":
            return None
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, date):
            return v
        s = str(v).strip().replace("/", "-").replace(".", "-")
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y%m%d", "%m-%d"):
            try:
                d = datetime.strptime(s, fmt).date()
                if fmt == "%m-%d":
                    d = d.replace(year=_today().year)
                return d
            except ValueError:
                continue
        return None

    def as_bool(v: Any) -> bool:
        s = as_text(v).lower()
        return s in ("1", "true", "y", "yes", "是", "已完成", "完成", "✓")

    # ---- sheet 1：变更单 ----
    rows1 = sheet_rows("变更单")
    if not rows1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="「变更单」工作表为空")
    h1 = rows1[0]
    c_id = header_index(h1, "序号")
    c_pcode = header_index(h1, "项目代码", "项目编号")
    c_pname = header_index(h1, "项目名称", "项目")
    c_pn = header_index(h1, "物料PN", "物料 PN", "PN")
    c_type = header_index(h1, "变更类型", "类型")
    c_owner = header_index(h1, "责任人", "负责人")
    c_title = header_index(h1, "标题", "变更标题")
    c_desc = header_index(h1, "描述", "变更内容")
    c_status = header_index(h1, "状态")

    excel_to_change: dict[int, int] = {}
    types_by_name = {t.name: t for t in db.execute(select(ChangeType)).scalars().all()}

    for excel_row_no, row in enumerate(rows1[1:], start=2):
        title = as_text(cell(row, c_title))
        pn = as_text(cell(row, c_pn))
        if not title and not pn:
            continue
        pcode = as_text(cell(row, c_pcode))
        pname = as_text(cell(row, c_pname))
        project = None
        if pcode:
            project = db.execute(select(Project).where(Project.code == pcode)).scalars().first()
        if project is None and pname:
            project = db.execute(select(Project).where(Project.name == pname)).scalars().first()
        if project is None:
            result.errors.append(f"变更单第 {excel_row_no} 行：找不到项目「{pcode or pname}」")
            result.skipped += 1
            continue
        material = db.execute(select(Material).where(Material.pn == pn)).scalars().first()
        if material is None:
            result.errors.append(f"变更单第 {excel_row_no} 行：找不到物料「{pn}」")
            result.skipped += 1
            continue
        tname = as_text(cell(row, c_type)) or "未分类"
        ctype = types_by_name.get(tname)
        if ctype is None:
            ctype = ChangeType(name=tname, sort_order=0, is_active=True)
            db.add(ctype)
            db.flush()
            types_by_name[tname] = ctype

        raw_id = as_text(cell(row, c_id))
        target: Optional[Change] = None
        if raw_id.isdigit():
            cand = db.get(Change, int(raw_id))
            if cand is not None and not cand.is_removed:
                target = cand
        if target is None:
            target = (
                db.execute(
                    select(Change).where(
                        Change.project_id == project.id,
                        Change.material_id == material.id,
                        Change.title == title,
                        Change.is_removed.is_(False),
                    )
                )
                .scalars()
                .first()
            )

        st = as_text(cell(row, c_status))
        status_val = {"已完成": "done", "已作废": "voided", "进行中": "active"}.get(st, "active")
        if target is None:
            target = Change(
                project_id=project.id,
                material_id=material.id,
                change_type_id=ctype.id,
                title=title or f"{pn} 变更",
                description=as_text(cell(row, c_desc)) or None,
                owner=as_text(cell(row, c_owner)) or None,
                status="active",
            )
            db.add(target)
            db.flush()
            result.created_changes += 1
        else:
            target.change_type_id = ctype.id
            target.title = title or target.title
            target.owner = as_text(cell(row, c_owner)) or target.owner
            desc = as_text(cell(row, c_desc))
            if desc:
                target.description = desc
            if status_val:
                target.status = status_val
            result.updated_changes += 1
        excel_to_change[excel_row_no] = target.id

    db.flush()

    # ---- sheet 2：待办项 ----
    if "待办项" in wb.sheetnames:
        rows2 = sheet_rows("待办项")
        if rows2:
            h2 = rows2[0]
            t_chg = header_index(h2, "变更单序号", "变更单")
            t_parent = header_index(h2, "父项行号", "父项")
            t_name = header_index(h2, "任务名", "待办项", "任务")
            t_owner = header_index(h2, "责任人", "负责人")
            t_start = header_index(h2, "计划开始", "开始")
            t_end = header_index(h2, "计划完成", "计划结束", "完成")
            t_done = header_index(h2, "是否完成", "完成状态", "已勾")
            t_seq = header_index(h2, "排序", "序号")

            row_to_task: dict[int, int] = {}
            for excel_row_no, row in enumerate(rows2[1:], start=2):
                name = as_text(cell(row, t_name))
                if not name:
                    continue
                chg_ref = as_text(cell(row, t_chg))
                change_id: Optional[int] = None
                if chg_ref.isdigit() and int(chg_ref) in excel_to_change:
                    change_id = excel_to_change[int(chg_ref)]
                elif chg_ref.isdigit():
                    cand = db.get(Change, int(chg_ref))
                    if cand is not None and not cand.is_removed:
                        change_id = cand.id
                if change_id is None:
                    result.errors.append(f"待办项第 {excel_row_no} 行：无法确定所属变更单「{chg_ref}」")
                    result.skipped += 1
                    continue

                parent_ref = as_text(cell(row, t_parent))
                parent_id: Optional[int] = None
                if parent_ref.isdigit():
                    parent_id = row_to_task.get(int(parent_ref))
                    if parent_id is None:
                        result.errors.append(
                            f"待办项第 {excel_row_no} 行：父项行号「{parent_ref}」未指向本表内的任务"
                        )
                        result.skipped += 1
                        continue

                level = 1
                if parent_id is not None:
                    parent_task = db.get(ChangeTask, parent_id)
                    level = (parent_task.level + 1) if parent_task else 2
                    if level > MAX_TASK_LEVEL:
                        result.errors.append(
                            f"待办项第 {excel_row_no} 行：层级超过 {MAX_TASK_LEVEL} 层，已跳过"
                        )
                        result.skipped += 1
                        continue

                exists = (
                    db.execute(
                        select(ChangeTask).where(
                            ChangeTask.change_id == change_id,
                            ChangeTask.parent_id == parent_id,
                            ChangeTask.name == name,
                            ChangeTask.is_removed.is_(False),
                        )
                    )
                    .scalars()
                    .first()
                )
                plan_start = as_date(cell(row, t_start))
                plan_end = as_date(cell(row, t_end))
                owner = as_text(cell(row, t_owner)) or None
                done_flag = as_bool(cell(row, t_done))
                seq_raw = as_text(cell(row, t_seq))
                seq = int(seq_raw) if seq_raw.isdigit() else (excel_row_no - 2)

                if exists is None:
                    task = ChangeTask(
                        change_id=change_id,
                        parent_id=parent_id,
                        level=level,
                        seq=seq,
                        name=name,
                        owner=owner,
                        plan_start=plan_start,
                        plan_end=plan_end,
                        is_done=done_flag,
                        done_at=datetime.now() if done_flag else None,
                    )
                    db.add(task)
                    db.flush()
                    row_to_task[excel_row_no] = task.id
                    result.created_tasks += 1
                else:
                    exists.level = level
                    exists.seq = seq
                    if owner:
                        exists.owner = owner
                    if plan_start:
                        exists.plan_start = plan_start
                    if plan_end:
                        exists.plan_end = plan_end
                    if done_flag != exists.is_done:
                        exists.is_done = done_flag
                        exists.done_at = datetime.now() if done_flag else None
                    row_to_task[excel_row_no] = exists.id
                    result.updated_tasks += 1

    db.flush()
    for change_id in {v for v in excel_to_change.values()}:
        chg = db.get(Change, change_id)
        if chg is not None:
            _refresh_change_summary(db, chg)
    db.commit()
    return result


@router.get("/template", summary="下载空模板（变更单 + 待办项两个 sheet）")
def change_template() -> Response:
    """给同事填的**空白 Excel**，列名与 `/import` 的解析规则一字不差。

    与 `/export` 的区别：导出是「已有数据」的快照；模板是「给你填」的空壳。
    两条路复用同一套列名，所以以下两种用法都通：
      1. 下载模板 → 填 → 导入
      2. 导出现有数据 → 改 → 导入（按序号匹配更新）

    示例行故意用了**不存在的项目代码**（PRJ-示例），万一被误导入也只会
    报「找不到项目」并 skip，不会往库里写脏数据。填写时直接删掉示例行即可。
    """
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
    except ImportError:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")

    wb = openpyxl.Workbook()
    head_fill = PatternFill("solid", fgColor="F1EFE8")
    head_font = Font(bold=True, size=10)
    demo_font = Font(color="9A9A94", size=10, italic=True)
    center = Alignment(horizontal="center", vertical="center")

    # ---- sheet 1：变更单（与 /import 的匹配列保持一致）----
    ws1 = wb.active
    ws1.title = "变更单"
    cols1 = ["序号", "项目代码", "项目名称", "物料PN", "物料名称", "变更类型", "责任人", "标题",
             "描述", "状态", "计划开始", "计划结束", "完成率%", "时间进度%", "偏差%",
             "超期任务数", "实际完成", "已归档"]
    for i, label in enumerate(cols1, start=1):
        cell = ws1.cell(row=1, column=i, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = center
    demo1 = ["", "PRJ-示例", "示例-请删除本行", "110205-00031", "车规级 MCU 主控芯片", "二供导入",
             "张三", "示例：新增华东二供", "示例：请删掉本行后再填自己的内容", "", "", "", "", "", "", "", "", ""]
    for i, val in enumerate(demo1, start=1):
        c = ws1.cell(row=2, column=i, value=val)
        c.font = demo_font
    # 填写要点，避免同事填出无法解析的格式
    ws1.cell(row=4, column=1, value="填写说明：① 序号留空 = 新建；填数字 = 更新该序号（序号可在变更页详情里看到）。"
                                  "② 项目代码 / 物料PN 必须是系统里已存在的。③ 变更类型不必先在页面建，导入时会自动创建。"
                                  "④ 状态留空 = 进行中；可填 进行中 / 已完成 / 已作废。⑤ 计划开始 / 计划结束 建议 YYYY-MM-DD。"
                                  "⑥ 灰色示例行务必删除。").font = Font(size=9, color="9A9A94")
    for i, w in enumerate([8, 14, 22, 16, 22, 16, 12, 28, 34, 10, 12, 12, 10, 12, 10, 12, 12, 9], start=1):
        ws1.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws1.freeze_panes = "A2"

    # ---- sheet 2：待办项（层级用「父项行号」表达）----
    ws2 = wb.create_sheet("待办项")
    cols2 = ["变更单序号", "层级", "父项行号", "任务名", "责任人", "计划开始", "计划完成",
             "是否完成", "完成时间", "状态", "超期/迟交天数"]
    for i, label in enumerate(cols2, start=1):
        cell = ws2.cell(row=1, column=i, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = center
    demo2 = ["", 1, "", "示例：提交 PPAP 资料包", "张三", "2026-10-08", "2026-10-15", "否", "", "", ""]
    for i, val in enumerate(demo2, start=1):
        c = ws2.cell(row=2, column=i, value=val)
        c.font = demo_font
    ws2.cell(row=4, column=1, value="填写说明：① 「变更单序号」= sheet1 里那张单的序号，必须能对上。"
                                  "② 「父项行号」= 本表里父任务所在的**行号**（Excel 左侧行号），留空 = 一级待办项；"
                                  "最多 5 层。③ 是否完成填 是/否（也认 1/true/已完成）。④ 灰色示例行务必删除。").font = Font(size=9, color="9A9A94")
    for i, w in enumerate([12, 6, 10, 30, 12, 12, 12, 10, 18, 14, 14], start=1):
        ws2.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws2.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = "change-import-template.xlsx"
    from urllib.parse import quote

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
        },
    )


@router.get("/export", summary="导出 Excel（变更单 + 待办项两个 sheet）")
def export_changes(
    project_id: Optional[int] = Query(None, description="限定项目；空 = 全部"),
    change_id: Optional[int] = Query(None, description="只导一张单"),
    archived: str = Query("all", description="0 / 1 / all"),
    db: Session = Depends(get_db),
) -> Response:
    """归档打包用的导出，也支持日常导出。两个 sheet：变更单 / 待办项。"""
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
    except ImportError:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="服务端未安装 openpyxl")

    today = _today()
    changes = _load_changes(db, include_archived=True, project_ids=[project_id] if project_id else None)
    if archived == "1":
        changes = [c for c in changes if c.archived_at is not None]
    elif archived == "0":
        changes = [c for c in changes if c.archived_at is None]
    if change_id is not None:
        changes = [c for c in changes if c.id == change_id]
    changes.sort(key=lambda c: (c.project_id, c.id))

    tasks_map = _load_tasks_map(db, [c.id for c in changes])

    STATUS_LABEL = {"active": "进行中", "done": "已完成", "voided": "已作废"}
    STATE_LABEL = {"todo": "未到期", "soon": "临期", "overdue": "超期未完成", "done": "按时完成", "late": "迟交完成"}

    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "变更单"
    head_fill = PatternFill("solid", fgColor="F1EFE8")
    head_font = Font(bold=True, size=10)
    cols1 = ["序号", "项目代码", "项目名称", "物料PN", "物料名称", "变更类型", "责任人", "标题",
             "描述", "状态", "计划开始", "计划结束", "完成率%", "时间进度%", "偏差%",
             "超期任务数", "实际完成", "已归档"]
    for i, label in enumerate(cols1, start=1):
        cell = ws1.cell(row=1, column=i, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    cols2 = ["变更单序号", "层级", "父项行号", "任务名", "责任人", "计划开始", "计划完成",
             "是否完成", "完成时间", "状态", "超期/迟交天数"]
    ws2 = wb.create_sheet("待办项")
    for i, label in enumerate(cols2, start=1):
        cell = ws2.cell(row=1, column=i, value=label)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    row2 = 2
    # ★ 变更单 sheet 的行游标。**不能用 ws1.max_row 当游标**：
    #   openpyxl 的 `append([])` 不会真的产生一行（空列表没有单元格），
    #   max_row 会一直停在表头行 1 → 每张单都写在第 1 行互相覆盖，表头也被冲掉。
    row1 = 2
    # 记录「变更单 id → 该单任务在 sheet2 的 Excel 行号」，供父项行号列填写
    task_excel_row: dict[int, int] = {}

    for c in changes:
        read = _to_change_read(c, tasks_map.get(c.id, []), today)
        for i, val in enumerate(
            [
                c.id,
                c.project.code if c.project else "",
                c.project.name if c.project else "",
                c.material.pn if c.material else "",
                c.material.name if c.material else "",
                c.change_type.name if c.change_type else "",
                c.owner or "",
                c.title,
                c.description or "",
                STATUS_LABEL.get(c.status, c.status),
                c.plan_start.isoformat() if c.plan_start else "",
                c.plan_end.isoformat() if c.plan_end else "",
                read.done_rate,
                read.time_rate,
                read.deviation,
                read.overdue_leaf,
                c.completed_at.date().isoformat() if c.completed_at else "",
                "是" if c.archived_at else "",
            ],
            start=1,
        ):
            ws1.cell(row=row1, column=i, value=val)
        row1 += 1

        # 先把本单所有任务写进 sheet2（记录行号），再回填父项行号
        tasks = sorted(tasks_map.get(c.id, []), key=lambda t: (t.level, t.seq, t.id))
        start_row = row2
        for t in tasks:
            ws2.cell(row=row2, column=1, value=c.id)
            ws2.cell(row=row2, column=2, value=t.level)
            ws2.cell(row=row2, column=3, value="")
            ws2.cell(row=row2, column=4, value=t.name)
            ws2.cell(row=row2, column=5, value=t.owner or c.owner or "")
            ws2.cell(row=row2, column=6, value=t.plan_start.isoformat() if t.plan_start else "")
            ws2.cell(row=row2, column=7, value=t.plan_end.isoformat() if t.plan_end else "")
            ws2.cell(row=row2, column=8, value="是" if t.is_done else "")
            ws2.cell(row=row2, column=9, value=t.done_at.strftime("%Y-%m-%d %H:%M") if t.done_at else "")
            st, od, ld = _task_state(t.plan_end, t.is_done, t.done_at, today)
            ws2.cell(row=row2, column=10, value=STATE_LABEL.get(st, ""))
            ws2.cell(row=row2, column=11, value=(od or ld) if (od or ld) else "")
            task_excel_row[t.id] = row2
            row2 += 1
        for t in tasks:
            if t.parent_id and t.parent_id in task_excel_row:
                ws2.cell(row=task_excel_row[t.id], column=3, value=task_excel_row[t.parent_id])
        if start_row == row2:
            ws2.cell(row=row2, column=1, value=c.id)
            ws2.cell(row=row2, column=4, value="（该变更单还没有任务）")
            row2 += 1

    for i, w in enumerate([8, 14, 22, 16, 22, 16, 12, 28, 24, 10, 12, 12, 10, 12, 10, 12, 12, 9], start=1):
        ws1.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    for i, w in enumerate([12, 6, 10, 28, 12, 12, 12, 10, 18, 14, 14], start=1):
        ws2.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws1.freeze_panes = "A2"
    ws2.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    filename = f"changes-{stamp}.xlsx"
    from urllib.parse import quote

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
        },
    )


# ===========================================================================
# 归档（只作用在变更模块内部，不动 projects 表）
# ===========================================================================


@router.post("/archives/project/{project_id}", response_model=ChangeArchiveRead, summary="整项目归档")
def archive_project(
    project_id: int,
    remark: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> ChangeArchiveRead:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目 {project_id} 不存在")
    now = datetime.now()
    changes = (
        db.execute(
            select(Change).where(
                Change.project_id == project_id,
                Change.is_removed.is_(False),
                Change.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    for c in changes:
        c.archived_at = now
    rec = ChangeArchive(scope="project", project_id=project_id, change_id=None, archived_at=now, remark=remark)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return ChangeArchiveRead(
        id=rec.id,
        scope="project",
        project_id=project_id,
        project_code=project.code,
        project_name=project.name,
        change_id=None,
        change_title=None,
        archived_at=rec.archived_at,
        remark=rec.remark,
    )


@router.post("/archives/project/{project_id}/unarchive", summary="取消整项目归档")
def unarchive_project(project_id: int, db: Session = Depends(get_db)) -> dict:
    now = datetime.now()
    changes = (
        db.execute(
            select(Change).where(Change.project_id == project_id, Change.archived_at.is_not(None))
        )
        .scalars()
        .all()
    )
    for c in changes:
        c.archived_at = None
    # ★ 连带清理「单张归档」的留痕：这些单子刚被取消归档，已不再是归档态。
    #   历史上这里只删 scope="project" 的记录 → 「先单独归档某单，再整项目归档，
    #   再取消整项目归档」会留下一条指向「未归档单」的孤儿留痕，谎报已归档。
    #   （实测踩中：changes #3 的留痕仍在，而该单 archived_at 已是 NULL。）
    unarchived_ids = {c.id for c in changes}
    recs = db.execute(select(ChangeArchive).where(ChangeArchive.project_id == project_id)).scalars().all()
    for r in recs:
        if r.scope == "project" or (r.change_id is not None and r.change_id in unarchived_ids):
            db.delete(r)
    db.commit()
    return {"unarchived": len(changes), "at": now.isoformat()}


@router.post("/{change_id}/archive", response_model=ChangeRead, summary="单张变更单归档")
def archive_change(
    change_id: int,
    remark: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> ChangeRead:
    change = _get_change_or_404(db, change_id)
    now = datetime.now()
    change.archived_at = now
    db.add(ChangeArchive(scope="change", project_id=change.project_id, change_id=change.id, remark=remark))
    db.commit()
    db.refresh(change)
    return _to_change_read(change, [], _today())


@router.post("/{change_id}/unarchive", response_model=ChangeRead, summary="取消单张归档")
def unarchive_change(change_id: int, db: Session = Depends(get_db)) -> ChangeRead:
    change = _get_change_or_404(db, change_id)
    change.archived_at = None
    recs = db.execute(select(ChangeArchive).where(ChangeArchive.change_id == change_id)).scalars().all()
    for r in recs:
        db.delete(r)
    db.commit()
    db.refresh(change)
    return _to_change_read(change, [], _today())


@router.post("/{change_id}/void", response_model=ChangeRead, summary="作废变更单")
def void_change(change_id: int, db: Session = Depends(get_db)) -> ChangeRead:
    change = _get_change_or_404(db, change_id)
    _ensure_editable(change)
    change.status = "voided"
    db.commit()
    db.refresh(change)
    return _to_change_read(change, [], _today())


@router.post("/{change_id}/restore", response_model=ChangeRead, summary="取消作废（恢复为进行中）")
def restore_change(change_id: int, db: Session = Depends(get_db)) -> ChangeRead:
    change = _get_change_or_404(db, change_id)
    _ensure_editable(change)
    change.status = "active"
    change.completed_at = None
    db.commit()
    db.refresh(change)
    return _to_change_read(change, [], _today())


# ===========================================================================
# 变更单：详情 / 修改 / 删除  （参数路由必须放在所有字面量路由之后）
# ===========================================================================


@router.get("/{change_id}", response_model=ChangeDetail, summary="变更单详情（含任务树）")
def get_change(change_id: int, db: Session = Depends(get_db)) -> ChangeDetail:
    change = _get_change_or_404(db, change_id)
    if change.project is None:
        change = (
            db.execute(
                select(Change)
                .options(
                    joinedload(Change.project),
                    joinedload(Change.material),
                    joinedload(Change.change_type),
                    joinedload(Change.supplier),
                )
                .where(Change.id == change_id)
            )
            .scalars()
            .one()
        )
    today = _today()
    tasks = (
        db.execute(
            select(ChangeTask)
            .where(ChangeTask.change_id == change_id, ChangeTask.is_removed.is_(False))
            .order_by(ChangeTask.level, ChangeTask.seq, ChangeTask.id)
        )
        .scalars()
        .all()
    )
    base = _to_change_read(change, list(tasks), today)
    return ChangeDetail(**base.model_dump(), tasks=_build_task_tree(change, list(tasks), today))


@router.patch("/{change_id}", response_model=ChangeRead, summary="修改变更单")
def update_change(change_id: int, payload: ChangeUpdate, db: Session = Depends(get_db)) -> ChangeRead:
    change = _get_change_or_404(db, change_id)
    _ensure_editable(change)
    data = payload.model_dump(exclude_unset=True)
    if "change_type_id" in data and data["change_type_id"] and db.get(ChangeType, data["change_type_id"]) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="变更类型不存在")
    for key, value in data.items():
        if key == "title" and value:
            value = str(value).strip()
        setattr(change, key, value)
    if data.get("status") == "done" and change.completed_at is None:
        change.completed_at = datetime.now()
    if data.get("status") == "active":
        change.completed_at = None
    db.commit()
    db.refresh(change)
    tasks = (
        db.execute(
            select(ChangeTask).where(ChangeTask.change_id == change_id, ChangeTask.is_removed.is_(False))
        )
        .scalars()
        .all()
    )
    return _to_change_read(change, list(tasks), _today())


@router.delete("/{change_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除变更单（默认软删）")
def delete_change(
    change_id: int,
    hard: bool = Query(False, description="true = 物理删除（作废后彻底清掉）"),
    db: Session = Depends(get_db),
) -> Response:
    change = _get_change_or_404(db, change_id)
    if hard:
        for t in db.execute(select(ChangeTask).where(ChangeTask.change_id == change_id)).scalars().all():
            db.delete(t)
        for r in db.execute(select(ChangeArchive).where(ChangeArchive.change_id == change_id)).scalars().all():
            db.delete(r)
        db.delete(change)
    else:
        change.is_removed = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===========================================================================
# 任务（挂在变更单下）
# ===========================================================================


@router.post("/{change_id}/tasks", response_model=ChangeTaskNode, status_code=status.HTTP_201_CREATED, summary="新增任务")
def create_task(change_id: int, payload: ChangeTaskCreate, db: Session = Depends(get_db)) -> ChangeTaskNode:
    change = _get_change_or_404(db, change_id)
    _ensure_editable(change)

    level = 1
    if payload.parent_id is not None:
        parent = db.get(ChangeTask, payload.parent_id)
        if parent is None or parent.change_id != change_id or parent.is_removed:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="父任务不存在")
        level = parent.level + 1
    if level > MAX_TASK_LEVEL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"最多支持 {MAX_TASK_LEVEL} 层，无法再往下添加子项",
        )

    next_seq = (
        db.execute(
            select(func.coalesce(func.max(ChangeTask.seq), -1)).where(
                ChangeTask.change_id == change_id, ChangeTask.parent_id.is_(payload.parent_id)
            )
        ).scalar_one()
        + 1
    )
    task = ChangeTask(
        change_id=change_id,
        parent_id=payload.parent_id,
        level=level,
        seq=payload.seq if payload.seq is not None else next_seq,
        name=payload.name.strip(),
        description=payload.description,
        owner=payload.owner,
        plan_start=payload.plan_start,
        plan_end=payload.plan_end,
    )
    db.add(task)
    db.flush()
    _refresh_change_summary(db, change)
    db.commit()
    db.refresh(task)
    owner = task.owner or change.owner
    st, od, ld = _task_state(task.plan_end, task.is_done, task.done_at, _today())
    return ChangeTaskNode(
        id=task.id,
        change_id=task.change_id,
        parent_id=task.parent_id,
        level=task.level,
        seq=task.seq,
        name=task.name,
        description=task.description,
        owner=owner,
        plan_start=task.plan_start,
        plan_end=task.plan_end,
        is_done=task.is_done,
        done_at=task.done_at,
        remark=task.remark,
        state=st,  # type: ignore[arg-type]
        overdue_days=od,
        late_days=ld,
        leaf_total=1,
        leaf_done=1 if task.is_done else 0,
        children=[],
    )


@router.post("/{change_id}/tasks/batch", summary="批量加任务（一行一个任务名）")
def batch_create_tasks(
    change_id: int, payload: ChangeTaskBatchCreate, db: Session = Depends(get_db)
) -> dict:
    """比 Excel 更快，覆盖 80% 场景。空行自动忽略。"""
    change = _get_change_or_404(db, change_id)
    _ensure_editable(change)
    level = 1
    parent_id = payload.parent_id
    if parent_id is not None:
        parent = db.get(ChangeTask, parent_id)
        if parent is None or parent.change_id != change_id or parent.is_removed:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="父任务不存在")
        level = parent.level + 1
    if level > MAX_TASK_LEVEL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"最多支持 {MAX_TASK_LEVEL} 层，无法再往下添加子项",
        )

    base_seq = (
        db.execute(
            select(func.coalesce(func.max(ChangeTask.seq), -1)).where(
                ChangeTask.change_id == change_id, ChangeTask.parent_id.is_(parent_id)
            )
        ).scalar_one()
        + 1
    )
    created = 0
    for offset, raw in enumerate(payload.text.splitlines()):
        name = raw.strip().lstrip("-·*").strip()
        if not name:
            continue
        db.add(
            ChangeTask(
                change_id=change_id,
                parent_id=parent_id,
                level=level,
                seq=base_seq + offset,
                name=name,
                owner=payload.owner,
            )
        )
        created += 1
    db.flush()
    _refresh_change_summary(db, change)
    db.commit()
    return {"created": created}


# ===========================================================================
# 任务（独立前缀 /api/change-tasks，避免与 /api/changes/{change_id}/tasks 冲突）
# ===========================================================================


def _get_task_or_404(db: Session, task_id: int) -> ChangeTask:
    task = db.get(ChangeTask, task_id)
    if task is None or task.is_removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"任务 {task_id} 不存在")
    return task


@task_router.patch("/{task_id}", response_model=ChangeTaskNode, summary="修改任务")
def update_task(task_id: int, payload: ChangeTaskUpdate, db: Session = Depends(get_db)) -> ChangeTaskNode:
    task = _get_task_or_404(db, task_id)
    change = _get_change_or_404(db, task.change_id)
    _ensure_editable(change)

    data = payload.model_dump(exclude_unset=True)
    if "is_done" in data:
        new_done = bool(data.pop("is_done"))
        _apply_done(db, change, task, new_done)
    for key, value in data.items():
        if key == "name" and value:
            value = str(value).strip()
        setattr(task, key, value)
    db.flush()
    _refresh_change_summary(db, change)
    db.commit()
    db.refresh(task)

    owner = task.owner or change.owner
    st, od, ld = _task_state(task.plan_end, task.is_done, task.done_at, _today())
    return ChangeTaskNode(
        id=task.id,
        change_id=task.change_id,
        parent_id=task.parent_id,
        level=task.level,
        seq=task.seq,
        name=task.name,
        description=task.description,
        owner=owner,
        plan_start=task.plan_start,
        plan_end=task.plan_end,
        is_done=task.is_done,
        done_at=task.done_at,
        remark=task.remark,
        state=st,  # type: ignore[arg-type]
        overdue_days=od,
        late_days=ld,
        leaf_total=1,
        leaf_done=1 if task.is_done else 0,
        children=[],
    )


def _apply_done(db: Session, change: Change, task: ChangeTask, new_done: bool) -> None:
    """勾选/取消勾选。

    勾选瞬间自动写 `done_at`（用户零录入）——这是「迟交完成」与燃尽实际线的唯一来源。
    **点父项 = 一键全勾 / 全取消**（用户确认的批量语义）。
    """
    children = (
        db.execute(
            select(ChangeTask).where(ChangeTask.parent_id == task.id, ChangeTask.is_removed.is_(False))
        )
        .scalars()
        .all()
    )
    targets = [task, *children] if children else [task]
    for t in targets:
        t.is_done = new_done
        if new_done:
            if t.done_at is None:
                t.done_at = datetime.now()
        else:
            t.done_at = None


@task_router.post("/{task_id}/toggle", response_model=ChangeTaskNode, summary="勾选 / 取消勾选任务")
def toggle_task(task_id: int, payload: ChangeTaskToggle, db: Session = Depends(get_db)) -> ChangeTaskNode:
    task = _get_task_or_404(db, task_id)
    change = _get_change_or_404(db, task.change_id)
    _ensure_editable(change)
    _apply_done(db, change, task, payload.is_done)
    db.flush()
    _refresh_change_summary(db, change)
    db.commit()
    db.refresh(task)
    owner = task.owner or change.owner
    st, od, ld = _task_state(task.plan_end, task.is_done, task.done_at, _today())
    return ChangeTaskNode(
        id=task.id,
        change_id=task.change_id,
        parent_id=task.parent_id,
        level=task.level,
        seq=task.seq,
        name=task.name,
        description=task.description,
        owner=owner,
        plan_start=task.plan_start,
        plan_end=task.plan_end,
        is_done=task.is_done,
        done_at=task.done_at,
        remark=task.remark,
        state=st,  # type: ignore[arg-type]
        overdue_days=od,
        late_days=ld,
        leaf_total=1,
        leaf_done=1 if task.is_done else 0,
        children=[],
    )


@task_router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除任务（级联删子项）")
def delete_task(task_id: int, db: Session = Depends(get_db)) -> Response:
    """有子项时**级联删除全部下级**（前端会二次确认并提示将删几个）。"""
    task = _get_task_or_404(db, task_id)
    change = _get_change_or_404(db, task.change_id)
    _ensure_editable(change)

    all_tasks = (
        db.execute(select(ChangeTask).where(ChangeTask.change_id == task.change_id))
        .scalars()
        .all()
    )
    children_map: dict[Optional[int], list[ChangeTask]] = {}
    for t in all_tasks:
        children_map.setdefault(t.parent_id, []).append(t)

    def collect(node: ChangeTask) -> list[ChangeTask]:
        out = [node]
        for child in children_map.get(node.id, []):
            out.extend(collect(child))
        return out

    for t in collect(task):
        t.is_removed = True
    db.flush()
    _refresh_change_summary(db, change)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
