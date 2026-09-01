import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/**
 * 物料供需组合图（echarts line + bar）。
 * - 一张图同时呈现：物料需求（折线，每物料一条）+ 供应商产能（柱状，每供应商一组堆叠）
 * - X 轴：1-12 月
 * - legend 在底部滚动（多物料/多供应商时可滚动）
 * - tooltip 显示当月所有物料需求 + 供应商产能（堆叠合计）
 *
 * 设计要点：用户希望折线 + 柱状在一张表里，便于一眼对比"需求 vs 产能"。
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

/** 物料需求 line 调色板（多物料区分） */
const DEMAND_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
] as const;
/** 供应商产能 bar 调色板（多供应商区分；绿调为主，区别于需求 line） */
const CAPACITY_COLORS = [
  "#10b981", "#22c55e", "#84cc16", "#a3e635", "#06b6d4",
  "#0ea5e9", "#14b8a6", "#facc15", "#fb923c", "#fbbf24",
] as const;

export interface MaterialDemandPoint {
  pn: string;
  name: string;
  /** 1-12 月物料需求（demand × bom）；缺则当月视为 0 */
  demandSeries: number[];
  color: string;
}

export interface SupplierCapacityPoint {
  code: string;
  name: string;
  /** 1-12 月产能 */
  capacitySeries: number[];
  color: string;
}

const THEME = {
  light: { axis: "#cbd5e1", axisLabel: "#64748b", splitLine: "#e2e8f0" },
  dark: { axis: "#334155", axisLabel: "#94a3b8", splitLine: "#1e293b" },
} as const;

interface MaterialSupplyChartsProps {
  className?: string;
  demand: MaterialDemandPoint[];
  capacity: SupplierCapacityPoint[];
  height?: number;
}

/* -------------------------------------------------------------------------- */
/*  组合图 option                                                              */
/* -------------------------------------------------------------------------- */

