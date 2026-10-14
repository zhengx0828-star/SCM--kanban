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
# L1 基地主数据
# ---------------------------------------------------------------------------


class BaseSiteBase(BaseModel):
    """基地公共字段。"""

    code: str = Field(..., min_length=1, max_length=32, examples=["CZ"])
    name: str = Field(..., min_length=1, max_length=100, examples=["常州"])
    city: Optional[str] = Field(None, max_length=100, examples=["常州"])
    remark: Optional[str] = Field(None, max_length=2000)


class BaseSiteCreate(BaseSiteBase):
    """新增基地请求体。"""


class BaseSiteUpdate(BaseModel):
    """更新基地请求体（仅传需要修改的字段）。"""

    code: Optional[str] = Field(None, min_length=1, max_length=32)
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    city: Optional[str] = Field(None, max_length=100)
    remark: Optional[str] = Field(None, max_length=2000)


class BaseSiteRead(BaseSiteBase):
    """基地响应模型。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    plan_count: int = 0  # 引用该基地的库存档案数（删除前提示用）
    created_at: datetime
    updated_at: datetime


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
    sync_master_names: bool = Field(
        False,
        description=(
            "命中**已存在**的物料/供应商时，是否用本次提交的名称去覆盖全局主数据名称。"
            "**默认 False（安全侧）**：只复用、绝不改全局主数据 —— 任何调用方漏传都不会误伤其它项目。"
            "手动「快速新增」因为名称是用户当场亲手打的、改名是他的明确意图，才显式传 True。"
            "★ Excel 批量导入必须保持 False：物料按 PN、供应商按 code 是全项目共用的一条，"
            "导入时改名会连带改掉其它项目看到的名称（2026-10-14 事故：导入 EP1 把 LFP3 的 191 改成了 CCS）。"
            "传 False 时名称不一致由前端提示，不静默处理。"
        ),
    )


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

# 月份校验：必须 01-12。旧写法 ^\d{4}-\d{2}$ 会放行 2026-00 / 2026-13，
# 这类月份能写进库，而 dashboard-stats 取 max(month) 时会跳到空月份、把当月风险整片遮住。
MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class ShareRecordBase(BaseModel):
    """份额记录公共字段。"""

    month: str = Field(..., pattern=MONTH_PATTERN, examples=["2026-08"], description="月份快照（YYYY-MM）")
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
    mismatch_alerts: int = 0          # 份额×评分错配条数（份额 ≥50% 但加权分 <0.5）
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
INV_COV_MID = 0.35              # 需求波动分档：COV < 0.35 低 / [0.35, 0.8) 中 / ≥ 0.8 高
INV_COV_HI = 0.8
INV_SAFE_DOH_DEFAULT = 5        # 安全天数兜底值：COV 不可算（需求样本 < 2 个月）时回退用
INV_URGENT_DOH_THRESHOLD = 3    # 紧急档绝对阈值：DOH < 该值一律判「紧急」，不依赖安全天数
INV_EXCESS_DOH_DEFAULT = 30     # 过剩库存天数（DOH > 该值 = 蓝灯积压，默认 30）
INV_YELLOW_RATIO = 1.25         # 黄灯带 = 安全天数 × 100%~125%（DOH 贴近安全线）
INV_MIN_HIST_MONTHS = 2         # 需求样本少于 2 个月不计算 COV

# 安全天数公式：安全天数 = Z × COV × √LT（标准统计式，Z 为服务水平系数）
INV_Z_DEFAULT = 1.65            # 默认 Z：95% 服务水平
INV_SERVICE_LEVEL_OPTIONS = {   # 常用服务水平 ↔ Z 对照（前端联动展示）
    "90%": 1.28,
    "95%": 1.65,
    "97.5%": 1.96,
    "99%": 2.33,
}

# 产能校验分档（占用率 = 建议补货量 ÷ 该项目当月分配额度）
INV_CAPACITY_OK = "ok"          # 占用 ≤ 70%：产能充足
INV_CAPACITY_TIGHT = "tight"    # 占用 70%~100%：产能紧张
INV_CAPACITY_SHORT = "short"    # 占用 > 100%：超出额度，产能不足
INV_CAPACITY_NA = "na"          # 未录入额度，无法校验
INV_CAPACITY_TIGHT_RATIO = 0.7  # 紧张阈值
INV_CAPACITY_FULL_RATIO = 1.0   # 不足阈值

# 需求数据来源
INV_SOURCE_MASTER = "master"      # 与底表联动：客户需求 × BOM 系数
INV_SOURCE_SNAPSHOT = "snapshot"  # 使用档案自带快照（Excel 导入 / 早期手工录入）

# 顶部四卡口径：今日 DOH 四档（唯一判定入口 = routers/inventory.py::_doh_bucket_of）
# 与「预警状态（每格颜色）」是两套口径：颜色看期末/SS/安全线，四卡只看今日 DOH。
INV_DOH_BUCKET_STOCKOUT = "stockout"   # ① 库存耗尽：DOH <= 0（或今日已断货）
INV_DOH_BUCKET_URGENT = "urgent"       # ② 紧急：0 < DOH < 安全天数
INV_DOH_BUCKET_LOW = "low"             # ③ 偏低：安全天数 <= DOH < LeadTime
INV_DOH_BUCKET_OK = "ok"               # ④ 充足：DOH >= LeadTime
INV_DOH_BUCKET_UNKNOWN = "unknown"     # ⑤ 无法评估：需求不可用三档（缺需求 / BOM=0 / 需求为 0）
INV_DOH_BUCKET_ORDER = (               # 展示顺序（越靠前越紧急）
    INV_DOH_BUCKET_STOCKOUT,
    INV_DOH_BUCKET_URGENT,
    INV_DOH_BUCKET_LOW,
    INV_DOH_BUCKET_OK,
    INV_DOH_BUCKET_UNKNOWN,
)

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
INV_COV_LABEL_NA = "na"            # COV 不可算：历史样本 < 2 个月，或需求均值 ≤ 0（0 ÷ 0）


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
    """推算单元 + 30 天矩阵 + 补货建议 + 产能校验（页面主表一行的完整数据）。"""

    id: int
    project_id: int
    project_code: str
    project_name: str
    supplier_id: int
    supplier_name: str
    supplier_code: str
    base_id: int
    base_name: str
    material_id: int
    pn: str
    material_name: str
    lead_time_days: float
    on_hand: float

    # ---- 需求与波动 ----
    demand_source: str            # INV_SOURCE_*：master=底表联动 / snapshot=档案快照
    bom_factor: float | None      # 底表 BOM 系数（快照模式为 None）
    demand_blank: bool = False    # 需求序列存在但窗口日均需求 ≈ 0（漏录 / 客户需求为 0）
    bom_zero: bool = False        # 底表联动且 BOM 系数显式为 0（需求被乘成 0）
    cov: float | None             # 需求波动系数；None = 样本不足或均值为 0
    cov_label: str                # INV_COV_LABEL_*
    avg_daily: float              # 未来窗口内日均需求（SS 基数）
    hist: list[InventoryMonthQty]
    fcast: list[InventoryMonthQty]

    # ---- 安全库存口径（规则页 SOP）----
    service_z: float              # 服务水平系数 Z
    safe_days: float              # 安全天数 = Z × COV × √LT（COV 不可算时回退 INV_SAFE_DOH_DEFAULT）
    safe_days_derived: bool       # True=由公式推导；False=COV 不可算、回退兜底值
    ss: float                     # 安全库存 = 日均需求 × 安全天数
    rop: float                    # 再订货点 = (LT + 安全天数) × 日均需求

    # ---- 补货建议（窗口内实际跌破 ROP 才给建议，否则为 None）----
    replenish_qty: float | None       # 建议补货量 = 一个周期量，即 ROP
    order_by_date: str | None         # 最晚下单日（库存首次跌破 ROP 之日）
    stockout_date: str | None         # 预计耗尽日（期末首次 ≤ 0）
    days_until_order: int | None      # 距最晚下单日的天数（= 窗口下标，0 = 今天必须下单；不会为负）

    # ---- 产能校验（建议补货量 vs 该项目当月分配额度）----
    capacity_limit: float | None      # 该项目在该供应商处的当月分配额度
    capacity_used: float | None       # 供应商当月总产能（用于展示占比）
    capacity_usage: float | None      # 占用率 = 补货量 ÷ 分配额度
    capacity_status: str              # INV_CAPACITY_*
    capacity_month: str | None        # 校验所取月份（YYYY-MM）

    doh_bucket: str = ""              # 顶部四卡档位（INV_DOH_BUCKET_*）：后端判定，前端直接用
    doh_today: float | None = None    # 今日 DOH（capped 按窗口长度），四卡/排序/展示共用

    days: list[InventoryCellOut]  # 长度 = 30（窗口随今天滚动）


class InventoryDohBuckets(BaseModel):
    """今日 DOH 四档分布（顶部四卡口径，键为 INV_DOH_BUCKET_*）。"""

    stockout: int = 0
    urgent: int = 0
    low: int = 0
    ok: int = 0
    unknown: int = 0
    # 「无法评估」三种成因的细分计数（灰卡 hint 用，三者和 = unknown）
    unknown_no_series: int = 0   # 缺需求数据：hist / fcast 皆空
    unknown_bom_zero: int = 0    # BOM 系数显式为 0
    unknown_demand_blank: int = 0  # 有序列但窗口日均 ≈ 0


class InventoryMostUrgent(BaseModel):
    """项目内最紧急的推算单元（用于项目卡片第四行）。"""

    material_name: str
    pn: str
    base_name: str
    doh: float
    bucket: str  # INV_DOH_BUCKET_*


class InventoryProjectOverview(BaseModel):
    """项目级 DOH 概览（L0 项目卡片墙数据，不含任何物料明细）。"""

    project_id: int
    project_code: str
    project_name: str
    plan_count: int              # 推算单元（行）数
    material_count: int          # 物料数（按 PN 去重）
    doh_buckets: InventoryDohBuckets
    most_urgent: InventoryMostUrgent | None = None  # 全部无法评估时为 None


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

    date: str                      # YYYY-MM-DD
    # 上下限是「防手滑打字」而非业务上限：超量级输入（如 -1e12）会让期末库存与
    # DOH 反推被拉爆，前端还会显示出格的长度。
    demand_override: float | None = Field(None, ge=-1e9, le=1e9)   # 改系统预测需求格；None=不改动
    manual_demand: float | None = Field(None, ge=-1e9, le=1e9)     # 改手工修正需求；None=不改动（0=清空）
    manual_in: float | None = Field(None, ge=-1e9, le=1e9)         # 改手工修正入库；None=不改动（0=清空）
    ending_override: float | None = Field(None, ge=-1e9, le=1e9)   # 直接改期末库存；None=不改动
    doh_target: float | None = Field(None, ge=0, le=365)           # 编辑 DOH 格：按目标天数反推期末库存


class InventoryPlanUpdate(BaseModel):
    """推算单元级更新（左冻结列：LeadTime / 初始现有库存 可双击改）。"""

    lead_time_days: float | None = Field(None, gt=0)
    on_hand: float | None = Field(None, ge=0, description="初始现有库存（不允许负数）")


class InventoryImportResult(BaseModel):
    """Excel 导入结果。"""

    imported: int = 0             # 新增推算单元
    updated: int = 0              # 已存在被更新（系统数据刷新 + 手工修正清空重建）
    errors: list[str] = []


class InventoryPlanCreate(BaseModel):
    """新建库存档案：从底表选定「项目 × 物料 × 供应商」，并指定收货基地。"""

    project_id: int
    material_id: int
    supplier_id: int
    base_id: int
    lead_time_days: float = Field(7, gt=0, description="采购提前期（天）")
    on_hand: float = Field(0, ge=0, description="初始现有库存")


class InventoryCandidate(BaseModel):
    """底表中「项目 × 物料 × 供应商」组合（用于批量选取建档）。"""

    project_id: int
    project_code: str
    project_name: str
    material_id: int
    pn: str
    material_name: str
    supplier_id: int
    supplier_code: str
    supplier_name: str
    bom_factor: float | None            # 底表 BOM 系数（为空则需求无法推算）
    demand_months: int                  # 底表已录入的客户需求月份数
    planned_base_ids: list[int] = Field(default_factory=list)  # 已建档的基地，避免重复建


class InventoryBulkCreate(BaseModel):
    """批量建档请求。"""

    items: list[InventoryPlanCreate] = Field(..., min_length=1)


class InventoryBulkCreateResult(BaseModel):
    """批量建档结果。"""

    created: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 变更管理（过程数据层）
#
# 口径见 docs/changes-redesign/02-方案定稿-v0.2.md。
#
# ⚠️ 关键：任务的「五色状态」、完成率、时间进度、偏差**全部是派生值**，
# 由服务层实时算出来塞进响应，数据库里没有对应字段（防不一致）。
# ---------------------------------------------------------------------------

ChangeStatus = Literal["active", "done", "voided"]
"""变更单状态：active 进行中 / done 已完成 / voided 已作废。"""

TaskState = Literal["todo", "soon", "overdue", "done", "late"]
"""任务派生状态（由 plan_end + is_done + done_at + 今天 推出，不落库）：
todo 未到期 / soon 临期 / overdue 超期未完成 / done 按时完成 / late 迟交完成。"""

ArchiveScope = Literal["project", "change"]

# 任务层级封顶（用户确认：支持多层，但最多 5 层，防止甘特图与报表失控）
MAX_TASK_LEVEL = 5

# 临期阈值（用户确认 3 天，不做页面配置）
NEAR_DUE_DAYS = 3


# ---- 变更类型字典 ----------------------------------------------------------


class ChangeTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, examples=["供应商切换"])
    sort_order: int = Field(0, ge=0, le=9999)
    remark: Optional[str] = Field(None, max_length=2000)


class ChangeTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    sort_order: Optional[int] = Field(None, ge=0, le=9999)
    is_active: Optional[bool] = None
    remark: Optional[str] = Field(None, max_length=2000)


class ChangeTypeRead(BaseModel):
    """类型响应。usage_count = 被多少张变更单引用（决定能否删除）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int
    is_active: bool
    remark: Optional[str] = None
    usage_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---- 变更单 ----------------------------------------------------------------


