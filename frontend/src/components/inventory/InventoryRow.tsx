import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Pencil, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DohSparkline } from "@/components/inventory/DohSparkline";
import {
  INV_CAPACITY_META,
  INV_SOURCE,
  INV_STATUS_META,
  dohBucketMeta,
  type InvStatus,
  type InventoryPlan,
} from "@/types/inventory";
import { cn } from "@/lib/utils";

/**
 * L1 单行：一行一个推算单元（项目 × 基地 × 物料 × 供应商）。
 *
 * 与旧版的关键差异：
 * 1. 不再有 30 列矩阵 → 冻结列从 600px 收到 440px，横向滚动消失；
 * 2. DOH 是视觉最重的一列（这是本次改版的「第一视线」）；
 * 3. 新增 30 天 DOH sparkline（看趋势，不只看当下）；
 * 4. LT / 库存 保留双击，另加 hover 铅笔按钮（双击不可发现，用户找不到）；
 * 5. 点击整行 → 打开 L2 抽屉（30 天矩阵已搬过去）。
 */

interface Props {
  plan: InventoryPlan;
  bucket: string;
  density: "comfortable" | "compact";
  pending: boolean;
  onOpen: () => void;
  onEditPlan: (field: "lt" | "onhand", current: string) => void;
  editing: { field: "lt" | "onhand"; initial: string } | null;
  onCommitEdit: (v: string) => void;
  onCancelEdit: () => void;
  editRef: React.RefObject<HTMLInputElement>;
}

