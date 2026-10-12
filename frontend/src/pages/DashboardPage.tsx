import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { FolderKanban, GitPullRequestArrow, MapPin, Plus, ShieldAlert, Timer, TrendingUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChinaMap } from "@/components/charts/ChinaMap";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { SupplierFormDialog } from "@/components/suppliers/SupplierFormDialog";
import { SupplierDetailDialog } from "@/components/suppliers/SupplierDetailDialog";
import { useMaterials } from "@/hooks/use-materials";
import { useInventoryProjectOverview } from "@/hooks/use-inventory";
import { useChangeSummary } from "@/hooks/use-changes";
import { useProjectSuppliers, useProjects } from "@/hooks/use-projects";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useShareDashboardStats } from "@/hooks/use-share";
import { cn } from "@/lib/utils";
import { RISK_META, RISK_ORDER, riskKeyOf, type Supplier, type SupplierRiskKey } from "@/types/supplier";
import type { ChangeSummary } from "@/types/change";

/**
 * Dashboard 看板页：总结性概览。
 * 顶部统计卡 → 整幅全国供应商分布地图（可缩放拖拽，红黄蓝按风险等级着色，灰=未评估）。
 * 地图带「项目切片器」：选中项目后只显示该项目下的供应商点位（数据与供应商列表联动）。
 * 「项目/物料总数」与「供应商列表」页联动：项目数 = 项目 Tab 数量；物料数 = 物料 Tab 数量（按唯一 PN 计）。
 */

/** 切片器默认值：查看全部供应商 */
const SLICE_ALL = "__all__";

interface StatItem {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  chip: string;
  /** 副标语气：有超期 → 红、只有临期 → 黄、其余灰 */
  hintTone?: "danger" | "warn";
  onClick?: () => void;
}

/**
 * 库存预警统计卡（数值来自实时接口，无演示数据）：
 * 库存天数 < 3 = 库存概览里「已断货 + 紧急」两档的推算单元数，与库存页 L0 四卡同源。
 *
 * ⚠️ 口径：这是「推算单元数」（项目×物料×供应商×基地），**不是按 PN 去重的物料数**
 *    （库存塔底「物料数」才是 PN 口径），所以卡名里不带「物料」二字。
 *
 * 可点击跳转库存管理：带 `bucket=stockout,urgent`（库存页 bucket 支持逗号多档），
 * 否则卡上数字与列表行数会对不上。必须同时带 `project`：库存页 L1 只在「已选项目」时渲染，
 * 只带 bucket 会落到 L0 空视图。这里只带「确实有该档行」的项目。
 */
function buildUrgentInventoryStat(
  urgentUnits: number,
  urgentProjectIds: string,
  goInventory: (bucket: string, projectIds: string) => void
): StatItem {
  return {
    label: "库存天数 < 3",
    value: urgentUnits.toLocaleString(),
    hint: "已断货 / 紧急，需立即补货 · 点击查看明细",
    icon: Timer,
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    onClick: () => goInventory("stockout,urgent", urgentProjectIds),
  };
}

/**
 * 变更进行中 —— Dashboard 卡 5（方案乙，变更管理模块已上线）。
 *
 * 大数字 = **进行中的变更单数**；副标 = 「超期 N · 临期 M」，有超期时整行变红。
 * 数据源与变更页页头同源（`/api/changes/summary`），所以点进去数字和列表对得上。
 *
 * 跳转去向：超期或临期任一 > 0 → 变更页并带上 `?risk=overdue,near`（两者一起筛）；
 * 都为 0 → 直接进变更页（不带着一个空筛选落地）。
 *
 * 注意：值为 0 时写「暂无变更」，**不要**写「无法评估 / 暂无数据」——那是数据缺失的语义。
 */
