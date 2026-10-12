import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import type { ChangeBurndown } from "@/types/change";

/**
 * 燃尽图：计划阶梯线 + 实际线。
 *
 * 口径（用户确认）：
 *   - 只数**叶子**任务（父项不重复计入）
 *   - 计划线按各叶子的 `plan_end` **阶梯下降**（比直线更真实）
 *   - 实际线按 `done_at` 逐日累计下降
 *   - **只依赖已录入的数据**，不推算、不补假点（数据保真）
 *
 * 两条线的距离回答一个问题：我们比计划快了还是慢了。
 */

const THEME = {
  light: {
    axis: "#cbd5e1",
    axisLabel: "#64748b",
    splitLine: "#e2e8f0",
    tooltipBg: "#ffffff",
    tooltipBorder: "#e2e8f0",
    tooltipText: "#0f172a",
  },
  dark: {
    axis: "#334155",
    axisLabel: "#94a3b8",
    splitLine: "#1e293b",
    tooltipBg: "#1e293b",
    tooltipBorder: "#334155",
    tooltipText: "#e2e8f0",
  },
} as const;

interface Props {
  data?: ChangeBurndown;
  isLoading?: boolean;
  className?: string;
}

export function BurndownChart({ data, isLoading, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();

  const option = useMemo<echarts.EChartsOption>(() => {
    const t = dark ? THEME.dark : THEME.light;
    const points = data?.points ?? [];
    return {
      backgroundColor: "transparent",
      grid: { left: 40, right: 20, top: 34, bottom: 32, containLabel: true },
      legend: {
        top: 4,
        right: 8,
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { color: t.axisLabel, fontSize: 11 },
        data: ["计划剩余", "实际剩余"],
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = (Array.isArray(params) ? params : [params]) as Array<{
            axisValue?: string;
            seriesName?: string;
            value?: number | null;
          }>;
          if (!arr.length) return "";
          const head = `<div style="font-weight:600;margin-bottom:4px">${arr[0].axisValue ?? ""}</div>`;
          const body = arr
            .map(
              (p) =>
                `<div style="display:flex;justify-content:space-between;gap:12px;line-height:1.6">` +
                `<span>${p.seriesName}</span>` +
                `<span style="font-variant-numeric:tabular-nums;font-weight:600">${
                  p.value == null ? "—" : p.value
                }</span></div>`
            )
            .join("");
          return head + body;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((p) => p.date.slice(5)),
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.axisLabel, fontSize: 10, interval: Math.max(0, Math.floor(points.length / 8) - 1) },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        name: "剩余任务",
        nameTextStyle: { color: t.axisLabel, fontSize: 10 },
        axisLabel: { color: t.axisLabel, fontSize: 10 },
        splitLine: { lineStyle: { color: t.splitLine, type: "dashed" } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          id: "plan",
          name: "计划剩余",
          type: "line",
          step: "end",
          symbol: "none",
          data: points.map((p) => p.plan_remaining),
          lineStyle: { width: 1.8, color: "#94a3b8", type: "dashed" },
          itemStyle: { color: "#94a3b8" },
        },
        {
          id: "actual",
          name: "实际剩余",
          type: "line",
          smooth: false,
          symbol: "circle",
          symbolSize: 5,
          data: points.map((p) => p.actual_remaining),
          lineStyle: { width: 2.2, color: "#3b82f6" },
          itemStyle: { color: "#3b82f6" },
          areaStyle: { color: "rgba(59,130,246,0.08)" },
        },
      ],
      animationDuration: 400,
    };
  }, [data, dark]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(option, true);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [option]);

  const empty = !isLoading && (!data || data.points.length === 0);

  return (
    <div className={cn("relative h-[240px] w-full", className)}>
      <div ref={ref} className="h-full w-full" />
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          还没有任务或任务未填计划时间，暂时画不出燃尽曲线
        </div>
      )}
    </div>
  );
}
