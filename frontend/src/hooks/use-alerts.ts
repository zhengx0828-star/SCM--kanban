import { useQuery } from "@tanstack/react-query";
import { alertApi } from "../lib/api";

export const alertKeys = {
  all: ["alerts"] as const,
  list: (projectIds: string, baseMonth: string, horizon: number) =>
    ["alerts", projectIds, baseMonth, horizon] as const,
};

/**
 * 预警聚合。Dashboard 是唯一消费方（不单独开页面）。
 *
 * staleTime 30s：预警是派生数据，切回标签页时重算一次即可；
 * 太短会把「库存 DOH 每秒都在变」的错觉带给用户。
 */
export function useAlerts(opts: { projectIds?: string; baseMonth?: string; horizon?: number } = {}) {
  const projectIds = opts.projectIds ?? "";
  const baseMonth = opts.baseMonth ?? "";
  const horizon = opts.horizon ?? 3;

  return useQuery({
    queryKey: alertKeys.list(projectIds, baseMonth, horizon),
    queryFn: () =>
      alertApi.get({
        project_ids: projectIds || undefined,
        base_month: baseMonth || undefined,
        horizon,
      }),
    staleTime: 30_000,
  });
}
