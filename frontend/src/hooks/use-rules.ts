import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ruleApi } from "../lib/api";
import type { RuleCreateInput, RuleUpdateInput } from "../types/rule";

export const ruleKeys = {
  all: ["rules"] as const,
  list: (params?: Record<string, unknown>) => ["rules", "list", params ?? {}] as const,
};

/** 规则列表（按 module 分组、sort_order 升序） */
export function useRules(params?: { page?: number; page_size?: number; module?: string; keyword?: string }) {
  return useQuery({
    queryKey: ruleKeys.list(params),
    queryFn: () => ruleApi.list(params),
  });
}

/** 新增规则 */
export function useCreateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RuleCreateInput) => ruleApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    },
  });
}

/** 更新规则 */
export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: RuleUpdateInput }) => ruleApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    },
  });
}

/** 删除规则 */
export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => ruleApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    },
  });
}
