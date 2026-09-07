import axios from "axios";
import type {
  Product,
  ProductCreateInput,
  ProductListParams,
  ProductListResponse,
  ProductUpdateInput,
} from "../types/product";
import type { Supplier, SupplierCreateInput, SupplierUpdateInput } from "../types/supplier";
import type {
  Material,
  MaterialCreateInput,
  MaterialListParams,
  MaterialListResponse,
} from "../types/material";
import type {
  SupplyRelation,
  SupplyRelationCreateInput,
  SupplyRelationListParams,
  SupplyRelationListResponse,
  SupplyRelationProjectBrief,
} from "../types/supplyRelation";
import type {
  Project,
  ProjectBomUpdateInput,
  ProjectCreateInput,
  ProjectDemandUpdateInput,
  ProjectListParams,
  ProjectListResponse,
  ProjectSupplyRelation,
  ProjectSupplyRelationCreateInput,
  ProjectSupplyRelationQuickCreateInput,
  ProjectSupplyRelationUpdateInput,
  ProjectUpdateInput,
} from "../types/project";
import type {
  Rule,
  RuleCreateInput,
  RuleListResponse,
  RuleUpdateInput,
} from "../types/rule";
import type {
  ShareDashboardStats,
  ShareImportResult,
  ShareProjectBrief,
  ShareQuadrantPoint,
  ShareRecord,
  ShareRecordCreateInput,
  ShareRecordListResponse,
  ShareRecordUpdateInput,
  ShareRiskItem,
  ShareSummary,
} from "../types/share";
import type {
  InventoryDayUpdateInput,
  InventoryFilter,
  InventoryPlan,
  InventoryPlanUpdateInput,
  InventoryImportResult,
  InventorySummary,
} from "../types/inventory";

/** Axios 实例：开发环境经 Vite 代理转发到后端，无需处理跨域 */
export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

export const productApi = {
  /** 分页查询产品列表 */
  list(params: ProductListParams) {
    return apiClient.get<ProductListResponse>("/products", { params }).then((res) => res.data);
  },

  /** 按 ID 查询产品 */
  get(id: number) {
    return apiClient.get<Product>(`/products/${id}`).then((res) => res.data);
  },

  /** 新增产品 */
  create(data: ProductCreateInput) {
    return apiClient.post<Product>("/products", data).then((res) => res.data);
  },

  /** 部分更新产品 */
  update(id: number, data: ProductUpdateInput) {
    return apiClient.patch<Product>(`/products/${id}`, data).then((res) => res.data);
  },

  /** 软删除产品 */
  remove(id: number) {
    return apiClient.delete(`/products/${id}`);
  },
};

export const supplierApi = {
  /** 查询全部供应商（主数据 + 地图点位） */
  list() {
    return apiClient.get<Supplier[]>("/suppliers").then((res) => res.data);
  },

  /** 新增供应商主数据（仅身份字段，不含项目信息） */
  create(data: SupplierCreateInput) {
    return apiClient.post<Supplier>("/suppliers", data).then((res) => res.data);
  },

  /** 更新供应商（地图录入时补全地图字段） */
  update(id: number, data: SupplierUpdateInput) {
    return apiClient.patch<Supplier>(`/suppliers/${id}`, data).then((res) => res.data);
  },

  /** 删除供应商 */
  remove(id: number) {
    return apiClient.delete(`/suppliers/${id}`);
  },
};

export const materialApi = {
  /** 分页查询物料列表 */
  list(params: MaterialListParams) {
    return apiClient.get<MaterialListResponse>("/materials", { params }).then((res) => res.data);
  },

  /** 新增物料 */
  create(data: MaterialCreateInput) {
    return apiClient.post<Material>("/materials", data).then((res) => res.data);
  },

  /** 删除物料 */
  remove(id: number) {
    return apiClient.delete(`/materials/${id}`);
  },
};

