"""FastAPI 应用入口。

启动后自动创建数据表并写入演示数据，
Swagger 文档地址：http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import text

from .database import Base, engine
from .migrations import run_migrations
from .routers import (
    alerts,
    bases,
    changes,
    inventory,
    materials,
    products,
    projects,
    rules,
    share,
    suppliers,
    supply_relations,
)
# 暂不写入演示数据，保留空白底表
# from .seed import seed_materials, seed_products, seed_projects, seed_suppliers


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    # 删除已废弃的 share_base_configs 表（拉线数已搬到 share_records.bases 自身）
    # — 安全 drop（如不存在则跳过），避免历史项目残留造成模型不一致。
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS share_base_configs"))
    # 结构迁移：create_all 不会改已有表，这里补齐列与约束变更（幂等）
    for line in run_migrations(engine):
        print(f"[migration] {line}")
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
        # 前端已迁到 80（http://localhost 不带端口），保留默认端口写法
        "http://localhost",
        "http://127.0.0.1",
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
app.include_router(bases.router)
app.include_router(rules.router)
app.include_router(share.router)
app.include_router(inventory.router)
# 变更管理：三个 router（变更单 / 任务 / 类型字典）。
# 变更单 router 内部已保证字面量路由注册在 /{change_id} 之前，详见 routers/changes.py 顶部注释。
app.include_router(changes.router)
app.include_router(changes.task_router)
app.include_router(changes.type_router)
# 预警中心：只读聚合，不写任何表。必须放在各业务 router 之后（它 import 它们的判定函数）。
app.include_router(alerts.router)


# ---------------------------------------------------------------------------
# 全局兜底：把 Pydantic 的英文「Field required / Input should be a valid integer /
# String should have at least 1 character」等翻译成中文提示给到前端，避免后台
# 默认 detail 列表里的英文给国内业务用户带来困惑。
# ---------------------------------------------------------------------------

# 字段路径段 → 中文标签
_FIELD_LABELS: dict[str, str] = {
    "bases": "基地配置",
    "base": "基地名",
    "lines": "拉线数量",
    "project_id": "项目 ID",
    "month": "月份",
    "share_current": "本月系统份额",
    "q_score": "质量评分 Q",
    "d_score": "交付评分 D",
    "c_score": "成本评分 C",
    "bases_data": "基地配额",
    "file_path": "Excel 文件路径",
    "from_month": "结转源月份",
    "to_month": "结转目标月份",
    # 库存推算单元
    "items": "批量建档项",
    "material_id": "物料 ID",
    "supplier_id": "供应商 ID",
    "base_id": "基地 ID",
    "lead_time_days": "采购提前期",
    "on_hand": "初始现有库存",
    "date": "日期",
    "demand_override": "系统预测需求",
    "manual_demand": "手工修正需求",
    "manual_in": "手工修正入库",
    "ending_override": "期末库存",
    "doh_target": "目标覆盖天数",
    "service_z": "服务水平系数 Z",
    "excess": "过剩天数阈值",
    # 变更管理
    "change_type_id": "变更类型",
    "title": "变更标题",
    "description": "描述",
    "owner": "责任人",
    "parent_id": "父任务 ID",
    "seq": "排序",
    "is_done": "是否完成",
    "plan_start": "计划开始",
    "plan_end": "计划完成",
    "scope": "归档范围",
    "sort_order": "排序",
    "is_active": "是否启用",
    "text": "批量任务文本",
    "hard": "是否物理删除",
    "archived": "归档状态",
    "change_id": "变更单 ID",
    "task_id": "任务 ID",
}

# Pydantic 错误 type → 中文释义
_ERROR_TYPE_MSGS: dict[str, str] = {
    "missing": "不能为空",
    "int_parsing": "应填整数",
    "int_type": "应填整数",
    "string_too_short": "不能为空",
    "string_type": "应为字符串",
    "value_error": "字段值不合法",
    "json_invalid": "JSON 格式错误",
    "list_type": "应为列表",
    "dict_type": "应为对象",
    "greater_than": "数值过小",
    "greater_than_equal": "数值过小",
    "less_than": "数值过大",
    "less_than_equal": "数值过大",
    "string_pattern_mismatch": "格式不正确",
}


def _bound_msg(err_type: str, ctx: dict) -> str:
    """带上下限的中文文案（如「初始现有库存 数值过小（需 ≥ 0）」）。"""
    if err_type in ("greater_than", "greater_than_equal"):
        limit = ctx.get("ge", ctx.get("gt"))
        op = "≥" if err_type == "greater_than_equal" else ">"
        return f"数值过小（需 {op} {limit:g}）" if isinstance(limit, (int, float)) else "数值过小"
    if err_type in ("less_than", "less_than_equal"):
        limit = ctx.get("le", ctx.get("lt"))
        op = "≤" if err_type == "less_than_equal" else "<"
        return f"数值过大（需 {op} {limit:g}）" if isinstance(limit, (int, float)) else "数值过大"
    return _ERROR_TYPE_MSGS.get(err_type, "")


def _label_for_path(loc: list) -> str:
    """把 Pydantic loc 路径转成中文标签（如 body.bases.0.lines → 第 1 项·拉线数量）。"""
    out: list[str] = []
    pending_idx: str | None = None
    for x in loc:
        if x == "body":
            continue
        if isinstance(x, int):
            pending_idx = f"第 {x + 1} 项"
            continue
        label = _FIELD_LABELS.get(str(x), str(x))
        if pending_idx:
            out.append(f"{pending_idx}·{label}")
            pending_idx = None
        else:
            out.append(label)
    if pending_idx:
        out.append(pending_idx)
    return " · ".join([p for p in out if p])


@app.exception_handler(RequestValidationError)
async def _request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """把所有请求体/参数校验错误翻译为中文，返回 {detail: "..."} 与业务路由一致。"""
    raw_errors = exc.errors()
    msgs: list[str] = []
    for err in raw_errors:
        loc = err.get("loc", [])
        err_type = err.get("type", "")
        raw_msg = err.get("msg", "")
        path_label = _label_for_path(loc)
        type_zh = _bound_msg(err_type, err.get("ctx", {}) or {})
        if type_zh:
            if path_label:
                msgs.append(f"{path_label}{type_zh}")
            else:
                msgs.append(type_zh)
        else:
            cleaned = raw_msg.replace("Value error, ", "").strip()
            if path_label:
                msgs.append(f"{path_label}：{cleaned}")
            else:
                msgs.append(cleaned or "请求参数不合法")
    detail = "；".join(m for m in msgs if m) or "请求参数不合法"
    return JSONResponse(status_code=422, content={"detail": detail})


@app.get("/api/health", tags=["Health"], summary="健康检查")
def health_check() -> dict:
    return {"status": "ok", "service": "product-service", "version": app.version}
