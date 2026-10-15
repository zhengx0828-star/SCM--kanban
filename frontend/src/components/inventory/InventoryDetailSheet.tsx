import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock4,
  Factory,
  PackagePlus,
  Trash2,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CapacityHint, RopTimingHint, SafetyStockHint } from "@/components/inventory/ConceptHints";
import { CellInput } from "@/components/inventory/InventoryRow";
import {
  INV_CAPACITY_META,
  INV_COV_META,
  INV_SOURCE,
  INV_STATUS_META,
  dohBucketMeta,
  type InventoryCell,
  type InventoryPlan,
  type InvStatus,
} from "@/types/inventory";
import { cn } from "@/lib/utils";

/**
 * L2 物料详情抽屉：30 天 × 5 层矩阵 + 口径条 + 建议条。
 *
 * 这是本次改版最关键的搬迁：原本 30 天矩阵「行内展开」，把表格撑到
 * 600 + 30×76 = 2880px 宽，展开行与其它行完全不对齐，横向滚动 2880px
 * 才能看到最右侧的产能校验。搬进独立抽屉后，横向滚动只发生在这里，
 * 主列表恢复零横向滚动。
 *
 * 所有单元格的双击编辑能力**原样保留**（预测 / 手需 / 入库 / 期末 / DOH 五层）。
 */

const LEFT_W = 168;
const DAY_W = 78;
const GRID = `${LEFT_W}px repeat(30, ${DAY_W}px)`;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

type DayField = "sys" | "md" | "mi" | "ending" | "doh";

const DAY_FIELDS: { key: DayField; label: string; note: string }[] = [
  { key: "sys", label: "系统预测", note: "双击修改 = 覆盖该日摊日均；清空恢复系统值" },
  { key: "md", label: "手工需求", note: "双击修改，可为负；置 0 清除" },
  { key: "mi", label: "手工入库", note: "双击修改，可为负；置 0 清除" },
  { key: "ending", label: "期末库存", note: "双击直接改 = 覆盖自动算（盘点）；清空恢复" },
  { key: "doh", label: "动态 DOH", note: "双击输入目标天数 = 反推期末库存" },
];

export interface EditingCell {
  planId: number;
  date: string | null;
  field: DayField;
  initial: string;
}

interface Props {
  plan: InventoryPlan | null;
  bucket: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: EditingCell | null;
  onOpenEdit: (planId: number, date: string, field: DayField, current: string) => void;
  onCommitEdit: (v: string) => void;
  onCancelEdit: () => void;
  editRef: React.RefObject<HTMLInputElement>;
  pending: boolean;
  onDelete: (plan: InventoryPlan) => void;
  onJumpToSupplyDemand: (plan: InventoryPlan) => void;
}

function fmt(n: number): string {
  return `${Math.round(n)}`;
}

