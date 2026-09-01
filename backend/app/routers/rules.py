"""规则条目路由（各模块 SOP、Excel 导入规则等）。

- GET    /api/rules?module=&keyword=  分页/筛选查询（按 module 分组、sort_order 升序）
- POST   /api/rules                    新增规则
- PATCH  /api/rules/{id}               更新规则
- DELETE /api/rules/{id}               删除规则
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Rule
from ..schemas import RuleCreate, RuleListResponse, RuleRead, RuleUpdate

router = APIRouter(prefix="/api/rules", tags=["Rules"])


@router.get("", response_model=RuleListResponse, summary="查询规则列表（按 module 分组、sort_order 升序）")
def list_rules(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(100, ge=1, le=200, description="每页数量"),
    module: Optional[str] = Query(None, description="按模块精确过滤"),
    keyword: Optional[str] = Query(None, description="按标题/正文模糊搜索"),
) -> RuleListResponse:
    conditions: list = []
    if module:
        conditions.append(Rule.module == module)
    if keyword:
        like = f"%{keyword}%"
        conditions.append(or_(Rule.title.like(like), Rule.content.like(like)))

    total = db.execute(select(func.count()).select_from(Rule).where(*conditions)).scalar_one()
    stmt = (
        select(Rule)
        .where(*conditions)
        .order_by(Rule.module.asc(), Rule.sort_order.asc(), Rule.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(db.execute(stmt).scalars().all())
    return RuleListResponse(items=items, total=total)


@router.post("", response_model=RuleRead, status_code=status.HTTP_201_CREATED, summary="新增规则")
def create_rule(payload: RuleCreate, db: Session = Depends(get_db)) -> Rule:
    rule = Rule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=RuleRead, summary="更新规则")
def update_rule(rule_id: int, payload: RuleUpdate, db: Session = Depends(get_db)) -> Rule:
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则 {rule_id} 不存在")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除规则")
def delete_rule(rule_id: int, db: Session = Depends(get_db)) -> None:
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则 {rule_id} 不存在")
    db.delete(rule)
    db.commit()
