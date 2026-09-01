import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, CalendarRange, ChevronRight, Factory, Inbox, LineChart, PackageOpen, Sliders } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DemandLineChart, buildDemandSeries, LINE_COLORS } from "@/components/charts/DemandLineChart";
import { MaterialSupplyCharts } from "@/components/charts/MaterialSupplyCharts";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { MaterialDrawerFilter } from "@/components/projects/MaterialDrawerFilter";
import {
  SupplyStudioTable,
  type SupplyStudioRow,
} from "@/components/projects/SupplyStudioTable";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { projectApi } from "@/lib/api";
import { useProjectMaterials, useProjectRelations, useProjects } from "@/hooks/use-projects";
import type { Project, ProjectStatus } from "@/types/project";

/**
 * 供需管理 · 项目列表（入口页）。
 *
 * 页面分区（自上而下）：
 *   1) 项目卡片网格（点击进入项目详情）
 *   2) 客户需求 1-12 月折线图（按项目；带项目 chip 切片器）— 已有
 *   3) 【新增】物料供需分析
 *      - 切片器：项目 chip 多选 + 物料 chip 多选（物料带搜索，按 PN/名称过滤）
 *      - 双图：物料需求折线图（按月 × 物料）+ 供应商产能柱状图（按月 × 供应商，堆叠）
 *      - Supply Studio 表：按月供需平衡（含年合计 + 盈余/缺口状态）
 *
 * 数据流：
 *   useAllProjectsRelations → { projectId, demand, relations: ProjectSupplyRelation[] }
 *   → 根据 selectedProjects + selectedMaterials 进行聚合：
 *      · 物料需求（每月）= Σ over (project, material)  demand[p][m] × bom[p, material]
 *      · 供应商产能（每月）= Σ over (project, material, supplier)  capacity[r][m]
 *      · 客户需求（每月）= Σ over project  demand[p][m]
 */

const STATUS_META: Record<ProjectStatus, { label: string; chip: string }> = {
  active: { label: "进行中", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  planning: { label: "规划中", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  closed: { label: "已结束", chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

export default function SupplyDemandPage() {
  const navigate = useNavigate();
  const { data: projectList, isLoading } = useProjects({ page: 1, page_size: 100 });

  const projects = projectList?.items ?? [];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <section>
              <h1 className="text-4xl font-semibold tracking-tight">供需管理</h1>
              <p className="mt-2 text-muted-foreground">
                选择一个项目，查看并维护该项目下的客户需求、各物料 BOM 用量、各供应商产能。
              </p>
            </section>

            {/* 上部：项目卡片网格 */}
            {isLoading ? (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onClick={() => navigate(`/supply-demand/projects/${p.id}`)}
                  />
                ))}
              </div>
            )}

            {/* 客户需求折线图（带项目切片器） */}
            {projects.length > 0 && <DemandChartCard projects={projects} />}

            {/* 物料供需分析（双图 + 切片器 + Supply Studio） */}
            {projects.length > 0 && <MaterialSupplyCard projects={projects} />}
          </div>
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  数据聚合（useAllProjectsRelations）                                          */
/* -------------------------------------------------------------------------- */

interface ProjectRelationsData {
  id: number;
  code: string;
  name: string;
  demand: number[] | null;
  relations: import("@/types/project").ProjectSupplyRelation[];
  isLoading: boolean;
}

function useAllProjectsRelations(projects: Project[]): ProjectRelationsData[] {
  const queries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["projects", "relations", p.id],
      queryFn: () => projectApi.relations(p.id),
    })),
  });

  return useMemo(
    () =>
      projects.map((p, i) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        demand: (queries[i].data?.[0]?.demand ?? null) as number[] | null,
        relations: queries[i].data ?? [],
        isLoading: queries[i].isLoading,
      })),
    [projects, queries]
  );
}

/* -------------------------------------------------------------------------- */
/*  客户需求折线图 Card（已有）                                                */
/* -------------------------------------------------------------------------- */