export function InventoryRow({
  plan,
  bucket,
  density,
  pending,
  onOpen,
  onEditPlan,
  editing,
  onCommitEdit,
  onCancelEdit,
  editRef,
}: Props) {
  const compact = density === "compact";
  const bucketMeta = dohBucketMeta(bucket);

  // 枚举兜底：后端新增取值时不得 undefined 白屏
  const statusMeta = INV_STATUS_META[plan.days[0]?.status as InvStatus] ?? INV_STATUS_META.ok;
  const capMeta = INV_CAPACITY_META[plan.capacity_status] ?? INV_CAPACITY_META.na;

  const noDemandData = plan.hist.length === 0 && plan.fcast.length === 0;
  const bomZero = !!plan.bom_zero;
  const blankDemand = !!plan.demand_blank && !bomZero && !noDemandData;
  const unknown = bucket === "unknown";

  const dohToday = useMemo(() => {
    const d0 = plan.days[0];
    if (!d0) return 0;
    return d0.doh_capped ? 30 : d0.doh;
  }, [plan.days]);

  const capPct =
    plan.capacity_usage != null ? Math.min(Math.max(plan.capacity_usage, 0), 1) * 100 : 0;

  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group grid cursor-pointer items-center gap-x-2 border-b px-3 text-xs transition-colors last:border-b-0 hover:bg-accent/40",
        compact ? "py-1" : "py-2",
        pending && "opacity-60"
      )}
      style={{
        gridTemplateColumns:
          "minmax(200px,1.5fr) 84px 84px 76px 88px 100px 92px 96px 92px 76px 32px",
      }}
    >
      {/* 物料 + 项目/基地 + 供应商 */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground" title={plan.material_name}>
            {plan.material_name}
          </span>
          <span className="shrink-0 rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
            {plan.pn}
          </span>
          {bomZero ? (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-px text-[10px] font-medium text-red-700 dark:text-red-400"
              title="底表 BOM 系数为 0 —— 客户需求被乘成 0。到「供需管理」把 BOM 系数改成实际用量"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              BOM 为 0
            </span>
          ) : noDemandData || blankDemand ? (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
              title={
                blankDemand
                  ? "有需求序列但窗口日均 ≈ 0（客户需求漏录或为 0），不会触发任何预警"
                  : plan.demand_source === INV_SOURCE.master
                    ? "底表未录入该项目的客户需求，或 BOM 系数缺失"
                    : "档案内没有历史需求与未来预测"
              }
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              {blankDemand ? "需求为 0" : "缺需求数据"}
            </span>
          ) : (
            <span
              className={cn(
                "shrink-0 rounded px-1 py-px text-[10px]",
                plan.demand_source === INV_SOURCE.master
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
              title={
                plan.demand_source === INV_SOURCE.master
                  ? `需求来自底表联动：客户需求 × BOM 系数${plan.bom_factor != null ? `（BOM ${plan.bom_factor}）` : ""}`
                  : "需求来自档案自带的历史 / 预测快照"
              }
            >
              {plan.demand_source === INV_SOURCE.master ? "底表联动" : "快照"}
            </span>
          )}
        </div>
        <div className="mt-px flex items-center gap-1 truncate text-[10px] text-muted-foreground">
          <span className="truncate">{plan.project_name}</span>
          <span className="text-foreground/40">·</span>
          <span className="truncate">{plan.base_name}</span>
          <span className="text-foreground/40">·</span>
          <Truck className="h-2.5 w-2.5 shrink-0 opacity-50" />
          <span className="truncate" title={`${plan.supplier_name}（${plan.supplier_code}）`}>
            {plan.supplier_name}
          </span>
        </div>
      </div>

      {/* LT（可编辑） */}
      <EditableCell
        label="LT"
        value={String(plan.lead_time_days)}
        display={String(plan.lead_time_days)}
        editing={editing?.field === "lt"}
        hovered={hovered}
        onEdit={(field, current) => onEditPlan(field, current)}
        onCommit={onCommitEdit}
        onCancel={onCancelEdit}
        editRef={editRef}
        title={`LeadTime（天）· 双击或点铅笔修改\n当前 ${plan.lead_time_days} 天`}
      />

      {/* 库存（可编辑） */}
      <EditableCell
        label="库存"
        value={String(plan.on_hand)}
        display={String(Math.round(plan.on_hand))}
        editing={editing?.field === "onhand"}
        hovered={hovered}
        onEdit={(field, current) => onEditPlan(field, current)}
        onCommit={onCommitEdit}
        onCancel={onCancelEdit}
        editRef={editRef}
        title={`初始现有库存 · 双击或点铅笔修改\n当前 ${plan.on_hand}`}
      />

      {/* DOH —— 本表核心列 */}
      <div className="text-right" title={`今日动态 DOH：${dohToday.toFixed(1)} 天\n安全天数 ${plan.safe_days}｜LeadTime ${plan.lead_time_days}`}>
        <span className={cn("inline-block rounded px-1.5 py-0.5 text-sm font-semibold tabular-nums", bucketMeta.chipCls)}>
          {plan.days[0]?.doh_capped ? "30+" : dohToday.toFixed(1)}
        </span>
      </div>

      {/* 状态 */}
      <div className="text-right">
        <span
          className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", statusMeta.cellCls)}
          title={`期末 ${Math.round(plan.days[0]?.ending ?? 0)}（SS ${Math.round(plan.ss)}）`}
        >
          {statusMeta.label}
        </span>
      </div>

      {/* 建议补货 */}
      <div className="text-right tabular-nums" title="建议补货量（一个周期量 = ROP）">
        {unknown || plan.replenish_qty == null ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          <span className="font-medium text-foreground">{Math.round(plan.replenish_qty)}</span>
        )}
      </div>

      {/* 最晚下单 */}
      <div className="text-right" title={plan.order_by_date ? `最晚下单日 ${plan.order_by_date}` : "30 天内无需下单"}>
        {plan.order_by_date == null ? (
          <span className="text-[10px] text-muted-foreground/60">无需下单</span>
        ) : (
          <span className="flex flex-col items-end leading-tight">
            <span className="tabular-nums text-foreground">{plan.order_by_date.slice(5)}</span>
            <span
              className={cn(
                "text-[10px]",
                (plan.days_until_order ?? 99) <= 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"
              )}
            >
              {(plan.days_until_order ?? 99) <= 0 ? "今天必须下单" : `还剩 ${plan.days_until_order} 天`}
            </span>
          </span>
        )}
      </div>

      {/* 预计耗尽 */}
      <div className="text-right" title={plan.stockout_date ? `预计耗尽日 ${plan.stockout_date}` : "30 天内不会耗尽"}>
        {plan.stockout_date ? (
          <span className="tabular-nums text-foreground">{plan.stockout_date.slice(5)}</span>
        ) : (
          <span className="text-[10px] text-muted-foreground/60">30 天内不会</span>
        )}
      </div>

      {/* 30 天 DOH 走势 */}
      <div className="flex justify-end" title={unknown ? "需求不可用，无走势" : "未来 30 天 DOH 走势（虚线 = 安全天数）"}>
        {unknown ? (
          <span className="text-[10px] text-muted-foreground/40">—</span>
        ) : (
          <DohSparkline plan={plan} strokeCls={bucketMeta.textCls} />
        )}
      </div>

      {/* 产能校验 */}
      <div className="text-right" title={`${capMeta.label}：${capMeta.hint}`}>
        {plan.capacity_limit == null ? (
          <span className={cn("text-[10px]", capMeta.cls)}>未录额度</span>
        ) : (
          <span className="flex flex-col items-end gap-0.5 leading-tight">
            <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
              <span className={cn("block h-full", capMeta.bar)} style={{ width: `${capPct}%` }} />
            </span>
            <span className={cn("text-[10px]", capMeta.cls)}>{capMeta.label}</span>
          </span>
        )}
      </div>

      {/* 打开抽屉 */}
      <div className="flex justify-end text-muted-foreground/40 group-hover:text-foreground">
        <ChevronRight className="h-4 w-4" />
      </div>
    </div>
  );
}

