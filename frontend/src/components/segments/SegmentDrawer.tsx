import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { Pencil, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  CAP_DIMS,
  CARD_META,
  QUADRANT_MAP,
  WILL_DIMS,
  tierLabel,
  type CardColor,
  type Segment,
  type TierKey,
} from "@/types/segment";

/**
 * 单条评价抽屉：牌带 + 两张雷达（能力 / 意愿）+ 12 项档位表 + 跨期轨迹。
 *
 * 为什么拆两张雷达而不是一张 12 轴：能力与意愿是两把尺子，
 * 画进同一张图会让人误以为 12 项在同一个维度上可比。
 */

const THEME = {
  light: { axis: "#94a3b8", split: "#e2e8f0", text: "#64748b", name: "#334155" },
  dark: { axis: "#475569", split: "#334155", text: "#94a3b8", name: "#cbd5e1" },
} as const;

function MiniRadar({ dims, values, color }: { dims: readonly { key: string; label: string }[]; values: number[]; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();

  const option = useMemo<echarts.EChartsOption>(() => {
    const t = dark ? THEME.dark : THEME.light;
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: dark ? "#1e293b" : "#ffffff",
        borderColor: dark ? "#334155" : "#e2e8f0",
        textStyle: { color: dark ? "#e2e8f0" : "#0f172a", fontSize: 12 },
        formatter: (p: unknown) => {
          const d = p as { name?: string; value?: number[] };
          const idx = dims.findIndex((x) => x.label === d.name);
          const tier = idx >= 0 ? values[idx] : 0;
          return `${d.name ?? ""}<br/>档位 ${tier / 100} · 折算 ${tier} 分`;
        },
      },
      radar: {
        radius: "62%",
        center: ["50%", "54%"],
        splitNumber: 4,
        indicator: dims.map((d) => ({ name: d.label, max: 100 })),
        axisName: { color: t.name, fontSize: 11 },
        axisLine: { lineStyle: { color: t.split } },
        splitLine: { lineStyle: { color: t.split } },
        splitArea: { show: false },
      },
      series: [
        {
          type: "radar",
          symbolSize: 4,
          data: [{ value: values, name: "档位" }],
          lineStyle: { color, width: 2 },
          itemStyle: { color },
          areaStyle: { color, opacity: 0.16 },
        },
      ],
      animationDuration: 400,
    };
  }, [dims, values, color, dark]);

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

  return <div ref={ref} className="h-[260px] w-full" />;
}

interface Props {
  segment: Segment | null;
  threshold: number;
  history: Segment[];
  onClose: () => void;
  onEdit: (segment: Segment) => void;
  onDelete: (segment: Segment) => void;
  onCard: (segment: Segment, color: CardColor) => void;
  onRelease: (segment: Segment) => void;
}

