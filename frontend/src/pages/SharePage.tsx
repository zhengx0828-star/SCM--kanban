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
  Link2,
  RefreshCcw,
  Scale,
  ShieldAlert,
  Shuffle,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { cn, getApiErrorMessage } from "@/lib/utils";
import { RISK_TYPE_FALLBACK, RISK_TYPE_LABELS, RISK_TYPE_META, type ShareRiskItem } from "@/types/share";

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
 * 顶部：预警概览（KPI 卡 × 5，口径 = 当前月份 + 当前项目）
 * 其次：项目选择（项目卡片，点击切换当前项目，上方预警随之联动）
 * 再往下：风险排行 + 四象限
 * 明细表独立页面（/share/records?project_id=&month=）——物料/项目多时避免页面过长
 *
 * ⚠️ 页面顺序是「预警框在上、项目选择在下」（2026-10-04 按要求调换过），
 *    不要把项目列表挪回 KPI 卡之前。
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

            {/* 预警概览：位置**固定**在「选择项目」之上（先看风险，再挑项目）。
                ⚠️ 无份额数据的项目也要保留这一区块（换成空态），否则整块消失、
                页面退回「选择项目在最上」的旧观感 —— 看起来就像版式没改过、彩色卡也不见了。 */}
            {projectId && list.length > 0 && activeProject && (
              <>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">预警概览</h2>
                  <Badge variant="secondary" className="font-normal">
                    当前：{activeProject.name}（{activeProject.code}）· {month}
                  </Badge>
                </div>
                {activeProject.months.length === 0 ? (
                  <EmptyState
                    className="mt-3"
                    icon={<FileUp className="h-6 w-6" />}
                    title={`项目「${activeProject.name}」暂无份额数据`}
                    description="先在份额明细录入或导入份额数据，再回来看独供 / 波动 / 偏差 / 错配四类预警"
                    action={
                      <Button onClick={goRecords}>
                        <FileUp className="mr-1.5 h-4 w-4" />
                        去录入份额
                      </Button>
                    }
                  />
                ) : (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <KpiCard label="独供物料" icon={ShieldAlert} value={summary?.sole_materials} loading={summaryLoading} tone="red"
                      onClick={() => setRiskFilter("sole")}
                      sub={summary ? `占物料总数 ${pct(summary.sole_materials, summary.total_materials)}` : undefined} />
                    <KpiCard label="份额波动预警" icon={TrendingUp} value={summary?.fluctuation_alerts} loading={summaryLoading} tone="amber"
                      onClick={() => setRiskFilter("fluctuation")} sub="相对上月变化 ≥ ±30%" />
                    <KpiCard label="建议偏差预警" icon={Scale} value={summary?.deviation_alerts} loading={summaryLoading} tone="amber"
                      onClick={() => setRiskFilter("deviation")} sub="|本月 − 上月建议| > 5pt" />
                    <KpiCard label="份额×评分错配" icon={Shuffle} value={summary?.mismatch_alerts} loading={summaryLoading} tone="violet"
                      onClick={() => setRiskFilter("mismatch")} sub="份额 ≥ 50% 但加权分 < 0.5" />
                    <KpiCard label="高粘性供应商" icon={Link2} value={summary?.sticky_suppliers} loading={summaryLoading} tone="blue" sub="当月覆盖物料 ≥ 3" />
                  </div>
                )}
              </>
            )}

            {/* 项目选择 */}
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">选择项目</h2>
                <span className="text-xs text-muted-foreground">点击切换当前项目 · 上方预警概览随之联动</span>
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

            {/* 风险排行 + 四象限（预警概览已在「选择项目」之上，这里的空态也在那边） */}
            {projectId && list.length > 0 && activeProject && activeProject.months.length > 0 && (
              <>
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
                        <span className="text-xs text-muted-foreground">红 = 独供，黄 = 波动 / 偏差，紫 = 错配</span>
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
                        {filteredRisks.map((r) => {
                          const meta = RISK_TYPE_META[r.risk_type] ?? RISK_TYPE_FALLBACK;
                          return (
                            <div
                              key={r.record_id}
                              className={`flex items-center gap-3 rounded-md px-3 py-2 ${meta.rowBg}`}
                            >
                              <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium">{r.material_name}</span>
                                  <span className="text-xs text-muted-foreground">{r.pn}</span>
                                  <Badge variant="secondary" className="shrink-0 font-normal">{r.supplier_name}</Badge>
                                </div>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.detail}</p>
                              </div>
                              <span className={`shrink-0 text-xs font-medium ${meta.text}`}>
                                {meta.label}
                              </span>
                            </div>
                          );
                        })}
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

/**
 * 预警概览 5 张卡的配色 —— 与库存页 DOH 四卡同一套视觉语言：
 * 浅色底 + 彩色边框 + 顶部色条 + 彩色数字 + 彩色图标块。
 *
 * ⚠️ 底色用**显式浅色**（`bg-red-50/70`）而不是 `bg-red-500/10`：
 *    `Card` 自带 `bg-card`，`cn`=tailwind-merge 以「后写的胜出」消解冲突，
 *    显式浅色更稳（与 `INV_DOH_BUCKET_META.cardCls` 保持一致的做法）。
 * 值恒为 0 的卡也保留配色 —— 颜色表达「这类风险的严重度」，不是「有没有风险」。
 */
const KPI_TONES = {
  red: {
    card: "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10",
    bar: "bg-red-600",
    value: "text-red-700 dark:text-red-400",
    chip: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  amber: {
    card: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/5",
    bar: "bg-amber-400",
    value: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  violet: {
    card: "border-violet-200 bg-violet-50/70 dark:border-violet-500/30 dark:bg-violet-500/5",
    bar: "bg-violet-400",
    value: "text-violet-700 dark:text-violet-400",
    chip: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  },
  blue: {
    card: "border-blue-200 bg-blue-50/70 dark:border-blue-500/30 dark:bg-blue-500/5",
    bar: "bg-blue-400",
    value: "text-blue-700 dark:text-blue-400",
    chip: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  },
} as const;

type KpiTone = keyof typeof KPI_TONES;

function KpiCard({ label, value, loading, tone, sub, icon: Icon, onClick }: {
  label: string;
  value?: number;
  loading: boolean;
  tone: KpiTone;
  sub?: string;
  icon: LucideIcon;
  onClick?: () => void;
}) {
  const t = KPI_TONES[tone];
  return (
    <Card
      className={cn("relative overflow-hidden", t.card, onClick && "cursor-pointer transition-all hover:shadow-sm")}
      onClick={onClick}
    >
      {/* 顶部色条：色觉之外的第二重编码（与库存页四卡一致） */}
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", t.bar)} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground" title={label}>{label}</p>
            {loading ? (
              <Skeleton className="mt-1.5 h-7 w-12" />
            ) : (
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", t.value)}>{value ?? 0}</p>
            )}
            {sub && <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{sub}</p>}
          </div>
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", t.chip)}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
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