function DemandChartCard({ projects }: { projects: Project[] }) {
  const items = useAllProjectsRelations(projects);

  // 有 demand 的项目 id 列表（用作默认全选）
  const initiallyAvailable = useMemo(
    () => items.filter((i) => i.demand).map((i) => i.id),
    [items]
  );

  // null = 未初始化（首次进入），落到"全选有数据项目"回退；非 null = 用户选择
  // MultiSelectFilter 以 string 为 key，这里统一用 String(id)
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const effectiveSelected = useMemo<Set<string>>(
    () => selected ?? new Set(initiallyAvailable.map(String)),
    [selected, initiallyAvailable]
  );

  const series = useMemo(
    () =>
      buildDemandSeries(
        items.map((i) => ({ id: i.id, code: i.code, name: i.name, demand: i.demand })),
        new Set(Array.from(effectiveSelected).map(Number))
      ),
    [items, effectiveSelected]
  );

  const anyLoading = items.some((i) => i.isLoading) && series.every((s) => !s.demand);

  /** MultiSelectFilter 提交回调：允许 0 个选中（0/3 → 图表区显示空态） */
  const handleProjectsChange = (next: Set<string>) => {
    setSelected(next);
  };

  return (
    <Card className="mt-10">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <LineChart className="h-4 w-4" />
              客户需求（1-12 月 · 折线图）
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              各项目客户需求量按月走势；勾选项目切换该线显隐，未录入需求的项目不显示
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3">
          <div className="mb-4">
            <MultiSelectFilter
              label="项目筛选"
              options={items.map((i, idx) => ({
                value: String(i.id),
                label: `${i.code} · ${i.name}`,
                color: LINE_COLORS[idx % LINE_COLORS.length],
                badge: i.demand ? (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                    已录需求
                  </span>
                ) : undefined,
              }))}
              selected={effectiveSelected}
              onChange={handleProjectsChange}
              chipThreshold={12}
              placeholder="搜索项目代码或名称…"
            />
          </div>
          {effectiveSelected.size === 0 ? (
            <EmptyState
              size="md"
              icon={<LineChart className="h-7 w-7" />}
              title="请选择项目查看需求"
              description="在「项目筛选」勾选至少一个项目后，这里将展示其客户需求量按月走势"
            />
          ) : (
            <div className="h-[340px] w-full rounded-md border bg-background">
              {anyLoading ? (
                <Skeleton className="h-full w-full rounded-md" />
              ) : (
                <DemandLineChart className="h-full w-full" series={series} />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  物料供需分析 Card                                                           */
/* -------------------------------------------------------------------------- */

function MaterialSupplyCard({ projects }: { projects: Project[] }) {
  const items = useAllProjectsRelations(projects);

  /* ---- 候选物料集合（按 PN 聚合；颜色从 LINE_COLORS 循环） ---- */
  const allMaterials = useMemo(() => {
    const m = new Map<string, { pn: string; name: string }>();
    for (const it of items) {
      for (const r of it.relations) {
        if (!m.has(r.pn)) m.set(r.pn, { pn: r.pn, name: r.material_name });
      }
    }
    const list = Array.from(m.values());
    return list.map((x, i) => ({ ...x, color: LINE_COLORS[i % LINE_COLORS.length] }));
  }, [items]);

  /* ---- 默认选择：物料清单稳定后即默认全选；用户主动选择后保留 ---- */
  const allMaterialPns = useMemo(() => allMaterials.map((m) => m.pn), [allMaterials]);

  // null = 未初始化，使用"全选"回退；非 null = 用户选择（MultiSelectFilter 提交）
  // 这样避开 useState initializer + StrictMode + React Query 缓存的时序坑。
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string> | null>(null);
  const effectiveSelectedMaterials = useMemo<Set<string>>(
    () => selectedMaterials ?? new Set(allMaterialPns),
    [selectedMaterials, allMaterialPns]
  );

  /** MaterialDrawerFilter 提交回调：允许 0 个选中（0/8 → 物料区显示空态） */
  const handleMaterialsChange = (next: Set<string>) => {
    setSelectedMaterials(next);
  };

  /* ---- 派生：物料维度（每物料一行；按月聚合） ---- */
  const materialAggregates = useMemo(() => {
    // 对每个选中的物料 → 12 月的物料需求系列（demand × bom）
    // 物料需求 = Σ over (project in P, material=m) demand[p][t] × bom[p, m]
    // 取 bom：每个项目-物料对取一次（relations 任一行的 bom_factor）
    return allMaterials
      .filter((m) => effectiveSelectedMaterials.has(m.pn))
      .map((m) => {
        const demandSeries = Array(12).fill(0);
        let hasData = false;
        for (const it of items) {
          const dem = it.demand;
          if (!dem) continue;
          // 该项目下该物料的所有 relations，取首个 bom 即可（同物料 bom 一致）
          const row = it.relations.find((r) => r.pn === m.pn);
          const bom = row?.bom_factor ?? null;
          if (bom == null || bom === 0) continue;
          for (let t = 0; t < 12; t++) {
            const v = dem[t] ?? 0;
            if (v) {
              demandSeries[t] += v * bom;
              hasData = true;
            }
          }
        }
        return { ...m, demandSeries, hasData };
      })
      .filter((m) => m.hasData);
  }, [allMaterials, effectiveSelectedMaterials, items]);

  /* ---- 派生：供应商维度（按 supplier_code 聚合；按月 capacity 求和） ---- */
  const supplierAggregates = useMemo(() => {
    // 聚合维度：仅含选中的物料 × 项目下的 relation
    const acc = new Map<string, { code: string; name: string; capacitySeries: number[]; hasData: boolean }>();
    for (const it of items) {
      for (const r of it.relations) {
        if (!effectiveSelectedMaterials.has(r.pn)) continue;
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
    const list = Array.from(acc.values()).filter((s) => s.hasData);
    // 颜色循环
    return list.map((s, i) => ({ ...s, color: LINE_COLORS[i % LINE_COLORS.length] }));
  }, [items, effectiveSelectedMaterials]);

  /* ---- 派生：Supply Studio 行（按月汇总） ---- */
  const studioRows = useMemo<SupplyStudioRow[]>(() => {
    return MONTHS.map((t) => {
      // 客户需求合计：所有有数据的项目
      let customerDemand = 0;
      for (const it of items) {
        if (!it.demand) continue;
        customerDemand += it.demand[t] ?? 0;
      }
      // 物料需求合计：来自 materialAggregates[t]
      let materialDemand = 0;
      for (const m of materialAggregates) {
        materialDemand += m.demandSeries[t] ?? 0;
      }
      // 供应商产能合计：来自 supplierAggregates[t]
      let supplierCapacity = 0;
      for (const s of supplierAggregates) {
        supplierCapacity += s.capacitySeries[t] ?? 0;
      }
      return {
        monthIndex: t,
        customerDemand,
        materialDemand,
        supplierCapacity,
      };
    });
  }, [items, materialAggregates, supplierAggregates]);

  const stillLoading =
    items.some((i) => i.isLoading) && materialAggregates.length === 0 && supplierAggregates.length === 0;

  /* 空态判断：
   * - 没物料（allMaterials=0）：上层项目还没挂载任何物料关系
   * - 物料有但供需数据空（materialAggregates+supplierAggregates 都=0）：
   *   当前勾选的物料没有 demand / bom / capacity 任何数据
   * 这两种情况都进入"卡片级"空态，避免「图空 + 表满」的视觉割裂。
   */
  const hasNoMaterials = allMaterials.length === 0;
  const hasNoSupplyData = materialAggregates.length === 0 && supplierAggregates.length === 0;
  const showEmptyState = hasNoMaterials || hasNoSupplyData;

  return (
    <Card className="mt-10">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Sliders className="h-4 w-4" />
              物料供需分析（按月 · 折线 + 柱状 + Supply Studio）
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              项目/物料双维筛选；物料需求 = 客户需求 × BOM；产能按物料下所有供应商合计
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 pb-5 pt-3">
          {/* 物料多选器：右侧抽屉版（解决 20+ 物料堆砌问题）。
              即使无数据也保留入口，方便用户切换物料。 */}
          <div className="rounded-md border bg-muted/10 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">物料筛选</p>
            <MaterialDrawerFilter
              label="物料筛选"
              options={allMaterials.map((m) => ({
                value: m.pn,
                label: m.name,
                sublabel: m.pn,
                color: m.color,
              }))}
              selected={effectiveSelectedMaterials}
              onChange={handleMaterialsChange}
              previewCount={3}
              placeholder="搜索物料 PN 或名称…"
            />
          </div>

          {stillLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : effectiveSelectedMaterials.size === 0 ? (
            /* 用户主动清空物料选择（0/N）→ 显示引导空态，抽屉入口仍在上面 */
            <EmptyState
              size="md"
              icon={<PackageOpen className="h-7 w-7" />}
              title="请选择物料开始分析"
              description="在「物料筛选」勾选至少一个物料后，这里将展示物料需求与供应商产能的供需平衡"
            />
          ) : showEmptyState ? (
            <EmptyState
              size="md"
              icon={<PackageOpen className="h-7 w-7" />}
              title={hasNoMaterials ? "暂无物料关系" : "暂无物料供需数据"}
              description={
                hasNoMaterials
                  ? "请先在「供应商列表」挂载物料-供应商关系，再录入 BOM 和产能"
                  : "当前勾选的物料尚未录入客户需求或供应商产能；到「供应商列表」补录后再回来查看"
              }
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

              {/* Supply Studio */}
              <SupplyStudioTable rows={studioRows} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  项目卡片（顶部）                                                          */
/* -------------------------------------------------------------------------- */

function ProjectCard({
  project,
  onClick,
}: {
  project: Project;
  onClick: () => void;
}) {
  const { data: materials = [], isLoading: materialsLoading } = useProjectMaterials(project.id);
  const { data: relations = [], isLoading: relationsLoading } = useProjectRelations(project.id);
  const statusMeta = STATUS_META[project.status] ?? STATUS_META.active;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-stretch gap-3 rounded-lg border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm"
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

      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.chip}`}>
          {statusMeta.label}
        </span>
        {project.owner && <span className="text-xs text-muted-foreground">负责人：{project.owner}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<Boxes className="h-3.5 w-3.5" />} label="物料" value={materialsLoading ? "—" : String(materials.length)} />
        <Stat icon={<Factory className="h-3.5 w-3.5" />} label="明细行" value={relationsLoading ? "—" : String(relations.length)} />
        <Stat
          icon={<CalendarRange className="h-3.5 w-3.5" />}
          label="供应商"
          value={relationsLoading ? "—" : String(new Set(relations.map((r) => r.supplier_code)).size)}
        />
      </div>
    </button>
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
