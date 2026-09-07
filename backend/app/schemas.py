"""Pydantic v2 请求 / 响应模型。"""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProductStatus = Literal["active", "inactive", "archived"]
# 供应商风险等级（地图点位红黄绿）。None = 未评估；判定规则未定，录入不要求提供
SupplierRiskLevel = Literal["red", "yellow", "green"]
ProjectStatus = Literal["active", "planning", "closed"]


class ProductBase(BaseModel):
    """产品公共字段。"""

    name: str = Field(..., min_length=1, max_length=200, examples=["无线蓝牙降噪耳机"])
    sku: str = Field(..., min_length=1, max_length=64, examples=["SKU-1001"])
    price: float = Field(..., ge=0, le=1_000_000_000, examples=[299.0])
    stock: int = Field(0, ge=0, le=2_147_483_647, examples=[120])
    category: Optional[str] = Field(None, max_length=100, examples=["数码配件"])
    description: Optional[str] = Field(None, max_length=2000, examples=["支持主动降噪，续航 30 小时"])
    status: ProductStatus = Field(default="active", description="产品状态")


class ProductCreate(ProductBase):
    """新增产品请求体。"""


class ProductUpdate(BaseModel):
    """部分更新产品请求体（PATCH，所有字段可选）。"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    sku: Optional[str] = Field(None, min_length=1, max_length=64)
    price: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    stock: Optional[int] = Field(None, ge=0, le=2_147_483_647)
    category: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    status: Optional[ProductStatus] = None


class ProductRead(ProductBase):
    """产品响应模型（从 ORM 对象序列化）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ProductList(BaseModel):
    """分页列表响应。"""

    items: list[ProductRead]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# L1 供应商主数据
# ---------------------------------------------------------------------------


class SupplierBase(BaseModel):
    """供应商公共字段。

    城市/经纬度为地图场景字段（底表录入可不填，地图录入时前端要求必填）。
    """

    code: str = Field(..., min_length=1, max_length=50, examples=["SUP-001"], description="供应商代码（唯一）")
    name: str = Field(..., min_length=1, max_length=200, examples=["深圳市华芯电子有限公司"])
    city: Optional[str] = Field(None, max_length=100, examples=["深圳"])
    longitude: Optional[float] = Field(None, ge=73, le=135, description="经度（WGS84）", examples=[114.06])
    latitude: Optional[float] = Field(None, ge=3, le=54, description="纬度（WGS84）", examples=[22.55])
    contact_person: Optional[str] = Field(None, max_length=100, examples=["张伟"])
    phone: Optional[str] = Field(None, max_length=50, examples=["138-0000-0000"])
    supply_material: Optional[str] = Field(None, max_length=200, examples=["MCU 主控芯片"])
    # 风险等级：地图点位红黄绿，None = 未评估。录入时不要求提供；判定规则确定后由对应模块联动填充
    risk_level: Optional[SupplierRiskLevel] = Field(None, description="风险等级: red 高 / yellow 中 / green 正常，None=未评估")
    remark: Optional[str] = Field(None, max_length=2000, examples=["重点独供物料，需重点关注"])


class SupplierCreate(SupplierBase):
    """新增供应商请求体（仅主数据，不含项目信息）。"""


class SupplierUpdate(BaseModel):
    """更新供应商请求体（地图录入时补全地图字段，字段均可选）。"""

    city: Optional[str] = Field(None, max_length=100)
    longitude: Optional[float] = Field(None, ge=73, le=135)
    latitude: Optional[float] = Field(None, ge=3, le=54)
    contact_person: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=50)
    supply_material: Optional[str] = Field(None, max_length=200)
    risk_level: Optional[SupplierRiskLevel] = None
    remark: Optional[str] = Field(None, max_length=2000)


class SupplierMaterialBrief(BaseModel):
    """供应商响应中内嵌的物料简要信息（来源：L2 供应关系）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    pn: str
    name: str
    category: Optional[str] = None


class SupplierRead(SupplierBase):
    """供应商响应模型（含供应的物料，无项目信息）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    materials: list[SupplierMaterialBrief] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# L1 物料主数据
# ---------------------------------------------------------------------------


