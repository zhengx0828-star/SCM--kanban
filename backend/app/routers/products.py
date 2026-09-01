"""产品资源 RESTful CRUD 路由。

- GET    /api/products           分页查询（支持 keyword 模糊搜索、status 过滤）
- GET    /api/products/{id}      按 ID 查询
- POST   /api/products           新增
- PUT    /api/products/{id}      全量更新
- PATCH  /api/products/{id}      部分更新
- DELETE /api/products/{id}      软删除（is_deleted = True）
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product
from ..schemas import ProductCreate, ProductList, ProductRead, ProductUpdate

router = APIRouter(prefix="/api/products", tags=["Products"])


def _get_active_product(db: Session, product_id: int) -> Product:
    """按 ID 获取未删除的产品，不存在则返回 404。"""
    product = db.get(Product, product_id)
    if product is None or product.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"产品 {product_id} 不存在或已被删除",
        )
    return product


def _ensure_sku_unique(db: Session, sku: str, exclude_id: Optional[int] = None) -> None:
    """校验 SKU 唯一性（软删除记录不参与冲突校验），冲突返回 409。"""
    stmt = select(Product).where(Product.sku == sku, Product.is_deleted.is_(False))
    if exclude_id is not None:
        stmt = stmt.where(Product.id != exclude_id)
    if db.execute(stmt).scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"SKU 已存在：{sku}")


@router.get("", response_model=ProductList, summary="分页查询产品列表")
def list_products(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    keyword: Optional[str] = Query(None, description="按名称 / SKU / 分类模糊搜索"),
    status_filter: Optional[str] = Query(None, alias="status", description="按状态过滤：active | inactive | archived"),
) -> ProductList:
    conditions = [Product.is_deleted.is_(False)]
    if keyword:
        like = f"%{keyword}%"
        conditions.append(or_(Product.name.like(like), Product.sku.like(like), Product.category.like(like)))
    if status_filter:
        conditions.append(Product.status == status_filter)

    total = db.execute(select(func.count()).select_from(Product).where(*conditions)).scalar_one()
    stmt = (
        select(Product)
        .where(*conditions)
        .order_by(Product.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = db.execute(stmt).scalars().all()

    return ProductList(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.get("/{product_id}", response_model=ProductRead, summary="按 ID 查询产品")
def get_product(product_id: int, db: Session = Depends(get_db)) -> Product:
    return _get_active_product(db, product_id)


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED, summary="新增产品")
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> Product:
    _ensure_sku_unique(db, payload.sku)
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}", response_model=ProductRead, summary="全量更新产品")
def replace_product(product_id: int, payload: ProductCreate, db: Session = Depends(get_db)) -> Product:
    product = _get_active_product(db, product_id)
    _ensure_sku_unique(db, payload.sku, exclude_id=product.id)
    for field, value in payload.model_dump().items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/{product_id}", response_model=ProductRead, summary="部分更新产品")
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)) -> Product:
    product = _get_active_product(db, product_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return product
    if "sku" in data and data["sku"]:
        _ensure_sku_unique(db, data["sku"], exclude_id=product.id)
    for field, value in data.items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT, summary="软删除产品")
def delete_product(product_id: int, db: Session = Depends(get_db)) -> None:
    product = _get_active_product(db, product_id)
    product.is_deleted = True
    db.commit()
