import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supplierApi } from "../lib/api";
import type { SupplierCreateInput, SupplierUpdateInput } from "../types/supplier";

export const supplierKeys = {
  all: ["suppliers"] as const,
};

/** 查询全部供应商（地图点位数据） */
export function useSuppliers() {
  return useQuery({
    queryKey: supplierKeys.all,
    queryFn: () => supplierApi.list(),
  });
}

/** 新增供应商，成功后失效缓存（地图自动刷新点位） */
export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SupplierCreateInput) => supplierApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}

/** 更新供应商（地图录入时补全地图字段） */
export function useUpdateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierUpdateInput }) => supplierApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}

/** 删除供应商，成功后失效缓存 */
export function useDeleteSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => supplierApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}
