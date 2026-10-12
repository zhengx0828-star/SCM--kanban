import { cn } from "@/lib/utils";
import { ChangeInsight } from "./ChangeInsight";
import type { OverdueBucket } from "@/types/change";

/**
 * 超期深度 —— 区分「刚过期的」和「拖了很久的」。
 *
 * ★ 自适应降级（用户确认的设计）：
 *   4 档里有 **≥3 档有值** → 画成 4 行条形图（有结构可比）
 *   否则 → 退化成一行文字（例如"超期 6 项，集中在 4-7 天 与 8-14 天，拖最久 11 天"）
 *   理由：4 根柱子里 2 根是 0 的图不叫图，叫噪声。指标只有一个值时用文字，有结构时才用图。
 *   数据一多它会自己升格成图，不需要再改代码。
 */

interface Props {
  buckets: OverdueBucket[];
  /** 超期项总数（= 各档之和，用于文案与校验） */
  total: number;
  /** 拖得最久的天数 */
  maxDays: number;
  isLoading?: boolean;
  className?: string;
}

export function ChangeOverdueDepth({ buckets, total, maxDays, isLoading, className }: Props) {
  if (isLoading) {
    return <div className={cn("h-12 animate-pulse rounded-md bg-muted", className)} />;
  }

  if (total === 0) {
    return (
      <ChangeInsight tone="good" className={className}>
        当前没有超期未完成的待办项
      </ChangeInsight>
    );
  }

  const nonZero = buckets.filter((b) => b.count > 0);
  const max = Math.max(...buckets.map((b) => b.count), 1);

  if (nonZero.length < 3) {
    const labels = nonZero.map((b) => `${b.label}（${b.count} 项）`).join("、");
    return (
      <ChangeInsight tone="warn" className={className}>
        超期 {total} 项，只落在 {labels} 这 {nonZero.length} 个区间里，拖最久 {maxDays} 天
        <span className="text-muted-foreground"> —— 档位不足 3 档，暂以文字呈现，档位变多会自动画成图</span>
      </ChangeInsight>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {buckets.map((b) => {
        const pct = Math.round((b.count / max) * 100);
        return (
          <div key={b.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{b.label}</span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", b.count > 0 ? "bg-red-500/70" : "bg-transparent")}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums font-medium">{b.count}</span>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">
        共超期 {total} 项 · 拖最久 {maxDays} 天 · 越靠下说明拖得越久，越该有人负责
      </p>
    </div>
  );
}