class MaterialBase(BaseModel):
    """物料公共字段。"""

    pn: str = Field(..., min_length=1, max_length=64, examples=["MCU-001"])
    name: str = Field(..., min_length=1, max_length=200, examples=["主控芯片"])
    category: Optional[str] = Field(None, max_length=100, examples=["电子元器件"])
    spec: Optional[str] = Field(None, max_length=200, examples=["LQFP64"])
    remark: Optional[str] = Field(None, max_length=2000)


class MaterialCreate(MaterialBase):
    """新增物料请求体。"""


class MaterialRead(MaterialBase):
    """物料响应模型。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    supplier_count: int = 0


class MaterialList(BaseModel):
    """物料分页列表响应。"""

    items: list[MaterialRead]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# L2 供应关系主数据（四元组）
# ---------------------------------------------------------------------------


class SupplyRelationCreate(BaseModel):
    """新增供应关系（四元组：物料 + 供应商，全局唯一）。"""

    material_id: int = Field(..., description="物料 ID")
    supplier_id: int = Field(..., description="供应商 ID")


class SupplyRelationRead(BaseModel):
    """供应关系响应（四元组视图，供其他模块直接消费）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    material_id: int
    supplier_id: int
    pn: str = Field(..., description="物料 PN")
    material_name: str = Field(..., description="物料名称")
    supplier_name: str = Field(..., description="供应商名称")
    supplier_code: str = Field(..., description="供应商代码")
    project_count: int = 0
    created_at: datetime


class SupplyRelationList(BaseModel):
    """供应关系分页列表响应。"""

    items: list[SupplyRelationRead]
    total: int
    page: int
    page_size: int
    total_pages: int


class SupplyRelationProjectBrief(BaseModel):
    """引用某供应关系的项目简要信息。"""

    id: int
    code: str
    name: str
    status: str
    role: Optional[str] = None
    is_primary: bool = False


# ---------------------------------------------------------------------------
# L3 项目主数据
# ---------------------------------------------------------------------------


class ProjectBase(BaseModel):
    """项目公共字段。"""

    code: str = Field(..., min_length=1, max_length=50, examples=["PRJ-A"], description="项目代码（唯一）")
    name: str = Field(..., min_length=1, max_length=200, examples=["项目A"])
    status: ProjectStatus = Field(default="active", description="状态: active/planning/closed")
    owner: Optional[str] = Field(None, max_length=100, examples=["张三"])
    description: Optional[str] = Field(None, max_length=2000)


class ProjectCreate(ProjectBase):
    """新增项目请求体。"""


class ProjectUpdate(BaseModel):
    """更新项目请求体（字段均可选）。"""

    code: Optional[str] = Field(None, min_length=1, max_length=50)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    status: Optional[ProjectStatus] = None
    owner: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)


