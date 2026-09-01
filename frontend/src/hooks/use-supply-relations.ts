import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supplyRelationApi } from "../lib/api";
import type { SupplyRelationCreateInput, SupplyRelationListParams } from "../types/supplyRelation";

export const supplyRelationKeys = {
  all: ["supply-relations"] as const,
  list: (params: SupplyRelationListParams) => ["supply-relations", "list", params] as const,
  options: ["supply-relations", "options"] as const,
  projects: (id: number) => ["supply-relations", "projects", id] as const,
};

/** 分页查询供应关系（四元组） */
export function useSupplyRelations(params: SupplyRelationListParams) {
  return useQuery({
    queryKey: supplyRelationKeys.list(params),
    queryFn: () => supplyRelationApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** 全量供应关系（下拉/选择器消费） */
export function useSupplyRelationOptions() {
  return useQuery({
    queryKey: supplyRelationKeys.options,
    queryFn: () => supplyRelationApi.options(),
  });
}

/** 新增供应关系 */
export function useCreateSupplyRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SupplyRelationCreateInput) => supplyRelationApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplyRelationKeys.all });
    },
  });
}

/** 删除供应关系 */
export function useDeleteSupplyRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => supplyRelationApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplyRelationKeys.all });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** 查询引用某供应关系的项目 */
export function useSupplyRelationProjects(id: number | null) {
  return useQuery({
    queryKey: supplyRelationKeys.projects(id ?? -1),
    queryFn: () => supplyRelationApi.projects(id!),
    enabled: id != null,
  });
}
