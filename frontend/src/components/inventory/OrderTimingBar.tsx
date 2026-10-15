import { INV_STATUS, type InventoryCell, type InventoryPlan } from "@/types/inventory";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * 下单时机细条（原「风险时间漏斗」降级保留）。
 *
 * 口径不变：一行 30 天矩阵里**首次需要下单**的日子分桶。
 * 亮灯判据 = 该日期末跌破再订货点 ROP，或状态已到红/深红。
 * 用 ROP 而非安全线作主信号，因为 ROP 已含采购提前期，它才是
 * 「现在下单来得及」的最后时点（ROP = (LT + 安全天数) × 日均需求）。
 *
 * 与顶部 DOH 四卡**互斥过滤**：一个是库存健康度（DOH），一个是补货时机（ROP），
 * 叠加会让用户困惑，故同时只能生效一个。
 */

/** 首亮灯日分桶：0=今日 1=D2–D7 2=D8–D14 3=D15–D30；-1 = 窗口内无风险 */
export type RiskBucket = -1 | 0 | 1 | 2 | 3;
export const NO_RISK: RiskBucket = -1;

/** 某日是否需要下单：期末跌破 ROP，或状态已到红/深红 */
export function needOrderOn(plan: InventoryPlan, cell: InventoryCell): boolean {
  if (cell.status === INV_STATUS.stockout || cell.status === INV_STATUS.red) return true;
  return cell.ending <= plan.rop;
}

/** 找一行 30 天矩阵里第一次需要下单的位置 → 归属分桶 */
export function firstRiskBucket(p: InventoryPlan): RiskBucket {
  for (let i = 0; i < p.days.length; i++) {
    if (needOrderOn(p, p.days[i])) {
      if (i === 0) return 0;
      if (i < 7) return 1;
      if (i < 14) return 2;
      return 3;
    }
  }
  return NO_RISK;
}

export interface TimingSegment {
  bucket: Exclude<RiskBucket, -1>;
  label: string;
  rangeLabel: string;
  hint: string;
  bar: string;
  textCls: string;
}

export const TIMING_SEGMENTS: TimingSegment[] = [
  {
    bucket: 0,
    label: "今日需下单",
    rangeLabel: "今日",
    hint: "今日已跌破再订货点 ROP，现在下单才来得及",
    bar: "bg-red-600",
    textCls: "text-red-700 dark:text-red-400",
  },
  {
    bucket: 1,
    label: "7 天内",
    rangeLabel: "D2–D7",
    hint: "预计本周内跌破 ROP，需尽快安排采购",
    bar: "bg-orange-500",
    textCls: "text-orange-700 dark:text-orange-400",
  },
  {
    bucket: 2,
    label: "8–14 天",
    rangeLabel: "D8–D14",
    hint: "预计下两周内跌破 ROP，可排进补货计划",
    bar: "bg-amber-500",
    textCls: "text-amber-700 dark:text-amber-400",
  },
  {
    bucket: 3,
    label: "15–30 天",
    rangeLabel: "D15–D30",
    hint: "窗口尾部才需补货，先观察需求变化",
    bar: "bg-yellow-500",
    textCls: "text-yellow-700 dark:text-yellow-600",
  },
];

interface Props {
  counts: Record<number, number>;
  irreversibleToday: number;
  noRisk: number;
  active: number | null;
  onSelect: (bucket: number | null) => void;
  totalRows: number;
}

/**
 * 一条 ~44px 高的细分段条。段宽按「行数占比」自适应（最小 12% 保证可点）。
 * 段①右侧附「其中 N 行下单也来不及」（今日 DOH < LT）。
 */
export function OrderTimingBar({ counts, irreversibleToday, noRisk, active, onSelect, totalRows }: Props) {
  const sum = TIMING_SEGMENTS.reduce((acc, s) => acc + (counts[s.bucket] ?? 0), 0);

  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          下单时机
          <span className="ml-1 text-muted-foreground/70">按每行首次跌破再订货点 ROP 的日期分布</span>
        </p>
        <div className="flex items-center gap-2 text-[11px]">
          {sum === 0 && <span className="text-emerald-600 dark:text-emerald-400">30 天内均无需下单</span>}
          {irreversibleToday > 0 && (
            <span className="rounded bg-red-500/10 px-1.5 py-px font-medium text-red-600 dark:text-red-400">
              其中 {irreversibleToday} 行下单也来不及（今日 DOH &lt; LT）
            </span>
          )}
          {noRisk > 0 && <span className="text-muted-foreground">{noRisk} 行窗口内无风险</span>}
        </div>
      </div>

      {/* 分段条：flex-grow 按计数分配，零计数的段给最小宽度 */}
      <div className="flex h-7 gap-1 overflow-hidden rounded-md">
        {TIMING_SEGMENTS.map((s) => {
          const count = counts[s.bucket] ?? 0;
          const isActive = active === s.bucket;
          return (
            <button
              key={s.bucket}
              type="button"
              disabled={count === 0}
              onClick={() => onSelect(isActive ? null : s.bucket)}
              title={`${s.label}（${s.rangeLabel}）· ${count} 行\n${s.hint}\n点击只看这一档；再点一次取消`}
              style={{ flexGrow: count === 0 ? 0 : count }}
              className={cn(
                "flex min-w-[84px] items-center justify-center gap-1.5 rounded px-2 text-[11px] font-medium transition-all",
                count === 0 ? "cursor-default bg-muted/40 text-muted-foreground/50" : "text-white",
                count > 0 && s.bar,
                count > 0 && "hover:opacity-90",
                isActive && "ring-2 ring-foreground/60 ring-offset-1"
              )}
            >
              <span className="truncate">{s.rangeLabel}</span>
              <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
