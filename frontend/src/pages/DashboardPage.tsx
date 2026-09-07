import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { FolderKanban, MapPin, Plus, RefreshCw, ShieldAlert, Timer, TrendingUp, X } from "lucide-react";
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
import { useProjectSuppliers, useProjects } from "@/hooks/use-projects";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useShareDashboardStats } from "@/hooks/use-share";
import { cn } from "@/lib/utils";
import { RISK_META, RISK_ORDER, riskKeyOf, type Supplier, type SupplierRiskKey } from "@/types/supplier";

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
  onClick?: () => void;
}

/** 除「项目/物料总数」外的演示指标（该卡在组件内实时计算） */
const BASE_STATS: StatItem[] = [
  {
    label: "库存天数 < 3 物料",
    value: "132",
    hint: "需紧急补货",
    icon: Timer,
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    label: "变更进行中",
    value: "45",
    hint: "待评审 / 执行中",
    icon: RefreshCw,
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: suppliers = [], isLoading } = useSuppliers();
  // 与「供应商列表」页共用同一接口与缓存失效键，联动刷新：
  // 项目总数 = 项目列表 total；物料总数 = 物料列表 total（物料表 PN 唯一，即不同 PN 的种数）
  const { data: projectList, isLoading: projectLoading } = useProjects({ page: 1, page_size: 1 });
  const { data: materialList, isLoading: materialLoading } = useMaterials({ page: 1, page_size: 1 });
  // Dashboard 联动：份额波动 / 重点物料独供（跨项目、最新月，与份额管理同源）
  const { data: shareStats, isLoading: shareStatsLoading } = useShareDashboardStats();
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
      ...BASE_STATS,
    ],
    [projectList?.total, materialList?.total, shareStats, navigate]
  );
  const statsLoading = projectLoading || materialLoading || shareStatsLoading;

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

            {/* 顶部统计卡（项目/物料总数为实时联动数据，其余为演示数据） */}
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
                    <p className="text-xs text-muted-foreground">{stat.hint}</p>
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
              看板统计为演示数据，待接入真实业务数据后更新。
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
