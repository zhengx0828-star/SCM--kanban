/** L3 项目主数据与项目供应明细 */

/** 项目状态 */
export type ProjectStatus = "active" | "planning" | "closed";

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; className: string }> = {
  active: { label: "进行中", className: "bg-green-50 text-green-700 dark:bg-green-950/50" },
  planning: { label: "规划中", className: "bg-amber-50 text-amber-700 dark:bg-amber-950/50" },
  closed: { label: "已关闭", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
};

/** 项目实体 */
export interface Project {
  id: number;
  code: string;
  name: string;
  status: ProjectStatus;
  owner: string | null;
  description: string | null;
  /** 项目下供应明细条数 */
  relation_count: number;
  created_at: string;
  updated_at: string;
}

/** 新增/编辑项目请求体 */
export interface ProjectCreateInput {
  code: string;
  name: string;
  status: ProjectStatus;
  owner?: string | null;
  description?: string | null;
}

export type ProjectUpdateInput = Partial<ProjectCreateInput>;

/** 项目分页查询参数 */
export interface ProjectListParams {
  page: number;
  page_size: number;
  keyword?: string;
}

/** 项目分页响应 */
export interface ProjectListResponse {
  items: Project[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 项目供应明细（四元组 + 项目专属字段） */
export interface ProjectSupplyRelation {
  id: number;
  project_id: number;
  supply_relation_id: number;
  pn: string;
  material_name: string;
  supplier_name: string;
  supplier_code: string;
  role: string | null;
  is_primary: boolean;
  unit_price: number | null;
  quota: string | null;
  lead_time: string | null;
  valid_from: string | null;
  valid_to: string | null;
  /** 客户需求（1-12月，供需管理模块；物料行冗余，同项目同物料各行一致） */
  demand: number[] | null;
  /** 供应商产能（1-12月，供需管理模块；供应商级） */
  capacity: number[] | null;
  /** BOM 用量系数（1 台产品需多少个该物料；项目×物料，单一值全年通用） */
  bom_factor: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

/** 挂载供应关系到项目（带项目专属字段） */
export interface ProjectSupplyRelationCreateInput {
  supply_relation_id: number;
  role?: string | null;
  is_primary?: boolean;
  unit_price?: number | null;
  quota?: string | null;
  lead_time?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  demand?: number[] | null;
  capacity?: number[] | null;
  remark?: string | null;
}

/** 快速录入项目明细（四元组一行式，自动建主数据并挂载） */
export interface ProjectSupplyRelationQuickCreateInput {
  pn: string;
  material_name: string;
  supplier_name: string;
  supplier_code: string;
  role?: string | null;
  is_primary?: boolean;
  unit_price?: number | null;
  quota?: string | null;
  lead_time?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  demand?: number[] | null;
  capacity?: number[] | null;
  remark?: string | null;
}

/** 批量维护某项目的客户需求（1-12月，同步到该项目下所有供应明细；项目级数据） */
export interface ProjectDemandUpdateInput {
  demand: number[];
}

/** 批量维护某物料的 BOM 用量系数（项目×物料，同步到该项目下该物料所有供应明细） */
export interface ProjectBomUpdateInput {
  material_pn: string;
  bom_factor: number;
}

/** 更新项目供应明细 */
export type ProjectSupplyRelationUpdateInput = Partial<
  Omit<ProjectSupplyRelationCreateInput, "supply_relation_id">
>;

/** 项目下供应商角色选项 */
export const ROLE_OPTIONS = ["主供", "备选", "认证中", "指定", "代理"];
