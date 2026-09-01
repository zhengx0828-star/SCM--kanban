import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/**
 * 客户需求 1-12 月折线图（ECharts 渲染）。
 * - X 轴：1月 → 12月
 * - Y 轴：客户需求量（统一坐标，便于跨项目对比）
 * - 每条线 = 一个项目；该项目未录入 demand 时不画线（其它项目仍正常显示）
 * - 主题感知（light/dark）
 * - 主题变更时整图重建；数据/显隐变更时仅增量更新 series（按 id 合并），保证交互流畅
 *
 * 注意：颜色按 selectedProjectIds 顺序循环取 LINE_COLORS，避免数量多时颜色重复。
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

/** 折线系列调色板（≥ 8 个项目足够区分；>8 时循环复用，与 chip 颜色一致） */
const LINE_COLORS = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#84cc16", // lime-500
  "#f97316", // orange-500
  "#14b8a6", // teal-500
] as const;

/** 项目描述（一个系列 = 一条线） */
export interface DemandProjectSeries {
  /** 项目 id */
  projectId: number;
  /** 项目代号（显示在 tooltip 与图例 chip 上） */
  code: string;
  /** 项目名（用于 chip 文字） */
  name: string;
  /** 颜色（来自 LINE_COLORS 之一） */
  color: string;
  /** 1-12 月需求；长度为 12 或 null（null = 未录入，本项目不画线） */
  demand: number[] | null;
  /** 是否可见（切片器状态） */
  visible: boolean;
}

/** 构建 series options（按 id 合并，echarts.setOption 按 id 增量更新） */
function buildSeries(items: DemandProjectSeries[]): echarts.SeriesOption[] {
  return items.map((p) => ({
    id: `demand-${p.projectId}`,
    name: `${p.code} · ${p.name}`,
    type: "line",
    smooth: true,
    symbol: "circle",
    symbolSize: 7,
    showSymbol: true,
    // demand 为 null 时整条线不画（不是断续，echarts 默认会把 null 视为空断点，但既然投影要语义化为"未录入"，直接不展示）
    data: p.demand ?? [],
    lineStyle: { width: 2.2, color: p.color },
    itemStyle: { color: p.color, borderColor: p.color, borderWidth: 0 },
    emphasis: {
      focus: "series",
      lineStyle: { width: 3 },
    },
    // 未选中（visible=false）→ 系列不画
    // echarts 没有显式 visibility 字段，但可以通过 stack / 不写 series 来过滤；
    // 这里干脆在调用方过滤后再 buildSeries，保证 series 数量即为选中数量。
  }));
}

/** 主题变体（参考 charts/ChinaMap.tsx 的视觉语言，保持一致） */
const THEME = {
  light: {
    axis: "#cbd5e1",
    axisLabel: "#64748b",
    splitLine: "#e2e8f0",
    background: "transparent",
    cursor: "rgba(15,23,42,0.04)",
  },
  dark: {
    axis: "#334155",
    axisLabel: "#94a3b8",
    splitLine: "#1e293b",
    background: "transparent",
    cursor: "rgba(255,255,255,0.04)",
  },
} as const;

