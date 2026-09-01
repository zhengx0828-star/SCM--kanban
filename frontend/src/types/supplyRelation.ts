/** L2 供应关系主数据（四元组：物料PN · 物料名称 · 供应商名称 · 供应商代码） */

/** 供应关系实体（其他模块统一从这里取基础数据） */
export interface SupplyRelation {
  id: number;
  material_id: number;
  supplier_id: number;
  /** 物料 PN */
  pn: string;
  /** 物料名称 */
  material_name: string;
  /** 供应商名称 */
  supplier_name: string;
  /** 供应商代码 */
  supplier_code: string;
  /** 被多少个项目引用 */
  project_count: number;
  created_at: string;
}

/** 新增供应关系请求体 */
export interface SupplyRelationCreateInput {
  material_id: number;
  supplier_id: number;
}

/** 供应关系分页查询参数 */
export interface SupplyRelationListParams {
  page: number;
  page_size: number;
  keyword?: string;
}

/** 供应关系分页响应 */
export interface SupplyRelationListResponse {
  items: SupplyRelation[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 引用某供应关系的项目简要信息 */
export interface SupplyRelationProjectBrief {
  id: number;
  code: string;
  name: string;
  status: string;
  role: string | null;
  is_primary: boolean;
}
