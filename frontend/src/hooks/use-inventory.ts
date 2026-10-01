import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { baseApi, inventoryApi } from "../lib/api";
import type {
  BaseSiteInput,
  InventoryDayUpdateInput,
  InventoryFilter,
  InventoryPlan,
  InventoryPlanCreateInput,
  InventoryPlanUpdateInput,
  InventorySummary,
} from "../types/inventory";

export const inventoryKeys = {
  all: ["inventory"] as const,
  plans: (f: InventoryFilter) => ["inventory", "plans", f] as const,
  overview: (z: number, excess: number) => ["inventory", "overview", z, excess] as const,
  summary: (f: InventoryFilter) => ["inventory", "summary", f] as const,
  candidates: (projectIds: string) => ["inventory", "candidates", projectIds] as const,
};

export const baseKeys = {
  all: ["bases"] as const,
};

/**
 * 推算单元列表（含 30 天矩阵 / 补货建议 / 产能校验）。
 *
 * ⚠️ `enabled` 必须传「已选项目数 > 0」：L0 未选项目时不加载任何物料
 * （避免所有物料堆在主页面）。后端对空 project_ids 也返回 []，双保险。
 */
export function useInventoryPlans(filters: InventoryFilter, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.plans(filters),
    queryFn: () => inventoryApi.plans(filters),
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** 项目级 DOH 概览（L0 项目卡片墙数据源；不含物料明细） */
export function useInventoryProjectOverview(serviceZ = 1.65, excess = 30, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.overview(serviceZ, excess),
    queryFn: () => inventoryApi.projectOverview({ service_z: serviceZ, excess }),
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** 导出当前筛选视图为 xlsx（触发浏览器下载） */
export function useInventoryExport() {
  return useMutation({
    mutationFn: (filters: InventoryFilter) => inventoryApi.export(filters),
    onSuccess: (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `库存信号塔-${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

/** KPI 概览（后端同 filters 计算，与规则页口径一致） */
export function useInventorySummary(filters: InventoryFilter) {
  return useQuery({
    queryKey: inventoryKeys.summary(filters),
    queryFn: () => inventoryApi.summary(filters),
  });
}

/** 底表中可建档的组合 */
export function useInventoryCandidates(projectIds = "", enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.candidates(projectIds),
    queryFn: () => inventoryApi.candidates(projectIds),
    enabled,
  });
}

/** 基地主数据 */
export function useBases() {
  return useQuery({
    queryKey: baseKeys.all,
    queryFn: () => baseApi.list(),
  });
}

export function useCreateBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BaseSiteInput) => baseApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: baseKeys.all }),
  });
}

export function useUpdateBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<BaseSiteInput> }) => baseApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: baseKeys.all }),
  });
}

export function useDeleteBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => baseApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKeys.all });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
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

/** 改 LeadTime / 初始现有库存（params 需带上当前 service_z，否则返回值与页面口径不一致） */
export function useUpdateInventoryPlan() {
  const queryClient = useQueryClient();
  const replaceRow = useReplacePlanInCache();
  return useMutation({
    mutationFn: ({ id, data, params }: { id: number; data: InventoryPlanUpdateInput; params?: InventoryFilter }) =>
      inventoryApi.updatePlan(id, data, params),
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
    mutationFn: ({ id, cells, params }: { id: number; cells: InventoryDayUpdateInput[]; params?: InventoryFilter }) =>
      inventoryApi.updateDays(id, cells, params),
    onSuccess: (row) => {
      replaceRow(row);
      queryClient.invalidateQueries({ queryKey: ["inventory", "summary"] });
    },
  });
}

/** 新建单个档案 */
export function useCreateInventoryPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InventoryPlanCreateInput) => inventoryApi.createPlan(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}

/** 批量建档 */
export function useBulkCreateInventoryPlans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: InventoryPlanCreateInput[]) => inventoryApi.bulkCreatePlans(items),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}

/** 删除档案 */
export function useDeleteInventoryPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => inventoryApi.removePlan(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
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
