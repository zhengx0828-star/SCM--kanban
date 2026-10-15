import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Factory,
  FolderKanban,
  Inbox,
  LineChart,
  Package,
  PackageOpen,
  Sliders,
} from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DemandLineChart, buildDemandSeries } from "@/components/charts/DemandLineChart";
import { MaterialSupplyCharts } from "@/components/charts/MaterialSupplyCharts";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { SupplyCoefHeatmap } from "@/components/projects/SupplyCoefHeatmap";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { projectApi } from "@/lib/api";
import { useProjectRelations, useProjects } from "@/hooks/use-projects";
import {
  buildMaterialRisk,
  summarizeSupplyRisk,
  type MaterialRisk,
  type SupplyRiskSummary,
} from "@/lib/supply-risk";
import { cn } from "@/lib/utils";
import { CHART_PALETTE } from "@/lib/chart-palette";
import type { Project, ProjectStatus } from "@/types/project";

/**
 * 供需管理 · 入口页。
 *
 * 页面分区（自上而下）：
 *   1) **风险总览（老板首屏）** —— 4 张风险指标卡，开口即见，**零交互**
 *      · 有缺口物料 / 最严重缺口（按缺口比例）/ 全年产能覆盖率 / 首个缺口月份
 *      · 数据范围恒为**全部项目**（老板一打开就有东西看，不受下方筛选影响）
 *   2) 项目卡片网格 —— 点击进入项目详情（录客户需求 / BOM / 产能）
 *   3) 明细分析 —— 项目/物料双下拉 + **两个始终展开**的内容块
 *      · 客户需求（折线，**始终呈现**：未选项目时看全部项目，选了就收窄）
 *      · 物料供需分析（柱+折线）→ **供应系数热力图**（就在图下方）
 *
 * 关键口径（2026-10-14 第二版，与用户确认）：
 *   · **供应系数 = 产能 ÷ 需求**，热力图格内直接写这个数（0.85 = 只够需求的 85%）
 *   · 三档 + 无数据：< 1.0 缺口(红) / 1.0-1.3 紧张(黄) / > 1.3 充足(绿) / 需求 0(灰)
 *   · 热力图**只列所选物料**；**没做下拉筛选就不出内容**（默认项目、物料均为空）
 *   · **例外**：客户需求区块一直呈现（用户明确要求），不受"没筛选就不出内容"约束
 *   · 明细区块**不再折叠** —— 可"展开/收起"的只有两个下拉选择器本身
 *   · 原「Supply Studio 明细」表已移除，信息并入供应系数热力图
 *   · 汇总复用项目卡片同一批 relations 缓存 → **零额外请求**
 */

