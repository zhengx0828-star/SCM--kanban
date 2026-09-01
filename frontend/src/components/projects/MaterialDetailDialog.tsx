import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import {
  Boxes,
  Factory,
  Loader2,
  Package,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/lib/theme";
import {
  useUpdateProjectBom,
  useUpdateProjectRelation,
} from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";
import type { ProjectSupplyRelation } from "@/types/project";

/**
 * 物料详情对话框（项目 × 物料维度，弹窗更大、视觉更舒服）。
 *
 * 结构：
 *   - Header：物料 PN · 名称
 *   - BOM 用量系数（单字段 + 保存）
 *   - 物料需求（客户需求 × BOM）：echarts 折线图 + 月度数字小表
 *   - 供应商产能（每家供应商）：echarts 柱状图（叠加物料需求线） + 12 月大输入
 *   - 供应商名是按钮，点击 → 跳 SupplierDetailDialog
 *
 * 视觉：弹窗 max-w-5xl、max-h-[78vh] 内可滚、padding 充足、行高大、字号 ≥ text-sm
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function sumOf(arr: number[] | null | undefined) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0);
}

export interface MaterialRow {
  pn: string;
  name: string;
  bom: number | null;
  /** 该物料在项目下的所有供应明细（每行 = 一个供应商） */
  rows: ProjectSupplyRelation[];
  /** 项目级客户需求 1-12 月（任意行都能取到，所有行同步） */
  demand: number[] | null;
}

interface MaterialDetailDialogProps {
  open: boolean;
  material: MaterialRow | null;
  projectId: number;
  onClose: () => void;
  /** 在对话框内部点击供应商名/查看供应商按钮时触发（弹 SupplierDetailDialog 等）。 */
  onSupplierClick?: (supplier: { code: string; name: string }) => void;
}

/* -------------------------------------------------------------------------- */
/*  配色                                                                       */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  demand: "#3b82f6", // blue-500 物料需求
  capacity: "#10b981", // emerald-500 供应商产能
  axis: "#cbd5e1",
  axisLabel: "#64748b",
  splitLine: "#e2e8f0",
  axisDark: "#334155",
  axisLabelDark: "#94a3b8",
  splitLineDark: "#1e293b",
} as const;

