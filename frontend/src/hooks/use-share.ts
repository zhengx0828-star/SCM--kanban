import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shareApi } from "../lib/api";
import type { ShareRecordCreateInput, ShareRecordUpdateInput } from "../types/share";

export const shareKeys = {
  all: ["share"] as const,
  dashboard: ["share", "dashboard"] as const,
  projects: ["share", "projects"] as const,
  summary: (projectId: number, month: string) => ["share", "summary", projectId, month] as const,
  risks: (projectId: number, month: string, top?: number) => ["share", "risks", projectId, month, top] as const,
  quadrant: (projectId: number, month: string) => ["share", "quadrant", projectId, month] as const,
  records: (projectId: number, month: string, keyword?: string) => ["share", "records", projectId, month, keyword] as const,
};

/** Dashboard 联动统计（份额波动/独供，跨项目最新月） */
export function useShareDashboardStats() {
  return useQuery({
    queryKey: shareKeys.dashboard,
    queryFn: () => shareApi.dashboardStats(),
  });
}

/** 有份额数据的项目列表 */
export function useShareProjects() {
  return useQuery({
    queryKey: shareKeys.projects,
    queryFn: () => shareApi.projects(),
  });
}

/** KPI 汇总 */
export function useShareSummary(projectId: number | null, month: string) {
  return useQuery({
    queryKey: shareKeys.summary(projectId ?? 0, month),
    queryFn: () => shareApi.summary(projectId!, month),
    enabled: projectId != null,
  });
}

/** 风险排行 */
export function useShareRisks(projectId: number | null, month: string, top = 10) {
  return useQuery({
    queryKey: shareKeys.risks(projectId ?? 0, month, top),
    queryFn: () => shareApi.risks(projectId!, month, top),
    enabled: projectId != null,
  });
}

/** 四象限散点 */
export function useShareQuadrant(projectId: number | null, month: string) {
  return useQuery({
    queryKey: shareKeys.quadrant(projectId ?? 0, month),
    queryFn: () => shareApi.quadrant(projectId!, month),
    enabled: projectId != null,
  });
}

/** 明细列表 */
export function useShareRecords(projectId: number | null, month: string, keyword?: string) {
  return useQuery({
    queryKey: shareKeys.records(projectId ?? 0, month, keyword),
    queryFn: () => shareApi.records(projectId!, month, keyword),
    enabled: projectId != null,
  });
}

/** 手动新增 */
export function useCreateShareRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ShareRecordCreateInput) => shareApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

/** 手动修改（自动重算） */
export function useUpdateShareRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ShareRecordUpdateInput }) => shareApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

/** Excel 导入 */
export function useImportShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, month, filePath }: { projectId: number; month: string; filePath: string }) =>
      shareApi.importExcel(projectId, month, filePath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

/** 月末结转 */
export function useRolloverShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, fromMonth, toMonth }: { projectId: number; fromMonth: string; toMonth: string }) =>
      shareApi.rollover(projectId, fromMonth, toMonth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}