const STATUS_META: Record<ProjectStatus, { label: string; chip: string }> = {
  active: { label: "进行中", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  planning: { label: "规划中", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  closed: { label: "已结束", chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
};

/** 物料下拉圆点：只看有没有风险（用户要求"不要花花绿绿，有风险一色、没风险一色"） */
const RISK_DOT = "#ef4444";
const SAFE_DOT = "#22c55e";

export default function SupplyDemandPage() {
  const navigate = useNavigate();
  const { data: projectList, isLoading } = useProjects({ page: 1, page_size: 100 });
  const projects = projectList?.items ?? [];
  const allProjectIds = useMemo(() => new Set(projects.map((p) => String(p.id))), [projects]);

  /* ---- 明细分析范围：默认**不选**（没有下拉筛选就不要有内容） ---- */
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const hasProjectSelected = selectedProjectIds.size > 0;
  const hasMaterialSelected = selectedMaterials.size > 0;

  /* ---- 风险总览：恒看全部项目；与项目卡片共用 relations 缓存 ---- */
  const overviewRelations = useProjectsRelations(projects, allProjectIds);
  const overviewRows = useMemo(
    () => aggregateMaterialRows(collectMaterials(overviewRelations), overviewRelations),
    [overviewRelations]
  );
  const riskSummary = useMemo<SupplyRiskSummary>(
    () => summarizeSupplyRisk(overviewRows),
    [overviewRows]
  );

  /* ---- 明细分析：只看所选项目 ---- */
  const detailRelations = useProjectsRelations(projects, selectedProjectIds);
  const allMaterials = useMemo(
    () =>
      collectMaterials(detailRelations).map((x, i) => ({
        ...x,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
      })),
    [detailRelations]
  );
  const detailRows = useMemo(
    () => aggregateMaterialRows(allMaterials, detailRelations),
    [allMaterials, detailRelations]
  );

  /* 物料下拉圆点颜色：该物料任一月份缺口或紧张 → 红，否则绿 */
  const riskyByPn = useMemo(() => new Map(detailRows.map((m) => [m.pn, m.hasRisk])), [detailRows]);

  /* 项目范围变化 → 物料选择重置 */
  const projectScopeKey = useMemo(
    () => Array.from(selectedProjectIds).sort().join(","),
    [selectedProjectIds]
  );
  useEffect(() => {
    setSelectedMaterials(new Set());
  }, [projectScopeKey]);

  const colorByPn = useMemo(() => new Map(allMaterials.map((m) => [m.pn, m.color])), [allMaterials]);

  /* ---- 图表用：按「物料筛选」收窄 ---- */
  const chartMaterials = useMemo(
    () => detailRows.filter((m) => selectedMaterials.has(m.pn) && m.totalDemand > 0),
    [detailRows, selectedMaterials]
  );

  const materialAggregates = useMemo(
    () =>
      chartMaterials.map((m) => ({
        pn: m.pn,
        name: m.name,
        color: colorByPn.get(m.pn) ?? "#3b82f6",
        demandSeries: m.monthly.map((x) => x.demand),
        hasData: true,
      })),
    [chartMaterials, colorByPn]
  );

  /* ---- 聚合：供应商维度（按 supplier_code 汇总产能） ---- */
  const supplierAggregates = useMemo(() => {
    const acc = new Map<string, { code: string; name: string; capacitySeries: number[]; hasData: boolean }>();
    for (const it of detailRelations) {
      for (const r of it.relations) {
        if (!selectedMaterials.has(r.pn)) continue;
        const existing = acc.get(r.supplier_code) ?? {
          code: r.supplier_code,
          name: r.supplier_name,
          capacitySeries: Array(12).fill(0),
          hasData: false,
        };
        const cap = r.capacity;
        if (cap && cap.length === 12) {
          for (let t = 0; t < 12; t++) {
            const v = cap[t] ?? 0;
            if (v) {
              existing.capacitySeries[t] += v;
              existing.hasData = true;
            }
          }
        }
        acc.set(r.supplier_code, existing);
      }
    }
    return Array.from(acc.values())
      .filter((s) => s.hasData)
      .map((s, i) => ({ ...s, color: CHART_PALETTE[i % CHART_PALETTE.length] }));
  }, [detailRelations, selectedMaterials]);

  const overviewLoading = isLoading || overviewRelations.some((i) => i.isLoading);
  const loadingRelations = hasProjectSelected && detailRelations.some((i) => i.isLoading);
  const noMaterialRelation = hasProjectSelected && allMaterials.length === 0;
  const noSupplyData = materialAggregates.length === 0 && supplierAggregates.length === 0;

  /* ---- 客户需求：**始终呈现**（用户要求）----
     未选项目 → 看全部项目；选了项目 → 收窄到所选项目。
     两条数据都已在上方取过（同一 queryKey 缓存），不产生额外请求。 */
  const demandRelations = hasProjectSelected ? detailRelations : overviewRelations;
  const demandProjectIds = hasProjectSelected ? selectedProjectIds : allProjectIds;
  const demandLoading = hasProjectSelected ? loadingRelations : overviewLoading;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">供需管理</h1>
              <p className="mt-2 text-muted-foreground">
                一眼看风险：哪些物料会缺、什么时候开始缺；下方可展开明细逐项排查。
              </p>
            </section>

            {/* 1) 风险总览（老板首屏 · 全部项目 · 零交互） */}
            {projects.length > 0 && <RiskOverview summary={riskSummary} loading={overviewLoading} />}

            {/* 2) 项目卡片网格：进入详情录入 */}
            {isLoading ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-36" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <EmptyState
                className="mt-8"
                size="lg"
                icon={<Inbox className="h-7 w-7" />}
                title="暂无项目"
                description="请到「供应商列表」先创建项目并挂载物料-供应商关系"
              />
            ) : (
              <>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {projects.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onClick={() => navigate(`/supply-demand/projects/${p.id}`)}
                    />
                  ))}
                </div>
                <p className="mt-2.5 px-1 text-xs text-muted-foreground">
                  点击卡片进入项目详情（录入客户需求 / BOM / 产能）。
                </p>
              </>
            )}

            {/* 3) 明细分析：选项目 + 选物料 → 图表 + 供应系数热力图 */}
            {projects.length > 0 && (
              <div id="supply-detail" className="scroll-mt-20">
                <div className="mt-8 flex items-center gap-2">
                  <h2 className="text-sm font-medium">明细分析</h2>
                  <span className="text-xs text-muted-foreground">
                    客户需求始终展示；物料供需图与热力图需先选项目与物料
                  </span>
                </div>

                {/* ★ 必须是 overflow-visible：Card 基础类自带 overflow-hidden，
                    会把下拉面板（absolute 定位、向下超出卡片）整块裁掉 ——
                    表现就是"点开下拉只看到搜索框、选项列表不见了"，项目和物料都选不了。
                    cn() 走 twMerge，后写的 overflow-visible 会覆盖基础类的 overflow-hidden。 */}
                <Card className="mt-3 overflow-visible">
                  <CardContent className="flex flex-col gap-5 p-4 sm:flex-row sm:items-start sm:gap-8">
                    <MultiSelectDropdown
                      label="项目"
                      icon={<FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />}
                      options={projects.map((p) => ({
                        value: String(p.id),
                        label: `${p.code} · ${p.name}`,
                      }))}
                      selected={selectedProjectIds}
                      onChange={setSelectedProjectIds}
                      placeholder="选择项目"
                      searchPlaceholder="搜索项目代码或名称…"
                      hint={hasProjectSelected ? undefined : "选择项目后，下方才会出内容"}
                    />
                    <MultiSelectDropdown
                      label="物料"
                      icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />}
                      options={allMaterials.map((m) => ({
                        value: m.pn,
                        label: m.name,
                        sublabel: m.pn,
                        color: riskyByPn.get(m.pn) ? RISK_DOT : SAFE_DOT,
                      }))}
                      selected={selectedMaterials}
                      onChange={setSelectedMaterials}
                      disabled={!hasProjectSelected || allMaterials.length === 0}
                      placeholder={hasProjectSelected ? "选择物料" : "请先选择项目"}
                      searchPlaceholder="搜索物料 PN 或名称…"
                      hint={
                        !hasProjectSelected
                          ? undefined
                          : hasMaterialSelected
                            ? undefined
                            : "选择物料后，物料供需图与热力图才会出内容"
                      }
                    />
                  </CardContent>
                </Card>

                {/* 客户需求：始终呈现（未选项目时给全部项目） */}
                <AnalysisSection
                  title="客户需求"
                  icon={<LineChart className="h-4 w-4 text-muted-foreground" />}
                  subtitle={
                    hasProjectSelected ? `${selectedProjectIds.size} 个项目` : `全部 ${projects.length} 个项目`
                  }
                >
                  <DemandContent
                    data={demandRelations}
                    selectedIds={demandProjectIds}
                    loading={demandLoading}
                  />
                </AnalysisSection>

                {!hasProjectSelected ? (
                  <AnalysisSection
                    title="物料供需分析"
                    icon={<Sliders className="h-4 w-4 text-muted-foreground" />}
                  >
                    <EmptyState
                      size="md"
                      icon={<PackageOpen className="h-7 w-7" />}
                      title="请先选择项目与物料"
                      description="在上方下拉里选好项目与物料，物料供需组合图与供应系数热力图会显示在这里"
                    />
                  </AnalysisSection>
                ) : (
                  <AnalysisSection
                    title="物料供需分析"
                    icon={<Sliders className="h-4 w-4 text-muted-foreground" />}
                    subtitle={
                      hasMaterialSelected ? `${materialAggregates.length} 个物料有数据` : undefined
                    }
                  >
                    {loadingRelations ? (
                      <Skeleton className="h-[260px] w-full" />
                    ) : noMaterialRelation ? (
                      <EmptyState
                        size="md"
                        icon={<PackageOpen className="h-7 w-7" />}
                        title="暂无物料关系"
                        description="所选项目还没有挂载物料-供应商关系，请到「供应商列表」挂载后再来查看"
                      />
                    ) : !hasMaterialSelected ? (
                      <EmptyState
                        size="md"
                        icon={<PackageOpen className="h-7 w-7" />}
                        title="请先选择物料"
                        description="在上方「物料」下拉里勾选要看哪些物料，这里才会出组合图与供应系数热力图"
                      />
                    ) : noSupplyData ? (
                      <EmptyState
                        size="md"
                        icon={<PackageOpen className="h-7 w-7" />}
                        title="暂无物料供需数据"
                        description="所选物料尚未录入客户需求或供应商产能；到项目详情页补录后再回来查看"
                      />
                    ) : (
                      <>
                        <MaterialSupplyCharts
                          demand={materialAggregates.map((m) => ({
                            pn: m.pn,
                            name: m.name,
                            demandSeries: m.demandSeries,
                            color: m.color,
                          }))}
                          capacity={supplierAggregates.map((s) => ({
                            code: s.code,
                            name: s.name,
                            capacitySeries: s.capacitySeries,
                            color: s.color,
                          }))}
                        />
                        <SupplyCoefHeatmap className="mt-4" materials={chartMaterials} />
                      </>
                    )}
                  </AnalysisSection>
                )}
              </div>
            )}

            <p className="mt-6 text-center text-xs text-muted-foreground">
              数据均与各业务模块实时同源；供应系数 = 产能 ÷ 需求，&lt; 1 缺口、1.0-1.3 紧张、&gt; 1.3 充足，需求为 0 显示灰色。
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  风险总览（老板首屏 · 4 张指标卡）                                            */
/* -------------------------------------------------------------------------- */

