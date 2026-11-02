import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { segmentApi, supplierCardApi } from "../lib/api";
import type {
  SegmentConfig,
  SegmentUpsertInput,
  SupplierCardCreateInput,
  SupplierCardReleaseInput,
  TierValues,
} from "../types/segment";

export const segmentKeys = {
  all: ["supplier-segments"] as const,
  list: (params: Record<string, unknown>) => ["supplier-segments", "list", params] as const,
  summary: (period?: string) => ["supplier-segments", "summary", period ?? ""] as const,
  periods: ["supplier-segments", "periods"] as const,
  history: (pn: string, code: string) => ["supplier-segments", "history", pn, code] as const,
  config: ["supplier-segments", "config"] as const,
  cards: (params: Record<string, unknown>) => ["supplier-cards", params] as const,
};

/** 评价列表 */
export function useSegments(params: { period?: string; segment?: string; q?: string } = {}) {
  return useQuery({
    queryKey: segmentKeys.list(params),
    queryFn: () => segmentApi.list(params),
  });
}

/** 象限分布 */
export function useSegmentSummary(period?: string) {
  return useQuery({
    queryKey: segmentKeys.summary(period),
    queryFn: () => segmentApi.summary(period),
  });
}

/** 有数据的月份 */
export function useSegmentPeriods() {
  return useQuery({ queryKey: segmentKeys.periods, queryFn: () => segmentApi.periods() });
}

/** 阈值 / 权重 */
export function useSegmentConfig() {
  return useQuery({ queryKey: segmentKeys.config, queryFn: () => segmentApi.getConfig() });
}

/** 单点跨期轨迹（抽屉里画落点迁移用） */
export function useSegmentHistory(pn: string | null, supplierCode: string | null) {
  return useQuery({
    queryKey: segmentKeys.history(pn ?? "", supplierCode ?? ""),
    queryFn: () => segmentApi.history(pn!, supplierCode!),
    enabled: Boolean(pn && supplierCode),
  });
}

/** 红黄牌列表 */
export function useSupplierCards(params: { supplier_id?: number; active?: boolean } = {}) {
  return useQuery({ queryKey: segmentKeys.cards(params), queryFn: () => supplierCardApi.list(params) });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  // 打牌/解牌会改评价行的 quadrant，所以连 list + summary 一起失效
  return () => {
    queryClient.invalidateQueries({ queryKey: segmentKeys.all });
    queryClient.invalidateQueries({ queryKey: ["supplier-cards"] });
  };
}

export function useUpsertSegment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: SegmentUpsertInput) => segmentApi.upsert(data),
    onSuccess: invalidate,
  });
}

export function useUpdateSegment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SegmentUpsertInput> & Partial<TierValues> }) =>
      segmentApi.update(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteSegment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => segmentApi.remove(id),
    onSuccess: invalidate,
  });
}

export function useImportSegments() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ file, defaultPeriod }: { file: File; defaultPeriod?: string }) =>
      segmentApi.importExcel(file, defaultPeriod),
    onSuccess: invalidate,
  });
}

export function useCopyPeriod() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => segmentApi.copyPeriod(from, to),
    onSuccess: invalidate,
  });
}

export function useUpdateSegmentConfig() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: Partial<SegmentConfig>) => segmentApi.updateConfig(data),
    onSuccess: invalidate,
  });
}

export function useCreateCard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: SupplierCardCreateInput) => supplierCardApi.create(data),
    onSuccess: invalidate,
  });
}

export function useReleaseCard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierCardReleaseInput }) => supplierCardApi.release(id, data),
    onSuccess: invalidate,
  });
}
