import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock4,
  FileUp,
  RefreshCw,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { InventoryImportDialog } from "@/components/inventory/InventoryImportDialog";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/ui/multi-select-filter";
import {
  useInventoryPlans,
  useUpdateInventoryDays,
  useUpdateInventoryPlan,
} from "@/hooks/use-inventory";
import { getApiErrorMessage } from "@/lib/utils";
import {
  INV_COV_META,
  INV_STATUS,
  INV_STATUS_META,
  type InventoryCell,
  type InventoryDayUpdateInput,
  type InventoryPlan,
} from "@/types/inventory";

/* ------------------------------------------------------------------ */
/* 常量与工具                                                          */
/* ------------------------------------------------------------------ */

const LEFT_W = 560; // 冻结左列宽（px）
const DAY_W = 76; // 单日列宽（px）
const GRID = `${LEFT_W}px repeat(30, ${DAY_W}px)`;

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function fmt(n: number): string {
  return `${Math.round(n)}`;
}
function fmtDoh(cell: InventoryCell): string {
  if (cell.doh_capped) return "30+";
  return cell.doh.toFixed(1);
}

/* ------------------------------------------------------------------ */
/* 风险时间漏斗：顶部四卡 = 推算单元未来 30 天「首次跌破安全线」分桶     */
/* 口径：DOH 为动态覆盖天数（与规则页 SOP 一致）；亮灯 = 该日状态为        */
/* 红（期末<SS 或 DOH<安全天数）或深红（已断货）；取全窗口首个亮灯日落桶。 */
/* ------------------------------------------------------------------ */

/** 首亮灯日分桶：0=今日 1=D2–D7 2=D8–D14 3=D15–D30；-1 = 窗口内无风险 */
type RiskBucket = -1 | 0 | 1 | 2 | 3;
const NO_RISK: RiskBucket = -1;

/** 找一行 30 天矩阵里第一次红/深红的位置 → 归属分桶 */
function firstRiskBucket(p: InventoryPlan): RiskBucket {
  for (let i = 0; i < p.days.length; i++) {
    const s = p.days[i].status;
    if (s === INV_STATUS.stockout || s === INV_STATUS.red) {
      if (i === 0) return 0;
      if (i < 7) return 1;
      if (i < 14) return 2;
      return 3;
    }
  }
  return NO_RISK;
}

interface RiskCardMeta {
  bucket: Exclude<RiskBucket, -1>;
  label: string;
  rangeLabel: string;
  hint: string;
  tone: string;
  iconCls: string;
  Icon: typeof AlertOctagon;
}

/** 顶部四卡配置：越靠前越紧急，用色由深红 → 橙 → 琥珀递减 */
const RISK_CARDS: RiskCardMeta[] = [
  {
    bucket: 0,
    label: "今日亮灯",
    rangeLabel: "今日",
    hint: "今日 DOH<安全天数（默认 5）或期末<SS，含已断货",
    tone: "#dc2626",
    iconCls: "bg-red-500/10 text-red-600",
    Icon: AlertOctagon,
  },
  {
    bucket: 1,
    label: "7 天内将亮灯",
    rangeLabel: "D2–D7",
    hint: "预计本周内首次跌破安全线，需尽快补货 / 调拨",
    tone: "#ea580c",
    iconCls: "bg-orange-500/10 text-orange-600",
    Icon: Clock4,
  },
  {
    bucket: 2,
    label: "8–14 天将亮灯",
    rangeLabel: "D8–D14",
    hint: "预计下两周内跌破安全线，可排进补货计划",
    tone: "#f59e0b",
    iconCls: "bg-amber-500/10 text-amber-600",
    Icon: CalendarRange,
  },
  {
    bucket: 3,
    label: "15–30 天将亮灯",
    rangeLabel: "D15–D30",
    hint: "窗口尾部风险，先观察需求变化",
    tone: "#eab308",
    iconCls: "bg-amber-400/10 text-amber-600",
    Icon: Waves,
  },
];