class ChangeCreate(BaseModel):
    project_id: int = Field(..., ge=1, description="所属项目")
    material_id: int = Field(..., ge=1, description="物料 ID（一张单一个物料）")
    change_type_id: int = Field(..., ge=1, description="变更类型")
    supplier_id: Optional[int] = Field(None, ge=1, description="涉及的供应商（可选）")
    title: str = Field(..., min_length=1, max_length=200, examples=["MCU 供应商切换"])
    description: Optional[str] = Field(None, max_length=5000)
    owner: Optional[str] = Field(None, max_length=100, description="总责任人（任务未填时继承它）")
    remark: Optional[str] = Field(None, max_length=2000)


class ChangeUpdate(BaseModel):
    """部分更新（PATCH）。注意：plan_start / plan_end 由叶子任务汇总，不接受手改。"""

    change_type_id: Optional[int] = Field(None, ge=1)
    supplier_id: Optional[int] = Field(None, ge=1)
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    owner: Optional[str] = Field(None, max_length=100)
    status: Optional[ChangeStatus] = None
    remark: Optional[str] = Field(None, max_length=2000)


class ChangeRead(BaseModel):
    """变更单响应（含派生指标）。

    派生字段口径（§5）：
      - done_rate = 已完叶子 ÷ 叶子总数 × 100（人给的答案）
      - time_rate = 已过时长 ÷ 总时长 × 100（自动的标尺）
      - deviation = time_rate − done_rate（>0 表示时间跑在人前面 = 滞后）
    """

    id: int
    project_id: int
    project_code: str = ""
    project_name: str = ""
    material_id: int
    material_pn: str = ""
    material_name: str = ""
    change_type_id: int
    change_type_name: str = ""
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    owner: Optional[str] = None
    status: ChangeStatus = "active"
    plan_start: Optional[date] = None
    plan_end: Optional[date] = None
    completed_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    remark: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # ---- 派生 ----
    leaf_total: int = 0
    leaf_done: int = 0
    done_rate: float = 0.0
    time_rate: float = 0.0
    deviation: float = 0.0
    overdue_leaf: int = 0
    near_leaf: int = 0
    late_leaf: int = 0
    overdue_days: int = 0
    days_left: Optional[int] = None
    is_archived: bool = False


