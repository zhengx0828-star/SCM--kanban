/** 产品状态 */
export type ProductStatus = "active" | "inactive" | "archived";

/** 产品实体（与后端 ProductRead 对应） */
export interface Product {
  id: number;
  name: string;
  sku: string;
  price: number;
  stock: number;
  category: string | null;
  description: string | null;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

/** 分页列表查询参数 */
export interface ProductListParams {
  page: number;
  page_size: number;
  keyword?: string;
  status?: string;
}

/** 分页列表响应 */
export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 新增产品请求体 */
export type ProductCreateInput = {
  name: string;
  sku: string;
  price: number;
  stock: number;
  category?: string;
  description?: string;
  status: ProductStatus;
};

/** 部分更新请求体 */
export type ProductUpdateInput = Partial<ProductCreateInput>;
