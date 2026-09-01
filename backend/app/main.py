"""FastAPI 应用入口。

启动后自动创建数据表并写入演示数据，
Swagger 文档地址：http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routers import materials, products, projects, rules, share, suppliers, supply_relations
# 暂不写入演示数据，保留空白底表
# from .seed import seed_materials, seed_products, seed_projects, seed_suppliers


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    # seed_products()
    # seed_materials()
    # seed_suppliers()
    # seed_projects()
    yield


app = FastAPI(
    title="Product Service API",
    version="1.0.0",
    description="产品资源 RESTful CRUD 接口：分页列表、按 ID 查询、新增、全量/部分更新、软删除。",
    lifespan=lifespan,
)

# CORS：允许前端本地开发端口访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router)
app.include_router(suppliers.router)
app.include_router(materials.router)
app.include_router(supply_relations.router)
app.include_router(projects.router)
app.include_router(rules.router)
app.include_router(share.router)


@app.get("/api/health", tags=["Health"], summary="健康检查")
def health_check() -> dict:
    return {"status": "ok", "service": "product-service", "version": app.version}
