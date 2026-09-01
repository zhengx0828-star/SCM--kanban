import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { materialApi } from "../lib/api";
import type { MaterialCreateInput, MaterialListParams } from "../types/material";

export const materialKeys = {
  all: ["materials"] as const,
  list: (params: MaterialListParams) => ["materials", "list", params] as const,
};

/** 分页查询物料列表 */
export function useMaterials(params: MaterialListParams) {
  return useQuery({
    queryKey: materialKeys.list(params),
    queryFn: () => materialApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** 新增物料 */
export function useCreateMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MaterialCreateInput) => materialApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: materialKeys.all });
    },
  });
}

/** 删除物料 */
export function useDeleteMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => materialApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: materialKeys.all });
    },
  });
}
