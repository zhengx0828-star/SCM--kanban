import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarRange,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FileUp,
  Inbox,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { ShareQuadrantChart } from "@/components/share/ShareQuadrantChart";
import {
  useRolloverShare,
  useShareDashboardStats,
  useShareProjects,
  useShareQuadrant,
  useShareRisks,
  useShareSummary,
} from "@/hooks/use-share";
import { getApiErrorMessage } from "@/lib/utils";
import { RISK_TYPE_LABELS, type ShareRiskItem } from "@/types/share";

/** 当前月份（YYYY-MM） */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 可用的月份列表：当前月往前推 12 个月 */
function monthOptions(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** 风险筛选：全部 或 某一风险类型（与后端 risk_type 对齐） */
type RiskFilter = "all" | ShareRiskItem["risk_type"];

const RISK_FILTERS: { value: RiskFilter; label: string }[] = [
  { value: "all", label: "全部风险" },
  { value: "sole", label: "独供" },
  { value: "fluctuation", label: "波动" },
  { value: "deviation", label: "偏差" },
  { value: "mismatch", label: "错配" },
];

/** 校验 URL 里的 risk 参数是否为合法风险类型 */
function parseRiskFilter(value: string | null): RiskFilter {
  return value && RISK_FILTERS.some((f) => f.value === value) ? (value as RiskFilter) : "all";
}

/**
 * 份额管理 · 项目入口页。
 *
 * 顶部：项目列表（有份额数据的项目卡片，点击进入该项目视图）
 * 选中项目后：月份切换 + KPI 卡 + 风险排行 + 四象限
 * 明细表独立页面（/share/records?project_id=&month=）——物料/项目多时避免页面过长
 */
export default function SharePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(() => searchParams.get("month") ?? currentMonth());
  const riskFromUrl = searchParams.get("risk");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>(() => parseRiskFilter(riskFromUrl));

  // 项目选择：URL ?project_id= 优先，否则第一个项目
  const { data: projects, isLoading: projectsLoading } = useShareProjects();
  const list = projects ?? [];

  // 项目卡片风险标注（与 Dashboard 同源，跨项目最新月，复用缓存无额外请求）
  const { data: shareDashboard } = useShareDashboardStats();

  const urlProjectId = searchParams.get("project_id");
  const [selected, setSelected] = useState<number | null>(() => (urlProjectId ? Number(urlProjectId) : null));

  // 从 Dashboard 带 risk 进入时，自动定位到第一个有该风险类型的项目
  useEffect(() => {
    if (selected != null || projectsLoading) return;
    const r = parseRiskFilter(riskFromUrl);
    if (r !== "fluctuation" && r !== "sole") return;
    const briefs = shareDashboard?.by_project;
    const target = briefs?.find((b) =>
      r === "fluctuation" ? b.fluctuation_materials > 0 : b.sole_materials > 0
    );
    if (target) setSelected(target.project_id);
  }, [riskFromUrl, selected, projectsLoading, shareDashboard]);

  const projectId = selected ?? list[0]?.project_id ?? null;
  const activeProject = list.find((p) => p.project_id === projectId);

  const { data: summary, isLoading: summaryLoading } = useShareSummary(projectId, month);
  const { data: risks, isLoading: risksLoading } = useShareRisks(projectId, month, 100);
  const { data: quadrant } = useShareQuadrant(projectId, month);
  const rolloverMutation = useRolloverShare();
  const options = useMemo(() => monthOptions(), []);

  // 按风险筛选过滤风险排行
  const filteredRisks = useMemo(() => {
    if (!risks) return risks;
    if (riskFilter === "all") return risks;
    return risks.filter((r) => r.risk_type === riskFilter);
  }, [risks, riskFilter]);

  const handleRollover = () => {
    if (!projectId) return;
    const next = nextMonth(month);
    if (!window.confirm(`确认将 ${month} 的份额数据结转到 ${next}（生成下月空档）？`)) return;
    rolloverMutation.mutate(
      { projectId, fromMonth: month, toMonth: next },
      {
        onSuccess: () => {
          toast.success(`已结转至 ${next}`);
          setMonth(next);
        },
        onError: (err) => toast.error(getApiErrorMessage(err)),
      }
    );
  };

  const goRecords = () => {
    if (!projectId) return;
    navigate(`/share/records?project_id=${projectId}&month=${month}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight">份额管理</h1>
                <p className="mt-2 max-w-3xl text-muted-foreground">
                  按项目、按月快照各物料 × 供应商的份额与 QDC 评分，自动计算建议配额并识别独供 / 波动 / 偏差风险。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="w-36">
                    <CalendarRange className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={goRecords} disabled={!projectId}>
                  <ClipboardList className="mr-1.5 h-4 w-4" />
                  份额明细
                </Button>
                <Button variant="outline" onClick={handleRollover} disabled={!projectId || rolloverMutation.isPending}>
                  <RefreshCcw className={`mr-1.5 h-4 w-4 ${rolloverMutation.isPending ? "animate-spin" : ""}`} />
                  月末结转
                </Button>
              </div>
            </div>

            {/* 项目列表 */}
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">选择项目</h2>
                {activeProject && (
                  <Badge variant="secondary" className="font-normal">
                    当前：{activeProject.name}（{activeProject.code}）
                  </Badge>
                )}
              </div>
              {projectsLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
              ) : list.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-6 w-6" />}
                  title="暂无份额数据"
                  description="先在「份额明细」页面为项目录入或导入份额数据，再回来查看风险视图"
                  action={
                    <Button onClick={() => navigate("/share/records")}>
                      <FileUp className="mr-1.5 h-4 w-4" />
                      去录入份额
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((p) => {
                    const hasData = p.months.length > 0;
                    const brief = shareDashboard?.by_project?.find((b) => b.project_id === p.project_id);
                    return (
                      <button
                        key={p.project_id}
                        type="button"
                        onClick={() => setSelected(p.project_id)}
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          p.project_id === projectId
                            ? "border-primary bg-accent/40"
                            : "border-border hover:border-primary/40 hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{p.code}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {hasData
                            ? `${p.months.length} 个月有数据 · 最新 ${p.months[p.months.length - 1]}`
                            : "暂无数据 · 点此进入录入"}
                        </p>
                        {brief && (brief.fluctuation_materials > 0 || brief.sole_materials > 0) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {brief.fluctuation_materials > 0 && (
                              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                波动 {brief.fluctuation_materials}
                              </span>
                            )}
                            {brief.sole_materials > 0 && (
                              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                独供 {brief.sole_materials}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 选中项目后的 KPI + 风险 + 四象限 */}
            {projectId && list.length > 0 && activeProject && activeProject.months.length === 0 ? (
              <EmptyState
                className="mt-8"
                icon={<FileUp className="h-7 w-7" />}
                title={`项目「${activeProject.name}」暂无份额数据`}
                description="点击下方「去录入」进入份额明细，手动录入或 Excel 导入首批份额数据"
                action={
                  <Button onClick={goRecords}>
                    <FileUp className="mr-1.5 h-4 w-4" />
                    去录入份额
                  </Button>
                }
              />
            ) : projectId && list.length > 0 && (
              <>
                {/* KPI 卡 × 4 */}
                <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="独供物料" value={summary?.sole_materials} loading={summaryLoading} tone="red"
                    sub={summary ? `占物料总数 ${pct(summary.sole_materials, summary.total_materials)}` : undefined} />
                  <KpiCard label="份额波动预警" value={summary?.fluctuation_alerts} loading={summaryLoading} tone="amber" sub="|本月 − 上期| ≥ 30pt" />
                  <KpiCard label="建议偏差预警" value={summary?.deviation_alerts} loading={summaryLoading} tone="amber" sub="|本月 − 上月建议| > 5pt" />
                  <KpiCard label="高粘性供应商" value={summary?.sticky_suppliers} loading={summaryLoading} tone="blue" sub="当月覆盖物料 ≥ 3" />
                </div>

                {/* 风险排行 */}
                <Card className="mt-6">
                  <CardContent className="p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <h2 className="text-sm font-medium">风险排行</h2>
                        <Badge variant="secondary" className="font-normal">
                          {filteredRisks?.length ?? 0} 条
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as RiskFilter)}>
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RISK_FILTERS.map((f) => (
                              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">红 = 高优先级，黄 = 关注</span>
                      </div>
                    </div>
                    {risksLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                      </div>
                    ) : !risks || risks.length === 0 ? (
                      <EmptyState
                        size="sm"
                        icon={<CircleAlert className="h-6 w-6" />}
                        title="本月暂无风险预警"
                        description="该项目该月没有独供 / 波动 / 偏差 / 错配记录"
                      />
                    ) : !filteredRisks || filteredRisks.length === 0 ? (
                      <EmptyState
                        size="sm"
                        icon={<CircleAlert className="h-6 w-6" />}
                        title={`${RISK_TYPE_LABELS[riskFilter as ShareRiskItem["risk_type"]]} 暂无风险`}
                        description="可切换上方风险筛选查看其他类型"
                      />
                    ) : (
                      <div className="space-y-2">
                        {filteredRisks.map((r) => (
                          <div
                            key={r.record_id}
                            className={`flex items-center gap-3 rounded-md px-3 py-2 ${
                              r.risk_level === "high"
                                ? "bg-red-500/10"
                                : "bg-amber-500/10"
                            }`}
                          >
                            <span className={`h-2 w-2 shrink-0 rounded-full ${r.risk_level === "high" ? "bg-red-500" : "bg-amber-500"}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium">{r.material_name}</span>
                                <span className="text-xs text-muted-foreground">{r.pn}</span>
                                <Badge variant="secondary" className="shrink-0 font-normal">{r.supplier_name}</Badge>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.detail}</p>
                            </div>
                            <span className={`shrink-0 text-xs font-medium ${
                              r.risk_level === "high"
                                ? "text-red-600 dark:text-red-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}>
                              {RISK_TYPE_LABELS[r.risk_type]}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* 四象限 */}
                <Card className="mt-6">
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-medium">份额 × 评分四象限</h2>
                      <span className="text-xs text-muted-foreground">
                        横轴 = 份额%，纵轴 = 加权分；点大小 = 基地拉线数量；红色 = 独供
                      </span>
                    </div>
                    <ShareQuadrantChart points={quadrant ?? []} loading={!quadrant} />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  子组件 / 工具                                                               */
/* -------------------------------------------------------------------------- */

function KpiCard({ label, value, loading, tone, sub }: {
  label: string;
  value?: number;
  loading: boolean;
  tone: "red" | "amber" | "blue";
  sub?: string;
}) {
  const color = tone === "red"
    ? "text-red-600 dark:text-red-400"
    : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : "text-blue-600 dark:text-blue-400";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-12" />
        ) : (
          <p className={`mt-1 text-2xl font-medium ${color}`}>{value ?? 0}</p>
        )}
        {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function pct(a: number | undefined, b: number | undefined): string {
  if (!a || !b) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