class ChangeList(BaseModel):
    """分页列表响应（对齐既有分页对象形状）。"""

    items: list[ChangeRead]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---- 任务树 ----------------------------------------------------------------


class ChangeTaskCreate(BaseModel):
    parent_id: Optional[int] = Field(None, ge=1, description="留空 = 一级待办项")
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    owner: Optional[str] = Field(None, max_length=100)
    plan_start: Optional[date] = None
    plan_end: Optional[date] = None
    seq: Optional[int] = Field(None, ge=0)


class ChangeTaskUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    owner: Optional[str] = Field(None, max_length=100)
    plan_start: Optional[date] = None
    plan_end: Optional[date] = None
    seq: Optional[int] = Field(None, ge=0)
    is_done: Optional[bool] = None


class ChangeTaskToggle(BaseModel):
    is_done: bool


class ChangeTaskBatchCreate(BaseModel):
    """批量加任务：一行一个任务名（比 Excel 更快，覆盖 80% 场景）。"""

    parent_id: Optional[int] = Field(None, ge=1)
    text: str = Field(..., min_length=1, max_length=20000)
    owner: Optional[str] = Field(None, max_length=100)


class ChangeTaskNode(BaseModel):
    """任务树节点（递归）。children 为空 = 叶子。"""

    id: int
    change_id: int
    parent_id: Optional[int] = None
    level: int = 1
    seq: int = 0
    name: str
    description: Optional[str] = None
    owner: Optional[str] = None
    plan_start: Optional[date] = None
    plan_end: Optional[date] = None
    is_done: bool = False
    done_at: Optional[datetime] = None
    remark: Optional[str] = None

    # ---- 派生 ----
    state: TaskState = "todo"
    overdue_days: int = 0
    late_days: int = 0
    leaf_total: int = 0
    leaf_done: int = 0
    children: list["ChangeTaskNode"] = Field(default_factory=list)


