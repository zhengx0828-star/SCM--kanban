import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { productApi } from "../lib/api";
import type {
  ProductCreateInput,
  ProductListParams,
  ProductUpdateInput,
} from "../types/product";

export const productKeys = {
  all: ["products"] as const,
  list: (params: ProductListParams) => ["products", "list", params] as const,
  detail: (id: number) => ["products", "detail", id] as const,
};

/** 分页查询产品列表（翻页时保留上一页数据，避免闪烁） */
export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => productApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** 新增产品，成功后失效列表缓存 */
export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProductCreateInput) => productApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

/** 更新产品，成功后失效列表缓存 */
export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProductUpdateInput }) =>
      productApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

/** 软删除产品，成功后失效列表缓存 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => productApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}