function buildComboOption(
  dark: boolean,
  demand: MaterialDemandPoint[],
  capacity: SupplierCapacityPoint[]
) {
  const t = dark ? THEME.dark : THEME.light;
  const visibleDemand = demand.filter((d) => d.demandSeries.some((v) => v > 0));
  const maxDemand = Math.max(0, ...visibleDemand.flatMap((d) => d.demandSeries));
  const maxCapacity = Math.max(0, ...capacity.flatMap((s) => s.capacitySeries));
  const maxY = Math.max(maxDemand, maxCapacity);

  return {
    backgroundColor: "transparent",
    grid: { left: 56, right: 16, top: 24, bottom: 64, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis, type: "dashed" } },
      backgroundColor: dark ? "#1e293b" : "#ffffff",
      borderColor: dark ? "#334155" : "#e2e8f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a", fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = (Array.isArray(params) ? params : [params]) as Array<{
          axisValueLabel?: string;
          seriesType?: string;
          seriesName?: string;
          value?: number;
          color?: string;
        }>;
        if (!arr.length) return "";
        const month = arr[0].axisValueLabel ?? "";
        const demandLines = arr
          .filter((p) => p.seriesType === "line" && typeof p.value === "number")
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        const capLines = arr.filter((p) => p.seriesType === "bar" && typeof p.value === "number");
        let demandTotal = 0;
        let capTotal = 0;
        const demandHtml = demandLines
          .map((p) => {
            demandTotal += p.value ?? 0;
            return (
              `<div style="display:flex;align-items:center;gap:6px;line-height:1.5">` +
              `<span style="display:inline-block;width:8px;height:2px;background:${p.color}"></span>` +
              `<span style="flex:1">${p.seriesName}</span>` +
              `<span style="font-variant-numeric:tabular-nums;font-weight:600">${(p.value ?? 0).toLocaleString()}</span>` +
              `</div>`
            );
          })
          .join("");
        const capHtml = capLines
          .filter((p) => (p.value ?? 0) > 0)
          .map((p) => {
            capTotal += p.value ?? 0;
            return (
              `<div style="display:flex;align-items:center;gap:6px;line-height:1.5">` +
              `<span style="display:inline-block;width:8px;height:8px;background:${p.color}"></span>` +
              `<span style="flex:1">${p.seriesName}</span>` +
              `<span style="font-variant-numeric:tabular-nums;font-weight:600">${(p.value ?? 0).toLocaleString()}</span>` +
              `</div>`
            );
          })
          .join("");
        const diff = capTotal - demandTotal;
        const diffColor = diff >= 0 ? "#10b981" : "#f43f5e";
        return (
          `<div style="font-weight:600;margin-bottom:4px">${month}</div>` +
          (demandHtml
            ? `<div style="margin-bottom:2px;color:${t.axisLabel}">物料需求（折线）</div>` + demandHtml
            : "") +
          (capHtml
            ? `<div style="margin-top:6px;margin-bottom:2px;color:${t.axisLabel}">供应商产能（柱状）</div>` + capHtml
            : "") +
          `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${dark ? "#334155" : "#e2e8f0"};display:flex;justify-content:space-between;font-weight:600">` +
          `<span>产能 - 需求</span>` +
          `<span style="font-variant-numeric:tabular-nums;color:${diffColor}">${diff >= 0 ? "+" : ""}${diff.toLocaleString()}</span>` +
          `</div>`
        );
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      textStyle: { color: t.axisLabel, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 10,
      icon: "roundRect",
      data: [
        ...visibleDemand.map((d, idx) => ({
          name: `需求 · ${d.pn}`,
          icon: "rect",
          itemStyle: { color: d.color || DEMAND_COLORS[idx % DEMAND_COLORS.length] },
        })),
        ...capacity.map((c, idx) => ({
          name: `产能 · ${c.name}`,
          icon: "rect",
          itemStyle: { color: c.color || CAPACITY_COLORS[idx % CAPACITY_COLORS.length] },
        })),
      ],
    },
    xAxis: {
      type: "category",
      data: MONTHS,
      boundaryGap: true,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.axisLabel, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: {
        color: t.axisLabel,
        fontSize: 11,
        formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`),
      },
      splitLine: { lineStyle: { color: t.splitLine, type: "dashed" } },
      axisLine: { show: false },
      axisTick: { show: false },
      max: maxY > 0 ? Math.ceil((maxY * 1.15) / 10) * 10 : 100,
    },
    series: [
      // 物料需求：折线
      ...visibleDemand.map((d, idx) => ({
        id: `mreq-${d.pn}`,
        name: `需求 · ${d.pn}`,
        type: "line" as const,
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        data: d.demandSeries,
        lineStyle: { width: 2, color: d.color || DEMAND_COLORS[idx % DEMAND_COLORS.length] },
        itemStyle: { color: d.color },
        z: 5,
      })),
      // 供应商产能：柱状堆叠
      ...capacity.map((c, idx) => ({
        id: `cap-${c.code}-${idx}`,
        name: `产能 · ${c.name}`,
        type: "bar" as const,
        stack: "cap",
        barMaxWidth: 22,
        data: c.capacitySeries,
        itemStyle: {
          color: c.color || CAPACITY_COLORS[idx % CAPACITY_COLORS.length],
          borderRadius: idx === capacity.length - 1 ? [3, 3, 0, 0] : 0,
        },
      })),
    ],
  } as echarts.EChartsOption;
}

/* -------------------------------------------------------------------------- */
/*  主组件                                                                     */
/* -------------------------------------------------------------------------- */

export function MaterialSupplyCharts({
  className,
  demand,
  capacity,
  height = 380,
}: MaterialSupplyChartsProps) {
  const empty = demand.length === 0 && capacity.length === 0;
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">
        物料需求（折线）+ 供应商产能（柱状）· 组合图
      </div>
      <div className="w-full" style={{ height }}>
        {empty ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/70">
            暂无数据 — 请先在物料筛选选择物料/确保已录入产能
          </div>
        ) : (
          <ComboChart demand={demand} capacity={capacity} />
        )}
      </div>
    </div>
  );
}

function ComboChart({
  demand,
  capacity,
}: {
  demand: MaterialDemandPoint[];
  capacity: SupplierCapacityPoint[];
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
    chart.setOption(buildComboOption(dark, demand, capacity), true);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  /* 数据变更：增量更新 series */
  const payloadDigest = useMemo(
    () => JSON.stringify({ demand, capacity }),
    [demand, capacity]
  );
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(buildComboOption(dark, demand, capacity), {
      notMerge: false,
      lazyUpdate: true,
    });
  }, [payloadDigest, dark, demand, capacity]);

  return <div ref={ref} className={cn("h-full w-full")} />;
}

export { DEMAND_COLORS, CAPACITY_COLORS };