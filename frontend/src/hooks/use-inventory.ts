import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryApi } from "../lib/api";
import type {
  InventoryDayUpdateInput,
  InventoryFilter,
  InventoryPlan,
  InventoryPlanUpdateInput,
  InventorySummary,
} from "../types/inventory";

export const inventoryKeys = {
  all: ["inventory"] as const,
  plans: (f: InventoryFilter) => ["inventory", "plans", f] as const,
  summary: (f: InventoryFilter) => ["inventory", "summary", f] as const,
};

/** 推算单元列表（含 30 天矩阵） */
export function useInventoryPlans(filters: InventoryFilter) {
  return useQuery({
    queryKey: inventoryKeys.plans(filters),
    queryFn: () => inventoryApi.plans(filters),
    placeholderData: (prev) => prev,
  });
}

/** KPI 四卡（后端同 filters 计算，与规则页口径一致） */
export function useInventorySummary(filters: InventoryFilter) {
  return useQuery({
    queryKey: inventoryKeys.summary(filters),
    queryFn: () => inventoryApi.summary(filters),
  });
}

/** 把 mutation 返回的单行替换进所有 plans 缓存（表格即时刷新，不闪烁） */
function useReplacePlanInCache() {
  const queryClient = useQueryClient();
  return (row: InventoryPlan) => {
    queryClient.setQueriesData<InventoryPlan[]>({ queryKey: ["inventory", "plans"] }, (old) => {
      if (!old) return old;
      const idx = old.findIndex((p) => p.id === row.id);
      if (idx === -1) return old;
      const next = [...old];
      next[idx] = row;
      return next;
    });
  };
}

/** 改 LeadTime / 初始现有库存 */
export function useUpdateInventoryPlan() {
  const queryClient = useQueryClient();
  const replaceRow = useReplacePlanInCache();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: InventoryPlanUpdateInput }) => inventoryApi.updatePlan(id, data),
    onSuccess: (row) => {
      replaceRow(row);
      queryClient.invalidateQueries({ queryKey: ["inventory", "summary"] });
    },
  });
}

/** 批量改某日单元格（双击编辑保存后整行重算返回） */
export function useUpdateInventoryDays() {
  const queryClient = useQueryClient();
  const replaceRow = useReplacePlanInCache();
  return useMutation({
    mutationFn: ({ id, cells }: { id: number; cells: InventoryDayUpdateInput[] }) => inventoryApi.updateDays(id, cells),
    onSuccess: (row) => {
      replaceRow(row);
      queryClient.invalidateQueries({ queryKey: ["inventory", "summary"] });
    },
  });
}

/** Excel 导入 */
export function useImportInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filePath: string) => inventoryApi.importExcel(filePath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
