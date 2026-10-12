import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { cn, percentageSplit } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { categoryColor } from "@/types/change";

/**
 * 通用环形图（甜甜圈）—— 类型分布 / 项目分布共用。
 *
 * 口径纪律：
 *   - 只画传进来的数，**扇区为 0 的项直接不画**（ECharts 画 0 值扇区会留一条脏线）
 *   - 分类配色走 `categoryColor(位次)`，按位次取色 → 同一份数据刷新后颜色不跳
 *   - ★ 刻意不用红/黄/绿：那是本模块的**状态语义**（超期/临期/完成），
 *     拿去做分类色会被误读成"这个类型有问题"
 *   - 圆心显示总数，免得看的人再去心算各扇区之和
 */

const THEME = {
  light: {
    tooltipBg: "#ffffff",
    tooltipBorder: "#e2e8f0",
    tooltipText: "#0f172a",
    centerLabel: "#64748b",
    centerValue: "#0f172a",
    emptyRing: "#e2e8f0",
  },
  dark: {
    tooltipBg: "#1e293b",
    tooltipBorder: "#334155",
    tooltipText: "#e2e8f0",
    centerLabel: "#94a3b8",
    centerValue: "#e2e8f0",
    emptyRing: "#1e293b",
  },
} as const;

export interface DonutItem {
  name: string;
  value: number;
}

interface Props {
  items: DonutItem[];
  isLoading?: boolean;
  className?: string;
  /** 圆心下方的小字，如「变更单」 */
  centerLabel?: string;
  /** 点扇区回调（下钻用）。不传则不可点。 */
  onSliceClick?: (name: string, index: number) => void;
  emptyText?: string;
  /** 图例放右侧还是底部 —— 窄栏用 bottom，宽栏用 right */
  legendPosition?: "right" | "bottom";
  /**
   * 指定每个扇区的颜色（与 items **等长、同序**，按 index 取）。
   * 不传则走 `categoryColor(位次)` —— 分类色板（刻意避开红/黄/绿，见 types/change.ts）。
   *
   * ★ 目前只有「任务构成」饼传这个，且**必须**传：它要保留 `taskStateMeta(state).solid`
   *   的**状态语义色**（蓝进行中 / 黄临期 / 红超期 / 绿按时 / 橙迟交）。
   *   若走分类色板，"超期"会被画成紫色 —— 老板最该警觉的信号失去颜色提示。
   *   这是**有意的业务特例**，不要改默认行为（分类维度仍必须与状态色分得开）。
   */
  colors?: string[];
  /** tooltip 里的计数单位 —— 变更单是「张」，任务是「项」。图例不带单位（避免过宽）。 */
  unit?: string;
}

export function ChangeDonutChart({
  items,
  isLoading,
  className,
  centerLabel = "合计",
  onSliceClick,
  emptyText = "暂无可统计的数据",
  legendPosition = "right",
  colors,
  unit = "张",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();

  // 0 值不参与绘制（但保留在图例里，让读的人知道"这项确实是 0"）
  const drawn = useMemo(() => items.filter((it) => it.value > 0), [items]);
  const total = useMemo(() => items.reduce((s, it) => s + it.value, 0), [items]);
  const clickable = Boolean(onSliceClick);

  /**
   * 百分比用**最大余数法**分配，保证各扇区加起来正好 100%（见 utils.percentageSplit）。
   * 直接四舍五入会出现 43+29+29=101% —— 饼图百分比加起来不是 100，
   * 看的人第一反应是"数据错了吧"，白白消耗信任。
   */
  const pctMap = useMemo(() => {
    const map = new Map<string, number>();
    if (items.length === 0) return map;
    const parts = percentageSplit(items.map((it) => it.value));
    items.forEach((it, i) => map.set(it.name, parts[i] ?? 0));
    return map;
  }, [items]);

  const pctOf = (name: string) => pctMap.get(name) ?? (total > 0 ? Math.round(((items.find((x) => x.name === name)?.value ?? 0) / total) * 100) : 0);

  const option = useMemo<echarts.EChartsOption>(() => {
    const t = dark ? THEME.dark : THEME.light;
    const legendRight = legendPosition === "right";
    return {
      backgroundColor: "transparent",
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      tooltip: {
        trigger: "item",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        formatter: (p: unknown) => {
          const d = p as { name?: string; value?: number };
          return (
            `<div style="font-weight:600;margin-bottom:2px">${d.name ?? ""}</div>` +
            `<div style="font-variant-numeric:tabular-nums">${d.value ?? 0} ${unit} · ${pctOf(d.name ?? "")}%</div>`
          );
        },
      },
      legend: {
        orient: legendRight ? "vertical" : "horizontal",
        right: legendRight ? 0 : undefined,
        bottom: legendRight ? undefined : 0,
        top: legendRight ? "middle" : undefined,
        left: legendRight ? undefined : "center",
        itemWidth: 9,
        itemHeight: 9,
        icon: "circle",
        itemGap: 7,
        textStyle: { color: t.centerValue, fontSize: 11 },
        formatter: (name: string) => {
          const it = items.find((x) => x.name === name);
          const v = it?.value ?? 0;
          return `${name}  ${v} · ${pctOf(name)}%`;
        },
        // 图例也把 0 值项列出来（灰色），避免"数据没了"的错觉
        data: items.map((it) => it.name),
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "76%"],
          center: legendRight ? ["34%", "50%"] : ["50%", "44%"],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: "transparent", borderWidth: 1 },
          emphasis: { scale: true, scaleSize: 5 },
          data: drawn.map((it) => {
            const idx = items.findIndex((x) => x.name === it.name);
            return {
              name: it.name,
              value: it.value,
              // ★ 传了 colors 就用它（状态语义色，如任务构成）；否则走分类色板
              itemStyle: { color: colors?.[idx] ?? categoryColor(idx) },
            };
          }),
          cursor: clickable ? "pointer" : "default",
        },
      ],
      graphic:
        drawn.length > 0
          ? [
              {
                type: "text",
                left: legendRight ? "34%" : "50%",
                top: "44%",
                style: {
                  text: String(total),
                  textAlign: "center",
                  fill: t.centerValue,
                  fontSize: 22,
                  fontWeight: 500,
                },
              },
              {
                type: "text",
                left: legendRight ? "34%" : "50%",
                top: "58%",
                style: {
                  text: centerLabel,
                  textAlign: "center",
                  fill: t.centerLabel,
                  fontSize: 11,
                },
              },
            ]
          : [],
      animationDuration: 400,
    };
  }, [items, drawn, total, pctMap, dark, centerLabel, clickable, legendPosition, colors, unit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(option, true);
    const onClick = (p: unknown) => {
      if (!onSliceClick) return;
      const d = p as { name?: string; dataIndex?: number };
      if (d.name) onSliceClick(d.name, d.dataIndex ?? 0);
    };
    chart.on("click", onClick);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.off("click", onClick);
      chart.dispose();
    };
  }, [option, onSliceClick]);

  const empty = !isLoading && drawn.length === 0;

  return (
    <div className={cn("relative w-full", className)}>
      <div ref={ref} className="h-full w-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          加载中…
        </div>
      )}
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}