function RiskOverview({ summary, loading }: { summary: SupplyRiskSummary; loading: boolean }) {
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

  const worst = summary.worst;
  const coverage = summary.coverageRatio;

  if (loading) {
    return (
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="有缺口物料"
          value={`${summary.shortageMaterialCount} 个`}
          hint={`共 ${summary.materialCount} 个物料`}
          tone={summary.shortageMaterialCount > 0 ? "danger" : "ok"}
        />
        <KpiCard
          label="最严重缺口"
          value={worst ? `${worst.worstMonthIndex + 1} 月` : "无"}
          hint={
            worst
              ? `${worst.pn} · 缺口占该月需求 ${Math.round(worst.worstGapRatio * 100)}%`
              : "全年产能均可覆盖需求"
          }
          tone={worst ? "danger" : "ok"}
        />
        <KpiCard
          label="全年产能覆盖率"
          value={pct(coverage)}
          hint={
            summary.worstMaterialCoverage == null
              ? "暂无需求数据"
              : `最差物料 ${pct(summary.worstMaterialCoverage)}`
          }
          tone={coverage == null ? "muted" : coverage < 1 ? "danger" : "ok"}
        />
        <KpiCard
          label="首个缺口月份"
          value={summary.firstShortageMonth == null ? "无缺口" : `${summary.firstShortageMonth + 1} 月起`}
          hint={`全年缺口总量 ${Math.round(summary.totalGap).toLocaleString()}`}
          tone={summary.firstShortageMonth == null ? "ok" : "warn"}
        />
      </div>
      <p className="mt-2.5 px-1 text-xs text-muted-foreground">
        口径：全部项目；供应系数 = 产能 ÷ 需求，&lt; 1 为缺口。明细分析在页面下方，按项目 / 物料筛选后查看。
      </p>
    </div>
  );
}

/**
 * KPI 状态映射（对齐库存 DohBucketCards 的「顶部 3px 色条 + 图标块」基准）：
 *   色条 = 状态语义（红=危险/琥珀=警告/绿=正常/灰=未评估）
 *   数字 = 统一深色 foreground（不再靠数字变色表达状态，避免满屏彩色数字）
 */
const KPI_TONE_META: Record<
  "danger" | "warn" | "ok" | "muted",
  { bar: string; chip: string; icon: React.ComponentType<{ className?: string }> }
> = {
  danger: {
    bar: "bg-red-500",
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
    icon: AlertTriangle,
  },
  warn: {
    bar: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  ok: {
    bar: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    icon: CheckCircle2,
  },
  muted: {
    bar: "bg-slate-400",
    chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    icon: CircleDashed,
  },
};

function KpiCard({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "warn" | "ok" | "muted";
}) {
  const meta = KPI_TONE_META[tone];
  const Icon = meta.icon;
  return (
    <Card className="relative overflow-hidden p-4">
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", meta.bar)} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p
            className="mt-1.5 truncate text-2xl font-semibold tracking-tight tabular-nums text-foreground"
            title={value}
          >
            {value}
          </p>
          {hint && (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={hint}>
              {hint}
            </p>
          )}
        </div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.chip)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  数据获取：只查**已选项目**的关系（未选 → 不请求）                            */
/* -------------------------------------------------------------------------- */

interface ProjectRelationsData {
  id: number;
  code: string;
  name: string;
  demand: number[] | null;
  relations: import("@/types/project").ProjectSupplyRelation[];
  isLoading: boolean;
}

function useProjectsRelations(projects: Project[], selectedIds: Set<string>): ProjectRelationsData[] {
  const targets = useMemo(
    () => projects.filter((p) => selectedIds.has(String(p.id))),
    [projects, selectedIds]
  );
  const queries = useQueries({
    queries: targets.map((p) => ({
      queryKey: ["projects", "relations", p.id],
      queryFn: () => projectApi.relations(p.id),
    })),
  });
  return useMemo(
    () =>
      targets.map((p, i) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        demand: (queries[i]?.data?.[0]?.demand ?? null) as number[] | null,
        relations: queries[i]?.data ?? [],
        isLoading: queries[i]?.isLoading ?? false,
      })),
    [targets, queries]
  );
}

/* -------------------------------------------------------------------------- */
/*  物料聚合（纯函数：候选收集 + 物料×月 需求/产能）                              */
/* -------------------------------------------------------------------------- */

/** 从关系里收集去重后的物料候选（PN → 名称） */
function collectMaterials(relationsData: ProjectRelationsData[]): { pn: string; name: string }[] {
  const m = new Map<string, { pn: string; name: string }>();
  for (const it of relationsData) {
    for (const r of it.relations) {
      if (!m.has(r.pn)) m.set(r.pn, { pn: r.pn, name: r.material_name });
    }
  }
  return Array.from(m.values());
}

/**
 * 物料 × 月 聚合：
 *   需求 = Σ(项目客户需求 × 该项目该物料 BOM)，每个「项目×物料」只累加一次
 *   产能 = Σ 该物料每一行供应商的月度产能
 */
function aggregateMaterialRows(
  materials: { pn: string; name: string }[],
  relationsData: ProjectRelationsData[]
): MaterialRisk[] {
  const demandByPn = new Map<string, number[]>();
  const capacityByPn = new Map<string, number[]>();
  for (const m of materials) {
    demandByPn.set(m.pn, Array(12).fill(0));
    capacityByPn.set(m.pn, Array(12).fill(0));
  }

  for (const it of relationsData) {
    const bomByPn = new Map<string, number | null>();
    for (const r of it.relations) {
      if (!demandByPn.has(r.pn)) continue;
      if (!bomByPn.has(r.pn)) bomByPn.set(r.pn, r.bom_factor);
    }
    if (it.demand) {
      for (const [pn, bom] of bomByPn) {
        if (bom == null || bom === 0) continue;
        const arr = demandByPn.get(pn)!;
        for (let t = 0; t < 12; t++) arr[t] += (it.demand[t] ?? 0) * bom;
      }
    }
    for (const r of it.relations) {
      const arr = capacityByPn.get(r.pn);
      if (!arr) continue;
      const cap = r.capacity;
      if (cap && cap.length === 12) {
        for (let t = 0; t < 12; t++) arr[t] += cap[t] ?? 0;
      }
    }
  }

  return materials.map((m) =>
    buildMaterialRisk(m.pn, m.name, demandByPn.get(m.pn) ?? [], capacityByPn.get(m.pn) ?? [])
  );
}

/* -------------------------------------------------------------------------- */
/*  内容区块（**始终展开**，不带折叠箭头）                                        */
/* -------------------------------------------------------------------------- */

function AnalysisSection({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mt-3 overflow-hidden">
      <div className="flex items-center gap-2.5 border-b px-5 py-3.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </span>
        {subtitle && <span className="shrink-0 text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  客户需求区块内容                                                            */
/* -------------------------------------------------------------------------- */

function DemandContent({
  data,
  selectedIds,
  loading,
}: {
  data: ProjectRelationsData[];
  selectedIds: Set<string>;
  loading: boolean;
}) {
  const series = useMemo(
    () =>
      buildDemandSeries(
        data.map((i) => ({ id: i.id, code: i.code, name: i.name, demand: i.demand })),
        new Set(Array.from(selectedIds).map(Number))
      ),
    [data, selectedIds]
  );
  const hasAnyDemand = data.some((i) => i.demand);

  if (loading) return <Skeleton className="h-[320px] w-full rounded-md" />;
  if (!hasAnyDemand) {
    return (
      <EmptyState
        size="md"
        icon={<LineChart className="h-7 w-7" />}
        title="所选项目未录入客户需求"
        description="到项目详情页录入 1-12 月客户需求后，这里会展示各项目需求走势"
      />
    );
  }
  return (
    <div className="h-[340px] w-full rounded-md border bg-background">
      <DemandLineChart className="h-full w-full" series={series} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  项目卡片                                                                    */
/* -------------------------------------------------------------------------- */

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  // 只查 1 次：物料数 / 明细行 / 供应商数 都能从该项目的供应明细推出
  const { data: relations = [], isLoading: relationsLoading } = useProjectRelations(project.id);
  const statusMeta = STATUS_META[project.status] ?? STATUS_META.active;
  const materialCount = useMemo(() => new Set(relations.map((r) => r.pn)).size, [relations]);
  const supplierCount = useMemo(() => new Set(relations.map((r) => r.supplier_code)).size, [relations]);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group cursor-pointer p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{project.code}</p>
          <p className="mt-1 truncate text-base font-semibold leading-tight" title={project.name}>
            {project.name}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant="secondary" className={statusMeta.chip}>
          {statusMeta.label}
        </Badge>
        {project.owner && <span className="text-xs text-muted-foreground">负责人：{project.owner}</span>}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat icon={<Boxes className="h-3.5 w-3.5" />} label="物料" value={relationsLoading ? "—" : String(materialCount)} />
        <Stat icon={<Factory className="h-3.5 w-3.5" />} label="明细行" value={relationsLoading ? "—" : String(relations.length)} />
        <Stat icon={<CalendarRange className="h-3.5 w-3.5" />} label="供应商" value={relationsLoading ? "—" : String(supplierCount)} />
      </div>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 text-center">
      <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
