import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { useTheme } from "@/lib/theme";
import { CARD_META, QUADRANT_MAP, type CardColor, type Segment } from "@/types/segment";
import { cn } from "@/lib/utils";

/**
 * 四象限散点：横轴 Willingness（意愿）、纵轴 Capabilities（能力）。
 *
 * 轴序 2026-11-02 由「横能力/纵意愿」改成「横意愿/纵能力」，象限随之换位：
 * 意愿低、能力强（右上→左上）；意愿高、能力弱（左上→右下）。
 * 意愿高、能力强（右上）与意愿低、能力弱（左下）不动。
 * 象限名就按两维高低直写，不再另起「战略伙伴」这类名字 —— 看图的人不用再记一遍对照表。
 *
 * 几条硬约束：
 *  - 十字线位置来自后端下发的 threshold，不写死 —— 阈值是可配置项，
 *    写死会让「方案说 50、图上画 60」这种事再次发生。
 *  - **牌点沉在原点**（牌期间两维归零），多家同时打牌会完全重叠 →
 *    聚合成一个气泡，中心显示家数，点击展开该牌的清单。
 *    ★ 不加随机偏移：坐标一偏就成 0.8 这种假数，看图的人会当真。
 *  - 牌点不标文字（会在原点糊成一团），靠气泡数字 + tooltip。
 */

const THEME = {
  light: {
    tooltipBg: "#ffffff",
    tooltipBorder: "#e2e8f0",
    tooltipText: "#0f172a",
    axis: "#94a3b8",
    split: "#f1f5f9",
    crosshair: "#cbd5e1",
  },
  dark: {
    tooltipBg: "#1e293b",
    tooltipBorder: "#334155",
    tooltipText: "#e2e8f0",
    axis: "#64748b",
    split: "#1e293b",
    crosshair: "#475569",
  },
} as const;

interface Props {
  data: Segment[];
  threshold: number;
  onSelect?: (segment: Segment) => void;
  onCardClick?: (card: CardColor) => void;
  className?: string;
}