ChangeTaskNode.model_rebuild()


class ChangeDetail(ChangeRead):
    """变更单详情 = 基本信息 + 任务树。"""

    tasks: list[ChangeTaskNode] = Field(default_factory=list)


# ---- 聚合（卡片墙 / Summary / 预警 / 燃尽） --------------------------------


class ChangeTypeCount(BaseModel):
    change_type_id: int
    type_name: str
    count: int


class TaskStateCount(BaseModel):
    """五色任务构成的其中一格（服务端固定按 todo/soon/overdue/done/late 顺序输出，**含 0**）。

    带 `label` 是为了让前端不必自己维护文案；带 `state` 是为了让前端能用
    `TASK_STATE_META[state] ?? 兜底` 取色（门禁 P8）。
    """

    state: str
    label: str
    count: int


class OverdueBucket(BaseModel):
    """超期时长分档的其中一格（服务端固定输出 4 档，**含 0**）。

    前端据此判断「≥3 档有值 → 升格为柱图，否则退化成一行文字」。
    """

    label: str
    count: int



class ChangeUrgentBrief(BaseModel):
    """项目卡上「最紧急的那张单」一行。"""

    change_id: int
    title: str
    owner: Optional[str] = None
    overdue_days: int = 0
    overdue_leaf: int = 0
    material_pn: str = ""


