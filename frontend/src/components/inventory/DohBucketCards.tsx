import { AlertOctagon, AlertTriangle, CheckCircle2, Clock4, HelpCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  INV_DOH_BUCKET,
  INV_DOH_BUCKET_ORDER,
  dohBucketMeta,
  type InvDohBucket,
  type InventoryDohBuckets,
} from "@/types/inventory";
import { cn } from "@/lib/utils";

/**
 * 顶部四卡 = 今日 DOH 四档预警（+ 第五张灰卡「无法评估」）。
 *
 * 口径：取「今日（窗口第 1 天）的动态 DOH」分桶，判定唯一入口在后端
 * `routers/inventory.py::_doh_bucket_of`，前端**不重算**（防口径漂移）。
 *
 *   ① 库存耗尽  DOH ≤ 0
 *   ② 紧急      0 < DOH < 安全天数
 *   ③ 偏低      安全天数 ≤ DOH < LeadTime
 *   ④ 充足      DOH ≥ LeadTime
 *   ⑤ 无法评估  需求不可用三档（缺需求 / BOM=0 / 需求为 0）—— 绝不入绿档
 *
 * 点击卡片 = 过滤出该档；再点一次取消（与「下单时机细条」互斥）。
 */

const ICONS: Record<InvDohBucket, typeof AlertOctagon> = {
  stockout: AlertOctagon,
  urgent: AlertTriangle,
  low: Clock4,
  ok: CheckCircle2,
  unknown: HelpCircle,
};

interface Props {
  buckets: InventoryDohBuckets;
  active: string | null;
  onSelect: (bucket: string | null) => void;
  totalRows: number;
}

export function DohBucketCards({ buckets, active, onSelect, totalRows }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {INV_DOH_BUCKET_ORDER.map((bucket) => {
        const meta = dohBucketMeta(bucket);
        const Icon = ICONS[bucket] ?? HelpCircle;
        const count = buckets[bucket] ?? 0;
        const isActive = active === bucket;
        const pct = totalRows > 0 ? (count / totalRows) * 100 : 0;

        // 灰卡 hint 必须分列三种成因，方便集中补录
        const hint =
          bucket === INV_DOH_BUCKET.unknown
            ? count > 0
              ? [
                  buckets.unknown_no_series > 0 ? `缺需求 ${buckets.unknown_no_series}` : null,
                  buckets.unknown_bom_zero > 0 ? `BOM为0 ${buckets.unknown_bom_zero}` : null,
                  buckets.unknown_demand_blank > 0 ? `需求为0 ${buckets.unknown_demand_blank}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "数据完整，无需补录"
            : meta.hint;

        return (
          <Card
            key={bucket}
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
            onClick={() => onSelect(isActive ? null : bucket)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(isActive ? null : bucket);
              }
            }}
            className={cn(
              "relative cursor-pointer overflow-hidden p-4 transition-all hover:shadow-sm",
              meta.cardCls,
              isActive && "ring-2 ring-primary ring-offset-1"
            )}
            title={`${meta.label}（${meta.desc}）\n点击只看这一档；再点一次取消`}
          >
            {/* 顶部色条：色觉之外的第二重编码 */}
            <span className={cn("absolute inset-x-0 top-0 h-[3px]", meta.bar)} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{meta.label}</span>
                </p>
                <p className={cn("mt-1.5 text-3xl font-semibold tabular-nums leading-none", meta.textCls)}>
                  {count}
                </p>
                <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground/80">{meta.desc}</p>
              </div>
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.chipCls)}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            {/* 占比条 */}
            <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <span className={cn("block h-full rounded-full", meta.bar)} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 truncate text-[10px] text-muted-foreground" title={hint}>
              {hint}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