/**
 * 可编辑单元格：双击进入编辑（老习惯），hover 时出现铅笔按钮（可发现）。
 * 点击铅笔按钮会 stopPropagation，避免顺带打开抽屉。
 */
function EditableCell({
  label,
  value,
  display,
  editing,
  hovered,
  onEdit,
  onCommit,
  onCancel,
  editRef,
  title,
}: {
  label: string;
  value: string;
  display: string;
  editing: boolean;
  hovered: boolean;
  onEdit: (field: "lt" | "onhand", current: string) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  editRef: React.RefObject<HTMLInputElement>;
  title: string;
}) {
  const field = label === "LT" ? "lt" : "onhand";
  if (editing) {
    return (
      <div className="flex justify-end px-1" onClick={(e) => e.stopPropagation()}>
        <CellInput defaultValue={value} editRef={editRef} onCommit={onCommit} onCancel={onCancel} />
      </div>
    );
  }
  return (
    <div
      className="flex items-center justify-end gap-1 px-1 tabular-nums"
      title={title}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit(field, value);
      }}
    >
      <span className="text-foreground">{display}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(field, value);
        }}
        className={cn(
          "shrink-0 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
          hovered ? "opacity-100" : "opacity-0"
        )}
        title={`修改${label === "LT" ? " LeadTime" : "现有库存"}`}
        aria-label={`修改${label === "LT" ? " LeadTime" : "现有库存"}`}
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

/** 行内数字输入（Enter 提交 / Esc 取消 / 失焦提交） */
export function CellInput({
  defaultValue,
  editRef,
  onCommit,
  onCancel,
  className,
}: {
  defaultValue: string;
  editRef: React.RefObject<HTMLInputElement>;
  onCommit: (v: string) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(defaultValue);
  return (
    <input
      ref={editRef}
      autoFocus
      className={cn(
        "h-5 w-16 rounded border border-primary bg-background px-1 text-right text-[10px] tabular-nums outline-none focus:ring-1 focus:ring-primary",
        className
      )}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(defaultValue);
          onCancel?.();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** 列表表头（与行 gridTemplateColumns 必须一致） */
export function InventoryListHeader({ sort, onSort }: { sort: string; onSort: (key: string) => void }) {
  const Th = ({
    label,
    sortKey,
    align = "right",
    title,
  }: {
    label: string;
    sortKey?: string;
    align?: "left" | "right";
    title?: string;
  }) => (
    <button
      type="button"
      disabled={!sortKey}
      onClick={() => sortKey && onSort(sortKey)}
      title={title ?? (sortKey ? `按${label}排序` : undefined)}
      className={cn(
        "flex items-center gap-0.5 text-[11px] font-medium",
        align === "right" ? "justify-end" : "justify-start",
        sortKey ? "hover:text-foreground" : "cursor-default",
        sort === sortKey ? "text-primary" : "text-muted-foreground"
      )}
    >
      {label}
      {sort === sortKey && <span className="text-[9px]">▼</span>}
    </button>
  );

  return (
    <div
      className="grid items-center gap-x-2 border-b bg-muted/60 px-3 py-2 text-[11px]"
      style={{ gridTemplateColumns: "minmax(200px,1.5fr) 84px 84px 76px 88px 100px 92px 96px 92px 76px 32px" }}
    >
      <Th label="物料 / 项目 · 基地 · 供应商" sortKey="pn" align="left" />
      <Th label="LT" sortKey="lt" />
      <Th label="库存" />
      <Th label="DOH" sortKey="doh" title="按今日 DOH 升序（最危险在最上）" />
      <Th label="状态" />
      <Th label="建议补货" sortKey="replenish" />
      <Th label="最晚下单" sortKey="order" />
      <Th label="预计耗尽" />
      <Th label="30 天走势" />
      <Th label="产能" />
      <span />
    </div>
  );
}