class ChangeProjectOverview(BaseModel):
    """项目卡片墙的一行（老板视角）。

    两种完成率都要（用户确认）：
      - task_done_rate   按该项目所有叶子任务算
      - change_done_rate 按变更单算（已完成 ÷ 未作废）
    """

    project_id: int
    project_code: str
    project_name: str
    total: int = 0
    active: int = 0
    done: int = 0
    voided: int = 0
    archived: int = 0
    """★ 未完成的待办项数（叶子任务里 is_done 为假的个数）。

    口径与首页「最需要盯的待办项」一致：**已完成的事不算待办**（迟交完成也不算）。
    项目饼图的「待办项数」口径用它 —— 本模块的「待办项」= `change_tasks` 实体，
    不是变更单。此前该口径错写成 `total − voided − archived`（数的是"单"），
    既与标签不符，改 total 口径后还会重复减作废导致静默错数。
    """
    open_tasks: int = 0
    overdue_changes: int = 0
    overdue_tasks: int = 0
    near_changes: int = 0
    near_tasks: int = 0
    task_done_rate: float = 0.0
    change_done_rate: float = 0.0
    """★ 平均时间进度 / 平均偏差（首页偏差榜用）。

    avg_deviation = avg_time_rate − avg_task_done_rate，> 0 表示时间跑在人前面（滞后）。
    只统计未作废、未归档的变更单。
    """
    avg_time_rate: float = 0.0
    avg_deviation: float = 0.0
    type_counts: list[ChangeTypeCount] = Field(default_factory=list)
    most_urgent: Optional[ChangeUrgentBrief] = None


