/** 物料主档（L1 主数据，PN 唯一） */
export interface Material {
  id: number;
  pn: string;
  name: string;
  category: string | null;
  spec: string | null;
  remark: string | null;
  supplier_count: number;
  created_at: string;
  updated_at: string;
}

/** 新增物料请求体 */
export interface MaterialCreateInput {
  pn: string;
  name: string;
  category?: string;
  spec?: string;
  remark?: string;
}

/** 物料分页查询参数 */
export interface MaterialListParams {
  page: number;
  page_size: number;
  keyword?: string;
}

/** 物料分页响应 */
export interface MaterialListResponse {
  items: Material[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