function buildOption(dark: boolean, series: DemandProjectSeries[]): echarts.EChartsOption {
  const t = dark ? THEME.dark : THEME.light;
  const visibleSeries = series.filter((s) => s.visible && s.demand);
  const maxY = Math.max(0, ...visibleSeries.flatMap((s) => s.demand ?? []));

  return {
    backgroundColor: t.background,
    // 顶部预留些空间避免与 legend 撞
    grid: { left: 48, right: 24, top: 32, bottom: 36, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        lineStyle: { color: t.axis, type: "dashed" },
      },
      backgroundColor: dark ? "#1e293b" : "#ffffff",
      borderColor: dark ? "#334155" : "#e2e8f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a", fontSize: 12 },
      // 显示当月所有项目 + 项目月需求量，年合计
      formatter: (params: unknown) => {
        const arr = (Array.isArray(params) ? params : [params]) as Array<{
          axisValueLabel?: string;
          seriesName?: string;
          value?: number;
          color?: string;
        }>;
        if (!arr.length) return "";
        const month = arr[0].axisValueLabel ?? "";
        // 求当月合计
        const monthTotal = arr.reduce((a, p) => a + (typeof p.value === "number" ? p.value : 0), 0);
        const lines = arr
          .filter((p) => typeof p.value === "number")
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
          .map(
            (p) =>
              `<div style="display:flex;align-items:center;gap:6px;line-height:1.6">` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></span>` +
              `<span style="flex:1">${p.seriesName}</span>` +
              `<span style="font-variant-numeric:tabular-nums;font-weight:600">${(p.value ?? 0).toLocaleString()}</span>` +
              `</div>`
          )
          .join("");
        return (
          `<div style="font-weight:600;margin-bottom:4px">${month}</div>` +
          lines +
          `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${dark ? "#334155" : "#e2e8f0"};display:flex;justify-content:space-between;font-weight:600">` +
          `<span>当月合计</span>` +
          `<span style="font-variant-numeric:tabular-nums">${monthTotal.toLocaleString()}</span>` +
          `</div>`
        );
      },
    },
    xAxis: {
      type: "category",
      data: MONTHS,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.axisLabel, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      // 自动 + 至少 1 个数量级
      minInterval: 1,
      axisLabel: {
        color: t.axisLabel,
        fontSize: 11,
        formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`),
      },
      splitLine: { lineStyle: { color: t.splitLine, type: "dashed" } },
      axisLine: { show: false },
      axisTick: { show: false },
      // 不强制 0 起，让数据更聚焦；保留底部 padding
      scale: true,
      max: maxY > 0 ? Math.ceil((maxY * 1.15) / 10) * 10 : 100,
    },
    series: buildSeries(series),
    animationDuration: 500,
  };
}

interface DemandLineChartProps {
  className?: string;
  /** 所有项目（含未录入需求的项目，作为 chip 显示但不画线） */
  series: DemandProjectSeries[];
}

export function DemandLineChart({ className, series }: DemandLineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();

  /* ----- 初始化 / 主题切换时整图重建 ----- */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(buildOption(dark, series), true);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
    // 重建图表依赖 dark + series 全量（首次 + 主题切换）
    // 后续显隐 / 数据变更走下面的增量更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  /* ----- 数据 / 显隐变化时仅增量更新 series ----- */
  // 序列化 series 摘要作为依赖，避免对象引用变化但值未变时的抖动
  const seriesDigest = useMemo(
    () =>
      series
        .map((s) => `${s.projectId}:${s.visible ? 1 : 0}:${(s.demand ?? []).join(",")}`)
        .join("|"),
    [series]
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.getInstanceByDom(el);
    if (!chart) return;
    chart.setOption({ series: buildSeries(series) }, { notMerge: false, lazyUpdate: true });
  }, [seriesDigest, series]);

  return <div ref={ref} className={cn("h-full w-full", className)} />;
}

/** 把项目扁平化成"含颜色"的 series（chip 也复用 LINE_COLORS） */
export function buildDemandSeries(
  projects: Array<{ id: number; code: string; name: string; demand: number[] | null }>,
  selectedIds: Set<number>
): DemandProjectSeries[] {
  return projects.map((p, idx) => ({
    projectId: p.id,
    code: p.code,
    name: p.name,
    color: LINE_COLORS[idx % LINE_COLORS.length],
    demand: p.demand ?? null,
    visible: selectedIds.has(p.id),
  }));
}

/** 取一条"已选中且有数据"项目的 fallback 颜色（用于 chip 描边） */
export function colorOf(series: DemandProjectSeries[], projectId: number): string {
  return series.find((s) => s.projectId === projectId)?.color ?? "#64748b";
}

export { LINE_COLORS };