class ChangeSummary(BaseModel):
    """全局统计（Dashboard 卡 5 与变更页页头共用同一口径）。"""

    total: int = 0
    active: int = 0
    done: int = 0
    voided: int = 0
    archived: int = 0
    overdue_changes: int = 0
    overdue_tasks: int = 0
    near_changes: int = 0
    near_tasks: int = 0
    project_count: int = 0
    material_count: int = 0
    type_count: int = 0
    type_counts: list[ChangeTypeCount] = Field(default_factory=list)
    """★ 以下三项供首页可视化（2026-10-06 新增）。

    口径提醒：全部只数**叶子任务**、只算**未归档且未作废**的单
    （与 overdue_tasks / near_tasks 完全同源，可直接相加校验）。
    """
    task_state_counts: list[TaskStateCount] = Field(default_factory=list)
    overdue_buckets: list[OverdueBucket] = Field(default_factory=list)
    unassigned_tasks: int = 0
    """拖得最久的那一项超期了多少天（0 = 当前没有超期项）"""
    max_overdue_days: int = 0


class ChangeAlertItem(BaseModel):
    """预警明细行（必带责任人；未指派单独标灰）。"""

    level: Literal["overdue", "near", "late"]
    task_id: int
    task_name: str
    task_level: int = 1
    change_id: int
    change_title: str
    project_id: int
    project_code: str = ""
    project_name: str = ""
    material_pn: str = ""
    material_name: str = ""
    owner: Optional[str] = None
    is_unassigned: bool = False
    plan_end: Optional[date] = None
    days: int = 0


class BurndownPoint(BaseModel):
    date: date
    plan_remaining: int
    actual_remaining: Optional[int] = None


class ChangeBurndown(BaseModel):
    """燃尽数据。只依赖已录入数据，不推算、不补假点。

    `step` = 取样步长（天）。1 = 逐日；7 = 跨度 > 180 天时为控体量按周取样，
    前端据此在标题里注明「按周取样」。
    """

    total: int = 0
    start: Optional[date] = None
    end: Optional[date] = None
    step: int = 1
    points: list[BurndownPoint] = Field(default_factory=list)


# ---- 归档 / 导入导出 -------------------------------------------------------


class ChangeArchiveRead(BaseModel):
    id: int
    scope: ArchiveScope
    project_id: int
    project_code: str = ""
    project_name: str = ""
    change_id: Optional[int] = None
    change_title: Optional[str] = None
    archived_at: datetime
    remark: Optional[str] = None


class ChangeImportResult(BaseModel):
    created_changes: int = 0
    updated_changes: int = 0
    created_tasks: int = 0
    updated_tasks: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
