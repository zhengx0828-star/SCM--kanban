import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CircleDot, Factory, FileUp, ListPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { BaseManageDialog } from "@/components/inventory/BaseManageDialog";
import { DohBucketCards } from "@/components/inventory/DohBucketCards";
import { InventoryBulkCreateDialog } from "@/components/inventory/InventoryBulkCreateDialog";
import { InventoryDetailSheet, type EditingCell } from "@/components/inventory/InventoryDetailSheet";
import { InventoryImportDialog } from "@/components/inventory/InventoryImportDialog";
import { InventoryListHeader, InventoryRow } from "@/components/inventory/InventoryRow";
import { InventoryToolbar } from "@/components/inventory/InventoryToolbar";
import { InventoryViewSettings } from "@/components/inventory/InventoryViewSettings";
import { OrderTimingBar, firstRiskBucket, NO_RISK, type RiskBucket } from "@/components/inventory/OrderTimingBar";
import { ProjectCardWall } from "@/components/inventory/ProjectCardWall";
import { useInventoryExport, useInventoryPlans, useInventoryProjectOverview, useUpdateInventoryDays, useUpdateInventoryPlan } from "@/hooks/use-inventory";
import { getApiErrorMessage } from "@/lib/utils";
import {
  INV_DOH_BUCKET,
  dohBucketLabels,
  dohBucketMeta,
  parseBuckets,
  type InventoryDensity,
  type InventoryDayUpdateInput,
  type InventoryFilter,
  type InventoryPlan,
} from "@/types/inventory";
import type { MultiSelectOption } from "@/components/ui/multi-select-filter";

/**
 * 库存信号塔（三层结构）
 *
 * 顶部 DOH 四卡预警框 —— 先看风险：未选项目 = 全部项目合计，已选项目 = 已选项目口径
 * L0 项目卡片墙 —— 项目选择（可多选）；未选项目不加载物料（物料再多也不会堆在主页面）
 * L1 库存总览   —— 选定项目后展开：下单时机细条 + 工具栏 + 紧凑列表（DOH 为第一视线）
 * L2 详情抽屉   —— 30 天 × 5 层矩阵（横向滚动只发生在抽屉内）
 *
 * ⚠️ 页面顺序是「预警框在上、项目选择在下」（2026-10-04 按要求调换过），
 *    不要把 ProjectCardWall 挪回四卡之前。
 *
 * 状态全部走 URL query（可分享 / 可刷新保留）：
 *   ?project=1,2 &bucket=urgent &pn=&sup=&base=&plan=123
 *
 * `bucket` 支持逗号多档（`stockout,urgent`）—— Dashboard「库存天数 < 3」卡
 * 把「已断货 + 紧急」两档一起带过来，四卡与列表口径才一致。
 */

const PAGE_SIZE = 50;

/** 空集常量（L0 全局四卡不可点，用同一个空集合，避免每次渲染新建） */
const NO_BUCKETS: ReadonlySet<string> = new Set<string>();