export function InventoryDetailSheet({
  plan,
  bucket,
  open,
  onOpenChange,
  editing,
  onOpenEdit,
  onCommitEdit,
  onCancelEdit,
  editRef,
  pending,
  onDelete,
  onJumpToSupplyDemand,
}: Props) {
  const dayHeaders = useMemo(() => {
    if (!plan) return [];
    const todayIso = new Date().toISOString().slice(0, 10);
    return plan.days.map((c) => {
      const d = new Date(c.date + "T00:00:00");
      return {
        md: `${d.getMonth() + 1}/${d.getDate()}`,
        wd: WEEK[d.getDay()],
        isToday: c.date === todayIso,
      };
    });
  }, [plan]);

  if (!plan) return null;

  const bucketMeta = dohBucketMeta(bucket);
  const covMeta = INV_COV_META[plan.cov_label] ?? INV_COV_META.na;
  const capMeta = INV_CAPACITY_META[plan.capacity_status] ?? INV_CAPACITY_META.na;

  const noDemandData = plan.hist.length === 0 && plan.fcast.length === 0;
  const bomZero = !!plan.bom_zero;
  const blankDemand = !!plan.demand_blank && !bomZero && !noDemandData;

  const d0 = plan.days[0];
  const dohToday = d0 ? (d0.doh_capped ? 30 : d0.doh) : 0;
  const capPct = plan.capacity_usage != null ? Math.min(Math.max(plan.capacity_usage, 0), 1) * 100 : 0;
  const isCellEditing = (date: string, field: DayField) =>
    editing?.planId === plan.id && editing?.date === date && editing?.field === field;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(1180px,94vw)] max-w-none gap-0 p-0">
        {/* 头部 */}
        <SheetHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span>{plan.material_name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">
                  {plan.pn}
                </span>
              </SheetTitle>
              <SheetDescription className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="secondary" className="px-1.5 py-0 font-normal">
                  {plan.project_code}
                </Badge>
                <span>{plan.project_name}</span>
                <span className="text-foreground/30">·</span>
                <span className="inline-flex items-center gap-1">
                  <Factory className="h-3 w-3 opacity-60" />
                  {plan.base_name}
                </span>
                <span className="text-foreground/30">·</span>
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-3 w-3 opacity-60" />
                  {plan.supplier_name}（{plan.supplier_code}）
                </span>
                <span className="text-foreground/30">·</span>
                <span
                  className={cn(
                    "rounded px-1 py-px",
                    plan.demand_source === INV_SOURCE.master
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {plan.demand_source === INV_SOURCE.master ? "底表联动" : "档案快照"}
                </span>
              </SheetDescription>
            </div>

            {/* 四个关键数字 */}
            <div className="flex flex-wrap items-center gap-2">
              <HeaderStat label="今日 DOH" value={d0?.doh_capped ? "30+" : dohToday.toFixed(1)} cls={bucketMeta.chipCls} />
              <HeaderStat label="安全天数" value={`${plan.safe_days}${plan.safe_days_derived ? "" : "*"}`} />
              <HeaderStat label="LeadTime" value={`${plan.lead_time_days}`} />
              <HeaderStat label="ROP" value={fmt(plan.rop)} />
            </div>
          </div>
          {!plan.safe_days_derived && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              安全天数带 * ：历史需求样本不足 2 个月或均值为 0，COV 不可算，已回退兜底值 {plan.safe_days} 天
            </p>
          )}
        </SheetHeader>

        <SheetBody>
          {/* 需求异常提示（需求不可用三档，绝不显示成正常） */}
          {(bomZero || noDemandData || blankDemand) && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 border-b px-5 py-2.5 text-xs",
                bomZero
                  ? "bg-red-50 dark:bg-red-500/10"
                  : "bg-amber-50 dark:bg-amber-500/10"
              )}
            >
              <AlertTriangle
                className={cn("h-3.5 w-3.5 shrink-0", bomZero ? "text-red-600" : "text-amber-600")}
              />
              <span className={cn("font-medium", bomZero ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>
                {bomZero ? "BOM 系数为 0，需求被乘为 0" : blankDemand ? "需求为 0" : "缺需求数据"}
              </span>
              <span className="text-muted-foreground">
                {bomZero
                  ? "该「项目 × 物料」的底表 BOM 系数是 0，无法推算补货建议"
                  : blankDemand
                    ? "有需求序列但窗口日均 ≈ 0，全 0 不会触发任何预警"
                    : "底表未录入客户需求，或档案没有历史 / 未来预测"}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => onJumpToSupplyDemand(plan)}
              >
                去供需管理修正
                <ArrowUpRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}

          {/* 口径条 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-5 py-2 text-[11px]">
            <SafetyStockHint plan={plan}>
              <span>
                <span className="text-muted-foreground">SS 安全库存</span>{" "}
                <b className="font-semibold text-foreground">{fmt(plan.ss)}</b>
              </span>
              <span>
                <span className="text-muted-foreground">安全天数</span>{" "}
                <b className="font-semibold text-foreground">{plan.safe_days}</b>
                {!plan.safe_days_derived && (
                  <span className="ml-1 rounded bg-amber-500/10 px-1 py-px text-amber-600 dark:text-amber-400">兜底</span>
                )}
                <span className="ml-1 text-muted-foreground/60">(Z={plan.service_z})</span>
              </span>
              <span>
                <span className="text-muted-foreground">历史 COV</span>{" "}
                <span className={cn("inline-flex rounded px-1 py-px", covMeta.cls)}>
                  {plan.cov_label === "na" ? "数据不足" : covMeta.label}
                  {plan.cov != null ? ` (${plan.cov.toFixed(2)})` : ""}
                </span>
              </span>
            </SafetyStockHint>
            <RopTimingHint plan={plan}>
              <span>
                <span className="text-muted-foreground">再订货点 ROP</span>{" "}
                <b className="font-semibold text-foreground">{fmt(plan.rop)}</b>
              </span>
            </RopTimingHint>
            <span>
              <span className="text-muted-foreground">日均需求</span>{" "}
              <b className="font-semibold text-foreground">{plan.avg_daily}</b>
            </span>
            <span className="ml-auto text-muted-foreground/70">双击任意格直接修改数值</span>
          </div>

          {/* 建议条 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-background px-5 py-2.5 text-xs">
            {bomZero || noDemandData || blankDemand ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                需求数据不可用，无法推算补货建议
              </span>
            ) : plan.replenish_qty != null ? (
              <RopTimingHint plan={plan}>
                <span className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                    <PackagePlus className="h-2.5 w-2.5" />
                  </span>
                  <span className="text-muted-foreground">建议补货</span>
                  <b className="font-semibold tabular-nums text-red-600 dark:text-red-400">{fmt(plan.replenish_qty)}</b>
                  <span className="text-muted-foreground/70">（一个周期量 = ROP）</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">最晚下单日</span>
                  <b className="font-semibold tabular-nums text-foreground">{plan.order_by_date ?? "—"}</b>
                  {plan.days_until_order != null && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-px font-medium",
                        plan.days_until_order <= 0
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {plan.days_until_order <= 0 ? "今天必须下单" : `还剩 ${plan.days_until_order} 天`}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">预计耗尽</span>
                  <b className="font-semibold tabular-nums text-foreground">
                    {plan.stockout_date ?? "30 天内不会"}
                  </b>
                </span>
              </RopTimingHint>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-2.5 w-2.5" />
                </span>
                <span className="rounded bg-emerald-500/10 px-1.5 py-px font-medium text-emerald-600 dark:text-emerald-400">
                  30 天内无需补货
                </span>
                {plan.stockout_date && <span className="text-muted-foreground/70">预计耗尽 {plan.stockout_date}</span>}
              </span>
            )}

            {/* 产能校验 */}
            <CapacityHint plan={plan}>
              <span className="flex items-center gap-2 border-l border-border/60 pl-4">
                <span className="text-muted-foreground">产能校验</span>
                {plan.replenish_qty != null && plan.capacity_limit != null && plan.capacity_limit > 0 ? (
                  <>
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <span className={cn("block h-full", capMeta.bar)} style={{ width: `${capPct}%` }} />
                    </span>
                    <span className={cn("font-medium", capMeta.cls)}>{capMeta.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmt(plan.replenish_qty)} / {fmt(plan.capacity_limit)}
                      {plan.capacity_usage != null ? `（${(plan.capacity_usage * 100).toFixed(0)}%）` : ""}
                    </span>
                    {plan.capacity_month && <span className="text-muted-foreground/60">{plan.capacity_month}</span>}
                  </>
                ) : plan.replenish_qty != null && plan.capacity_limit != null && plan.capacity_limit <= 0 ? (
                  <>
                    <span className={cn("font-medium", capMeta.cls)}>{capMeta.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmt(plan.replenish_qty)} / 0（当月未分配额度）
                    </span>
                  </>
                ) : (
                  <span className={cn("font-medium", capMeta.cls)}>{capMeta.label}</span>
                )}
              </span>
            </CapacityHint>
          </div>

          {/* 30 天 × 5 层矩阵 */}
          <div className="overflow-auto">
            <div className="min-w-max">
              <div className="grid border-b" style={{ gridTemplateColumns: GRID }}>
                <div
                  className="sticky left-0 z-20 flex items-center border-r bg-muted/80 px-3 py-2 text-[11px] font-medium backdrop-blur"
                  style={{ width: LEFT_W }}
                >
                  未来 30 天
                </div>
                {dayHeaders.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      "border-r px-1 py-1.5 text-center text-[10px] last:border-r-0",
                      h.isToday ? "bg-primary/10 font-semibold text-primary" : "bg-muted/60"
                    )}
                  >
                    <div>{(i + 1).toString().padStart(2, "0")}</div>
                    <div className={h.isToday ? "" : "text-muted-foreground"}>
                      {h.md} 周{h.wd}
                    </div>
                  </div>
                ))}
              </div>

              {DAY_FIELDS.map((f) => (
                <div key={f.key} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: GRID }}>
                  <div
                    className="sticky left-0 z-20 flex flex-col justify-center border-r bg-background px-3 py-1"
                    style={{ width: LEFT_W }}
                  >
                    <span className="text-[11px] font-medium">{f.label}</span>
                    <span className="text-[9px] leading-tight text-muted-foreground/70">{f.note}</span>
                  </div>
                  {plan.days.map((c) => (
                    <DayCell
                      key={`${f.key}-${c.date}`}
                      cell={c}
                      field={f.key}
                      isEditing={isCellEditing(c.date, f.key)}
                      planId={plan.id}
                      onOpenEdit={onOpenEdit}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                      editRef={editRef}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"
            onClick={() => onDelete(plan)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            删除该档案
          </Button>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {pending && <span>保存中…</span>}
            <span>{plan.cov_label === "na" ? "历史样本不足 2 个月，波动不可算" : `波动：${covMeta.label}`}</span>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function HeaderStat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5 text-right">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums leading-tight", cls ?? "text-foreground")}>{value}</p>
    </div>
  );
}

function DayCell({
  cell,
  field,
  isEditing,
  planId,
  onOpenEdit,
  onCommit,
  onCancel,
  editRef,
}: {
  cell: InventoryCell;
  field: DayField;
  isEditing: boolean;
  planId: number;
  onOpenEdit: (planId: number, date: string, field: DayField, current: string) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  editRef: React.RefObject<HTMLInputElement>;
}) {
  const meta = INV_STATUS_META[cell.status as InvStatus] ?? INV_STATUS_META.ok;
  const fieldMeta = DAY_FIELDS.find((f) => f.key === field)!;

  const { text, extra } =
    field === "sys"
      ? { text: cell.sys_demand.toFixed(0), extra: null }
      : field === "md"
        ? { text: cell.manual_demand.toFixed(0), extra: null }
        : field === "mi"
          ? { text: cell.manual_in.toFixed(0), extra: null }
          : field === "ending"
            ? { text: cell.ending.toFixed(0), extra: null }
            : {
                text: cell.doh_capped ? "30+" : cell.doh.toFixed(1),
                extra: cell.doh_capped ? "∞" : null,
              };

  return (
    <div
      className={cn(
        "flex items-center gap-1 border-r px-1.5 py-1 text-[11px] tabular-nums last:border-r-0",
        field === "ending" && meta.cellCls,
        field === "doh" && cell.status !== "ok" && "bg-muted/30",
        field === "sys" && cell.sys_overridden && "bg-amber-500/10"
      )}
      title={`${fieldMeta.label} · ${cell.date}\n${fieldMeta.note}`}
      onDoubleClick={() => onOpenEdit(planId, cell.date, field, text)}
    >
      {isEditing ? (
        <CellInput
          defaultValue={text}
          editRef={editRef}
          onCommit={onCommit}
          onCancel={onCancel}
          className="w-full min-w-0"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-right font-medium">{text}</span>
          {extra && <span className="shrink-0 text-[9px] text-blue-500">{extra}</span>}
        </>
      )}
    </div>
  );
}