export const supplyRelationApi = {
  /** 分页查询供应关系（四元组，其他模块统一入口） */
  list(params: SupplyRelationListParams) {
    return apiClient.get<SupplyRelationListResponse>("/supply-relations", { params }).then((res) => res.data);
  },

  /** 全量供应关系（供下拉/选择器消费） */
  options() {
    return apiClient.get<SupplyRelation[]>("/supply-relations/options").then((res) => res.data);
  },

  /** 新增供应关系（物料 + 供应商，全局唯一） */
  create(data: SupplyRelationCreateInput) {
    return apiClient.post<SupplyRelation>("/supply-relations", data).then((res) => res.data);
  },

  /** 删除供应关系（级联删除项目明细） */
  remove(id: number) {
    return apiClient.delete(`/supply-relations/${id}`);
  },

  /** 该四元组被哪些项目引用 */
  projects(id: number) {
    return apiClient.get<SupplyRelationProjectBrief[]>(`/supply-relations/${id}/projects`).then((res) => res.data);
  },
};

export const projectApi = {
  /** 分页查询项目 */
  list(params: ProjectListParams) {
    return apiClient.get<ProjectListResponse>("/projects", { params }).then((res) => res.data);
  },

  /** 新增项目 */
  create(data: ProjectCreateInput) {
    return apiClient.post<Project>("/projects", data).then((res) => res.data);
  },

  /** 更新项目 */
  update(id: number, data: ProjectUpdateInput) {
    return apiClient.patch<Project>(`/projects/${id}`, data).then((res) => res.data);
  },

  /** 删除项目 */
  remove(id: number) {
    return apiClient.delete(`/projects/${id}`);
  },

  /** 项目下的供应明细（四元组 + 项目字段） */
  relations(projectId: number) {
    return apiClient.get<ProjectSupplyRelation[]>(`/projects/${projectId}/relations`).then((res) => res.data);
  },

  /** 项目下关联的供应商（去重，含地图点位字段，Dashboard 地图切片用） */
  suppliers(projectId: number) {
    return apiClient.get<Supplier[]>(`/projects/${projectId}/suppliers`).then((res) => res.data);
  },

  /** 项目下关联的物料（按 PN 去重，供需管理等模块的物料选择器用） */
  materials(projectId: number) {
    return apiClient.get<Material[]>(`/projects/${projectId}/materials`).then((res) => res.data);
  },

  /** 挂载供应关系到项目 */
  link(projectId: number, data: ProjectSupplyRelationCreateInput) {
    return apiClient.post<ProjectSupplyRelation>(`/projects/${projectId}/relations`, data).then((res) => res.data);
  },

  /** 快速录入项目明细（四元组一行式，自动建主数据并挂载） */
  quickAdd(projectId: number, data: ProjectSupplyRelationQuickCreateInput) {
    return apiClient
      .post<ProjectSupplyRelation>(`/projects/${projectId}/relations/quick-add`, data)
      .then((res) => res.data);
  },

  /** 更新项目供应明细（维护项目专属字段） */
  updateRelation(projectId: number, linkId: number, data: ProjectSupplyRelationUpdateInput) {
    return apiClient
      .patch<ProjectSupplyRelation>(`/projects/${projectId}/relations/${linkId}`, data)
      .then((res) => res.data);
  },

  /** 批量维护某物料的客户需求（1-12月，同步到该项目下该物料所有供应明细） */
  updateDemand(projectId: number, data: ProjectDemandUpdateInput) {
    return apiClient
      .put<ProjectSupplyRelation[]>(`/projects/${projectId}/demand`, data)
      .then((res) => res.data);
  },

  /** 批量维护某物料的 BOM 用量系数（项目×物料，同步到该项目下该物料所有供应明细） */
  updateBom(projectId: number, data: ProjectBomUpdateInput) {
    return apiClient
      .put<ProjectSupplyRelation[]>(`/projects/${projectId}/bom`, data)
      .then((res) => res.data);
  },

  /** 解除项目-供应关系 */
  unlink(projectId: number, linkId: number) {
    return apiClient.delete(`/projects/${projectId}/relations/${linkId}`);
  },
};

export const ruleApi = {
  /** 分页查询规则 */
  list(params?: { page?: number; page_size?: number; module?: string; keyword?: string }) {
    return apiClient.get<RuleListResponse>("/rules", { params }).then((res) => res.data);
  },

  /** 新增规则 */
  create(data: RuleCreateInput) {
    return apiClient.post<Rule>("/rules", data).then((res) => res.data);
  },

  /** 更新规则 */
  update(id: number, data: RuleUpdateInput) {
    return apiClient.patch<Rule>(`/rules/${id}`, data).then((res) => res.data);
  },

  /** 删除规则 */
  remove(id: number) {
    return apiClient.delete(`/rules/${id}`);
  },
};