function buildChangesStat(summary: ChangeSummary | undefined, goChanges: () => void): StatItem {
  const active = summary?.active ?? 0;
  const overdue = summary?.overdue_changes ?? 0;
  const near = summary?.near_changes ?? 0;
  const empty = active === 0 && overdue === 0 && near === 0;
  return {
    label: "变更进行中",
    value: active.toLocaleString(),
    hint: empty ? "暂无变更" : `超期 ${overdue} · 临期 ${near} · 点击查看`,
    hintTone: overdue > 0 ? "danger" : near > 0 ? "warn" : undefined,
    icon: GitPullRequestArrow,
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    onClick: goChanges,
  };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: suppliers = [], isLoading } = useSuppliers();
  // 与「供应商列表」页共用同一接口与缓存失效键，联动刷新：
  // 项目总数 = 项目列表 total；物料总数 = 物料列表 total（物料表 PN 唯一，即不同 PN 的种数）
  const { data: projectList, isLoading: projectLoading } = useProjects({ page: 1, page_size: 1 });
  const { data: materialList, isLoading: materialLoading } = useMaterials({ page: 1, page_size: 1 });
  // Dashboard 联动：份额波动 / 重点物料独供（跨项目、最新月，与份额管理同源）
  const { data: shareStats, isLoading: shareStatsLoading } = useShareDashboardStats();
  // 库存概览：用于「库存天数 < 3」这张卡（与库存页同源，实时口径）
  const { data: projectOverview, isLoading: overviewLoading } = useInventoryProjectOverview();
  // 变更统计：用于「变更进行中」这张卡（与变更页页头同源）
  const { data: changeSummary, isLoading: changeSummaryLoading } = useChangeSummary();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);
  /* 地图取点录入：pickMode = 取点模式；preset = 最近一次取点的省份 + 坐标（打开弹窗时预填） */
  const [pickMode, setPickMode] = useState(false);
  const [preset, setPreset] = useState<{ city: string; longitude: number; latitude: number } | null>(null);

  /* Esc 取消取点模式 */
  useEffect(() => {
    if (!pickMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode]);

  /** 打开「录入供应商」弹窗（普通模式：不带取点预填） */
  const openPlainForm = () => {
    setPickMode(false);
    setPreset(null);
    setFormOpen(true);
  };

  /** 地图取点成功：带出省份 + 坐标并打开录入弹窗 */
  const handleMapPick = (pt: { longitude: number; latitude: number; province: string }) => {
    setPickMode(false);
    setPreset({ city: pt.province, longitude: pt.longitude, latitude: pt.latitude });
    setFormOpen(true);
  };

  /* ---- 地图项目切片器 ---- */
  // 切片器项目列表（page_size=100，与供应商列表「项目」Tab 同源联动）
  const { data: sliceProjectList } = useProjects({ page: 1, page_size: 100 });
  const [sliceProjectId, setSliceProjectId] = useState<string>(SLICE_ALL);
  // 选中项目 → 拉该项目下供应商（含地图点位字段，后端 /api/projects/{id}/suppliers）
  const {
    data: projectSuppliers = [],
    isLoading: projectSuppliersLoading,
  } = useProjectSuppliers(sliceProjectId === SLICE_ALL ? null : Number(sliceProjectId));

  const mapSuppliers = sliceProjectId === SLICE_ALL ? suppliers : projectSuppliers;
  const mapLoading = sliceProjectId === SLICE_ALL ? isLoading : projectSuppliersLoading;

  const sliceProject = useMemo(
    () => (sliceProjectId === SLICE_ALL ? undefined : sliceProjectList?.items.find((p) => String(p.id) === sliceProjectId)),
    [sliceProjectId, sliceProjectList]
  );
  const sliceLabel = sliceProject
    ? `${sliceProject.code} · ${sliceProject.name}（${mapSuppliers.length} 家供应商）`
    : `全部供应商（${mapSuppliers.length}）`;

  /** 当前地图展示供应商的风险等级（含未评估）分布 */
  const riskCounts = useMemo(() => {
    const counts: Record<SupplierRiskKey, number> = { red: 0, yellow: 0, green: 0, none: 0 };
    for (const s of mapSuppliers) counts[riskKeyOf(s.risk_level)] += 1;
    return counts;
  }, [mapSuppliers]);

  /* 库存概览聚合：「已断货 + 紧急」（需立刻补货）的推算单元数。
     与库存页 L0 四卡墙同源（按 project-overview 的 doh_buckets 汇总）。
     ⚠️ 口径是「推算单元数」（项目×物料×供应商×基地），并非按 PN 去重。
     同时收集「有该档行的项目 id」与「全部项目 id」，供点击跳转时带上 —— 保证跳过去后行数 == 卡上数字。 */
  const { urgentUnits, urgentProjectIds, allProjectIds } = useMemo(() => {
    let urgent = 0;
    const urgentIds: number[] = [];
    const allIds: number[] = [];
    for (const p of projectOverview ?? []) {
      const b = p.doh_buckets ?? {};
      const u = (b.stockout ?? 0) + (b.urgent ?? 0);
      urgent += u;
      allIds.push(p.project_id);
      if (u > 0) urgentIds.push(p.project_id);
    }
    return {
      urgentUnits: urgent,
      urgentProjectIds: urgentIds.join(","),
      allProjectIds: allIds.join(","),
    };
  }, [projectOverview]);

  /**
   * 跳转库存管理：带「项目 + DOH 档位」两件套。
   * - 库存页 L1 只在「已选项目」时渲染，**只带 bucket 会落到 L0 空视图**，所以项目必带。
   * - 命中项目优先（跳过去行数 == 卡上数字）；一档都没命中时退回全部项目，
   *   让落地页显示「该档没有推算单元」的空态，而不是回到项目墙。
   */
  const goInventory = useCallback(
    (bucket: string, projectIds: string) => {
      const ids = projectIds || allProjectIds;
      navigate(ids ? `/inventory?project=${ids}&bucket=${bucket}` : "/inventory");
    },
    [navigate, allProjectIds]
  );

  /**
   * 跳转变更管理（用户口径 2026-10-05）：**超期 + 临期（3 天内到期）都算「要盯的」**，
   * 点卡就一起带进筛选，落地即可看到需要处理的那批单。
   * 两者都为 0 时不带筛选 —— 否则进去是个空筛选列表，比不筛更让人困惑。
   * 参数名与变更页一致：`?risk=overdue,near`（逗号多选，前端 `matchRisk` 逐项 or）。
   */
  const goChanges = useCallback(() => {
    const overdue = changeSummary?.overdue_changes ?? 0;
    const near = changeSummary?.near_changes ?? 0;
    if (overdue === 0 && near === 0) {
      navigate("/changes");
      return;
    }
    const risks = [overdue > 0 ? "overdue" : null, near > 0 ? "near" : null].filter(Boolean).join(",");
    navigate(`/changes?risk=${risks}`);
  }, [navigate, changeSummary]);

  const stats = useMemo<StatItem[]>(
    () => [
      {
        label: "项目/物料总数",
        value: `${(projectList?.total ?? 0).toLocaleString()} / ${(materialList?.total ?? 0).toLocaleString()}`,
        hint: "在管项目 / 物料种类",
        icon: FolderKanban,
        chip: "bg-primary/10 text-primary",
      },
      {
        label: "份额波动物料",
        value: (shareStats?.fluctuation_materials ?? 0).toLocaleString(),
        hint: shareStats?.month ? `${shareStats.month} 波动：相对上月变化 ≥ ±30%` : "暂无份额数据",
        icon: TrendingUp,
        chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        onClick: () =>
          navigate(shareStats?.month ? `/share?risk=fluctuation&month=${shareStats.month}` : "/share"),
      },
      {
        label: "重点物料独供数量",
        value: (shareStats?.sole_materials ?? 0).toLocaleString(),
        hint: shareStats?.month ? `${shareStats.month} 独供物料` : "暂无份额数据",
        icon: ShieldAlert,
        chip: "bg-red-500/10 text-red-600 dark:text-red-400",
        onClick: () =>
          navigate(shareStats?.month ? `/share?risk=sole&month=${shareStats.month}` : "/share"),
      },
      buildUrgentInventoryStat(urgentUnits, urgentProjectIds, goInventory),
      buildChangesStat(changeSummary, goChanges),
    ],
    [
      projectList?.total,
      materialList?.total,
      shareStats,
      urgentUnits,
      urgentProjectIds,
      goInventory,
      changeSummary,
      navigate,
    ]
  );
  const statsLoading =
    projectLoading || materialLoading || shareStatsLoading || overviewLoading || changeSummaryLoading;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />

        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-6xl">
            {/* 页头 */}
            <section id="overview" className="scroll-mt-20">
              <h1 className="text-4xl font-semibold tracking-tight">Dashboard</h1>
              <p className="mt-2 text-muted-foreground">
                供应链整体态势总览：关键指标、供应商分布与待办事项。
              </p>
            </section>

            {/* 顶部统计卡：五张全部为实时联动数据（变更进行中已接入变更管理模块） */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {stats.map((stat) => (
                <Card
                  key={stat.label}
                  className={stat.onClick ? "cursor-pointer transition-colors hover:border-primary/50" : undefined}
                  onClick={stat.onClick}
                >
                  <CardContent className="flex flex-col gap-2 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{stat.label}</span>
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", stat.chip)}>
                        <stat.icon className="h-4 w-4" />
                      </span>
                    </div>
                    {statsLoading ? (
                      <Skeleton className="h-7 w-24" />
                    ) : (
                      <p className="text-2xl font-semibold tracking-tight tabular-nums">{stat.value}</p>
                    )}
                    <p
                      className={cn(
                        "text-xs",
                        stat.hintTone === "danger"
                          ? "font-medium text-red-600 dark:text-red-400"
                          : stat.hintTone === "warn"
                            ? "font-medium text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {stat.hint}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 全国供应商分布地图（整幅占满） */}
            <div className="mt-6">
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">全国供应商分布</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {sliceLabel} · 点击点位查看详情 · 红黄蓝按风险等级着色（灰=未评估）
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* 项目切片器：选择项目 → 地图只显示该项目供应商 */}
                      <Select value={sliceProjectId} onValueChange={setSliceProjectId}>
                        <SelectTrigger className="w-44">
                          <SelectValue placeholder="选择项目" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SLICE_ALL}>全部供应商</SelectItem>
                          {sliceProjectList?.items.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.code} · {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {mapLoading ? (
                        <Skeleton className="h-6 w-28" />
                      ) : (
                        <div className="flex items-center gap-2">
                          {RISK_ORDER.map((risk) => (
                            <Badge key={risk} variant="outline" className="gap-1 px-2 py-0.5 text-xs font-normal">
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: RISK_META[risk].color }} />
                              {riskCounts[risk]}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant={pickMode ? "default" : "outline"}
                        onClick={() => {
                          setFormOpen(false);
                          setPickMode((v) => !v);
                        }}
                      >
                        <MapPin className="mr-1.5 h-4 w-4" />
                        地图选点
                      </Button>
                      <Button size="sm" onClick={openPlainForm}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        录入供应商
                      </Button>
                    </div>
                  </div>
                  <div className="relative h-[600px] p-2 sm:h-[680px]">
                    {/* 取点模式提示条 */}
                    {pickMode && (
                      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
                        <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-xs shadow-sm">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                          点击地图选择供应商所在位置，自动带出省份与坐标
                          <button
                            type="button"
                            aria-label="取消选点"
                            onClick={() => setPickMode(false)}
                            className="rounded p-0.5 transition-colors hover:bg-muted"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                    <ChinaMap
                      className="h-full w-full"
                      // 取点模式下隐藏供应商散点：避免点位遮住目标区域/点击散点无响应，取点更清爽
                      suppliers={pickMode ? [] : mapSuppliers}
                      pickMode={pickMode}
                      onSupplierClick={(s) => setSelected(s)}
                      onMapPick={handleMapPick}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 页脚提示 */}
            <p className="mt-6 text-center text-xs text-muted-foreground">
              本页统计均与各业务模块实时同源；地图仅展示已录入的供应商点位。
            </p>
          </div>
        </main>
      </div>

      {/* 录入弹窗：选了项目时，候选供应商限定为该项目下已挂载的；地图选点后自动预填省份/坐标 */}
      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} project={sliceProject ?? null} preset={preset} />
      {/* 点位详情弹窗 */}
      <SupplierDetailDialog supplier={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