export function SegmentDrawer({ segment, threshold, history, onClose, onEdit, onDelete, onCard, onRelease }: Props) {
  const open = Boolean(segment);

  const capValues = useMemo(
    () => CAP_DIMS.map((d) => ((segment?.[`tier_${d.key}` as TierKey] ?? 0) as number) * 100),
    [segment]
  );
  const willValues = useMemo(
    () => WILL_DIMS.map((d) => ((segment?.[`tier_${d.key}` as TierKey] ?? 0) as number) * 100),
    [segment]
  );

  const rows = useMemo(() => {
    if (!segment) return [];
    return [
      ...CAP_DIMS.map((d) => ({ ...d, dim: "能力", key: `tier_${d.key}` as TierKey })),
      ...WILL_DIMS.map((d) => ({ ...d, dim: "意愿", key: `tier_${d.key}` as TierKey })),
    ];
  }, [segment]);

  const meta = segment ? QUADRANT_MAP[segment.quadrant] ?? QUADRANT_MAP.incomplete : QUADRANT_MAP.incomplete;
  const cardMeta = segment?.card ? CARD_META[segment.card] : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[min(760px,94vw)] max-w-none gap-0 p-0">
        <SheetHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span>{segment?.supplier_name}</span>
                <Badge className="border-transparent" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                  {meta.label}
                </Badge>
                {cardMeta && (
                  <Badge className="border-transparent" style={{ backgroundColor: `${cardMeta.color}18`, color: cardMeta.color }}>
                    {cardMeta.label}
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription className="mt-1.5 text-xs">
                {segment?.pn} {segment?.material_name} · {segment?.period}
                {segment?.evaluator ? ` · 打分人 ${segment.evaluator}` : ""}
                {segment?.evaluated_on ? ` · ${segment.evaluated_on}` : ""}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">能力 / 意愿</p>
                <p className="text-lg font-medium tabular-nums">
                  {segment?.cap_score ?? "—"} <span className="text-muted-foreground">/</span> {segment?.will_score ?? "—"}
                </p>
              </div>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="px-6 py-5">
          {/* 牌带 */}
          <div
            className={cn(
              "mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3",
              cardMeta ? "border-transparent" : "bg-muted/30"
            )}
            style={cardMeta ? { backgroundColor: `${cardMeta.color}12` } : undefined}
          >
            <div className="min-w-0">
              {cardMeta ? (
                <>
                  <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: cardMeta.color }}>
                    <ShieldAlert className="h-4 w-4" />
                    当前挂 {cardMeta.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    红黄牌生效期间能力与意愿均记 0 分，档位原值保留；解除后自动恢复。
                  </p>
                </>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" />
                  无红黄牌
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {cardMeta ? (
                <Button size="sm" variant="outline" onClick={() => segment && onRelease(segment)}>
                  解除{cardMeta.label}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => segment && onCard(segment, "red")}
                  >
                    标红牌
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-600 hover:text-amber-700"
                    onClick={() => segment && onCard(segment, "yellow")}
                  >
                    标黄牌
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* 两张雷达 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border">
              <p className="border-b px-4 py-2 text-xs font-medium">能力 · 6 项</p>
              <MiniRadar dims={CAP_DIMS} values={capValues} color={QUADRANT_MAP.partner.color} />
            </div>
            <div className="rounded-md border">
              <p className="border-b px-4 py-2 text-xs font-medium">意愿 · 6 项</p>
              <MiniRadar dims={WILL_DIMS} values={willValues} color={QUADRANT_MAP.dependent.color} />
            </div>
          </div>

          {/* 12 项档位 */}
          <div className="mt-5 overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">维度</th>
                  <th className="px-3 py-2 text-left font-medium">指标</th>
                  <th className="px-3 py-2 text-right font-medium">档位</th>
                  <th className="px-3 py-2 text-right font-medium">折算分</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const value = segment ? segment[row.key] : null;
                  return (
                    <tr key={row.key} className="border-t">
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.dim}</td>
                      <td className="px-3 py-1.5">{row.label}</td>
                      <td className={cn("px-3 py-1.5 text-right tabular-nums", value === null && "text-muted-foreground")}>
                        {tierLabel(value)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {value === null ? "—" : value * 100}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 跨期轨迹 */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium">跨期轨迹</p>
            {history.length <= 1 ? (
              <p className="text-[11px] text-muted-foreground">只有一个期间的数据，暂无可比轨迹。</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">期间</th>
                      <th className="px-3 py-2 text-right font-medium">能力</th>
                      <th className="px-3 py-2 text-right font-medium">意愿</th>
                      <th className="px-3 py-2 text-left font-medium">象限</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => {
                      const hm = QUADRANT_MAP[h.quadrant] ?? QUADRANT_MAP.incomplete;
                      return (
                        <tr key={`${h.period}-${h.id}`} className="border-t">
                          <td className="px-3 py-1.5 tabular-nums">{h.period}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{h.cap_score ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{h.will_score ?? "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hm.color }} />
                              {hm.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="mt-4 text-[11px] leading-4 text-muted-foreground">
            象限判定：能力 &gt; {threshold} 且 意愿 &gt; {threshold} 为「意愿高、能力强」；正好 {threshold} 分算不过关。
          </p>
        </SheetBody>

        <SheetFooter className="flex-row justify-between border-t px-6 py-3">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => segment && onDelete(segment)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            删除评价
          </Button>
          <Button size="sm" onClick={() => segment && onEdit(segment)}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            编辑
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