export function QuadrantChart({ data, threshold, onSelect, onCardClick, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();

  /** 牌点聚合：同一牌色的所有供应商合成一个原点气泡 */
  const cardGroups = useMemo(() => {
    const groups: Record<CardColor, Segment[]> = { red: [], yellow: [] };
    for (const item of data) {
      if (item.card === "red" || item.card === "yellow") groups[item.card].push(item);
    }
    return groups;
  }, [data]);

  /** 未打牌的点照分数落位 */
  const normal = useMemo(() => data.filter((item) => !item.card), [data]);

  const option = useMemo<echarts.EChartsOption>(() => {
    const t = dark ? THEME.dark : THEME.light;

    const basePoints = normal.map((item) => {
      const meta = QUADRANT_MAP[item.quadrant] ?? QUADRANT_MAP.incomplete;
      return {
        name: `${item.supplier_name} · ${item.pn}`,
        value: [item.will_score ?? 0, item.cap_score ?? 0],
        itemStyle: {
          color: item.quadrant === "incomplete" ? "transparent" : meta.color,
          borderColor: meta.color,
          borderWidth: item.quadrant === "incomplete" ? 1.5 : 0,
          opacity: item.quadrant === "incomplete" ? 1 : 0.9,
        },
        symbol: item.quadrant === "incomplete" ? "emptyCircle" : "circle",
        label: {
          // 只给「意愿低、能力弱」标名字：老板最该点名的就是这一格，全标会糊
          show: item.quadrant === "exit",
          formatter: item.supplier_name,
          position: "bottom" as const,
          distance: 4,
          color: meta.color,
          fontSize: 10,
        },
        segment: item,
      };
    });

    const cardPoints = (["red", "yellow"] as CardColor[])
      .filter((color) => cardGroups[color].length > 0)
      .map((color) => {
        const rows = cardGroups[color];
        return {
          name: CARD_META[color].label,
          value: [0, 0],
          // 只挪绘制位置、不改数值：0,0 正好压在坐标轴交点上，不挪会被裁掉一半
          symbolOffset: [12, -12],
          // 家数越多气泡越大，但封顶，免得盖住整个左下角
          symbolSize: Math.min(18 + rows.length * 3, 46),
          itemStyle: {
            color: CARD_META[color].color,
            opacity: 0.9,
            borderColor: "#ffffff",
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: String(rows.length),
            color: "#ffffff",
            fontSize: 12,
            fontWeight: 500 as const,
          },
          cardColor: color,
          rows,
        };
      });

    return {
      backgroundColor: "transparent",
      animationDuration: 400,
      grid: { left: 48, right: 32, top: 40, bottom: 40 },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        name: "Willingness",
        nameLocation: "end",
        nameGap: 16,
        nameTextStyle: { color: t.axis, fontSize: 12, padding: [0, 0, 0, 12] },
        axisLabel: { color: t.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: t.crosshair } },
        splitLine: { lineStyle: { color: t.split } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        name: "Capabilities",
        nameLocation: "end",
        nameGap: 14,
        nameRotate: 0,
        nameTextStyle: { color: t.axis, fontSize: 12, padding: [0, 0, 6, 0] },
        axisLabel: { color: t.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: t.crosshair } },
        splitLine: { lineStyle: { color: t.split } },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        formatter: (p: unknown) => {
          const d = p as { data?: { segment?: Segment; rows?: Segment[]; cardColor?: CardColor } };
          if (d.data?.rows) {
            const rows = d.data.rows;
            const head = `<div style="font-weight:500;margin-bottom:4px">${CARD_META[d.data.cardColor!].label} · ${rows.length} 条</div>`;
            const lines = rows
              .slice(0, 8)
              .map((r) => `<div style="color:#64748b">${r.supplier_name} · ${r.pn}</div>`)
              .join("");
            const more = rows.length > 8 ? `<div style="color:#94a3b8;margin-top:2px">…另有 ${rows.length - 8} 条</div>` : "";
            return head + lines + more + `<div style="color:#94a3b8;margin-top:4px">点击查看清单</div>`;
          }
          const s = d.data?.segment;
          if (!s) return "";
          const meta = QUADRANT_MAP[s.quadrant] ?? QUADRANT_MAP.incomplete;
          return (
            `<div style="font-weight:500;margin-bottom:2px">${s.supplier_name}</div>` +
            `<div style="color:#64748b;margin-bottom:4px">${s.pn} ${s.material_name}</div>` +
            `<div style="font-variant-numeric:tabular-nums">能力 ${s.cap_score ?? "—"} · 意愿 ${s.will_score ?? "—"}</div>` +
            `<div style="color:${meta.color};margin-top:2px">${meta.label}</div>`
          );
        },
      },
      series: [
        // 底层：只用来承载十字线 + 四象限底色，点本身不可见
        {
          type: "scatter",
          data: [[0, 0]],
          symbolSize: 0,
          silent: true,
          tooltip: { show: false },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: t.crosshair, type: "dashed", width: 1 },
            label: { show: false },
            data: [{ xAxis: threshold }, { yAxis: threshold }],
          },
          markArea: {
            silent: true,
            // 象限名不在这里画：markArea 在 z=2，散点 z=5 会盖住字。
            // 名字单独用一层 scatter 画在 z=9，永远压在点上面。
            label: { show: false },
            data: [
              // 左上：意愿低、能力强
              [
                { xAxis: 0, yAxis: threshold, itemStyle: { color: QUADRANT_MAP.dependent.soft } },
                { xAxis: threshold, yAxis: 100 },
              ],
              // 右上：意愿高、能力强
              [
                { xAxis: threshold, yAxis: threshold, itemStyle: { color: QUADRANT_MAP.partner.soft } },
                { xAxis: 100, yAxis: 100 },
              ],
              // 左下：两维都低
              [
                { xAxis: 0, yAxis: 0, itemStyle: { color: QUADRANT_MAP.exit.soft } },
                { xAxis: threshold, yAxis: threshold },
              ],
              // 右下：意愿高、能力低
              [
                { xAxis: threshold, yAxis: 0, itemStyle: { color: QUADRANT_MAP.nurture.soft } },
                { xAxis: 100, yAxis: threshold },
              ],
            ],
          },
        },
        // 象限名：水平居中，贴各自色块的上沿内侧，单独一层画在散点之上
        {
          type: "scatter",
          silent: true,
          // zlevel 单独一层 canvas：只调 z 没用，散点仍会盖住字
          zlevel: 2,
          z: 10,
          symbolSize: 0,
          tooltip: { show: false },
          data: (
            [
              // 上半区贴上沿 6px；下半区压到 22px —— 分数在 45~50 的点正好挤在
              // 十字线下方，只压 10px 仍会被盖住，得让开一个点的直径。
              [QUADRANT_MAP.dependent, threshold / 2, 100, 6],
              [QUADRANT_MAP.partner, (threshold + 100) / 2, 100, 6],
              [QUADRANT_MAP.exit, threshold / 2, threshold, 22],
              [QUADRANT_MAP.nurture, (threshold + 100) / 2, threshold, 22],
            ] as const
          ).map(([meta, x, y, gap]) => ({
            value: [x, y],
            name: meta.label,
            label: {
              show: true,
              formatter: meta.label,
              position: "bottom" as const,
              offset: [0, gap],
              color: meta.color,
              fontSize: 12,
              fontWeight: 500 as const,
              // 白描边当底色：点从字后面经过时仍然读得清
              textBorderColor: "rgba(255,255,255,0.92)",
              textBorderWidth: 3,
            },
          })),
        },
        { type: "scatter", data: basePoints, symbolSize: 11, z: 5, cursor: "pointer" },
        { type: "scatter", data: cardPoints, z: 8, cursor: "pointer", clip: false },
      ],
    };
  }, [normal, cardGroups, threshold, dark]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(option, true);
    const onClick = (p: unknown) => {
      const d = p as { data?: { segment?: Segment; cardColor?: CardColor } };
      if (d.data?.cardColor && onCardClick) {
        onCardClick(d.data.cardColor);
        return;
      }
      if (d.data?.segment && onSelect) onSelect(d.data.segment);
    };
    chart.on("click", onClick);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.off("click", onClick);
      chart.dispose();
    };
  }, [option, onSelect, onCardClick]);

  return <div ref={ref} className={cn("h-full w-full", className)} />;
}
