import { cn } from "@/lib/utils";
import type { ChangeProjectOverview } from "@/types/change";

/**
 * 偏差榜 —— 本模块的「灵魂指标」在首页的正面暴露。
 *
 * 偏差 = 时间进度（自动的标尺）− 完成率（人给的答案）。
 * 项目里为什么要有这张图：单看完成率会误判 ——
 *   PACK 产线完成率 43.8% 看着最高，但时间已经过了 82%，实际落后最多。
 * 所以两根条必须**并排画在一起**，差距才是信息。
 *
 * 配色纪律：时间进度用中性灰（它是背景标尺，不是成绩），完成率用蓝；
 * 偏差值本身才用红/黄/绿报警。
 */

interface Props {
  rows: ChangeProjectOverview[];
  isLoading?: boolean;
  emptyText?: string;
  className?: string;
}

function toneOf(dev: number): { chip: string; label: string } {
  if (dev >= 20) return { chip: "bg-red-500/10 text-red-600 dark:text-red-400", label: "严重滞后" };
  if (dev > 0) return { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: "轻度滞后" };
  if (dev === 0) return { chip: "bg-muted text-muted-foreground", label: "持平" };
  return { chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", label: "超前" };
}

export function ChangeDeviationRank({ rows, isLoading, emptyText = "还没有可对比的项目", className }: Props) {
  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  // ★ 口径：rows 的 total 已不含作废 → 不能再减 voided（会重复减、把只剩作废单的项目误判成空）。
  //   有有效单、或本身在「已归档」Tab 里，才值得进榜。
  const visible = rows.filter((r) => r.total > 0 || r.archived > 0);
  if (visible.length === 0) {
    return <p className={cn("py-2 text-xs text-muted-foreground", className)}>{emptyText}</p>;
  }

  // 落后最多的排最前（这是榜，不是清单）
  const sorted = [...visible].sort((a, b) => b.avg_deviation - a.avg_deviation);

  return (
    <div className={cn("space-y-3", className)}>
      {sorted.map((r) => {
        const tone = toneOf(r.avg_deviation);
        const done = Math.max(0, Math.min(100, r.task_done_rate));
        const time = Math.max(0, Math.min(100, r.avg_time_rate));
        const sign = r.avg_deviation > 0 ? "+" : "";
        return (
          <div key={r.project_id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className="truncate text-xs font-medium" title={r.project_name}>
                {r.project_name}
              </span>
              <span
                className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums", tone.chip)}
                title={`偏差 = 时间进度 ${r.avg_time_rate}% − 完成率 ${r.task_done_rate}%`}
              >
                偏差 {sign}
                {r.avg_deviation} 个点 · {tone.label}
              </span>
            </div>

            <div className="mt-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[10px] text-muted-foreground">时间进度</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-muted-foreground/50" style={{ width: `${time}%` }} />
                </span>
                <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{time}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[10px] text-muted-foreground">完成率</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-blue-500" style={{ width: `${done}%` }} />
                </span>
                <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{done}%</span>
              </div>
            </div>
          </div>
        );
      })}
      <p className="pt-0.5 text-[10px] text-muted-foreground">
        灰条 = 时间进度（自动标尺）· 蓝条 = 完成率（人给的答案）· 两段之差即偏差
      </p>
    </div>
  );
}