class ProjectRead(ProjectBase):
    """项目响应模型。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    relation_count: int = 0
    created_at: datetime
    updated_at: datetime


class ProjectList(BaseModel):
    """项目分页列表响应。"""

    items: list[ProjectRead]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# L3 项目供应明细（四元组 + 项目专属字段，模块扩展点）
# ---------------------------------------------------------------------------


class ProjectSupplyRelationCreate(BaseModel):
    """将一条供应关系挂到项目下（可同时填写项目专属字段）。"""

    supply_relation_id: int = Field(..., description="供应关系 ID")
    role: Optional[str] = Field(None, max_length=50, description="该项目下的供应商角色（主供/备选/认证中等）")
    is_primary: bool = Field(False, description="是否主供")
    unit_price: Optional[float] = Field(None, ge=0, description="采购单价")
    quota: Optional[str] = Field(None, max_length=50, description="分配配额（如 60%）")
    lead_time: Optional[str] = Field(None, max_length=50, description="标准交付周期")
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    demand: Optional[list[float]] = Field(None, min_length=12, max_length=12, description="客户需求（1-12月，供需管理模块）")
    capacity: Optional[list[float]] = Field(None, min_length=12, max_length=12, description="供应商产能（1-12月，供需管理模块）")
    bom_factor: Optional[float] = Field(None, ge=0, description="BOM 用量系数（1 台产品需多少个该物料）")
    remark: Optional[str] = Field(None, max_length=2000)


class ProjectSupplyRelationQuickCreate(BaseModel):
    """项目明细快速录入（底表一行式）：输入四元组，自动创建/复用主数据并挂载。

    - 物料按 pn 查找，不存在则自动创建（pn + 名称）
    - 供应商按 code 查找，不存在则自动创建（名称 + 代码）
    - 供应关系按（物料 + 供应商）查找，不存在则自动创建
    - 最后挂载到当前项目（重复挂载返回 409）
    """

    pn: str = Field(..., min_length=1, max_length=64, examples=["MCU-001"], description="物料 PN")
    material_name: str = Field(..., min_length=1, max_length=200, examples=["主控芯片"], description="物料名称")
    supplier_name: str = Field(..., min_length=1, max_length=200, examples=["深圳市华芯电子有限公司"], description="供应商名称")
    supplier_code: str = Field(..., min_length=1, max_length=50, examples=["SUP-001"], description="供应商代码")
    role: Optional[str] = Field(None, max_length=50, description="该项目下的供应商角色（主供/备选/认证中等）")
    is_primary: bool = Field(False, description="是否主供")
    unit_price: Optional[float] = Field(None, ge=0, description="采购单价")
    quota: Optional[str] = Field(None, max_length=50, description="分配配额（如 60%）")
    lead_time: Optional[str] = Field(None, max_length=50, description="标准交付周期")
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    demand: Optional[list[float]] = Field(None, min_length=12, max_length=12, description="客户需求（1-12月，供需管理模块）")
    capacity: Optional[list[float]] = Field(None, min_length=12, max_length=12, description="供应商产能（1-12月，供需管理模块）")
    bom_factor: Optional[float] = Field(None, ge=0, description="BOM 用量系数（1 台产品需多少个该物料）")
    remark: Optional[str] = Field(None, max_length=2000)


class ProjectSupplyRelationUpdate(BaseModel):
    """更新项目供应明细（字段均可选）。"""

    role: Optional[str] = Field(None, max_length=50)
    is_primary: Optional[bool] = None
    unit_price: Optional[float] = Field(None, ge=0)
    quota: Optional[str] = Field(None, max_length=50)
    lead_time: Optional[str] = Field(None, max_length=50)
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    demand: Optional[list[float]] = Field(None, min_length=12, max_length=12, description="客户需求（1-12月）")
    capacity: Optional[list[float]] = Field(None, min_length=12, max_length=12, description="供应商产能（1-12月）")
    bom_factor: Optional[float] = Field(None, ge=0, description="BOM 用量系数")
    remark: Optional[str] = Field(None, max_length=2000)


class ProjectDemandUpdate(BaseModel):
    """批量维护某项目的客户需求（1-12月）：同步到该项目下所有供应明细行（不区分物料）。

    客户需求是项目级数据：客户给的是产品总需求，1 台产品需要多少个该物料由 BOM 系数体现。
    录入时按项目录一次，自动同步到该项目下所有供应明细行。
    """

    demand: list[float] = Field(..., min_length=12, max_length=12, description="客户需求（1-12月）")


class ProjectBomUpdate(BaseModel):
    """批量维护某物料的 BOM 用量系数（项目×物料，同步到该项目下该物料的所有供应明细行）。"""

    material_pn: str = Field(..., min_length=1, max_length=64, examples=["MCU-001"], description="物料 PN")
    bom_factor: float = Field(..., ge=0, description="BOM 用量系数（1 台产品需多少个该物料）")


class ProjectSupplyRelationRead(BaseModel):
    """项目供应明细响应（四元组 + 项目字段）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    supply_relation_id: int
    pn: str
    material_name: str
    supplier_name: str
    supplier_code: str
    role: Optional[str] = None
    is_primary: bool = False
    unit_price: Optional[float] = None
    quota: Optional[str] = None
    lead_time: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    demand: Optional[list[float]] = Field(None, description="客户需求（1-12月，供需管理模块）")
    capacity: Optional[list[float]] = Field(None, description="供应商产能（1-12月，供需管理模块）")
    bom_factor: Optional[float] = Field(None, description="BOM 用量系数")
    remark: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# 份额管理（L2 供应关系 × 月份快照）
# ---------------------------------------------------------------------------

# QDC 离散五档（唯一合法值）
QDC_SCORES = (1.0, 0.7, 0.5, 0.3, 0.0)

