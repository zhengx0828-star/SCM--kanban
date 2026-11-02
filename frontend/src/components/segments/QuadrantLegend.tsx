import { cn } from "@/lib/utils";
import { QUADRANTS, type Quadrant } from "@/types/segment";

/**
 * 象限图例卡：名称 / 家数 / 占比 / 动作。
 *
 * 老板看四象限图的第一个问题是「落在这一格该干什么」，
 * 所以动作建议必须和象限名同屏，不能只放在规则页。
 */
interface Props {
  byQuadrant: Record<string, number>;
  total: number;
  className?: string;
  onPick?: (quadrant: Quadrant) => void;
  activeQuadrant?: Quadrant | null;
}

export function QuadrantLegend({ byQuadrant, total, className, onPick, activeQuadrant }: Props) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {QUADRANTS.map((item) => {
        const count = byQuadrant[item.key] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const active = activeQuadrant === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onPick?.(item.key)}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
              active ? "border-foreground/30 bg-muted/60" : "hover:bg-muted/40"
            )}
          >
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {count} 条 · {pct}%
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{item.action}</span>
            </span>
          </button>
        );
      })}
      <p className="px-1 pt-1 text-[11px] leading-4 text-muted-foreground">
        牌生效期间能力与意愿一律记 0 分，点沉在原点；牌解除后按原档位自动恢复。
      </p>
    </div>
  );
}