const SUPPLIER_BAR_COLORS = ["#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

/* -------------------------------------------------------------------------- */
/*  echarts 选项构建                                                           */
/* -------------------------------------------------------------------------- */

function buildDemandOption(dark: boolean, series: number[] | null) {
  const ax = dark ? PALETTE.axisDark : PALETTE.axis;
  const axLabel = dark ? PALETTE.axisLabelDark : PALETTE.axisLabel;
  const split = dark ? PALETTE.splitLineDark : PALETTE.splitLine;
  const maxY = series ? Math.max(0, ...series) : 0;
  return {
    backgroundColor: "transparent",
    grid: { left: 48, right: 16, top: 16, bottom: 24, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#1e293b" : "#ffffff",
      borderColor: dark ? "#334155" : "#e2e8f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a", fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (Array.isArray(params) ? params : [params])[0] as {
          axisValueLabel?: string;
          value?: number;
        };
        const month = p?.axisValueLabel ?? "";
        const v = typeof p?.value === "number" ? p.value : 0;
        return (
          `<div style="font-weight:600">${month}</div>` +
          `<div style="display:flex;align-items:center;gap:6px">` +
          `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PALETTE.demand}"></span>` +
          `<span>物料需求</span>` +
          `<span style="font-variant-numeric:tabular-nums;font-weight:600;margin-left:auto">${v.toLocaleString()}</span>` +
          `</div>`
        );
      },
    },
    xAxis: {
      type: "category",
      data: MONTHS,
      boundaryGap: false,
      axisLine: { lineStyle: { color: ax } },
      axisTick: { show: false },
      axisLabel: { color: axLabel, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      scale: true,
      axisLabel: {
        color: axLabel,
        fontSize: 11,
        formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`),
      },
      splitLine: { lineStyle: { color: split, type: "dashed" } },
      axisLine: { show: false },
      axisTick: { show: false },
      max: maxY > 0 ? Math.ceil((maxY * 1.15) / 10) * 10 : 100,
    },
    series: series
      ? [
          {
            id: "mreq",
            name: "物料需求",
            type: "line",
            smooth: true,
            symbol: "circle",
            symbolSize: 6,
            data: series,
            lineStyle: { width: 2.4, color: PALETTE.demand },
            itemStyle: { color: PALETTE.demand },
            areaStyle: {
              color: {
                type: "linear",
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: "rgba(59,130,246,0.30)" },
                  { offset: 1, color: "rgba(59,130,246,0.00)" },
                ],
              },
            },
          },
        ]
      : [],
  } as echarts.EChartsOption;
}

function buildCapacityOption(
  dark: boolean,
  capacityBySupplier: Array<{ name: string; series: number[] }>,
  demandSeries: number[] | null
) {
  const ax = dark ? PALETTE.axisDark : PALETTE.axis;
  const axLabel = dark ? PALETTE.axisLabelDark : PALETTE.axisLabel;
  const split = dark ? PALETTE.splitLineDark : PALETTE.splitLine;
  const capMax = Math.max(0, ...capacityBySupplier.flatMap((s) => s.series));
  const demandMax = demandSeries ? Math.max(0, ...demandSeries) : 0;
  const maxY = Math.max(capMax, demandMax);
  return {
    backgroundColor: "transparent",
    grid: { left: 48, right: 16, top: 28, bottom: 36, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#1e293b" : "#ffffff",
      borderColor: dark ? "#334155" : "#e2e8f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a", fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = (Array.isArray(params) ? params : [params]) as Array<{
          axisValueLabel?: string;
          axisValue?: number | string;
          seriesName?: string;
          value?: number;
          color?: string;
        }>;
        if (!arr.length) return "";
        const month = arr[0].axisValueLabel ?? "";
        let monthCapTotal = 0;
        const lines = arr
          .filter((p) => typeof p.value === "number" && p.seriesName !== "物料需求（参考线）")
          .map((p) => {
            monthCapTotal += typeof p.value === "number" ? p.value : 0;
            return (
              `<div style="display:flex;align-items:center;gap:6px;line-height:1.5">` +
              `<span style="display:inline-block;width:8px;height:8px;background:${p.color}"></span>` +
              `<span style="flex:1">${p.seriesName}</span>` +
              `<span style="font-variant-numeric:tabular-nums;font-weight:600">${(p.value ?? 0).toLocaleString()}</span>` +
              `</div>`
            );
          })
          .join("");
        const monthIdx = typeof arr[0].axisValue === "number" ? arr[0].axisValue : Number(arr[0].axisValue ?? 0);
        const demandAtMonth = demandSeries ? demandSeries[monthIdx] ?? 0 : 0;
        const diff = demandAtMonth - monthCapTotal;
        return (
          `<div style="font-weight:600;margin-bottom:4px">${month}</div>` +
          lines +
          `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${dark ? "#334155" : "#e2e8f0"};display:flex;justify-content:space-between;font-weight:600">` +
          `<span>当月合计产能</span>` +
          `<span style="font-variant-numeric:tabular-nums">${monthCapTotal.toLocaleString()}</span>` +
          `</div>` +
          (demandSeries
            ? `<div style="display:flex;justify-content:space-between;color:${diff < 0 ? "#f43f5e" : "#10b981"}">` +
              `<span>vs. 物料需求 ${demandAtMonth.toLocaleString()}</span>` +
              `<span style="font-variant-numeric:tabular-nums">${diff >= 0 ? "+" : ""}${diff.toLocaleString()}</span>` +
              `</div>`
            : "")
        );
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      textStyle: { color: axLabel, fontSize: 10 },
      itemWidth: 10,
      itemHeight: 10,
      icon: "rect",
    },
    xAxis: {
      type: "category",
      data: MONTHS,
      axisLine: { lineStyle: { color: ax } },
      axisTick: { show: false },
      axisLabel: { color: axLabel, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: {
        color: axLabel,
        fontSize: 11,
        formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`),
      },
      splitLine: { lineStyle: { color: split, type: "dashed" } },
      axisLine: { show: false },
      axisTick: { show: false },
      max: maxY > 0 ? Math.ceil((maxY * 1.15) / 10) * 10 : 100,
    },
    series: [
      ...capacityBySupplier.map((s, idx) => ({
        id: `cap-${idx}`,
        name: s.name,
        type: "bar" as const,
        stack: "cap",
        barMaxWidth: 22,
        data: s.series,
        itemStyle: {
          color: SUPPLIER_BAR_COLORS[idx % SUPPLIER_BAR_COLORS.length],
          borderRadius: idx === capacityBySupplier.length - 1 ? [3, 3, 0, 0] : 0,
        },
      })),
      // 物料需求参考线（虚线，便于对比缺口/盈余）
      ...(demandSeries
        ? [
            {
              id: "demand-line",
              name: "物料需求（参考线）",
              type: "line" as const,
              smooth: true,
              symbol: "circle",
              symbolSize: 5,
              data: demandSeries,
              lineStyle: { width: 2, color: PALETTE.demand, type: "dashed" },
              itemStyle: { color: PALETTE.demand },
              z: 5,
            },
          ]
        : []),
    ],
  } as echarts.EChartsOption;
}

/* -------------------------------------------------------------------------- */
/*  echarts 通用单图（主题重建 + 数据变更增量更新）                             */
/* -------------------------------------------------------------------------- */

function MaterialChart({
  buildOption,
  payload,
  height = 240,
}: {
  buildOption: (dark: boolean, payload: unknown) => echarts.EChartsOption;
  payload: unknown;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { dark } = useTheme();

  /* 主题切换 → 重建 */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chartRef.current = chart;
    chart.setOption(buildOption(dark, payload), true);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  /* 数据变更 → 增量更新（合并 series） */
  const payloadDigest = useMemo(() => JSON.stringify(payload), [payload]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(buildOption(dark, payload), { notMerge: false, lazyUpdate: true });
  }, [payloadDigest, dark, buildOption, payload]);

  return (
    <div ref={ref} className="w-full" style={{ height }} />
  );
}

/* -------------------------------------------------------------------------- */
/*  MaterialDetailDialog                                                       */
/* -------------------------------------------------------------------------- */

export function MaterialDetailDialog({
  open,
  material,
  projectId,
  onClose,
  onSupplierClick,
}: MaterialDetailDialogProps) {
  /* ----- BOM 草稿 ----- */
  const [bomDraft, setBomDraft] = useState<number | null | "">(material?.bom ?? null);
  const [capacityDraft, setCapacityDraft] = useState<Record<number, number[]>>({});

  /* 物料切换时重置草稿 */
  useEffect(() => {
    if (!material) return;
    setBomDraft(material.bom);
    const caps: Record<number, number[]> = {};
    for (const r of material.rows) {
      caps[r.id] = r.capacity && r.capacity.length === 12 ? [...r.capacity] : Array(12).fill(0);
    }
    setCapacityDraft(caps);
  }, [material?.pn, material?.rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- Mutations ----- */
  const updateBom = useUpdateProjectBom(projectId);
  const updateRelation = useUpdateProjectRelation(projectId);

  /* ----- 派生 ----- */
  const bomNumber = typeof bomDraft === "number" ? bomDraft : null;
  const materialDemandSeries = useMemo(() => {
    if (!material?.demand || bomNumber == null) return null;
    return material.demand.map((v) => v * bomNumber);
  }, [material?.demand, bomNumber]);
  const materialDemandTotal = sumOf(materialDemandSeries);

  /* 每家供应商产能系列（用于柱状图 + 输入） */
  const supplierCapacitySeries = useMemo(() => {
    if (!material) return [];
    return material.rows.map((r) => {
      const v = capacityDraft[r.id] ?? (r.capacity && r.capacity.length === 12 ? r.capacity : Array(12).fill(0));
      return { name: r.supplier_name, code: r.supplier_code, series: v, link: r };
    });
  }, [material, capacityDraft]);

  const { dark } = useTheme();
  const demandOption = useMemo(
    () => buildDemandOption(dark, materialDemandSeries),
    [dark, materialDemandSeries]
  );
  const capacityOption = useMemo(
    () =>
      buildCapacityOption(
        dark,
        supplierCapacitySeries.map((s) => ({ name: s.name, series: s.series })),
        materialDemandSeries
      ),
    [dark, supplierCapacitySeries, materialDemandSeries]
  );

  const handleSaveBom = () => {
    if (!material) return;
    if (bomDraft === "" || bomDraft == null || !Number.isFinite(bomDraft)) {
      return toast.error("请先填写 BOM 用量系数");
    }
    updateBom.mutate(
      { material_pn: material.pn, bom_factor: bomDraft },
      {
        onSuccess: () => toast.success(`已保存 ${material.pn} 的 BOM 用量系数`),
        onError: (err) => toast.error(getApiErrorMessage(err)),
      }
    );
  };

  const handleSaveCapacity = (link: ProjectSupplyRelation) => {
    const values = capacityDraft[link.id] ?? Array(12).fill(0);
    updateRelation.mutate(
      { linkId: link.id, data: { capacity: values } },
      {
        onSuccess: () => toast.success(`已保存 ${link.supplier_name} 的产能`),
        onError: (err) => toast.error(getApiErrorMessage(err)),
      }
    );
  };

  if (!material) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5" />
            <span className="font-mono">{material.pn}</span>
            <span className="text-muted-foreground">· {material.name}</span>
          </DialogTitle>
          <DialogDescription>
            查看 BOM 系数、物料需求（折线）、各供应商产能（柱状 + 录入）；点供应商名跳转供应商详情。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[80vh] space-y-5 overflow-y-auto pr-1">
          {/* BOM 用量系数 */}
          <section className="rounded-lg border bg-card p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
              <Boxes className="h-4 w-4 text-muted-foreground" />
              BOM 用量系数（1 台产品需要几个该物料）
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="number"
                min={0}
                step="any"
                value={bomDraft === "" || bomDraft == null ? "" : bomDraft}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") setBomDraft("");
                  else {
                    const n = Number(raw);
                    setBomDraft(Number.isFinite(n) ? n : null);
                  }
                }}
                placeholder="例：2"
                className="h-10 w-40 text-base tabular-nums"
              />
              <Button
                onClick={handleSaveBom}
                disabled={updateBom.isPending || typeof bomDraft !== "number"}
                className="h-10"
              >
                {updateBom.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                保存 BOM
              </Button>
              {materialDemandSeries && (
                <span className="ml-2 text-sm text-muted-foreground">
                  年合计{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {materialDemandTotal.toLocaleString()}
                  </span>
                </span>
              )}
            </div>
          </section>

          {/* 物料需求 + 供应商产能 双图并排 */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PALETTE.demand }} />
                  物料需求（项目客户需求 × BOM）
                </p>
                {!materialDemandSeries && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    待填 BOM
                  </span>
                )}
              </div>
              <MaterialChart
                buildOption={(d) => buildDemandOption(d, materialDemandSeries)}
                payload={materialDemandSeries}
                height={200}
              />
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Factory className="h-4 w-4 text-muted-foreground" />
                  供应商产能（按月柱状）
                </p>
                <span className="text-[10px] text-muted-foreground">蓝虚线 = 物料需求</span>
              </div>
              {material.rows.length === 0 ? (
                <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  该物料暂无供应明细
                </p>
              ) : (
                <MaterialChart
                  buildOption={(d) =>
                    buildCapacityOption(
                      d,
                      supplierCapacitySeries.map((s) => ({ name: s.name, series: s.series })),
                      materialDemandSeries
                    )
                  }
                  payload={{ suppliers: supplierCapacitySeries, demand: materialDemandSeries }}
                  height={200}
                />
              )}
            </section>
          </div>

          {/* 供应商产能：每家供应商 12 月录入 */}
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Factory className="h-4 w-4 text-muted-foreground" />
                供应商产能明细（每家供应商 · 1-12 月录入）
              </p>
              <span className="text-xs text-muted-foreground">
                蓝色虚线在上方柱状图中对比
              </span>
            </div>

            {material.rows.length === 0 ? (
              <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                该物料暂无供应明细
              </p>
            ) : (
              <div className="space-y-4">
                {material.rows.map((r) => {
                  const values = capacityDraft[r.id] ?? Array(12).fill(0);
                  const total = sumOf(values);
                  return (
                    <div
                      key={r.id}
                      className="rounded-md border bg-background p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onSupplierClick?.({ code: r.supplier_code, name: r.supplier_name })
                            }
                            className="text-sm font-semibold text-foreground transition-colors hover:text-primary hover:underline"
                            title="查看供应商详情"
                          >
                            {r.supplier_name}
                          </button>
                          <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {r.supplier_code}
                          </span>
                          {r.is_primary && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                              主供
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            年合计{" "}
                            <span className="font-semibold tabular-nums text-foreground">
                              {total.toLocaleString()}
                            </span>
                          </span>
                          <Button
                            variant="outline"
                            onClick={() => handleSaveCapacity(r)}
                            disabled={updateRelation.isPending}
                            className="h-9"
                          >
                            {updateRelation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      {/* 12 月大输入 */}
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                        {MONTHS.map((m, i) => (
                          <div key={m} className="space-y-1">
                            <span className="block text-[10px] text-muted-foreground">{m}</span>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={Number.isFinite(values[i] ?? 0) ? values[i] : 0}
                              onChange={(e) => {
                                const next = [...values];
                                const n = Number(e.target.value);
                                next[i] = e.target.value === "" ? 0 : Number.isFinite(n) ? n : 0;
                                setCapacityDraft((p) => ({ ...p, [r.id]: next }));
                              }}
                              className="h-10 px-2 text-sm tabular-nums"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}