# 权重方案常量（动态规则：同物料供应商 Q 一致 → cost；不一致 → quality）
WEIGHT_SCHEMES = {
    "cost": {"q": 0.2, "d": 0.1, "c": 0.7},      # 成本配比 Q20% D10% C70%
    "quality": {"q": 0.7, "d": 0.1, "c": 0.2},   # 质量配比 Q70% D10% C20%
}

# 风险阈值（规则页 SOP 同步维护）
RISK_FLUCTUATION_RATIO = 0.3  # 份额波动预警：本月系统份额相对上期变化 ≥ ±30%（≥ 上期×1.3 或 ≤ 上期×0.7）
RISK_DEVIATION_PT = 5         # 建议偏差预警：|本月 − 上月建议| > 5 个百分点


class ShareRecordBase(BaseModel):
    """份额记录公共字段。"""

    month: str = Field(..., pattern=r"^\d{4}-\d{2}$", examples=["2026-08"], description="月份快照（YYYY-MM）")
    share_current: Optional[float] = Field(None, ge=0, le=100, description="本月系统份额（%）")
    q_score: Optional[float] = Field(None, description="质量评分（五档：1/0.7/0.5/0.3/0）")
    d_score: Optional[float] = Field(None, description="交付评分（五档）")
    c_score: Optional[float] = Field(None, description="成本评分（五档）")
    bases: Optional[list["ShareBase"]] = Field(None, description="基地快照：每项 {base, share, lines}（按物料录入时直接带拉线数）")
    remark: Optional[str] = Field(None, max_length=2000)


class ShareBase(BaseModel):
    """基地快照单项（每条份额记录里 inline 维护）。

    每条 share_record 可以有多基地配额 + 对应拉线数；
    系统份额 = Σ(b.share × b.lines) ÷ Σ(b.lines)（基地配额约定 0-1 小数，全部 ≤1 视为小数口径 ×100）。
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    base: str = Field(..., min_length=1, max_length=50, examples=["基地A"], description="基地名（必填，1-50 字符）")
    lines: int = Field(..., ge=1, le=999, description="该基地的拉线数量（正整数 1-999）")
    share: Optional[float] = Field(None, ge=0, le=100, description="该供应商在该基地的配额（0-1 小数 或 0-100 百分比）；None = 该供应商不供该基地")

    @field_validator("base")
    @classmethod
    def _base_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("基地名不能为空")
        return v.strip()

    @field_validator("lines")
    @classmethod
    def _lines_positive_int(cls, v) -> int:
        if v is None:
            raise ValueError("拉线数量不能为空，请填写正整数")
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("拉线数量必须为正整数")
        if v < 1:
            raise ValueError("拉线数量必须为正整数（≥1）")
        return v


# ShareRecordBase 字段引用 ShareBase 强类型，前向引用
ShareRecordBase.model_rebuild()


class ShareRecordCreate(ShareRecordBase):
    """手动新增份额记录。"""

    project_id: int = Field(..., description="项目 ID（份额为项目级数据）")
    supply_relation_id: int = Field(..., description="供应关系 ID（物料 × 供应商）")


class ShareRecordUpdate(BaseModel):
    """手动修改份额记录（字段均可选；保存后自动重算加权分/建议配额并标记 edited_manually）。"""

    share_current: Optional[float] = Field(None, ge=0, le=100, description="本月系统份额（%）")
    q_score: Optional[float] = Field(None, description="质量评分（五档）")
    d_score: Optional[float] = Field(None, description="交付评分（五档）")
    c_score: Optional[float] = Field(None, description="成本评分（五档）")
    bases: Optional[list[ShareBase]] = Field(None, description="基地快照：每项 {base, share, lines}")
    remark: Optional[str] = Field(None, max_length=2000)


class ShareRecordRead(BaseModel):
    """份额记录响应（四元组视图）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    project_name: str = ""
    supply_relation_id: int
    month: str
    pn: str
    material_name: str
    supplier_name: str
    supplier_code: str
    share_current: Optional[float] = None
    share_prev: Optional[float] = None
    quota_prev: Optional[float] = None
    quota_suggested: Optional[float] = None
    is_sole: bool = False
    q_score: Optional[float] = None
    d_score: Optional[float] = None
    c_score: Optional[float] = None
    weighted_score: Optional[float] = None
    weight_scheme: Optional[str] = None
    bases: Optional[list[dict]] = None
    edited_manually: bool = False
    remark: Optional[str] = None
    # 派生风险信号
    risk_sole: bool = False
    risk_fluctuation: bool = False
    risk_deviation: bool = False


