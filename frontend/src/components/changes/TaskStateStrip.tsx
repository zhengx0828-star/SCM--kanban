import { cn, percentageSplit } from "@/lib/utils";
import { TASK_STATE_ORDER, taskStateMeta, type TaskStateCount } from "@/types/change";

/**
 * 任务五色构成 —— 一条堆叠横条 + 图例。
 *
 * 为什么不做成饼图：五色是**固定语义**（蓝进行中/黄临期/红超期/绿按时/橙迟交），
 * 一条横条就能把"健康度结构"看清，不需要占一张图的卡位（首页密度纪律）。
 *
 * ★ 取色一律走 `taskStateMeta(state)` 的兜底，禁止直接下标 —— 门禁 P8。
 */

interface Props {
  counts: TaskStateCount[];
  className?: string;
  isLoading?: boolean;
  emptyText?: string;
}

export function TaskStateStrip({ counts, className, isLoading, emptyText = "还没有任务" }: Props) {
  const total = counts.reduce((s, c) => s + c.count, 0);

  if (isLoading) {
    return <div className={cn("h-2 w-full animate-pulse rounded-full bg-muted", className)} />;
  }

  if (total === 0) {
    return <p className={cn("py-1 text-xs text-muted-foreground", className)}>{emptyText}</p>;
  }

  // 按固定顺序渲染，忽略后端顺序差异；未登记的 state 归到末尾但仍安全取色
  const ordered = TASK_STATE_ORDER.map((s) => counts.find((c) => c.state === s)).filter(
    (c): c is TaskStateCount => Boolean(c)
  );
  // ★ 百分比走最大余数法：直接 Math.round 会得到 33+12+18+3+33 = 99%，
  //   横条上的百分比合计不是 100 同样会让人怀疑数据（见 utils.percentageSplit）
  const parts = percentageSplit(ordered.map((c) => c.count));

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="任务状态构成">
        {ordered
          .filter((c) => c.count > 0)
          .map((c) => {
            const meta = taskStateMeta(c.state);
            const pct = (c.count / total) * 100;
            return (
              <span
                key={c.state}
                title={`${meta.label} ${c.count} 项 · ${Math.round(pct)}%`}
                className="h-full"
                style={{ width: `${pct}%`, backgroundColor: meta?.solid ?? "#888780" }}
              />
            );
          })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {ordered.map((c, i) => {
          const meta = taskStateMeta(c.state);
          const pct = parts[i] ?? 0;
          return (
            <span
              key={c.state}
              className={cn(
                "flex items-center gap-1.5 text-[11px]",
                c.count === 0 && "opacity-45"
              )}
              title={`${meta.label} ${c.count} 项`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: meta?.solid ?? "#888780" }}
                aria-hidden
              />
              <span className="text-muted-foreground">{meta.label}</span>
              <span className="font-medium tabular-nums">{c.count}</span>
              <span className="text-muted-foreground/70 tabular-nums">{pct}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
