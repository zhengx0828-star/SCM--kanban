"""SQLAlchemy ORM 模型定义。

数据模型采用「三层五表」设计（主数据 / 供应关系 / 项目维度）：

L1 主数据层（全局、干净、跨模块复用）
  - suppliers  供应商（code 唯一）
  - materials  物料（pn 唯一）

L2 供应关系主数据（四元组：物料PN · 物料名称 · 供应商名称 · 供应商代码）
  - supply_relations  UNIQUE(material_id, supplier_id)
    同一物料多家供应商 = 多条；同一供应商供多物料 = 多条；不含任何项目信息。
    其他模块统一从这里取基础数据，再按需关联项目维度。

L3 项目维度（项目是一等公民，每个项目有独立信息）
  - projects                      项目主数据（code 唯一）
  - project_supply_relations      项目下的供应明细：四元组 + 项目专属字段
                                  UNIQUE(project_id, supply_relation_id)
                                  各模块的「特殊要求」字段都扩展在这里，不动主数据层。
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Product(Base):
    """产品实体。

    is_deleted 用于软删除：删除操作仅将该字段置为 True，
    所有业务查询默认过滤掉已删除记录，便于数据审计与恢复。

    SKU 唯一性使用「部分唯一索引」（仅对未删除记录生效），
    因此软删除后可以安全地复用该 SKU 创建新产品。
    """

    __tablename__ = "products"
    __table_args__ = (
        Index("uq_products_sku_active", "sku", unique=True, sqlite_where=text("is_deleted = 0")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment="产品名称")
    sku: Mapped[str] = mapped_column(String(64), nullable=False, comment="SKU 编码（唯一性见部分索引）")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="产品描述")
    price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, comment="销售价格")
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="库存数量")
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True, comment="产品分类")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="状态: active/inactive/archived")
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True, comment="软删除标记")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Supplier(Base):
    """L1 供应商主数据（code 唯一，跨项目共享，不含项目信息）。

    同时承载 Dashboard 地图点位字段（城市/经纬度/风险等级），可空。
    """

    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, comment="供应商代码（主数据唯一标识）")
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment="供应商名称")
    # 底表供应商可暂无地图信息；城市/经纬度为地图场景字段，可空
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True, comment="所在城市")
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, comment="经度（WGS84）")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, comment="纬度（WGS84）")
    contact_person: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="联系人")
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True, comment="联系电话")
    supply_material: Mapped[str | None] = mapped_column(String(200), nullable=True, comment="主要供应物料（冗余文本）")
    # 风险等级：红/黄/绿为地图点位颜色，NULL = 未评估。
    # 判定规则未定，录入时不带颜色；规则确定后由对应模块联动填充（project_supply_relations 扩展点）。
    risk_level: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="风险等级: red/yellow/green，NULL=未评估")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # 供应关系（四元组主数据）
    supply_relations: Mapped[list["SupplyRelation"]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def materials(self) -> list["Material"]:
        """该供应商供应的物料列表（供 Pydantic 序列化）。"""
        return [rel.material for rel in self.supply_relations]


class BaseSite(Base):
    """L1 基地主档（我方生产基地 / 仓库）。

    与供应商所在地（suppliers.city）无关：基地是「我们」收货与存放库存的地点，
    库存信号塔的推算单元按 项目 × 物料 × 供应商 × 基地 建立，因此基地必须是
    受控主数据而非自由文本，避免「常州 / 常州市 / 常州基地」这类同义异名。
    """

    __tablename__ = "base_sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True, comment="基地编码（唯一）")
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="基地名称")
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="所在城市")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Material(Base):
    """L1 物料主档（物料 PN 为唯一标识）。"""

    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    pn: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True, comment="物料 PN（唯一）")
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment="物料名称")
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True, comment="物料分类")
    spec: Mapped[str | None] = mapped_column(String(200), nullable=True, comment="规格型号")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # 供应关系（四元组主数据）
    supply_relations: Mapped[list["SupplyRelation"]] = relationship(
        back_populates="material", cascade="all, delete-orphan", lazy="selectin"
    )


class SupplyRelation(Base):
    """L2 供应关系主数据（四元组：物料PN · 物料名称 · 供应商名称 · 供应商代码）。

    同一物料 + 同一供应商 全局只有一条，不含任何项目信息。
    其他模块调用 /api/supply-relations 拿基础数据。
    """

    __tablename__ = "supply_relations"
    __table_args__ = (UniqueConstraint("material_id", "supplier_id", name="uq_supply_relation_material_supplier"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    # 供应商总产能（该供应商在该物料上的整体月产能，12 个月 JSON 数组）。
    # 与 project_supply_relations.capacity（分给某项目的额度）构成两层：
    #   本字段 = 供应商侧的总盘子；项目级字段 = 这个盘子里分给该项目的份额。
    capacity: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="供应商总产能（1-12月 JSON 数组；物料×供应商级，全项目共用总量）"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    material: Mapped[Material] = relationship(back_populates="supply_relations")
    supplier: Mapped[Supplier] = relationship(back_populates="supply_relations")

    # 项目明细（该四元组被哪些项目引用）
    project_links: Mapped[list["ProjectSupplyRelation"]] = relationship(
        back_populates="supply_relation", cascade="all, delete-orphan", lazy="selectin"
    )

    # 份额管理（按月快照）
    share_records: Mapped[list["ShareRecord"]] = relationship(
        back_populates="supply_relation", cascade="all, delete-orphan", lazy="selectin"
    )


class Project(Base):
    """L3 项目主数据（项目是一等公民，code 唯一）。"""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, comment="项目代码（唯一）")
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment="项目名称")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="状态: active/planning/closed")
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="项目负责人")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="项目描述")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # 项目下的供应明细
    supply_links: Mapped[list["ProjectSupplyRelation"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )


class ProjectSupplyRelation(Base):
    """L3 项目供应明细：四元组 + 项目专属字段。

    UNIQUE(project_id, supply_relation_id)：同一项目下同一供应关系只有一条。
    各模块的「特殊要求」字段扩展在这里（role / 单价 / 配额 / 交期 / 有效期等），
    不改动 L1/L2 主数据层。
    """

    __tablename__ = "project_supply_relations"
    __table_args__ = (UniqueConstraint("project_id", "supply_relation_id", name="uq_project_supply_relation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    supply_relation_id: Mapped[int] = mapped_column(
        ForeignKey("supply_relations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True, comment="该项目下的供应商角色（主供/备选/认证中/指定等）")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否主供")
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True, comment="该项目下采购单价")
    quota: Mapped[str | None] = mapped_column(String(50), nullable=True, comment="分配配额（如 60%/40%）")
    lead_time: Mapped[str | None] = mapped_column(String(50), nullable=True, comment="标准交付周期")
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True, comment="有效期起")
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True, comment="有效期止")
    # 供需管理模块特殊字段（JSON 数组，长度 12 = 1-12 月）：
    # demand 为客户需求（物料行冗余存客户产品总需求：1 台产品对该物料的需求预测，
    #         同一项目同物料的各行保持一致，录入时批量同步，用于和该物料供应商产能对比）；
    # capacity 为供应商产能（供应商级：每家供应商各自维护）；
    # bom_factor 为该物料 BOM 用量系数（1 台产品需要多少个该物料；项目×物料，单一值全年通用；
    #         物料需求 = 客户需求 × bom_factor）。
    demand: Mapped[str | None] = mapped_column(Text, nullable=True, comment="客户需求（1-12月 JSON 数组；物料行冗余，同项目同物料各行一致）")
    capacity: Mapped[str | None] = mapped_column(Text, nullable=True, comment="供应商产能（1-12月 JSON 数组；供应商级）")
    bom_factor: Mapped[float | None] = mapped_column(Float, nullable=True, comment="BOM 用量系数（1 台产品需多少个该物料；项目×物料，单一值全年通用）")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped[Project] = relationship(back_populates="supply_links")
    supply_relation: Mapped[SupplyRelation] = relationship(back_populates="project_links")


class ShareRecord(Base):
    """份额管理：项目 × L2 供应关系 × 月份的份额快照。

    按月一条记录，保留历史（UNIQUE(project_id, supply_relation_id, month)）。
    份额是项目级数据：同一物料×供应商在不同项目中的份额可不同（L3 维度）。
    字段口径见规则页「份额管理」SOP：
      - share_current  本月系统份额（%），公式 = Σ(基地份额 × 拉线数) ÷ Σ拉线数
      - share_prev     上期份额（%），rollover 时自动带入
      - quota_prev     上月建议配额（%），用于「建议偏差」= |share_current − quota_prev|
      - quota_suggested 下月建议配额（%）= 计算配额四舍五入取整
      - is_sole        独供 = 同项目同物料仅 1 家供应商（自动推导，项目内判定）
      - q/d/c_score    QDC 离散五档：1 / 0.7 / 0.5 / 0.3 / 0
      - weighted_score 加权分 = Q·wQ + D·wD + C·wC（后端算）
      - weight_scheme  实际生效权重方案 cost / quality（按项目内同物料 Q 一致性判定）
      - bases          基地快照 JSON：[{base, share, lines}]（每条记录内含「拉线数」，
                       同一基地在不同物料的拉线数允许不同——以录入为准，自动算口径一致）
      - edited_manually 手动改过标记（Excel 导入时保护，不覆盖手改值）
    """

    __tablename__ = "share_records"
    __table_args__ = (UniqueConstraint("project_id", "supply_relation_id", "month", name="uq_share_project_relation_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属项目（份额为项目级数据）")
    supply_relation_id: Mapped[int] = mapped_column(
        ForeignKey("supply_relations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    month: Mapped[str] = mapped_column(String(7), nullable=False, index=True, comment="月份快照（YYYY-MM）")
    share_current: Mapped[float | None] = mapped_column(Float, nullable=True, comment="本月系统份额（%）")
    share_prev: Mapped[float | None] = mapped_column(Float, nullable=True, comment="上期份额（%），rollover 带入")
    quota_prev: Mapped[float | None] = mapped_column(Float, nullable=True, comment="上月建议配额（%），用于建议偏差")
    quota_suggested: Mapped[float | None] = mapped_column(Float, nullable=True, comment="下月建议配额（%）= 计算配额四舍五入")
    is_sole: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="独供：同项目同物料仅 1 家供应商")
    q_score: Mapped[float | None] = mapped_column(Float, nullable=True, comment="质量评分（五档：1/0.7/0.5/0.3/0）")
    d_score: Mapped[float | None] = mapped_column(Float, nullable=True, comment="交付评分（五档）")
    c_score: Mapped[float | None] = mapped_column(Float, nullable=True, comment="成本评分（五档）")
    weighted_score: Mapped[float | None] = mapped_column(Float, nullable=True, comment="加权分 = Q·wQ + D·wD + C·wC")
    weight_scheme: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="生效权重方案: cost/quality")
    bases: Mapped[str | None] = mapped_column(Text, nullable=True, comment="基地快照 JSON：[{base, share, lines}]（每条记录自含拉线数，1-4 个基地）")
    edited_manually: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="手动修改标记（导入保护）")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped[Project] = relationship()
    supply_relation: Mapped[SupplyRelation] = relationship(back_populates="share_records")


class Rule(Base):
    """规则条目：各模块的 SOP、导入规则、注意事项等。

    后续根据各模块迭代补充；按 module 分组、sort_order 排序。
    """

    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    module: Mapped[str] = mapped_column(String(50), nullable=False, index=True, comment="所属模块（项目/物料/供应商/供应关系/Excel导入/通用...）")
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="规则标题")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="规则正文（支持换行）")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="排序（同 module 内升序）")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class InventoryPlan(Base):
    """库存信号塔：动态库存与 DOH 风险监控看板 —— 推算单元（项目 × 物料 × 供应商 × 基地）。

    一个推算单元 = 一条 SKU-供应商-基地 链：初始现有库存 + 采购提前期 + 历史需求（算 COV）+
    未来预测需求（月度值，服务端按自然日摊日均）→ 30 天日度滚动推算。

    UNIQUE(project_id, material_id, supplier_id, base_id)：同一项目同一基地同一物料同一供应商
    只有一条计划。基地为受控主数据（base_sites），供应商来自底表供应关系。

    需求数据来源两种模式（由 hist_json / fcast_json 是否为空决定）：
      - 均为空：与底表联动 —— 客户需求（project_supply_relations.demand）按 BOM 系数折算，
                供需管理录入后库存推算自动跟随；
      - 非空：使用本表快照（Excel 导入或早期手工录入的历史数据），不再跟随底表。

    手工修正（逐日 demand_override / manual_demand / manual_in / ending_override）
    落在 InventoryDay 表（按具体日期存，滚动窗口不错位）。
    口径与公式见规则页「库存管理」SOP。
    """

    __tablename__ = "inventory_plans"
    __table_args__ = (
        UniqueConstraint("project_id", "material_id", "supplier_id", "base_id", name="uq_inventory_link"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    base_id: Mapped[int] = mapped_column(ForeignKey("base_sites.id", ondelete="CASCADE"), nullable=False, index=True)
    lead_time_days: Mapped[float] = mapped_column(Float, nullable=False, default=7, comment="采购提前期（天），参与安全库存与不可逆断货判定")
    on_hand: Mapped[float] = mapped_column(Float, nullable=False, default=0, comment="初始现有库存（推算窗口 T0 期初）")
    hist_json: Mapped[str | None] = mapped_column(Text, nullable=True, comment="历史需求 JSON：[{m:'YYYY-MM', q:数量}, ...]（算 COV；为空则改用底表客户需求）")
    fcast_json: Mapped[str | None] = mapped_column(Text, nullable=True, comment="未来预测需求 JSON：[{m:'YYYY-MM', q:月度总量}, ...]（摊日均；为空则改用 客户需求×BOM 系数）")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped[Project] = relationship()
    material: Mapped["Material"] = relationship()
    supplier: Mapped["Supplier"] = relationship()
    base_site: Mapped["BaseSite"] = relationship()
    days: Mapped[list["InventoryDay"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", lazy="selectin"
    )


class InventoryDay(Base):
    """库存信号塔：某推算单元的某自然日的手工修正与覆盖数据。

    系统预测需求不落库（由未来预测月度值按自然日摊日均实时生成）；
    本表只存「人改过」的东西，无记录 = 全系统值。UNIQUE(plan_id, date) 按具体日期钉住，
    30 天窗口随今天滚动时手工修正不会错位。
      - demand_override  直接改写该日系统预测需求（覆盖摊日均）
      - manual_demand    手工修正需求（在系统预测之上追加，可正可负）
      - manual_in        手工修正入库（当天到货入库量，可正可负）
      - ending_override  直接覆盖该日期末库存（盘点/实际差异；后续日基于它重算）
    """

    __tablename__ = "inventory_days"
    __table_args__ = (UniqueConstraint("plan_id", "date", name="uq_inventory_plan_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("inventory_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True, comment="自然日（窗口随今天滚动，手工修正按日钉住）")
    demand_override: Mapped[float | None] = mapped_column(Float, nullable=True, comment="系统预测需求覆盖值（改过系统预测格才落库）")
    manual_demand: Mapped[float] = mapped_column(Float, nullable=False, default=0, comment="手工修正需求")
    manual_in: Mapped[float] = mapped_column(Float, nullable=False, default=0, comment="手工修正入库")
    ending_override: Mapped[float | None] = mapped_column(Float, nullable=True, comment="期末库存覆盖（直接改过期末格才落库）")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    plan: Mapped[InventoryPlan] = relationship(back_populates="days")


# ---------------------------------------------------------------------------
# 变更管理（过程数据层）
#
# 与前面几张表的关系：变更管理记录「稳态数据被改变的过程」，不动任何既有表。
# 锚点 = 项目 × 物料（PN）。一张变更单 = 一个物料；同物料同项目可有多张。
#
# 设计要点（口径见 docs/changes-redesign/02-方案定稿-v0.2.md §5）：
#   - 任务的「五色状态」（进行中/临期/超期未完成/按时完成/迟交完成）**不落库**，
#     全部由 plan_end + is_done + done_at + 今天 推导 → 结构里没有 status 字段。
#   - 进度百分比也不落库（纯派生：完成率 = 已完叶子 ÷ 叶子总数）。
#   - level 由后端按 parent.level + 1 推导，封顶 5 层。
# ---------------------------------------------------------------------------


class ChangeType(Base):
    """变更类型字典（全局，跨项目共用）。

    用户明确：类型「只是一个名字」—— 不做标准任务清单、不做默认负责人/默认周期。
    被任何变更单引用过的类型只能停用（is_active=False），不能删除，
    避免历史变更单出现孤儿引用。
    """

    __tablename__ = "change_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="类型名（如 供应商切换 / 设计变更 / 成本优化）")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="排序（升序）")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="启用标记；停用而非删除")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Change(Base):
    """变更单：项目 × 物料 × 变更类型。

    状态三态（无审批、无草稿）：
      - active  进行中（默认）
      - done    已完成（所有叶子勾完自动进入；也可手动覆盖）
      - voided  已作废（变更中途停止执行；不参与统计与预警）

    plan_start / plan_end 是**冗余汇总字段**（服务端从叶子任务算出后回写），
    用于列表排序与卡片预警，避免每次查询都递归任务树。
    """

    __tablename__ = "changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True, comment="序号（不做 CHG-xxxx 单号）")
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True)
    change_type_id: Mapped[int] = mapped_column(ForeignKey("change_types.id"), nullable=False, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True, comment="涉及的供应商（可选）")
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="变更标题")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="变更内容")
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="总责任人（自由文本，任务未填时继承它）")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True, comment="active 进行中 / done 已完成 / voided 已作废")
    plan_start: Mapped[date | None] = mapped_column(Date, nullable=True, comment="计划开始（由叶子任务汇总，冗余）")
    plan_end: Mapped[date | None] = mapped_column(Date, nullable=True, index=True, comment="计划结束（由叶子任务汇总，冗余；预警依据）")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, comment="实际完成时刻（自动写入，用于算整单迟交天数）")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True, comment="归档时刻（NULL = 未归档；归档后只读）")
    is_removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True, comment="软删除标记")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship()
    material: Mapped["Material"] = relationship()
    supplier: Mapped["Supplier | None"] = relationship()
    change_type: Mapped["ChangeType"] = relationship()
    tasks: Mapped[list["ChangeTask"]] = relationship(back_populates="change")


class ChangeTask(Base):
    """待办项 / 子项（单表自引用）。

    parent_id IS NULL → 一级待办项；非空 → 子项。level 1..5（封顶 5 层）。
    **只有叶子填真实的 plan_start / plan_end**；上层由子项汇总（服务层计算，不落库）。

    勾选规则（用户确认）：
      - 叶子直接勾；
      - 有子项的父项：子项全勾 → 父项自动已勾；点父项 = 一键全勾 / 全取消。
    done_at 在勾选瞬间由后端自动写入（用户零录入），用于区分
    「超期未完成」与「迟交完成」，也是燃尽图实际线的唯一数据源。
    """

    __tablename__ = "change_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    change_id: Mapped[int] = mapped_column(ForeignKey("changes.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("change_tasks.id", ondelete="CASCADE"), nullable=True, index=True, comment="NULL = 一级待办项"
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="层级 1..5（后端按 parent.level+1 推导）")
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="同级排序（甘特图自上而下）")
    name: Mapped[str] = mapped_column(String(200), nullable=False, comment="任务名")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="说明")
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="责任人（留空则继承变更单总责任人）")
    plan_start: Mapped[date | None] = mapped_column(Date, nullable=True, comment="计划开始（叶子填真实值）")
    plan_end: Mapped[date | None] = mapped_column(Date, nullable=True, index=True, comment="计划完成（预警依据）")
    is_done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True, comment="是否完成")
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, comment="完成时刻（勾选瞬间自动写；燃尽图实际线唯一来源）")
    is_removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True, comment="软删除标记")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    change: Mapped["Change"] = relationship(back_populates="tasks")
    parent: Mapped["ChangeTask | None"] = relationship(remote_side="ChangeTask.id", back_populates="children")
    children: Mapped[list["ChangeTask"]] = relationship(back_populates="parent")


class ChangeArchive(Base):
    """归档记录（只作用在变更管理模块内部）。

    ⚠️ 项目是供需/份额/库存共用的主数据：整项目归档**只冻结该项目下的变更单**，
    projects 表一个字段都不动，其他模块完全不受影响。

    scope='project' → 整项目归档（change_id 为 NULL）
    scope='change'  → 单张变更单归档（change_id 必填）
    """

    __tablename__ = "change_archives"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(10), nullable=False, comment="project 整项目 / change 单张")
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    change_id: Mapped[int | None] = mapped_column(ForeignKey("changes.id", ondelete="CASCADE"), nullable=True, index=True)
    archived_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="归档说明")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