class ShareSummary(BaseModel):
    """KPI 汇总（项目 × 月）。"""

    project_id: int
    project_name: str = ""
    month: str
    total_materials: int = 0          # 当月有记录的物料数
    total_relations: int = 0          # 当月记录条数
    sole_materials: int = 0           # 独供物料数（同项目同物料仅 1 家供应商）
    fluctuation_alerts: int = 0       # 份额波动预警条数（相对上期变化 ≥ ±30%）
    deviation_alerts: int = 0         # 建议偏差预警条数（|本月−上月建议|>5pt）
    sticky_suppliers: int = 0         # 高粘性供应商数（当月覆盖物料数 ≥ 3）


class ShareRiskItem(BaseModel):
    """风险排行条目。"""

    record_id: int
    project_id: int = 0
    pn: str
    material_name: str
    supplier_name: str
    supplier_code: str
    share_current: Optional[float] = None
    share_prev: Optional[float] = None
    weighted_score: Optional[float] = None
    risk_type: str = ""               # sole / fluctuation / deviation / mismatch
    risk_level: str = "low"           # high / medium
    detail: str = ""


class ShareQuadrantPoint(BaseModel):
    """四象限散点：一个点 = 一条供应关系。"""

    pn: str
    material_name: str
    supplier_name: str
    share: float = 0                   # 横轴：份额%
    score: float = 0                   # 纵轴：加权分
    lines: int = 0                     # 点大小：基地拉线数量合计
    is_sole: bool = False
    project_id: int = 0


class ShareRecordList(BaseModel):
    """份额明细列表响应。"""

    items: list[ShareRecordRead]
    total: int


class ShareImportResult(BaseModel):
    """Excel 导入结果。"""

    imported: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 规则条目（各模块 SOP、导入规则等）
# ---------------------------------------------------------------------------


class RuleBase(BaseModel):
    """规则公共字段。"""

    module: str = Field(..., min_length=1, max_length=50, examples=["Excel导入"], description="所属模块")
    title: str = Field(..., min_length=1, max_length=200, examples=["Excel 导入模板"], description="规则标题")
    content: str = Field(..., min_length=1, description="规则正文（支持换行）")
    sort_order: int = Field(0, ge=0, description="排序（同 module 内升序）")


class RuleCreate(RuleBase):
    """新增规则请求体。"""


class RuleUpdate(BaseModel):
    """更新规则请求体（字段均可选）。"""

    module: Optional[str] = Field(None, min_length=1, max_length=50)
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=1)
    sort_order: Optional[int] = Field(None, ge=0)