export const shareApi = {
  /** Dashboard 联动统计（份额波动/独供，跨项目最新月） */
  dashboardStats() {
    return apiClient.get<ShareDashboardStats>("/share/dashboard-stats").then((res) => res.data);
  },

  /** 有份额数据的项目列表 */
  projects() {
    return apiClient.get<ShareProjectBrief[]>("/share/projects").then((res) => res.data);
  },

  /** KPI 汇总（项目 × 月） */
  summary(projectId: number, month: string) {
    return apiClient.get<ShareSummary>("/share/summary", { params: { project_id: projectId, month } }).then((res) => res.data);
  },

  /** 风险排行（独供 > 波动 > 偏差 > 错配） */
  risks(projectId: number, month: string, top = 10) {
    return apiClient.get<ShareRiskItem[]>("/share/risks", { params: { project_id: projectId, month, top } }).then((res) => res.data);
  },

  /** 份额 × 评分四象限散点 */
  quadrant(projectId: number, month: string) {
    return apiClient.get<ShareQuadrantPoint[]>("/share/quadrant", { params: { project_id: projectId, month } }).then((res) => res.data);
  },

  /** 明细列表 */
  records(projectId: number, month: string, keyword?: string) {
    return apiClient
      .get<ShareRecordListResponse>("/share/records", { params: { project_id: projectId, month, keyword } })
      .then((res) => res.data);
  },

  /** 手动新增记录 */
  create(data: ShareRecordCreateInput) {
    return apiClient.post<ShareRecord>("/share/records", data).then((res) => res.data);
  },

  /** 手动修改（自动重算 + 标记手动） */
  update(id: number, data: ShareRecordUpdateInput) {
    return apiClient.put<ShareRecord>(`/share/records/${id}`, data).then((res) => res.data);
  },

  /** 删除份额记录（不可逆；后端会重算项目×物料剩余记录的加权分/建议配额/风险） */
  delete(id: number) {
    return apiClient.delete(`/share/records/${id}`).then((res) => res.data);
  },

  /** Excel 导入（服务端本地文件路径） */
  importExcel(projectId: number, month: string, filePath: string) {
    return apiClient
      .post<ShareImportResult>("/share/import", null, { params: { project_id: projectId, month, file_path: filePath } })
      .then((res) => res.data);
  },

  /** 月末结转：本月 → 下月空档 */
  rollover(projectId: number, fromMonth: string, toMonth: string) {
    return apiClient
      .post<ShareSummary>("/share/rollover", null, { params: { project_id: projectId, from_month: fromMonth, to_month: toMonth } })
      .then((res) => res.data);
  },
};

export const inventoryApi = {
  /** 推算单元列表（含 30 天矩阵；safe/excess 影响预警判定） */
  plans(filters: InventoryFilter = {}) {
    return apiClient.get<InventoryPlan[]>("/inventory/plans", { params: filters }).then((res) => res.data);
  },

  /** 顶部 KPI 四卡（当前筛选视图，按 PN 去重） */
  summary(filters: InventoryFilter = {}) {
    return apiClient.get<InventorySummary>("/inventory/summary", { params: filters }).then((res) => res.data);
  },

  /** 改 LeadTime / 初始现有库存（左冻结列） */
  updatePlan(id: number, data: InventoryPlanUpdateInput) {
    return apiClient.patch<InventoryPlan>(`/inventory/plans/${id}`, data).then((res) => res.data);
  },

  /** 批量改某日单元格（落库即重算，返回整行新矩阵） */
  updateDays(id: number, cells: InventoryDayUpdateInput[]) {
    return apiClient.put<InventoryPlan>(`/inventory/plans/${id}/days`, cells).then((res) => res.data);
  },

  /** Excel 导入（服务端本地文件路径） */
  importExcel(filePath: string) {
    return apiClient
      .post<InventoryImportResult>("/inventory/import", null, { params: { file_path: filePath } })
      .then((res) => res.data);
  },
};
