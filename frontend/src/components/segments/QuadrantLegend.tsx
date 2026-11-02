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
            // 选中态以前只有「边框深一点」，白卡上等于看不见 —— 现在用该象限的色
            // 做左边条 + 浅底 + 已筛标签，三处一起变，才看得出选中了哪一格。
            style={active ? { borderColor: `${item.color}80`, backgroundColor: item.soft } : undefined}
            className={cn(
              "relative flex w-full items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2 text-left transition-colors",
              active ? "" : "hover:bg-muted/40"
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {count} 条 · {pct}%
                </span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] leading-4 text-muted-foreground">
                <span className="truncate">{item.action}</span>
                {active && (
                  <span
                    className="shrink-0 rounded-full px-1.5 text-[10px] font-medium leading-4"
                    style={{ backgroundColor: `${item.color}1f`, color: item.color }}
                  >
                    已筛
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
      <p className="px-1 pt-1 text-[11px] leading-4 text-muted-foreground">
        红黄牌生效期间能力与意愿一律记 0 分，点沉在原点；解除后按原档位自动恢复。
      </p>
    </div>
  );
}