export default function InventoryPage() {
  const [sp, setSp] = useSearchParams();

  // ---- 全局参数（移入视图设置）----
  const [serviceZ, setServiceZ] = useState(1.65);
  const [excess, setExcess] = useState(30);
  const [density, setDensity] = useState<InventoryDensity>("comfortable");

  // ---- L0：已选项目（URL 承载）----
  const projSel = useMemo(() => {
    const raw = sp.get("project") ?? "";
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  }, [sp]);
  const hasProject = projSel.size > 0;

  // ---- L1 筛选 ----
  // bucket 支持逗号多档（Dashboard「库存天数 < 3」= stockout,urgent）
  const bucketSel = useMemo(() => new Set(parseBuckets(sp.get("bucket"))), [sp]);
  const sort = sp.get("sort") ?? "doh";
  const keyword = sp.get("q") ?? "";
  const pnSel = useMemo(() => new Set((sp.get("pn") ?? "").split(",").filter(Boolean)), [sp]);
  const supSel = useMemo(() => new Set((sp.get("sup") ?? "").split(",").filter(Boolean)), [sp]);
  const baseSel = useMemo(() => new Set((sp.get("base") ?? "").split(",").filter(Boolean)), [sp]);
  const timingSel = sp.get("timing") ?? "";

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSp]
  );

  // ---- 数据 ----
  const filters: InventoryFilter = useMemo(
    () => ({
      project_ids: [...projSel].join(","),
      base_ids: [...baseSel].join(","),
      supplier_ids: [...supSel].join(","),
      pns: [...pnSel].join(","),
      bucket: [...bucketSel].join(","),
      sort,
      service_z: serviceZ,
      excess,
    }),
    [projSel, baseSel, supSel, pnSel, bucketSel, sort, serviceZ, excess]
  );

  const overviewQ = useInventoryProjectOverview(serviceZ, excess);
  // ⚠️ 未选项目 → 不发起 /plans 请求（这是「未选项目不出物料」的关键）
  const plansQ = useInventoryPlans(filters, hasProject);
  const updateDays = useUpdateInventoryDays();
  const updatePlan = useUpdateInventoryPlan();
  const exportMut = useInventoryExport();

  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);
  const projects = useMemo(() => overviewQ.data ?? [], [overviewQ.data]);

  // ---- L0 卡片墙上的四档汇总（全项目口径）----
  const globalBuckets = useMemo(() => {
    const acc = { stockout: 0, urgent: 0, low: 0, ok: 0, unknown: 0, unknown_no_series: 0, unknown_bom_zero: 0, unknown_demand_blank: 0 };
    for (const p of projects) {
      acc.stockout += p.doh_buckets.stockout;
      acc.urgent += p.doh_buckets.urgent;
      acc.low += p.doh_buckets.low;
      acc.ok += p.doh_buckets.ok;
      acc.unknown += p.doh_buckets.unknown;
      acc.unknown_no_series += p.doh_buckets.unknown_no_series;
      acc.unknown_bom_zero += p.doh_buckets.unknown_bom_zero;
      acc.unknown_demand_blank += p.doh_buckets.unknown_demand_blank;
    }
    return acc;
  }, [projects]);

  // ---- L1：四卡统计 ----
  // 数字只汇总「已选项目」的项目级 DOH 分档（project-overview），与 L0 项目卡上的角标同源。
  //
  // ⚠️ 不能改成统计 `plans`：`plans` 本身已按 bucket 过滤，一旦筛出某一档，
  // 其余档立刻显示 0 —— 与上方项目卡角标自相矛盾（Dashboard 卡带 bucket 跳进来时最明显：
  // 卡上写「2」，落地页却显示 偏低 0 / 充足 0，而项目卡明明写着 偏低 2 充足 2）。
  // 四卡是「当前已选项目」这个语境的全局镜头，工具栏（物料/供应商/基地/搜索）只收窄下方列表。
  const rowBuckets = useMemo(() => {
    const acc = { stockout: 0, urgent: 0, low: 0, ok: 0, unknown: 0, unknown_no_series: 0, unknown_bom_zero: 0, unknown_demand_blank: 0 };
    for (const p of projects) {
      if (!projSel.has(String(p.project_id))) continue;
      const b = p.doh_buckets;
      acc.stockout += b.stockout;
      acc.urgent += b.urgent;
      acc.low += b.low;
      acc.ok += b.ok;
      acc.unknown += b.unknown;
      acc.unknown_no_series += b.unknown_no_series;
      acc.unknown_bom_zero += b.unknown_bom_zero;
      acc.unknown_demand_blank += b.unknown_demand_blank;
    }
    return acc;
  }, [projects, projSel]);

  /** 已选项目的推算单元总数（四卡占比条的分母，与 rowBuckets 同语境） */
  const selectedPlanCount = useMemo(
    () => projects.reduce((a, p) => (projSel.has(String(p.project_id)) ? a + p.plan_count : a), 0),
    [projects, projSel]
  );

  /** 全部项目的推算单元总数（未选项目时四卡的占比条分母） */
  const globalPlanCount = useMemo(() => projects.reduce((a, p) => a + p.plan_count, 0), [projects]);

  // ---- 下单时机细条统计 ----
  const timing = useMemo(() => {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const map = new Map<number, RiskBucket>();
    let irreversibleToday = 0;
    let noRisk = 0;
    for (const p of plans) {
      const b = firstRiskBucket(p);
      map.set(p.id, b);
      if (b === NO_RISK) noRisk += 1;
      else counts[b] += 1;
      if (b === 0) {
        const d0 = p.days[0];
        if (d0 && !d0.doh_capped && d0.doh < p.lead_time_days) irreversibleToday += 1;
      }
    }
    return { counts, map, irreversibleToday, noRisk };
  }, [plans]);

  // ---- 全局搜索（前端过滤，无需后端）----
  const searched = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return plans;
    return plans.filter((p) =>
      [p.material_name, p.pn, p.supplier_name, p.supplier_code, p.project_name, p.base_name]
        .join(" ")
        .toLowerCase()
        .includes(kw)
    );
  }, [plans, keyword]);

  // ---- 级联选项（始终基于「已选项目」的行，过滤选择不锁死候选）----
  const pnOptions = useMemo<MultiSelectOption[]>(() => {
    const seen = new Map<string, InventoryPlan>();
    for (const p of plans) if (!seen.has(p.pn)) seen.set(p.pn, p);
    return [...seen.values()].map((p) => ({
      value: p.pn,
      label: p.pn,
      sublabel: p.material_name,
      color: "#0ea5e9",
    }));
  }, [plans]);

  const supOptions = useMemo<MultiSelectOption[]>(() => {
    const seen = new Map<number, InventoryPlan>();
    for (const p of plans) if (!seen.has(p.supplier_id)) seen.set(p.supplier_id, p);
    return [...seen.values()].map((p) => ({
      value: String(p.supplier_id),
      label: p.supplier_name,
      sublabel: p.supplier_code,
      color: "#8b5cf6",
    }));
  }, [plans]);

  const baseOptions = useMemo<MultiSelectOption[]>(() => {
    const seen = new Map<number, InventoryPlan>();
    for (const p of plans) if (!seen.has(p.base_id)) seen.set(p.base_id, p);
    return [...seen.values()].map((p) => ({ value: String(p.base_id), label: p.base_name, color: "#f59e0b" }));
  }, [plans]);

  // ---- 显示行：搜索 + 时机细条过滤 + 截断 ----
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [filters, keyword, timingSel]);

  const rows = useMemo(() => {
    let out = searched;
    if (timingSel !== "") {
      const t = Number(timingSel);
      out = out.filter((p) => timing.map.get(p.id) === t);
    }
    return out;
  }, [searched, timingSel, timing.map]);

  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);
  const canExport = hasProject && rows.length > 0;

  // ---- L2 抽屉 ----
  const planParam = sp.get("plan");
  const detail = useMemo(() => plans.find((p) => String(p.id) === planParam) ?? null, [plans, planParam]);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (planParam && detail) setSheetOpen(true);
  }, [planParam, detail]);

  const closeSheet = () => {
    setSheetOpen(false);
    update({ plan: null });
  };

  // ---- 单元格编辑 ----
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [rowEditing, setRowEditing] = useState<{ planId: number; field: "lt" | "onhand"; initial: string } | null>(null);
  const [cancelEdit, setCancelEdit] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  const openCellEdit = (planId: number, date: string, field: EditingCell["field"], current: string) => {
    setCancelEdit(false);
    setEditing({ planId, date, field, initial: current });
  };
  const openRowEdit = (planId: number, field: "lt" | "onhand", current: string) => {
    setCancelEdit(false);
    setRowEditing({ planId, field, initial: current });
  };
  useEffect(() => {
    if (editing || rowEditing) editRef.current?.focus();
  }, [editing, rowEditing]);

  const commitCell = (value: string) => {
    if (!editing || !editing.date) return;
    const { planId, date, field, initial } = editing;
    if (cancelEdit) {
      setCancelEdit(false);
      setEditing(null);
      return;
    }
    setEditing(null);
    const v = value.trim();
    const params = { service_z: serviceZ, excess };
    const days = (cells: InventoryDayUpdateInput[]) =>
      updateDays.mutate({ id: planId, cells, params }, { onError: (e) => toast.error(getApiErrorMessage(e)) });

    if (v === "") {
      if (field === "sys") days([{ date, demand_override: null }]);
      else if (field === "ending") days([{ date, ending_override: null }]);
      else if (field === "doh") days([{ date, ending_override: null }]);
      else if (field === "md") days([{ date, manual_demand: 0 }]);
      else if (field === "mi") days([{ date, manual_in: 0 }]);
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      toast.error("请输入有效数字");
      return;
    }
    const cell = { date } as InventoryDayUpdateInput;
    if (field === "sys") cell.demand_override = n;
    else if (field === "md") cell.manual_demand = n;
    else if (field === "mi") cell.manual_in = n;
    else if (field === "ending") cell.ending_override = n;
    else cell.doh_target = n;
    days([cell]);
  };

  const commitRow = (value: string) => {
    if (!rowEditing) return;
    const { planId, field, initial } = rowEditing;
    if (cancelEdit) {
      setCancelEdit(false);
      setRowEditing(null);
      return;
    }
    setRowEditing(null);
    const v = value.trim();
    if (v === "") return;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      toast.error("请输入有效数字");
      return;
    }
    const params = { service_z: serviceZ, excess };
    if (field === "lt") {
      if (n <= 0) {
        toast.error("LeadTime 必须 > 0");
        return;
      }
      updatePlan.mutate({ id: planId, params, data: { lead_time_days: n } }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
    } else {
      if (n < 0) {
        toast.error("现有库存不能为负");
        return;
      }
      updatePlan.mutate({ id: planId, params, data: { on_hand: n } }, { onError: (e) => toast.error(getApiErrorMessage(e)) });
    }
  };

  const handleDelete = (plan: InventoryPlan) => {
    if (!window.confirm(`确认删除「${plan.material_name} ${plan.pn}」在 ${plan.base_name} 的库存档案？\n手工修正数据会一并清除，且不可恢复。`)) {
      return;
    }
    fetch(`/api/inventory/plans/${plan.id}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) throw new Error("删除失败");
        toast.success("已删除该库存档案");
        closeSheet();
        void plansQ.refetch();
        void overviewQ.refetch();
      })
      .catch((e) => toast.error(getApiErrorMessage(e)));
  };

  // ---- 项目选择 ----
  const toggleProject = (id: string) => {
    const next = new Set(projSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update({ project: [...next].join(","), plan: null });
  };
  const selectAllProjects = () => update({ project: projects.map((p) => p.project_id).join(",") });
  const clearProjects = () => update({ project: null, plan: null, bucket: null, timing: null });

  /** 切换某个 DOH 档位（多选；与「下单时机细条」互斥），全不选 = 不过滤 */
  const toggleBucket = (b: string) => {
    const next = new Set(bucketSel);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    update({ bucket: [...next].join(","), timing: null });
  };

  const hasFilters = pnSel.size > 0 || supSel.size > 0 || baseSel.size > 0 || keyword !== "" || bucketSel.size > 0 || timingSel !== "";
  const clearFilters = () => update({ pn: null, sup: null, base: null, q: null, bucket: null, timing: null });
  const doExport = () =>
    exportMut.mutate(filters, {
      onSuccess: () => toast.success("已开始下载"),
      onError: (e) => toast.error(getApiErrorMessage(e)),
    });

  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);

  const isLoading = hasProject ? plansQ.isLoading : overviewQ.isLoading;
  const showSheet = sheetOpen && detail !== null;

  /* ---------------- 渲染 ---------------- */
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
                  先选项目，再看物料 · 未来 30 天日度滚动推算 · 安全天数 = Z × COV × √LT（当前 Z={serviceZ}）
                  {hasProject && ` · 已选 ${projSel.size} 个项目`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <InventoryViewSettings
                  serviceZ={serviceZ}
                  excess={excess}
                  density={density}
                  onChangeServiceZ={setServiceZ}
                  onChangeExcess={setExcess}
                  onChangeDensity={setDensity}
                />
                <Button variant="outline" size="sm" onClick={() => setBaseOpen(true)}>
                  <Factory className="mr-1.5 h-3.5 w-3.5" />
                  基地管理
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileUp className="mr-1.5 h-3.5 w-3.5" />
                  Excel 导入
                </Button>
                <Button size="sm" onClick={() => setBulkOpen(true)}>
                  <ListPlus className="mr-1.5 h-3.5 w-3.5" />
                  从底表建档
                </Button>
              </div>
            </div>

            {/* ============ 预警框：DOH 四卡（放在项目选择之上，先看风险再挑项目）============
                未选项目 = 全部项目合计口径（不可点）；已选项目 = 已选项目口径（可点多选筛选）。
                统计口径永远是「已选项目的项目级分档」，不随工具栏筛选变化。 */}
            {projects.length > 0 && (
              <div className="mt-6">
                <DohBucketCards
                  buckets={hasProject ? rowBuckets : globalBuckets}
                  active={hasProject ? bucketSel : NO_BUCKETS}
                  onToggle={hasProject ? toggleBucket : () => undefined}
                  totalRows={hasProject ? selectedPlanCount : globalPlanCount}
                />
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {hasProject
                    ? `口径 = 已选 ${projSel.size} 个项目的推算单元分档 · 点击卡片可筛选下方列表`
                    : "以上为全部项目的合计口径 · 勾选下方项目后可按项目管理"}
                </p>
              </div>
            )}

            {/* ============ L0：项目卡片墙（项目选择，可多选）============ */}
            <div className="mt-6">
              <ProjectCardWall
                projects={projects}
                selected={projSel}
                onToggle={toggleProject}
                onSelectAll={selectAllProjects}
                onClearAll={clearProjects}
                isLoading={overviewQ.isLoading}
                onBulkCreate={() => setBulkOpen(true)}
                onImport={() => setImportOpen(true)}
              />
            </div>

            {/* ============ L1：库存总览（已选项目后展开）============ */}
            {hasProject && (
              <div className="mt-6 space-y-4">
                {/* 已选项目 chip 行 */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">已选项目</span>
                  {[...projSel].map((id) => {
                    const p = projects.find((x) => String(x.project_id) === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >
                        {p ? p.project_name : `#${id}`}
                        <button
                          type="button"
                          onClick={() => toggleProject(id)}
                          className="rounded-full p-0.5 hover:bg-primary/20"
                          aria-label={`取消选择 ${p?.project_name ?? id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                  <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={clearProjects}>
                    取消全部
                  </Button>
                </div>

                {/* ⚠️ DOH 四卡（预警框）已统一上移到「项目选择」之上，此处不要再放一份，
                    否则已选项目时会出现两排四卡。L1 从这里开始：已选项目 chip → 下单时机细条 → 工具栏 → 列表 */}

                {/* 下单时机细条（原漏斗降级保留） */}
                <OrderTimingBar
                  counts={timing.counts}
                  irreversibleToday={timing.irreversibleToday}
                  noRisk={timing.noRisk}
                  active={timingSel === "" ? null : Number(timingSel)}
                  onSelect={(b) => update({ timing: b === null ? null : String(b), bucket: null })}
                  totalRows={plans.length}
                />

                {/* 工具栏 */}
                <InventoryToolbar
                  keyword={keyword}
                  onKeyword={(v) => update({ q: v || null })}
                  pnOptions={pnOptions}
                  pnSel={pnSel}
                  onPnSel={(s) => update({ pn: [...s].join(",") })}
                  supOptions={supOptions}
                  supSel={supSel}
                  onSupSel={(s) => update({ sup: [...s].join(",") })}
                  baseOptions={baseOptions}
                  baseSel={baseSel}
                  onBaseSel={(s) => update({ base: [...s].join(",") })}
                  onExport={doExport}
                  exporting={exportMut.isPending}
                  canExport={canExport}
                  onRefresh={() => {
                    void plansQ.refetch();
                    void overviewQ.refetch();
                  }}
                  refreshing={plansQ.isFetching}
                  onClearFilters={clearFilters}
                  hasFilters={hasFilters}
                />

                {/* 列表 */}
                {isLoading ? (
                  <Skeleton className="h-[420px] w-full rounded-xl" />
                ) : rows.length === 0 ? (
                  <Card>
                    <CardContent className="p-6">
                      <EmptyState
                        icon={<CircleDot className="h-7 w-7" />}
                        title={
                          bucketSel.size > 0
                            ? `「${dohBucketLabels(bucketSel)}」档没有推算单元`
                            : timingSel !== ""
                              ? "该时段没有需要下单的推算单元"
                              : keyword !== "" || pnSel.size > 0 || supSel.size > 0 || baseSel.size > 0
                                ? "当前筛选下没有匹配的推算单元"
                                : "所选项目暂无推算单元"
                        }
                        description={
                          bucketSel.has(INV_DOH_BUCKET.unknown)
                            ? "当前没有需求数据不可用的行 —— 也可能是筛选后为空，可恢复全部再看"
                            : "放宽筛选条件，或恢复全部后再试"
                        }
                        action={
                          hasFilters ? (
                            <Button variant="outline" size="sm" onClick={clearFilters}>
                              清除筛选
                            </Button>
                          ) : undefined
                        }
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>
                            共 <b className="text-foreground">{rows.length}</b> 行
                            {rows.length !== plans.length && `（已筛选，全量 ${plans.length}）`}
                          </span>
                          {bucketSel.size > 0 && (
                            <span className={`rounded px-1.5 py-px ${dohBucketMeta([...bucketSel][0]).chipCls}`}>
                              DOH：{dohBucketLabels(bucketSel)}
                            </span>
                          )}
                          {timingSel !== "" && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-px text-amber-700 dark:text-amber-400">
                              下单时机：D{Number(timingSel) === 0 ? "1" : Number(timingSel) === 1 ? "2-7" : Number(timingSel) === 2 ? "8-14" : "15-30"}
                            </span>
                          )}
                          <span className="text-muted-foreground/70">
                            按今日 DOH 升序，最危险排最上 · 点击任意行看 30 天明细
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => update({ sort: sort === "doh" ? "pn" : "doh" })}
                            className="rounded border px-2 py-0.5 hover:bg-accent"
                          >
                            排序：{sort === "doh" ? "DOH 升序" : sort === "pn" ? "物料 PN" : sort === "replenish" ? "建议补货" : sort === "lt" ? "LeadTime" : "最晚下单"}
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <div className="min-w-[1020px]">
                          <InventoryListHeader sort={sort} onSort={(k) => update({ sort: k })} />
                          {visible.map((p) => (
                            <InventoryRow
                              key={p.id}
                              plan={p}
                              bucket={p.doh_bucket}
                              density={density}
                              pending={updateDays.isPending || updatePlan.isPending}
                              onOpen={() => update({ plan: String(p.id) })}
                              onEditPlan={(field, current) => openRowEdit(p.id, field, current)}
                              editing={rowEditing?.planId === p.id ? { field: rowEditing.field, initial: rowEditing.initial } : null}
                              onCommitEdit={commitRow}
                              onCancelEdit={() => setCancelEdit(true)}
                              editRef={editRef}
                            />
                          ))}
                        </div>
                      </div>

                      {rows.length > visible.length && (
                        <div className="flex items-center justify-center gap-3 border-t px-3 py-3 text-xs text-muted-foreground">
                          <span>
                            已显示 {visible.length} / {rows.length} 行
                          </span>
                          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                            再显示 {PAGE_SIZE} 行
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setLimit(rows.length)}>
                            全部展开
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* 缺需求数据集中提示（不占用四卡绿档） */}
                {rowBuckets.unknown > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>
                      有 <b className="text-foreground">{rowBuckets.unknown}</b> 行因需求数据不可用无法评估：
                      缺需求 {rowBuckets.unknown_no_series} · BOM 为 0 {rowBuckets.unknown_bom_zero} · 需求为 0{" "}
                      {rowBuckets.unknown_demand_blank}
                    </span>
                    <button
                      type="button"
                      onClick={() => update({ bucket: INV_DOH_BUCKET.unknown })}
                      className="rounded border px-2 py-0.5 hover:bg-accent"
                    >
                      只看这些行
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <InventoryDetailSheet
        plan={detail}
        bucket={detail?.doh_bucket ?? "ok"}
        open={showSheet}
        onOpenChange={(v) => !v && closeSheet()}
        editing={editing && detail && editing.planId === detail.id ? editing : null}
        onOpenEdit={openCellEdit}
        onCommitEdit={commitCell}
        onCancelEdit={() => setCancelEdit(true)}
        editRef={editRef}
        pending={updateDays.isPending}
        onDelete={handleDelete}
        onJumpToSupplyDemand={(p) => {
          window.open(`/supply-demand?project=${p.project_id}&material=${p.material_id}`, "_blank");
        }}
      />

      <InventoryImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <InventoryBulkCreateDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <BaseManageDialog open={baseOpen} onOpenChange={setBaseOpen} />
    </div>
  );
}