/** 字段说明（行内 5 层） */
type DayField = "sys" | "md" | "mi" | "ending" | "doh";
const DAY_FIELDS: { key: DayField; label: string; note: string }[] = [
  { key: "sys", label: "系统预测需求", note: "双击修改 = 覆盖该日摊日均；清空恢复系统值" },
  { key: "md", label: "手工修正需求", note: "双击修改，可为负；置 0 清除" },
  { key: "mi", label: "手工修正入库", note: "双击修改，可为负；置 0 清除" },
  { key: "ending", label: "期末库存", note: "双击直接改 = 覆盖自动算（盘点）；清空恢复" },
  { key: "doh", label: "动态 DOH", note: "双击输入目标天数 = 反推期末库存" },
];

interface CellEdit {
  planId: number;
  date: string | null; // null = 左冻结列 LT / OnHand
  field: DayField | "lt" | "onhand";
  initial: string;
}

/* ------------------------------------------------------------------ */
/* 页面主体                                                            */
/* ------------------------------------------------------------------ */

export default function InventoryPage() {
  // 全局参数（前置声明，随 safe/excess 变化通知后端重算整链状态）
  const [safe, setSafe] = useState(5); // 目标安全天数：默认 5（顶部漏斗的「今日亮灯」阈值 DOH<5）
  const [excess, setExcess] = useState(30);
  const { data: plans, isLoading, refetch, isFetching } = useInventoryPlans({ safe, excess });
  const updateDays = useUpdateInventoryDays();
  const updatePlan = useUpdateInventoryPlan();

  const all = useMemo(() => plans ?? [], [plans]);

  // 级联筛选（空 = 不限）
  const [projSel, setProjSel] = useState<Set<string>>(new Set());
  const [pnSel, setPnSel] = useState<Set<string>>(new Set());
  const [baseSel, setBaseSel] = useState<Set<string>>(new Set());
  // 风险时间漏斗：当前选中哪张卡（null = 全部）
  const [riskSel, setRiskSel] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<CellEdit | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // ---- 级联选项（始终基于全量数据，过滤选择不会锁死候选） ----
  const projectOptions = useMemo<MultiSelectOption[]>(() => {
    const seen = new Map<number, InventoryPlan>();
    for (const p of all) if (!seen.has(p.project_id)) seen.set(p.project_id, p);
    return [...seen.values()].map((p) => ({
      value: String(p.project_id),
      label: p.project_code,
      sublabel: p.project_name,
      color: "#6366f1",
    }));
  }, [all]);

  const pnOptions = useMemo<MultiSelectOption[]>(() => {
    const allowedProj = projSel.size === 0 ? null : projSel;
    const seen = new Map<string, InventoryPlan>();
    for (const p of all) {
      if (allowedProj && !allowedProj.has(String(p.project_id))) continue;
      if (!seen.has(p.pn)) seen.set(p.pn, p);
    }
    return [...seen.values()].map((p) => ({
      value: p.pn,
      label: p.pn,
      sublabel: p.material_name,
      color: "#0ea5e9",
    }));
  }, [all, projSel]);

  const baseOptions = useMemo<MultiSelectOption[]>(() => {
    const allowedProj = projSel.size === 0 ? null : projSel;
    const allowedPn = pnSel.size === 0 ? null : pnSel;
    const seen = new Set<string>();
    for (const p of all) {
      if (allowedProj && !allowedProj.has(String(p.project_id))) continue;
      if (allowedPn && !allowedPn.has(p.pn)) continue;
      seen.add(p.base);
    }
    return [...seen].map((b) => ({ value: b, label: b, color: "#f59e0b" }));
  }, [all, projSel, pnSel]);

  // ---- 行过滤（只做项目 / 物料 / 基地三维筛选，作为漏斗与矩阵的共同底集） ----
  const baseRows = useMemo(() => {
    const projOk = projSel.size === 0 ? null : projSel;
    const pnOk = pnSel.size === 0 ? null : pnSel;
    const baseOk = baseSel.size === 0 ? null : baseSel;
    return all.filter((p) => {
      if (projOk && !projOk.has(String(p.project_id))) return false;
      if (pnOk && !pnOk.has(p.pn)) return false;
      if (baseOk && !baseOk.has(p.base)) return false;
      return true;
    });
  }, [all, projSel, pnSel, baseSel]);

  // ---- 风险时间漏斗：顶部四卡统计（按表格行数 = 项目×基地×物料） ----
  const risk = useMemo(() => {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const firstMap = new Map<number, RiskBucket>();
    let irreversibleToday = 0; // 今日亮灯里「现在下单也来不及」（DOH < LeadTime）
    for (const p of baseRows) {
      const b = firstRiskBucket(p);
      firstMap.set(p.id, b);
      if (b !== NO_RISK) counts[b] += 1;
      if (b === 0) {
        const d0 = p.days[0];
        if (d0 && !d0.doh_capped && d0.doh < p.lead_time_days) irreversibleToday += 1;
      }
    }
    return { counts, firstMap, irreversibleToday, today: all[0]?.days[0]?.date ?? "" };
  }, [baseRows, all]);

  // ---- 矩阵展示行：选中某张漏斗卡 → 只留首亮灯日落在该时段的推算单元 ----
  const rows = useMemo(() => {
    if (riskSel === null) return baseRows;
    return baseRows.filter((p) => risk.firstMap.get(p.id) === riskSel);
  }, [baseRows, riskSel, risk.firstMap]);

  /* 双击打开行内编辑 */
  const [cancelEdit, setCancelEdit] = useState(false);
  const openEdit = (planId: number, date: string | null, field: CellEdit["field"], current: string) => {
    setCancelEdit(false);
    setEditing({ planId, date, field, initial: current });
  };
  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const commitEdit = (value: string) => {
    if (!editing) return;
    const { planId, date, field, initial } = editing;
    // Esc = 取消本次编辑（不提交，不误写覆盖标记）
    if (cancelEdit) {
      setCancelEdit(false);
      setEditing(null);
      return;
    }
    setEditing(null);
    const v = value.trim();
    const days = (cells: InventoryDayUpdateInput[]) =>
      updateDays.mutate({ id: planId, cells }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
    // 空 = 恢复/清除
    if (v === "") {
      if (field === "sys") days([{ date: date!, demand_override: null }]);
      else if (field === "ending") days([{ date: date!, ending_override: null }]);
      else if (field === "doh") days([{ date: date!, ending_override: null }]); // DOH 的覆盖由期末承载
      else if (field === "md") days([{ date: date!, manual_demand: 0 }]);
      else if (field === "mi") days([{ date: date!, manual_in: 0 }]);
      else if (field === "lt")
        updatePlan.mutate({ id: planId, data: { lead_time_days: Number(initial) || 7 } }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
      else if (field === "onhand")
        updatePlan.mutate({ id: planId, data: { on_hand: Number(initial) || 0 } }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      toast.error("请输入有效数字");
      return;
    }
    if (field === "lt") {
      if (n <= 0) return toast.error("LeadTime 必须 > 0");
      updatePlan.mutate({ id: planId, data: { lead_time_days: n } }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
    } else if (field === "onhand") {
      updatePlan.mutate({ id: planId, data: { on_hand: n } }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
    } else {
      const cell = { date: date! } as InventoryDayUpdateInput;
      if (field === "sys") cell.demand_override = n;
      else if (field === "md") cell.manual_demand = n;
      else if (field === "mi") cell.manual_in = n;
      else if (field === "ending") cell.ending_override = n;
      else cell.doh_target = n;
      days([cell]);
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dayHeaders = useMemo(() => {
    if (all.length === 0) return [];
    return all[0].days.map((c) => {
      const d = new Date(c.date + "T00:00:00");
      const md = `${d.getMonth() + 1}/${d.getDate()}`;
      const wd = WEEK[d.getDay()];
      const isToday = c.date === new Date().toISOString().slice(0, 10);
      return { md, wd, isToday };
    });
  }, [all]);

  /* ---------- 渲染 ---------- */
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1500px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-8 sm:px-8">
          <div className="mx-auto max-w-[1400px]">
            {/* 标题栏 */}
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">库存信号塔</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  未来 30 天日度滚动推算 · 动态 DOH（默认安全线 {safe} 天）· 顶部四卡 = 风险时间漏斗，预估未来风险何时发生（推算基准日{" "}
                  {risk.today || "—"}，随今天滚动）
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                  刷新
                </Button>
                <Button size="sm" onClick={() => setImportOpen(true)}>
                  <FileUp className="mr-1.5 h-4 w-4" />
                  Excel 导入
                </Button>
              </div>
            </div>

            {/* KPI 风险时间漏斗：点击卡片 = 只看首亮灯日落在该时段的推算单元 */}
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {RISK_CARDS.map((c) => {
                const count = risk.counts[c.bucket];
                const active = riskSel === c.bucket;
                const hint =
                  c.bucket === 0
                    ? `今日 DOH<${safe}（安全天数）或期末<SS${
                        risk.irreversibleToday > 0 ? `，其中 ${risk.irreversibleToday} 行下单也来不及` : ""
                      }`
                    : `${c.rangeLabel} 首次跌破安全线${c.bucket === 1 ? "（落在采购提前期内）" : ""}`;
                return (
                  <KpiCard
                    key={c.bucket}
                    label={c.label}
                    value={count}
                    hint={hint}
                    tone={c.tone}
                    iconCls={c.iconCls}
                    Icon={c.Icon}
                    active={active}
                    onClick={() => setRiskSel(active ? null : c.bucket)}
                  />
                );
              })}
            </div>

            {/* 控制栏：级联筛选 + 参数 */}
            <Card className="mb-4">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <MultiFilterBlock label="项目" options={projectOptions} selected={projSel} onChange={setProjSel} />
                  <MultiFilterBlock label="物料 PN" options={pnOptions} selected={pnSel} onChange={setPnSel} />
                  <MultiFilterBlock label="基地" options={baseOptions} selected={baseSel} onChange={setBaseSel} />
                  <div className="flex items-center gap-4 text-xs">
                    <ParamInput label="安全天数" value={safe} onChange={setSafe} />
                    <ParamInput label="过剩天数" value={excess} onChange={setExcess} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  {/* 图例 + 漏斗口径说明 */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <Legend cls="bg-red-700" label="≤0 已断货" />
                    <Legend cls="bg-red-400" label="偏低(期末<SS / DOH<安全)" />
                    <Legend cls="bg-amber-400" label="贴近安全线" />
                    <Legend cls="bg-blue-500" label="过剩(DOH>过剩天数)" />
                    <span className="text-muted-foreground/70">漏斗按每行首次跌破安全线的日期分桶</span>
                  </div>
                  {/* 漏斗过滤状态 / 恢复 */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {riskSel !== null ? (
                      <>
                        <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          {RISK_CARDS.find((c) => c.bucket === riskSel)?.label} · {rows.length} / {baseRows.length} 行
                        </span>
                        <button
                          type="button"
                          onClick={() => setRiskSel(null)}
                          className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                        >
                          恢复全部
                        </button>
                      </>
                    ) : (
                      <span>共 {rows.length} 行</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 主矩阵 */}
            {isLoading ? (
              <Skeleton className="h-[420px] w-full rounded-xl" />
            ) : all.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <EmptyState
                    icon={<FileUp className="h-7 w-7" />}
                    title="暂无库存推算单元"
                    description="先通过 Excel 导入「项目 × 基地 × 物料」推算单元（历史需求 / 未来预测 / 初始库存），系统自动开始 30 天日度推算"
                    action={
                      <Button onClick={() => setImportOpen(true)}>
                        <FileUp className="mr-1.5 h-4 w-4" />
                        导入库存数据
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            ) : rows.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <EmptyState
                    icon={<CircleDot className="h-7 w-7" />}
                    title={riskSel !== null ? "该漏斗时段没有风险行" : "当前筛选下没有匹配的推算单元"}
                    description={
                      riskSel !== null
                        ? "没有推算单元的首次跌破安全线落在该时段，可恢复全部查看整体情况"
                        : "放宽项目 / 物料 / 基地筛选条件后再试"
                    }
                    action={
                      riskSel !== null ? (
                        <Button variant="outline" size="sm" onClick={() => setRiskSel(null)}>
                          恢复全部
                        </Button>
                      ) : undefined
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
                    <div className="min-w-max">
                      {/* 表头（日期行，横向不滚动部分用 sticky） */}
                      <div className="grid border-b text-[10px]" style={{ gridTemplateColumns: GRID }}>
                        <div className="sticky left-0 z-30 flex items-center gap-2 border-r bg-muted/80 px-3 text-xs font-medium text-foreground backdrop-blur" style={{ width: LEFT_W }}>
                          项目 / 基地 / 物料（双击 LeadTime、初始库存可改）
                        </div>
                        {dayHeaders.map((h, i) => (
                          <div
                            key={i}
                            className={`border-r px-1 py-1.5 text-center last:border-r-0 ${h.isToday ? "bg-primary/10 font-semibold text-primary" : "bg-muted/60"}`}
                          >
                            <div>{(i + 1).toString().padStart(2, "0")}</div>
                            <div className={h.isToday ? "" : "text-muted-foreground"}>
                              {h.md} 周{h.wd}
                            </div>
                          </div>
                        ))}
                      </div>

                      {rows.map((plan) => (
                        <PlanBlock
                          key={plan.id}
                          plan={plan}
                          safe={safe}
                          expanded={expanded.has(plan.id)}
                          onToggle={() => toggleExpand(plan.id)}
                          editing={editing}
                          onOpenEdit={openEdit}
                          onCommitEdit={commitEdit}
                          onCancelEdit={() => setCancelEdit(true)}
                          editRef={editRef}
                          pending={updateDays.isPending || updatePlan.isPending}
                        />
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
      <InventoryImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 小组件                                                              */
/* ------------------------------------------------------------------ */

function MultiFilterBlock({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <MultiSelectFilter label={label} options={options} selected={selected} onChange={onChange} chipThreshold={4} />
    </div>
  );
}

function ParamInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="flex items-center gap-1.5">
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <Input
        className="h-7 w-16 px-2 text-xs tabular-nums"
        type="number"
        value={draft}
        min={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n > 0) onChange(Math.round(n));
          else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="text-muted-foreground/60">天</span>
    </label>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  iconCls,
  Icon,
  tone,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  iconCls: string;
  Icon: typeof AlertOctagon;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`p-4 transition-colors ${onClick ? "cursor-pointer hover:bg-accent/40" : ""} ${
        active ? "ring-2 ring-primary ring-offset-1" : ""
      }`}
      style={tone ? { borderTop: `3px solid ${tone}` } : undefined}
      onClick={onClick}
      title={onClick ? "点击过滤出该时段首次亮灯的行；再点一次恢复全部" : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-3xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconCls}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 单推算单元行（summary + 展开矩阵）                                    */
/* ------------------------------------------------------------------ */

function PlanBlock({
  plan,
  safe,
  expanded,
  onToggle,
  editing,
  onOpenEdit,
  onCommitEdit,
  onCancelEdit,
  editRef,
  pending,
}: {
  plan: InventoryPlan;
  safe: number;
  expanded: boolean;
  onToggle: () => void;
  editing: CellEdit | null;
  onOpenEdit: (planId: number, date: string | null, field: CellEdit["field"], current: string) => void;
  onCommitEdit: (v: string) => void;
  onCancelEdit: () => void;
  editRef: React.RefObject<HTMLInputElement>;
  pending: boolean;
}) {
  const covMeta = INV_COV_META[plan.cov_label];
  const isEditingCell = (date: string, field: CellEdit["field"]) =>
    editing?.planId === plan.id && editing?.date === date && editing?.field === field;
  const isEditingPlan = (field: "lt" | "onhand") =>
    editing?.planId === plan.id && editing?.date === null && editing?.field === field;

  // 行级：最早告警日（用于行摘要）
  const criticalDay = useMemo(() => {
    const idx = plan.days.findIndex((c) => c.status !== "ok");
    return idx === -1 ? null : plan.days[idx];
  }, [plan.days]);

  return (
    <div className={expanded ? "bg-muted/10" : ""}>
      {/* summary 行 */}
      <div
        className={`grid items-stretch border-b text-xs transition-colors ${
          pending ? "opacity-60" : ""
        }`}
        style={{ gridTemplateColumns: GRID }}
      >
        {/* 冻结左列 */}
        <div
          className="sticky left-0 z-20 flex items-center gap-2 border-r bg-background px-3 py-2"
          style={{ width: LEFT_W }}
        >
          <button
            type="button"
            onClick={onToggle}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            title={expanded ? "收起矩阵" : "展开 30 天矩阵"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-foreground">{plan.material_name}</span>
              <span className="rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">{plan.pn}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">
                {plan.project_code}
              </Badge>
              <span>{plan.project_name}</span>
              <span className="text-foreground/50">·</span>
              <span>{plan.base}</span>
            </div>
          </div>
          <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right 2xl:flex">
            <EditableLabel
              label="LT"
              value={plan.lead_time_days}
              editing={isEditingPlan("lt")}
              onDouble={() => onOpenEdit(plan.id, null, "lt", String(plan.lead_time_days))}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              editRef={editRef}
            />
            <EditableLabel
              label="库存"
              value={plan.on_hand}
              editing={isEditingPlan("onhand")}
              onDouble={() => onOpenEdit(plan.id, null, "onhand", String(plan.on_hand))}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              editRef={editRef}
            />
          </div>
        </div>

        {/* 30 天 summary 格 */}
        {plan.days.map((c, i) => {
          const meta = INV_STATUS_META[c.status];
          const isEditing = isEditingCell(c.date, "ending");
          return (
            <div
              key={c.date}
              title={`${c.date}\n期末 ${fmt(c.ending)}（SS ${fmt(plan.ss)}）\nDOH ${fmtDoh(c)}${c.doh_capped ? "（窗口内未耗尽）" : ""}\n双击修改期末库存`}
              className={`relative flex cursor-cell flex-col items-center justify-center border-r px-0.5 py-1 last:border-r-0 ${meta.cellCls}`}
              onDoubleClick={() => onOpenEdit(plan.id, c.date, "ending", String(c.ending))}
            >
              {isEditing ? (
                <CellInput defaultValue={String(c.ending)} editRef={editRef} onCommit={onCommitEdit} onCancel={onCancelEdit} />
              ) : (
                <>
                  <span className="text-[11px] font-semibold tabular-nums leading-tight">{fmt(c.ending)}</span>
                  <span className={`text-[9px] tabular-nums leading-tight ${c.status === "ok" ? "text-muted-foreground/70" : "opacity-90"}`}>
                    DOH {fmtDoh(c)}
                  </span>
                </>
              )}
              {/* 行首提示条（首个非正常日标记） */}
              {criticalDay?.date === c.date && c.status !== "ok" && (
                <span className="absolute inset-x-0 -top-0.5 h-0.5 bg-black/30" />
              )}
            </div>
          );
        })}
      </div>

      {/* 统计条（SS / COV / avg，防止信息丢失） */}
      <div className="flex items-center gap-3 border-b bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
        <span>
          <span className="text-foreground/60">SS 安全库存</span>{" "}
          <b className="font-semibold text-foreground">{fmt(plan.ss)}</b>
        </span>
        <span>
          日均需求 <b className="font-semibold text-foreground">{plan.avg_daily}</b>
        </span>
        <span>
          <span className="text-foreground/60">历史 COV</span>{" "}
          <span className={`inline-flex rounded px-1 py-px ${covMeta.cls}`}>
            {plan.cov_label === "na" ? "数据不足" : covMeta.label}
            {plan.cov != null ? ` (${plan.cov.toFixed(2)})` : ""}
          </span>
        </span>
        <span className="ml-auto">目标安全天数 {safe} 天 · 双击任意格直接修改数值</span>
      </div>

      {/* 展开：30 天 × 5 行矩阵 */}
      {expanded && (
        <div className="grid border-b" style={{ gridTemplateColumns: GRID }}>
          <div className="sticky left-0 z-20 border-r bg-muted/20 p-2" style={{ width: LEFT_W }}>
            <p className="text-[10px] font-medium text-muted-foreground">
              每日 5 行（双击数字即可修改：预测 / 手需 / 入库 / 期末，DOH 格反推目标期末库存）
            </p>
          </div>
          {plan.days.map((c, i) => (
            <div key={c.date} className="border-r last:border-r-0">
              {DAY_FIELDS.map((f) => (
                <DayRowCell key={f.key} cell={c} field={f.key} isEditing={isEditingCell(c.date, f.key)} onOpenEdit={onOpenEdit} onCommit={onCommitEdit} onCancel={onCancelEdit} planId={plan.id} date={c.date} editRef={editRef} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DayRowCell({
  cell,
  field,
  isEditing,
  planId,
  date,
  onOpenEdit,
  onCommit,
  onCancel,
  editRef,
}: {
  cell: InventoryCell;
  field: DayField;
  isEditing: boolean;
  planId: number;
  date: string;
  onOpenEdit: (planId: number, date: string | null, field: CellEdit["field"], current: string) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  editRef: React.RefObject<HTMLInputElement>;
}) {
  const text: { label: string; value: string; danger?: boolean } =
    field === "sys"
      ? { label: "预测", value: cell.sys_demand.toFixed(0) }
      : field === "md"
      ? { label: "手需", value: cell.manual_demand.toFixed(0) }
      : field === "mi"
      ? { label: "入库", value: cell.manual_in.toFixed(0) }
      : field === "ending"
      ? { label: "期末", value: cell.ending.toFixed(0) }
      : { label: "DOH", value: cell.doh_capped ? "30+" : cell.doh.toFixed(1) };

  const meta = INV_STATUS_META[cell.status];
  const fieldKey = DAY_FIELDS.find((f) => f.key === field)!;
  return (
    <div
      className={`group flex items-center gap-1 border-b px-1 py-px text-[10px] tabular-nums last:border-b-0 ${
        field === "ending" ? meta.cellCls : field === "doh" ? (cell.status === "ok" ? "" : "bg-muted/30") : ""
      }`}
      title={`${fieldKey.label} · ${cell.date}\n${fieldKey.note}`}
      onDoubleClick={() => onOpenEdit(planId, date, field, text.value)}
    >
      <span className="w-6 shrink-0 text-muted-foreground/70">{text.label}</span>
      {isEditing ? (
        <CellInput defaultValue={text.value} editRef={editRef} onCommit={onCommit} onCancel={onCancel} autoWidth />
      ) : (
        <>
          <span className={`min-w-0 flex-1 truncate text-right font-medium ${text.danger ? "text-red-500" : ""} ${
            field === "ending" ? "font-semibold" : ""
          }`}>
            {text.value}
          </span>
          {field === "doh" && (cell.doh_capped ? <span className="text-blue-500">∞</span> : null)}
        </>
      )}
    </div>
  );
}

function EditableLabel({
  label,
  value,
  editing,
  onDouble,
  onCommit,
  onCancel,
  editRef,
}: {
  label: string;
  value: number;
  editing: boolean;
  onDouble: () => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  editRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <button
      type="button"
      onDoubleClick={onDouble}
      className="flex items-center gap-1 rounded px-1 text-[10px] tabular-nums text-muted-foreground hover:bg-accent"
      title={`${label}：双击修改`}
    >
      {editing ? (
        <CellInput defaultValue={String(value)} editRef={editRef} onCommit={onCommit} onCancel={onCancel} autoWidth />
      ) : (
        <>
          <span className="text-foreground/50">{label}</span>
          <span className="font-semibold text-foreground">{value}</span>
        </>
      )}
    </button>
  );
}

function CellInput({
  defaultValue,
  editRef,
  onCommit,
  onCancel,
  autoWidth,
}: {
  defaultValue: string;
  editRef: React.RefObject<HTMLInputElement>;
  onCommit: (v: string) => void;
  onCancel?: () => void;
  autoWidth?: boolean;
}) {
  const [draft, setDraft] = useState(defaultValue);
  useEffect(() => {
    setDraft(defaultValue);
    editRef.current?.focus();
    editRef.current?.select();
  }, [defaultValue, editRef]);
  return (
    <input
      ref={editRef}
      className={`h-5 rounded border border-primary bg-background px-1 text-right text-[10px] tabular-nums outline-none focus:ring-1 focus:ring-primary ${autoWidth ? "w-full min-w-0" : "w-full"}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(defaultValue);
          onCancel?.();
          (e.target as HTMLInputElement).blur(); // blur 触发 onCommit → 由 cancelEdit 拦截，不落库
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
