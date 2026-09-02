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