class RuleRead(RuleBase):
    """规则响应模型。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class RuleListResponse(BaseModel):
    """规则列表响应（按 module 分组、sort_order 升序）。"""

    items: list[RuleRead]
    total: int


# ---------------------------------------------------------------------------
# 库存信号塔：动态库存与 DOH 风险监控看板（规则页「库存管理」SOP 同步维护）
# ---------------------------------------------------------------------------
INV_WINDOW_DAYS = 30            # 日度推算窗口（未来 30 天滚动）
INV_COV_MID = 0.35              # 历史需求波动分档：COV < 0.35 低 / [0.35, 0.8) 中 / ≥ 0.8 高
INV_COV_HI = 0.8
INV_SAFE_DOH_DEFAULT = 5        # 目标安全天数（前端可调，默认 5 天：顶部漏斗「今日亮灯」即 DOH<5）
INV_EXCESS_DOH_DEFAULT = 30     # 过剩库存天数（DOH > 该值 = 蓝灯积压，默认 30）
INV_YELLOW_RATIO = 1.25         # 黄灯带 = 安全天数 × 100%~125%（DOH 贴近安全线）
INV_MIN_HIST_MONTHS = 2         # 历史需求少于 2 个月不计算 COV

# 预警状态（判定优先级从高到低，同一格只落一种）
INV_STATUS_STOCKOUT = "stockout"   # 深红：期末库存 ≤ 0（已断货）
INV_STATUS_RED = "red"             # 浅红：期末库存 < SS 或 DOH < 安全天数
INV_STATUS_YELLOW = "yellow"       # 黄：DOH ∈ [安全, 安全×1.25)（贴近安全线）
INV_STATUS_BLUE = "blue"           # 蓝：DOH > 过剩天数（积压）
INV_STATUS_OK = "ok"               # 正常

# 波动标签（供 KPI「高波动 SKU」与表格标签列使用）
INV_COV_LABEL_HIGH = "high"
INV_COV_LABEL_MID = "mid"
INV_COV_LABEL_LOW = "low"
INV_COV_LABEL_NA = "na"            # 历史数据不足（< 2 个月）


class InventoryMonthQty(BaseModel):
    """单个月份的需求量（历史或预测共用）。"""

    m: str  # YYYY-MM
    q: float


class InventoryCellOut(BaseModel):
    """推算单元在某一自然日的完整单元格（30 天矩阵一行日）。"""

    date: str                     # YYYY-MM-DD
    sys_demand: float             # 系统预测需求（摊日均，或已被 demand_override 覆盖）
    sys_overridden: bool          # 系统预测格是否被手工改过
    manual_demand: float          # 手工修正需求
    manual_in: float              # 手工修正入库
    ending: float                 # 期末库存（自动重算，或 ending_override 覆盖）
    ending_overridden: bool       # 期末是否被直接覆盖
    doh: float                    # 动态 DOH（0.1 天精度；> 窗口封顶 30）
    doh_capped: bool              # DOH 是否超出窗口（显示 30+）
    status: str                   # INV_STATUS_*
    manual: bool                  # 该日是否有任一手工数据（三角标）


class InventoryPlanOut(BaseModel):
    """推算单元 + 30 天矩阵（页面主表一行的完整数据）。"""

    id: int
    project_id: int
    project_code: str
    project_name: str
    base: str
    material_id: int
    pn: str
    material_name: str
    lead_time_days: float
    on_hand: float
    cov: float | None             # None = 历史数据不足
    cov_label: str                # INV_COV_LABEL_*
    avg_daily: float              # 未来窗口内日均需求（SS 基数）
    ss: float                     # 动态安全库存数量
    hist: list[InventoryMonthQty]
    fcast: list[InventoryMonthQty]
    days: list[InventoryCellOut]  # 长度 = 30（窗口随今天滚动）


class InventorySummary(BaseModel):
    """顶部 KPI 风险概览卡（当前筛选视图内，按物料 PN 去重；人工干预按手改单元格数）。"""

    total_plans: int              # 当前视图推算单元（行）数
    stockout_pns: int             # 断货高风险 SKU（PN 种类数）：未来 30 天存在 期末<SS 或 DOH<安全天数
    irreversible_pns: int         # 不可逆断货预警（PN）：库存将归零且剩余覆盖天数 < LeadTime
    high_cov_pns: int             # 高波动 SKU（PN）：COV ≥ 0.8
    manual_cells: int             # 人工干预项：被手动修改过的单元格数（跨全部行）
    today: str                    # 推算基准日（YYYY-MM-DD）


class InventoryDayUpdate(BaseModel):
    """单日单元格批量更新项（全格可编辑；值为 None 表示清空该覆盖字段）。"""

    date: str                     # YYYY-MM-DD
    demand_override: float | None = None   # 改系统预测需求格；None=不改动
    manual_demand: float | None = None     # 改手工修正需求；None=不改动（0=清空）
    manual_in: float | None = None         # 改手工修正入库；None=不改动（0=清空）
    ending_override: float | None = None   # 直接改期末库存；None=不改动
    doh_target: float | None = None        # 编辑 DOH 格：按目标天数反推所需期末库存（覆盖）


class InventoryPlanUpdate(BaseModel):
    """推算单元级更新（左冻结列：LeadTime / 初始现有库存 可双击改）。"""

    lead_time_days: float | None = Field(None, gt=0)
    on_hand: float | None = None


class InventoryImportResult(BaseModel):
    """Excel 导入结果。"""

    imported: int = 0             # 新增推算单元
    updated: int = 0              # 已存在被更新（系统数据刷新 + 手工修正清空重建）
    errors: list[str] = []
