import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Download,
  FileUp,
  Inbox,
  ListChecks,
  PieChart,
  Plus,
  Search,
  Settings2,
  TrendingDown,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { BurndownChart } from "@/components/changes/BurndownChart";
import { ChangeAlertTable } from "@/components/changes/ChangeAlertTable";
import { ChangeDetailSheet } from "@/components/changes/ChangeDetailSheet";
import { ChangeDeviationRank } from "@/components/changes/ChangeDeviationRank";
import { ChangeDonutChart } from "@/components/changes/ChangeDonutChart";
import { ChangeFormDialog } from "@/components/changes/ChangeFormDialog";
import { ChangeImportDialog } from "@/components/changes/ChangeImportDialog";
import { ChangeInsight } from "@/components/changes/ChangeInsight";
import { ChangeListTable } from "@/components/changes/ChangeListTable";
import { ChangeOverdueDepth } from "@/components/changes/ChangeOverdueDepth";
import { ChangeTypeDialog } from "@/components/changes/ChangeTypeDialog";
import { GanttChart, type GanttTask } from "@/components/changes/GanttChart";
import { ProjectChangeCard } from "@/components/changes/ProjectChangeCard";
import {
  changeKeys,
  useArchiveProject,
  useChangeAlerts,
  useChangeBurndown,
  useChangeProjectOverview,
  useChanges,
  useChangeSummary,
  useUnarchiveProject,
} from "@/hooks/use-changes";
import { changeApi } from "@/lib/api";
import { useProjects } from "@/hooks/use-projects";
import { cn, getApiErrorMessage } from "@/lib/utils";
import type { Change, ChangeDetail, ChangeProjectOverview, ChangeTaskNode, TaskState } from "@/types/change";
import { TASK_STATE_OPEN, TASK_STATE_ORDER, taskStateMeta } from "@/types/change";

/**
 * 变更管理主页面（两层结构，沿用库存页的 L0 / L1 交互习惯）
 *
 *  L0 项目视图 —— 老板视角。**主页三块 + 分析视图三块**（2026-10-06 第三次重排）：
 *
 *   ┌ 固定顶部区（吸顶 · 永不折叠 · 永不下移）= 标题栏 + 统计卡 ×5
 *   │    「有多少活、多少在着火」—— 老板的"整体情况"，滚到哪儿都看得见
 *   ├ ① 项目卡片墙（导航层）      「有哪些项目 / 哪个项目有问题、多严重」
 *   ├ ② 构成三视图（三饼并列）    「任务构成 / 类型分布 / 项目分布」—— 一眼看出结构
 *   └ ③ 变更分析（一行入口 →）    待办跟进 · 整体趋势 · 偏差回归
 *
 *  变更分析视图（`?view=analysis`，同页切换、不新建路由）—— 执行层与复盘层：
 *   ├ 最需要盯的待办项（谁 · 哪张单 · 拖几天）
 *   ├ 整体燃尽图
 *   └ 深度分析（偏差榜 + 超期时长分档）
 *  这三块在里面**常显不折叠**（进来就是看细节的），而且在主页一个都没删 —— 只是换了位置。
 *
 *  ★ 分层判据（2026-10-06 用户钦定）：
 *    一块内容里**有「人」和「日期」**（责任人 / 执行工程师 / 任务名 / 计划时间 / 超期天数）
 *      → **执行层** → 折起来（团队自己要看的，一条不删）
 *    只有「多少 / 哪些 / 什么状态」→ **老板层** → 留第一屏
 *    边界：「项目负责人」算老板层；**任务执行工程师**算执行层（老板不点这个名）。
 *
 *  ★ 两个受众**不混在一屏**：老板层在主页、执行层进分析视图，靠**位置**分级，
 *    不靠删内容 —— 所有块一个不删。
 *    ★ 本轮唯一一次"动了呈现"是用户钦定的：五色堆叠条 → 饼图（与另两张饼同构），
 *      因为三张饼并排要求"整体美观"，横条与饼混排不齐。
 *
 *  ★ 顶部固定区的吸顶只在 lg+ 生效：390px 上统计卡是 2 列 × 3 行 ≈200px，
 *    再叠标题接近 1/3 屏，吸顶会把正文压没；手机上保证"排在最上面"即可。
 *
 *  ★ 首页设计三条纪律：
 *    1. **每张图标题下必带一句「由数据算出」的结论** —— 老板不必读图，读一行字即可。
 *       文字在 useMemo 里拼，不是写死话术。
 *    2. **每张图的数据都要"标好"**：图例（名称 + 值 + 百分比）、圆心（总数 + 单位）、
 *       hover tooltip（名称 + 值 + 单位 + 百分比）三处都给，不往扇区塞引线标签
 *       （三张饼并排后每张只剩 ~363px，标签会糊成一团）。
 *    3. **指标只有一个值时用文字，有结构时才用图**（超期分档不足 3 档自动降级为文字）。
 *
 *  ★ 数据保真：所有图只画库里已有的数，不推算、不补假点。没有数据给空态，不编结论。
 *
 *  L1 项目视图 —— 选中项目后展开：预警条 → 统计卡 → 合并甘特图 → 燃尽图 → 变更单列表。
 *  L2 详情抽屉 —— 一张单的三个 Tab（基本信息 / 甘特图 / 任务清单）。
 *
 *  ★ 模块灵魂「承诺兑现」：进度**按时间自动算**（时间是标尺），勾选是人给的答案，
 *   两者之差 = 偏差。五色状态（蓝/黄/红/绿/橙）全部由后端派生，前端只渲染。
 *
 * 状态全部走 URL query（可分享 / 可刷新保留）：
 *   ?project=3&risk=overdue&by=owner&c=12&alerts=flat&metric=tasks&view=analysis&type=2
 *   - project 有值 → L1 项目视图；空 → L0（主页 / 分析视图）
 *   - view=analysis → L0 分析视图（待办项 / 燃尽图 / 深度分析）；空 → L0 主页
 *   - risk      → overdue / near / late（统计卡与预警条点击写入）
 *                 ★ 在 L0 下它会**自动进入分析视图** —— 超期/临期明细（待办项）住在那里，
 *                   否则"点了卡片页面没反应" = 假死。
 *   - by=owner  → L1 右上角「按责任人」聚合视图（不占大头）
 *   - c         → 打开哪张变更单的详情抽屉
 *   - alerts    → flat = 待办项按严重度平铺（默认 group 三级分组）
 *   - metric    → 项目饼图口径 changes(默认) / tasks / overdue
 *   - type      → 卡片墙按变更类型过滤（类型饼图扇区点击写入）
 *   - todos / trend / deep → **已废弃**（三个折叠参数随内容迁入 `view=analysis`）；
 *                            仍读它们是**兼容旧链接**，见 `analysisOpen` 的说明。
 */

const CARD_PAGE_SIZE = 12;
/** L0 待办项只展示最紧急的若干条（按整组保留，不切断分组） */
const GLOBAL_ALERT_LIMIT = 8;

const RISK_LABEL: Record<string, string> = { overdue: "超期", near: "临期", late: "迟交" };

type ProjectMetric = "changes" | "tasks" | "overdue";

const METRIC_LABEL: Record<ProjectMetric, string> = {
  changes: "变更单数",
  tasks: "待办项数",
  overdue: "超期项数",
};

/* ------------------------------------------------------------------ 工具 */

/** 层级整体下移 delta —— 合并甘特图里「变更单块」占第 1 层，任务树要顺延 */
function shiftLevel(t: ChangeTaskNode, delta: number): GanttTask {
  return {
    ...t,
    level: t.level + delta,
    children: (t.children ?? []).map((c) => shiftLevel(c, delta)),
  };
}

/** 与后端 `/api/changes` 的 risk 过滤口径保持一致（前端做同一件事，省一次请求） */
function matchRisk(c: Change, risk: string): boolean {
  if (!risk) return true;
  const set = new Set(risk.split(",").map((s) => s.trim()).filter(Boolean));
  if (set.has("overdue") && c.overdue_leaf > 0) return true;
  if (set.has("near") && c.near_leaf > 0) return true;
  if (set.has("late") && c.late_leaf > 0) return true;
  if (set.has("done") && c.status === "done") return true;
  return false;
}

interface StatTileProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "red" | "amber" | "blue" | "emerald";
  onClick?: () => void;
  active?: boolean;
}

/** 统计卡顶部色条（对齐库存 DohBucketCards / 供需 KpiCard 的「顶部 3px 色条」基准） */
const STAT_TONE_BAR: Record<string, string> = {
  default: "bg-slate-400",
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
};

function StatTile({ label, value, hint, tone = "default", onClick, active }: StatTileProps) {
  const bar = STAT_TONE_BAR[tone] ?? STAT_TONE_BAR.default;
  return (
    <Card
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "relative gap-0 px-3.5 py-3 text-left transition-all",
        onClick && "cursor-pointer hover:shadow-sm",
        active && "bg-accent/40 ring-2 ring-primary ring-offset-1",
        !onClick && "cursor-default"
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", bar)} />
      <p className="truncate text-xs text-muted-foreground" title={label}>{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground" title={hint}>{hint}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ 页面 */

export default function ChangesPage() {
  const [sp, setSp] = useSearchParams();

  const projectId = sp.get("project") ?? "";
  const hasProject = projectId !== "";
  const pid = Number(projectId) || null;

  const archivedTab = sp.get("archived") === "1";
  const risk = sp.get("risk") ?? "";
  const q = sp.get("q") ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const byOwner = sp.get("by") === "owner";
  /** 作废的单默认隐藏（验收清单 #19），要看得手动打开 */
  const showVoided = sp.get("voided") === "1";
  const changeParam = Number(sp.get("c") ?? "0") || null;
  /** L0 待办项：group = 三级分组（默认）· flat = 按严重度平铺 */
  const alertsFlat = sp.get("alerts") === "flat";
  /** 项目饼图口径 */
  const metricRaw = sp.get("metric") ?? "changes";
  const metric: ProjectMetric = (
    ["changes", "tasks", "overdue"] as ProjectMetric[]
  ).includes(metricRaw as ProjectMetric)
    ? (metricRaw as ProjectMetric)
    : "changes";
  /** 卡片墙按变更类型过滤（类型饼图下钻） */
  const typeFilter = Number(sp.get("type") ?? "0") || null;

  /**
   * 分析视图是否呈现（`?view=analysis`）—— 待办项 / 整体燃尽图 / 深度分析都住在这里。
   *
   * ★ 兼容旧链接：`todos` / `trend` / `deep` 三个折叠参数的内容已随本次重排迁入本视图。
   *   收到其中任何一个（或带 `risk` 筛选进来 —— L0 下 `risk` 唯一的用处就是筛待办项）
   *   就**在渲染上**进入分析视图 → 老书签 / 老链接 / 旧验收脚本不会"点开一片空白"
   *   （这是上一轮"假死"教训的同款：入口写了参数，但内容已经不在那个位置）。
   *   ★ 这里**只改渲染、不写 URL**：所以「返回项目总览」不会被残留参数拽回来。
   *   （若改用 useEffect 改写 URL，返回时 `risk` 还在 → 立刻被弹回分析视图 = 返回按钮假死。）
   */
  const analysisOpen =
    !hasProject &&
    (sp.get("view") === "analysis" ||
      sp.get("todos") === "1" ||
      sp.get("trend") === "1" ||
      sp.get("deep") === "1" ||
      risk !== "");

  const [typeOpen, setTypeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ChangeProjectOverview | null>(null);

  const patch = useCallback(
    (p: Record<string, string | null>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(p)) {
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

  /* --------------------------------------------------------------- 数据 */

  const summaryQ = useChangeSummary();
  // 一次取「含已归档」的全量项目，两个 Tab 都在前端切（省一次请求）
  const overviewQ = useChangeProjectOverview(true);

  const archiveProject = useArchiveProject();
  const unarchiveProject = useUnarchiveProject();

  // L0「最需要盯的待办项」：**默认只取超期 + 临期，不含迟交完成**。
  //   ★ 原因：迟交完成是"已经做完了、只是晚了"，它没有可执行的动作，不是"待处理"。
  //     带上它会让口径自相矛盾 —— 统计卡说超期 6 + 临期 4 = 10 项，表格却说 21 项，
  //     同一页出现两个数，老板第一眼就会怀疑数据。
  //     显式带 risk=late 时（从别处跳进来）仍然尊重，交给后端 level 过滤。
  const alertLevel = risk || "overdue,near";
  const globalAlertsQ = useChangeAlerts(undefined, alertLevel);

  // L0 整体燃尽图：三个参数都不传 = 全局口径（不含归档与作废）
  const globalBurndownQ = useChangeBurndown({}, !hasProject);

  // L1：当前项目
  // project-overview 只包含「有变更单」的项目，所以项目名要另找一份兜底
  // （同一个 queryKey 与 Dashboard 的项目列表共用缓存，不会多打请求）
  const projectsQ = useProjects({ page: 1, page_size: 100 });
  const projectMeta = useMemo(
    () => (pid == null ? undefined : projectsQ.data?.items.find((p) => p.id === pid)),
    [projectsQ.data, pid]
  );

  const projectRow = useMemo(
    () => (pid == null ? null : (overviewQ.data ?? []).find((p) => p.project_id === pid) ?? null),
    [overviewQ.data, pid]
  );

  // L1 变更单列表（不筛 risk，前端再切；合并甘特图需要完整的单子）
  const listQ = useChanges(
    { project_id: projectId, archived: "all", sort: "risk", page_size: 100 },
    hasProject
  );
  const allChanges = useMemo(() => listQ.data?.items ?? [], [listQ.data]);

  const alertsQ = useChangeAlerts(pid ?? undefined, risk || undefined);
  const burndownQ = useChangeBurndown({ project_id: pid ?? undefined }, hasProject);

  /* 合并甘特图：拉到该项目每张单的任务树（与详情抽屉共用同一份缓存） */
  const detailQueries = useQueries({
    queries: allChanges.map((c) => ({
      queryKey: changeKeys.detail(c.id),
      queryFn: () => changeApi.get(c.id),
    })),
  });

  const details = useMemo(
    () => detailQueries.map((dq) => dq.data).filter((d): d is ChangeDetail => Boolean(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖内容指纹，见下方 detailsSig
    [detailQueries.map((dq) => dq.dataUpdatedAt).join(",")]
  );

  /** 内容指纹：任务被勾选/改期后也要让下面的 useMemo 重算 */
  const detailsSig = useMemo(
    () =>
      details
        .map((d) => {
          const parts: string[] = [];
          const walk = (ns: ChangeTaskNode[]) => {
            for (const n of ns) {
              parts.push(`${n.id}.${n.is_done ? 1 : 0}.${n.plan_start ?? ""}.${n.plan_end ?? ""}`);
              walk(n.children ?? []);
            }
          };
          walk(d.tasks ?? []);
          return `${d.id}:${d.status}:${parts.join(",")}`;
        })
        .join("|"),
    [details]
  );

  const gantt = useMemo(() => {
    const taskToChange = new Map<number, number>();
    const blocks: GanttTask[] = [];
    for (const c of details) {
      if (c.status === "voided") continue; // 作废的单不再占甘特图
      const walk = (n: ChangeTaskNode): GanttTask => {
        taskToChange.set(n.id, c.id);
        return { ...n, children: (n.children ?? []).map(walk) };
      };
      blocks.push({
        id: -c.id, // 负数 id 表示「变更单块头」，与真实任务 id 不冲突
        name: `${c.title} · ${c.material_pn}`,
        owner: c.owner,
        level: 1,
        state: ("todo" as TaskState),
        is_done: c.status === "done",
        plan_start: c.plan_start,
        plan_end: c.plan_end,
        done_at: c.completed_at,
        overdue_days: c.overdue_days,
        late_days: 0,
        leaf_total: c.leaf_total,
        leaf_done: c.leaf_done,
        summary: true, // 汇总条一律中性灰（配色纪律）
        children: (c.tasks ?? []).map((t) => shiftLevel(t, 1)),
      });
    }
    return { blocks, taskToChange };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 用指纹代替数组引用
  }, [detailsSig]);

  /* L1 按责任人聚合（不占大头：一个切换按钮 + 一个小卡片） */
  const ownerGroups = useMemo(() => {
    const m = new Map<string, { overdue: number; near: number; late: number; total: number }>();
    for (const a of alertsQ.data ?? []) {
      const key = a.owner ?? "（未指派）";
      const g = m.get(key) ?? { overdue: 0, near: 0, late: 0, total: 0 };
      g[a.level] += 1;
      g.total += 1;
      m.set(key, g);
    }
    return [...m.entries()].sort(
      (a, b) => b[1].overdue - a[1].overdue || b[1].near - a[1].near || b[1].total - a[1].total
    );
  }, [alertsQ.data]);

  /* L0：只按 Tab 过滤（饼图用），搜索另算（卡片墙用） */
  const tabRows = useMemo(
    // ★ 口径：total 只算有效单（不含作废）→ 判断「这个项目有没有单」要把作废算上，
    //   否则只剩作废单的项目会从墙上凭空消失（旧 total 含作废，行为如此）。
    () => (overviewQ.data ?? []).filter((p) => (archivedTab ? p.archived > 0 : p.total + p.voided > 0)),
    [overviewQ.data, archivedTab]
  );

  /* 偏差榜的可见行 —— 表格与那句结论**必须同源同过滤**：结论说「N 个项目」，
     表里就得有 N 行。两边各写一套 filter 迟早会飘（归档 Tab 下尤其明显）。 */
  const rankRows = useMemo(() => tabRows.filter((p) => p.total > 0 || p.archived > 0), [tabRows]);

  /* L0 卡片墙：Tab 过滤 → 类型过滤 → 搜索 → 分页 */
  const wallRows = useMemo(() => {
    let rows = tabRows;
    if (typeFilter != null) {
      rows = rows.filter((p) => p.type_counts.some((t) => t.change_type_id === typeFilter && t.count > 0));
    }
    const key = q.trim().toLowerCase();
    if (!key) return rows;
    return rows.filter(
      (p) => p.project_name.toLowerCase().includes(key) || p.project_code.toLowerCase().includes(key)
    );
  }, [tabRows, q, typeFilter]);

  const wallTotalPages = Math.max(1, Math.ceil(wallRows.length / CARD_PAGE_SIZE));
  const wallPage = Math.min(page, wallTotalPages);
  const wallPageRows = wallRows.slice((wallPage - 1) * CARD_PAGE_SIZE, wallPage * CARD_PAGE_SIZE);

  const voidedCount = useMemo(() => allChanges.filter((c) => c.status === "voided").length, [allChanges]);

  const tableItems = useMemo(() => {
    // 作废默认隐藏（#19）；合并甘特图用的是 allChanges，不受这里影响
    let items = showVoided ? allChanges : allChanges.filter((c) => c.status !== "voided");
    if (risk) items = items.filter((c) => matchRisk(c, risk));
    return items;
  }, [allChanges, risk, showVoided]);

  const summary = summaryQ.data;
  const typeTotal = (summary?.type_counts ?? []).reduce((s, t) => s + t.count, 0);
  /** 全部叶子任务数（含已完成）—— **只给「任务构成」五色条用**，那是构成、本就该含已完成 */
  const taskTotal = (summary?.task_state_counts ?? []).reduce((s, t) => s + t.count, 0);

  /**
   * ★「待办项」= **未完成**（进行中 + 临期 + 超期）。
   *   统计卡必须用它：用全量会在同屏造出两个「待办项」——
   *   卡片 33（含按时/迟交完成）vs 项目饼图「待办项数」21（= 各项目 open_tasks 之和），
   *   两个数还都在同一屏上。这也是「同屏数字必须同源」那条纪律的适用面。
   */
  const pendingTasks = (summary?.task_state_counts ?? [])
    // TaskStateCount.state 是 string（刻意宽松，取色走 taskStateMeta 兜底）→ 这里补断言
    .filter((t) => TASK_STATE_OPEN.includes(t.state as TaskState))
    .reduce((s, t) => s + t.count, 0);

  /* -------------------------------------------- L0 图表数据与「一句话结论」 */

  /** 全局燃尽图结论：实际 vs 计划差多少、最近一次「掉链子」发生在哪天 */
  const burndownInsight = useMemo((): { text: string; tone: "default" | "good" | "warn" | "bad" } => {
    const all = globalBurndownQ.data?.points ?? [];
    const pts = all.filter((p) => p.actual_remaining != null);
    if (pts.length === 0) {
      return { text: "还没有任务，或任务未填计划时间，暂时画不出燃尽曲线", tone: "default" };
    }
    const gapAt = (i: number) => (pts[i]!.actual_remaining ?? 0) - pts[i]!.plan_remaining;
    const last = pts[pts.length - 1]!;
    const gap = gapAt(pts.length - 1);
    const remaining = last.actual_remaining ?? 0;

    if (gap > 0) {
      // ★ 「自第一天就落后」这种结论等于没说 —— 更有用的是「差距最近一次扩大发生在哪天」，
      //   那天才是真正又掉了一次链子。从后往前找最后一个 gap 增大的点。
      let slipIdx = -1;
      for (let i = 1; i < pts.length; i++) {
        if (gapAt(i) > gapAt(i - 1)) slipIdx = i;
      }
      const tail =
        slipIdx > 0
          ? `；差距最近一次扩大在 ${pts[slipIdx]!.date.slice(5)}`
          : "；差距已不再扩大，最近没有新的掉链子";
      return {
        text: `实际剩余比计划多 ${gap} 项（还剩 ${remaining} 项没勾）${tail}`,
        tone: gap >= 8 ? "bad" : "warn",
      };
    }
    if (gap === 0) {
      return { text: `实际剩余与计划完全一致（各 ${last.plan_remaining} 项），进度咬得很紧`, tone: "good" };
    }
    return { text: `实际剩余比计划少 ${-gap} 项，进度快于计划`, tone: "good" };
  }, [globalBurndownQ.data]);

  /**
   * 任务构成饼图 —— **由五色条（`TaskStateStrip`）迁移而来**。
   * 用户钦定（2026-10-06）：「把条形图的内容也变成饼图，这样就是三个饼图，好看一点」。
   *
   * ★ 顺序固定走 `TASK_STATE_ORDER`（与后端 `_TASK_STATE_ORDER` 一致）：
   *   扇区与图例的顺序才稳定，刷新不会跳。
   * ★ 配色必须走 `taskStateMeta(s).solid` 的**状态语义色**，**不能**用饼图默认的分类色板 ——
   *   超期必须是红的、临期必须是黄的，那是老板的警报颜色（理由见 `ChangeDonutChart.colors`）。
   * ★ 含已完成（按时/迟交完成）：五色构成的本义是"全部任务的健康度"，不只数待办项。
   */
  const taskStateItems = useMemo(() => {
    const counts = summary?.task_state_counts ?? [];
    return TASK_STATE_ORDER.map((s) => ({
      state: s,
      name: taskStateMeta(s).label,
      value: counts.find((c) => c.state === s)?.count ?? 0,
    }));
  }, [summary]);

  const taskStateColors = useMemo(
    () => taskStateItems.map((it) => taskStateMeta(it.state).solid),
    [taskStateItems]
  );

  /** 任务构成饼的结论 —— 与另两张饼同款：标题下必带一句由数据算出的话（不写在图里） */
  const taskStateInsight = useMemo((): { text: string; tone: "default" | "info" | "warn" | "bad" } => {
    const total = taskStateItems.reduce((s, it) => s + it.value, 0);
    if (total === 0) return { text: "还没有任务", tone: "default" };
    const pct = (n: number) => Math.round((n / total) * 100);
    const top = taskStateItems.reduce((a, b) => (b.value > a.value ? b : a));
    const od = summary?.overdue_tasks ?? 0;
    const near = summary?.near_tasks ?? 0;
    if (od + near > 0) {
      return {
        text: `有风险 ${od + near} 项（${pct(od + near)}%）· 超期 ${od} 项 · ${top.name}最多 ${top.value} 项`,
        tone: od > 0 ? "bad" : "warn",
      };
    }
    return {
      text: `共 ${total} 项 · ${top.name}最多 ${top.value} 项（${pct(top.value)}%）`,
      tone: "info",
    };
  }, [taskStateItems, summary]);

  /** 类型饼图结论 */
  const typeInsight = useMemo((): { text: string; tone: "default" | "info" } => {
    const list = (summary?.type_counts ?? []).filter((t) => t.count > 0);
    if (list.length === 0 || typeTotal === 0) return { text: "暂无数据", tone: "default" };
    const top = list[0]!;
    const pct = Math.round((top.count / typeTotal) * 100);
    // 口径已统一：type_counts 与「变更总数」都不含作废 → 不再需要「另有 N 张作废未计入」的兜底说明，
    // 饼图之和直接等于总数。作废单的去处由统计卡 hint 与列表开关负责交代。
    if (list.length === 1) {
      return { text: `目前只有「${top.type_name}」一类，共 ${top.count} 张`, tone: "info" };
    }
    return {
      text: `${top.type_name}最多，${top.count}/${typeTotal} 张（${pct}%）；共 ${list.length} 种类型`,
      tone: "info",
    };
  }, [summary, typeTotal]);

  /** 项目饼图数据 + 结论（口径可切：变更单 / 待办项 / 超期项） */
  const projectMetricData = useMemo(() => {
    // ★ 口径：total 已不含作废 → 「待办项数」必须直接用后端的 open_tasks。
    //   旧写法 `total − voided − archived` 在新口径下会**重复减作废**
    //   （乘用车 1 − 1 − 0 = 0 → 静默少算一张单，饼图直接缺项）。
    const valueOf = (p: ChangeProjectOverview) =>
      metric === "tasks" ? p.open_tasks : metric === "overdue" ? p.overdue_tasks : p.total;
    return tabRows.map((p) => ({ name: p.project_name, value: valueOf(p), row: p }));
  }, [tabRows, metric]);

  const projectInsight = useMemo((): { text: string; tone: "default" | "info" | "warn" } => {
    const list = projectMetricData.filter((d) => d.value > 0);
    if (list.length === 0) {
      return {
        text: archivedTab ? "还没有归档的项目" : "还没有变更单，点右上角「新建变更单」开始记录",
        tone: "default",
      };
    }
    const sorted = [...list].sort((a, b) => b.value - a.value);
    const top = sorted[0]!;
    const unit = METRIC_LABEL[metric];
    const mostOverdue = [...tabRows].sort((a, b) => b.overdue_tasks - a.overdue_tasks)[0];
    const extra =
      metric !== "overdue" && mostOverdue && mostOverdue.overdue_tasks > 0
        ? `；超期项最多的是「${mostOverdue.project_name}」（${mostOverdue.overdue_tasks} 项）`
        : "";
    return {
      text: `按${unit}：「${top.name}」${top.value} 最多，共 ${list.length} 个项目有变更${extra}`,
      tone: metric === "overdue" ? "warn" : "info",
    };
  }, [projectMetricData, metric, tabRows, archivedTab]);

  /** 偏差榜结论 —— 数据源必须是 rankRows（与表格同一份），不能再用 overviewQ.data */
  const deviationInsight = useMemo((): { text: string; tone: "default" | "good" | "warn" | "bad" } => {
    const rows = rankRows;
    if (rows.length === 0) return { text: "暂无数据", tone: "default" };
    const worst = [...rows].sort((a, b) => b.avg_deviation - a.avg_deviation)[0]!;
    const lagging = rows.filter((p) => p.avg_deviation > 0).length;
    if (worst.avg_deviation <= 0) {
      return { text: `所有项目都不落后于时间进度（共 ${rows.length} 个）`, tone: "good" };
    }
    return {
      text:
        `「${worst.project_name}」完成率 ${worst.task_done_rate}% 垫底 —— ` +
        `时间已过 ${worst.avg_time_rate}%，落后 ${worst.avg_deviation} 个百分点；` +
        `${lagging}/${rows.length} 个项目滞后`,
      tone: worst.avg_deviation >= 20 ? "bad" : "warn",
    };
  }, [rankRows]);

  /**
   * 折叠区① 收起态摘要 —— **数字全部复用统计卡已有的字段**（同一个口径，不新造话术）。
   * 收起时老板看到的就是这一行：超期几项、涉及几张单、拖最久几天、临期几项、涉及几个人。
   */
  const alertsSummaryText = useMemo(() => {
    const od = summary?.overdue_tasks ?? 0;
    const near = summary?.near_tasks ?? 0;
    if (od === 0 && near === 0) return "当前没有超期或临期的待办项";
    const owners = new Set((globalAlertsQ.data ?? []).map((a) => a.owner ?? "（未指派）"));
    return [
      od > 0
        ? `超期 ${od} 项（${summary?.overdue_changes ?? 0} 张单）拖最久 ${summary?.max_overdue_days ?? 0} 天`
        : null,
      near > 0 ? `临期 ${near} 项` : null,
      owners.size > 0 ? `涉及 ${owners.size} 人` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [summary, globalAlertsQ.data]);

  /* ------------------------------------------------------------- 操作 */

  const doArchiveProject = () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    archiveProject.mutate(
      { projectId: target.project_id },
      {
        onSuccess: () => {
          toast.success(`「${target.project_name}」的变更单已归档`, {
            action: {
              label: "下载归档 Excel",
              onClick: () =>
                window.open(changeApi.exportUrl({ project_id: target.project_id, archived: "all" }), "_blank"),
            },
          });
          setArchiveTarget(null);
        },
        onError: (err) => toast.error(getApiErrorMessage(err)),
      }
    );
  };

  const doUnarchiveProject = (p: ChangeProjectOverview) => {
    unarchiveProject.mutate(p.project_id, {
      onSuccess: () => toast.success(`「${p.project_name}」已取消归档`),
      onError: (err) => toast.error(getApiErrorMessage(err)),
    });
  };

  const doExport = () => {
    window.open(
      changeApi.exportUrl(
        hasProject && pid != null
          ? { project_id: pid, archived: "all" }
          : { archived: archivedTab ? "1" : "0" }
      ),
      "_blank"
    );
  };

  /**
   * 清除筛选 —— 只清 `risk`，**不动 `view`**。
   *   待办项现在住分析视图、**常显不折叠**，不需要再靠 `todos=1` 维持展开态；
   *   反过来若把 view 一起清掉，点「清除筛选」会顺带把用户踢回主页 —— 那才是更严重的假死。
   */
  const clearRisk = () => patch({ risk: null });

  /* ----------------------------------------------------------- 工具栏 */

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setTypeOpen(true)}>
        <Settings2 className="mr-1.5 h-3.5 w-3.5" />
        变更类型
      </Button>
      <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
        <FileUp className="mr-1.5 h-3.5 w-3.5" />
        Excel 导入
      </Button>
      <Button variant="outline" size="sm" onClick={doExport}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        导出
      </Button>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        新建变更单
      </Button>
    </div>
  );

  /* ------------------------------------------------- L0 首页 */

  /**
   * 标题栏（含副标题与 4 个操作按钮）—— 抽成变量，因为它要进**固定顶部区**。
   * 原本它内联在 return 里；L0 / L1 两个视图共用同一份。
   */
  const titleBar = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">变更管理</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          承诺兑现追踪 · 进度按时间自动推算，勾选是人给的答案，两者之差即偏差
          {hasProject && (projectMeta || projectRow) && ` · 当前：${projectMeta?.name ?? projectRow?.project_name}`}
        </p>
      </div>
      {toolbar}
    </div>
  );

  /**
   * ★★ 统计卡 ×5 —— L0 的「整体情况」，属于**固定顶部区**：不折叠、不下移、滚动吸顶（lg+）。
   *   用户原话：「不仅要看项目哪里有问题，也要看有哪些项目，整体的情况是什么。
   *              这个〔标题 + 统计卡〕就一直放在最上面。」
   *
   *   两张可点卡（超期 / 临期）会把 `risk` 写进 URL 去筛「最需要盯的待办项」——
   *   那份清单在折叠区① 里，所以点击时**同时写 `todos=1`** 顺带展开，否则点了毫无反应（假死）。
   */
  const statsBand = (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile
        label="变更总数"
        value={summary?.total ?? 0}
        // ★ 口径 = **有效单**（不含作废、不含归档），所以「进行中 + 已完成」必须恰好等于总数。
        //   作废单不属于这个加法 → 用「另有」隔开，不能让读者以为它是构成的一部分。
        hint={`进行中 ${summary?.active ?? 0} · 已完成 ${summary?.done ?? 0}${
          (summary?.voided ?? 0) > 0 ? ` ｜ 另有作废 ${summary?.voided}` : ""
        }`}
      />
      <StatTile
        label="超期未完成"
        value={summary?.overdue_tasks ?? 0}
        hint={
          (summary?.overdue_tasks ?? 0) > 0
            ? `${summary?.overdue_changes ?? 0} 张单 · 拖最久 ${summary?.max_overdue_days ?? 0} 天`
            : "当前没有超期项"
        }
        tone="red"
        onClick={() => patch({ risk: risk === "overdue" ? null : "overdue", view: "analysis" })}
        active={risk === "overdue"}
      />
      <StatTile
        label="临期（3 天内）"
        value={summary?.near_tasks ?? 0}
        hint={`${summary?.near_changes ?? 0} 张单`}
        tone="amber"
        onClick={() => patch({ risk: risk === "near" ? null : "near", view: "analysis" })}
        active={risk === "near"}
      />
      <StatTile
        label="涉及项目"
        value={summary?.project_count ?? 0}
        hint={`${summary?.material_count ?? 0} 个物料 · ${summary?.type_count ?? 0} 种类型`}
        tone="blue"
      />
      <StatTile
        label="待办项 / 未指派"
        value={`${pendingTasks} / ${summary?.unassigned_tasks ?? 0}`}
        hint={
          (summary?.unassigned_tasks ?? 0) > 0
            ? `⚠ ${summary?.unassigned_tasks ?? 0} 项没有责任人`
            : `未完成的待办项都已指派责任人${
                taskTotal > pendingTasks ? ` · 共 ${taskTotal} 项含已完成` : ""
              }`
        }
        tone={(summary?.unassigned_tasks ?? 0) > 0 ? "red" : "default"}
      />
    </div>
  );

  /**
   * 项目卡片墙（导航层）—— ★ 2026-10-06 从第 3 屏提到第 1 屏，紧贴固定顶部区。
   *
   * 用户原话：「**不仅要看项目哪里有问题，也要看有哪些项目**」——
   * 这一块恰好同时回答这两件事：逐项目一张卡（**有哪些项目**）＋ 超期/临期明细与
   * 最紧急一条（**哪个项目哪里有问题、多严重**）。它是老板唯一能直接拿去用的信息
   * （"这个项目我得问一下"），所以必须排在第 2 眼的位置。
   */
  const cardWall = (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => patch({ archived: null, page: null })}
              className={cn(
                "rounded-md px-3 py-1 text-xs transition-colors",
                !archivedTab ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
              )}
            >
              进行中
            </button>
            <button
              type="button"
              onClick={() => patch({ archived: "1", page: null })}
              className={cn(
                "rounded-md px-3 py-1 text-xs transition-colors",
                archivedTab ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
              )}
            >
              已归档
            </button>
          </div>

          {risk && (
            <button
              type="button"
              onClick={clearRisk}
              className={cn(
                "rounded-md px-2 py-1 text-xs",
                risk === "overdue"
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              )}
              title="点击清除筛选"
            >
              仅看{RISK_LABEL[risk] ?? risk} ✕
            </button>
          )}
        </div>

        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => patch({ q: e.target.value || null, page: null })}
            placeholder="搜索项目名 / 项目代码"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="mt-3">
        {overviewQ.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : wallRows.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={archivedTab ? "还没有归档的项目" : q || typeFilter != null ? "没有匹配的项目" : "还没有变更单"}
            description={
              archivedTab
                ? "项目做完了可以在项目卡上点「归档此项目」，归档后会出现在这里"
                : q || typeFilter != null
                  ? "换个项目名 / 项目代码再试，或清空搜索与类型筛选"
                  : "点右上角「新建变更单」开始记录，也可以用 Excel 批量导入"
            }
            size="lg"
          />
        ) : (
          <>
            {/* ★ 必须显式写 grid-cols-1（= minmax(0,1fr)）：只写 sm:/xl: 时窄屏没有
                任何 grid-template-columns 生效，隐式列是 auto，宽度取内容 min-content，
                卡片里的 truncate(nowrap) 会把列撑到 380px > 容器 342px → 横向溢出 38px。 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {wallPageRows.map((p) => (
                <ProjectChangeCard
                  key={p.project_id}
                  data={p}
                  onOpen={() => patch({ project: String(p.project_id), risk: null, by: null, c: null })}
                  onArchive={() => setArchiveTarget(p)}
                  onUnarchive={() => doUnarchiveProject(p)}
                  archiving={archiveProject.isPending || unarchiveProject.isPending}
                />
              ))}
            </div>
            <Pagination
              page={wallPage}
              totalPages={wallTotalPages}
              total={wallRows.length}
              onPageChange={(next) => patch({ page: String(next) })}
            />
          </>
        )}
      </div>
    </>
  );

  const wallView = (
    <>
      {/* ① 项目卡片墙（导航层）—— 从第 3 屏提到第 1 屏，见 `cardWall` 的说明 */}
      {cardWall}

      {/* ② 构成三视图 —— 任务构成 / 按类型 / 按项目，三张饼并列一行
          ★ 2026-10-06 用户钦定：「饼图不是三张图吗？并列放在〔项目卡片墙〕这个下面可以吗？」
            +「为了整体美观可以饼图，把数据标好，或者鼠标放上去可以呈现就可以」
            → 原五色条升级为饼图，与另两张饼**同尺寸、同位置、同结构**，并排放在卡片墙正下方。
          ★ 「把数据标好」的落地（三张饼统一）：**图例**（名称 + 值 + 百分比）、
            **圆心**（总数 + 单位）、**hover tooltip**（名称 + 值 + 单位 + 百分比）。
            不往扇区里塞引线标签 —— 并排后每张只剩 ~363px，标签会糊成一团。
          ★ 每张饼标题下都带一句由数据算出的结论（`ChangeInsight`）：老板不读图也拿得到结论。
          ★ 排在卡片墙**之后**：构成回答"整体长什么样"，比"逐项目"更细一层；
            挡在卡片墙前面会把它往下推 ~350px，直接挤出第一屏。 */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 饼① 任务构成（原五色条迁移）—— 状态语义色，圆心标任务总数 */}
        <Card>
          {/* ★ 三张饼的 CardHeader 统一 `min-h-[116px]`（实测值）：让**圆心落在同一条水平线上**。
              两个变量会各自把 header 撑高 —— ①标题行是否带口径切换器（项目饼有、另两张没有）
              ②结论句 1 行还是 2 行。不统一高度就会出现"三张卡等宽等高、饼却高低不一"。 */}
          <CardHeader className="pb-2">
            <CardTitle
              className="flex min-h-[26px] items-center gap-1.5 text-sm font-medium"
              title={`共 ${taskTotal} 项 · 只数叶子（父项不重复计入）`}
            >
              <PieChart className="h-4 w-4 text-muted-foreground" />
              任务构成
            </CardTitle>
            <ChangeInsight className="mt-1.5 min-h-[2.5rem]" tone={taskStateInsight.tone}>
              {taskStateInsight.text}
            </ChangeInsight>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ChangeDonutChart
              className="h-[190px]"
              centerLabel="任务项"
              unit="项"
              isLoading={summaryQ.isLoading}
              emptyText="还没有任务"
              items={taskStateItems}
              colors={taskStateColors}
            />
          </CardContent>
        </Card>

        {/* 饼② 按类型分布（原折叠区②，现回主页）—— 点扇区下钻筛卡片墙 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex min-h-[26px] items-center gap-1.5 text-sm font-medium">
              <PieChart className="h-4 w-4 text-muted-foreground" />
              按类型分布
            </CardTitle>
            <ChangeInsight className="mt-1.5 min-h-[2.5rem]" tone={typeInsight.tone}>
              {typeInsight.text}
            </ChangeInsight>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ChangeDonutChart
              className="h-[190px]"
              centerLabel="变更单"
              isLoading={summaryQ.isLoading}
              emptyText="还没有变更单"
              items={(summary?.type_counts ?? []).map((t) => ({ name: t.type_name, value: t.count }))}
              onSliceClick={(_name, index) => {
                const list = (summary?.type_counts ?? []).filter((t) => t.count > 0);
                const hit = list[index];
                if (hit) patch({ type: typeFilter === hit.change_type_id ? null : String(hit.change_type_id), page: null });
              }}
            />
            {typeFilter != null && (
              <div className="flex items-center gap-2 px-3 pt-1">
                <button
                  type="button"
                  onClick={() => patch({ type: null, page: null })}
                  className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                  title="点击清除类型筛选"
                >
                  仅看：
                  {(summary?.type_counts ?? []).find((t) => t.change_type_id === typeFilter)?.type_name ?? "该类型"}{" "}
                  ✕
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 饼③ 按项目分布（原折叠区②，现回主页）—— 口径可切：变更单 / 待办项 / 超期项 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex min-h-[26px] items-center gap-1.5 text-sm font-medium">
                <PieChart className="h-4 w-4 text-muted-foreground" />
                按项目分布
              </CardTitle>
              <div className="inline-flex rounded-lg border p-0.5">
                {(["changes", "tasks", "overdue"] as ProjectMetric[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patch({ metric: m === "changes" ? null : m })}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                      metric === m ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
                    )}
                  >
                    {METRIC_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <ChangeInsight className="mt-1.5 min-h-[2.5rem]" tone={projectInsight.tone}>
              {projectInsight.text}
            </ChangeInsight>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ChangeDonutChart
              className="h-[190px]"
              centerLabel={METRIC_LABEL[metric]}
              isLoading={overviewQ.isLoading}
              emptyText={archivedTab ? "还没有归档的项目" : "还没有变更单"}
              items={projectMetricData.map((d) => ({ name: d.name, value: d.value }))}
              onSliceClick={(name) => {
                const hit = projectMetricData.find((d) => d.name === name);
                if (hit) patch({ project: String(hit.row.project_id), risk: null, by: null, c: null });
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* ③ 分析视图入口 —— 执行层与分析层（待办跟进 / 整体趋势 / 偏差回归）统一收进
          「变更分析」视图（`?view=analysis`），主页只留一行入口 + 一句摘要。
          ★ 摘要复用统计卡已有的数字（`alertsSummaryText`），不新写话术、不加接口。
          ★ 形状与折叠区一致（一行 + 右侧动作），但语义是**跳转**不是就地展开 ——
            所以文案写「进入 →」而不是「展开」，避免"点完没展开"的困惑。 */}
      <Card className="mt-4 overflow-hidden">
        <button
          type="button"
          onClick={() => patch({ view: "analysis" })}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/40"
        >
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          <ListChecks className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="shrink-0 text-sm font-medium">变更分析</span>
          <span className="hidden shrink-0 text-[11px] text-muted-foreground lg:inline">
            待办跟进 · 整体趋势 · 偏差回归
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{alertsSummaryText}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">进入 →</span>
        </button>
      </Card>
    </>
  );

  /**
   * 分析视图（`?view=analysis`）—— **同页视图**，与 L1 的 `?project=<id>` 同构：
   * 零路由改动、返回逻辑简单、URL 一样可分享。
   *
   * 用户口径（2026-10-06）：
   *   「不要把饼图折叠进去，放在主页」→ 三张饼已回主页（见 `wallView` ②）
   *   「剩余的折叠内容我觉得不用放在主页…你看看放在哪会好一点」+「P3 第一种吧」
   *     → 待办项 / 整体燃尽图 / 深度分析**整体搬进本视图**，同页切换、不新建路由
   *
   * ★ 搬进来后**常显不折叠**：这个视图就是为"看细节"进来的，
   *   再折一层 = 让用户点两次才看到自己专门来看的东西。
   * ★ 内容与受众一个不删：只是从主页的"折叠一等公民"变成二级视图的"常显一等公民"。
   * ★ 固定顶部区（标题 + 统计卡 ×5）在本视图**照样在**：
   *   统计卡的「超期未完成 / 临期」正好就是本页待办项的筛选入口，点一下就地筛（不会假死）。
   */
  const analysisView = (
    <>
      <div className="mt-5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => patch({ view: null, risk: null, todos: null, trend: null, deep: null })}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          返回项目总览
        </Button>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">变更分析</h2>
          <span className="text-[11px] text-muted-foreground">
            待办跟进 · 整体趋势 · 偏差回归 —— 执行与复盘视角，不进老板的第一屏
          </span>
        </div>
      </div>

      {/* ① 最需要盯的待办项（执行层：谁 · 哪张单 · 拖几天） */}
      {globalAlertsQ.isLoading ? null : (globalAlertsQ.data?.length ?? 0) > 0 ? (
        <Card className="mt-4 border-l-2 border-l-red-500/60">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                最需要盯的待办项
              </CardTitle>
              <div className="flex items-center gap-2">
                {risk && (
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearRisk}>
                    清除筛选
                  </Button>
                )}
                <div className="inline-flex rounded-lg border p-0.5">
                  <button
                    type="button"
                    onClick={() => patch({ alerts: null })}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                      !alertsFlat ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
                    )}
                  >
                    按项目/变更
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ alerts: "flat" })}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                      alertsFlat ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
                    )}
                    title="救火视角：全库最严重的几条，不看归属"
                  >
                    按严重度平铺
                  </button>
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {alertsFlat
                ? "按严重度排序：超期天数降序 → 临期剩余天数升序"
                : "按项目 → 变更单 → 待办项分组，组间按最严重程度排；点组头可折叠"}
              <span className="mx-1.5">·</span>
              只含超期与临期（迟交完成已做完，不列入待处理）
              {risk && (
                <>
                  <span className="mx-1.5">·</span>
                  已筛：{RISK_LABEL[risk] ?? risk}
                </>
              )}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <ChangeAlertTable
              items={globalAlertsQ.data ?? []}
              isLoading={false}
              mode={alertsFlat ? "flat" : "group"}
              showProject={alertsFlat}
              limit={GLOBAL_ALERT_LIMIT}
              storageKey="changes:alertCollapse:global"
              onRowClick={(a) => patch({ project: String(a.project_id), c: String(a.change_id) })}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* ② 整体燃尽图（原折叠区②，现常显） */}
      <Card className="mt-4 border-l-2 border-l-blue-500/60">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <TrendingDown className="h-4 w-4 text-blue-500" />
              整体燃尽图
            </CardTitle>
            <span className="text-[11px] text-muted-foreground">
              全部进行中的变更单 · 不含已归档与已作废
              {globalBurndownQ.data?.step === 7 ? " · 按周取样" : ""}
            </span>
          </div>
          <ChangeInsight className="mt-1.5" tone={burndownInsight.tone}>
            {burndownInsight.text}
          </ChangeInsight>
        </CardHeader>
        <CardContent className="p-2">
          <BurndownChart data={globalBurndownQ.data} isLoading={globalBurndownQ.isLoading} className="h-64" />
        </CardContent>
      </Card>

      {/* ③ 深度分析：偏差榜 + 超期时长分档（原折叠区③，现常显） */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">深度分析</CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            偏差榜（时间进度 vs 完成率） · 超期时长分档
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 px-4 pb-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium">偏差榜 · 谁比时间落后得多</p>
            <ChangeInsight className="mt-1.5" tone={deviationInsight.tone}>
              {deviationInsight.text}
            </ChangeInsight>
            <ChangeDeviationRank
              className="mt-3"
              rows={rankRows}
              isLoading={overviewQ.isLoading}
              emptyText={archivedTab ? "还没有归档的项目" : "还没有可对比的项目"}
            />
          </div>
          <div>
            <p className="text-xs font-medium">超期时长分档 · 拖了多久</p>
            <ChangeOverdueDepth
              className="mt-1.5"
              buckets={summary?.overdue_buckets ?? []}
              total={summary?.overdue_tasks ?? 0}
              maxDays={summary?.max_overdue_days ?? 0}
              isLoading={summaryQ.isLoading}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );

  /* ------------------------------------------------- L1 项目视图 */

  const projectView = (
    <>
      {/* 顶部：返回 + 项目名 + 预警条 */}
      <div className="mt-5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => patch({ project: null, risk: null, by: null, c: null })}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          返回首页
        </Button>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {projectMeta?.name ?? projectRow?.project_name ?? `项目 #${pid}`}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {projectMeta?.code ?? projectRow?.project_code}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={!projectRow || projectRow.overdue_changes === 0}
              onClick={() => patch({ risk: risk === "overdue" ? null : "overdue" })}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                projectRow && projectRow.overdue_changes > 0
                  ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
                  : "bg-muted text-muted-foreground",
                risk === "overdue" && "ring-1 ring-red-500/50"
              )}
            >
              🔴 超期 {projectRow?.overdue_changes ?? 0} 单 / {projectRow?.overdue_tasks ?? 0} 项
            </button>
            <button
              type="button"
              disabled={!projectRow || projectRow.near_changes === 0}
              onClick={() => patch({ risk: risk === "near" ? null : "near" })}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                projectRow && projectRow.near_changes > 0
                  ? "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                  : "bg-muted text-muted-foreground",
                risk === "near" && "ring-1 ring-amber-500/50"
              )}
            >
              🟡 临期 {projectRow?.near_changes ?? 0} 单 / {projectRow?.near_tasks ?? 0} 项
            </button>
            {risk === "late" && (
              <button
                type="button"
                onClick={clearRisk}
                className="rounded-md bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-600 dark:text-orange-400"
                title="点击清除筛选"
              >
                迟交完成 ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="变更单"
          value={projectRow?.total ?? 0}
          // ★ total 只算有效单 → 作废单不在这个数里，用「另有」标出，别让读者去凑
          hint={`${
            (projectRow?.voided ?? 0) > 0 ? `另有作废 ${projectRow?.voided} · ` : ""
          }已归档 ${projectRow?.archived ?? 0} 张`}
        />
        <StatTile label="进行中" value={projectRow?.active ?? 0} tone="blue" />
        <StatTile label="已完成" value={projectRow?.done ?? 0} tone="emerald" />
        <StatTile
          label="超期待办项"
          value={projectRow?.overdue_tasks ?? 0}
          hint={`${projectRow?.overdue_changes ?? 0} 张单`}
          tone="red"
          onClick={() => patch({ risk: risk === "overdue" ? null : "overdue" })}
          active={risk === "overdue"}
        />
        <StatTile
          label="类型种数"
          value={projectRow?.type_counts.length ?? 0}
          hint={`完成率 ${projectRow?.task_done_rate ?? 0}% · 偏差 ${
            (projectRow?.avg_deviation ?? 0) > 0 ? "+" : ""
          }${projectRow?.avg_deviation ?? 0}`}
        />
      </div>

      {/* 合并甘特图 + 燃尽图 */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              合并甘特图
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                灰色块头 = 变更单 · 彩色条 = 待办项 · 红色竖线 = 今日
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {listQ.isLoading || detailQueries.some((dq) => dq.isLoading) ? (
              <Skeleton className="h-64 rounded-none" />
            ) : (
              <GanttChart
                tasks={gantt.blocks}
                storageKey={`changes:collapse:project:${pid}`}
                onTaskClick={(taskId) => {
                  const cid = gantt.taskToChange.get(taskId);
                  if (cid) patch({ c: String(cid) });
                }}
                emptyText="这个项目还没有可排期的任务"
              />
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">燃尽图</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <BurndownChart data={burndownQ.data} isLoading={burndownQ.isLoading} className="h-64" />
          </CardContent>
        </Card>
      </div>

      {/* 变更单列表 / 按责任人 */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">
              变更单
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                共 {tableItems.length} 张
                {risk ? `（筛：${RISK_LABEL[risk] ?? risk}）` : ""}
              </span>
            </CardTitle>
            <div className="flex items-center gap-2">
              {risk && (
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearRisk}>
                  清除筛选
                </Button>
              )}
              {voidedCount > 0 && (
                <Button
                  variant={showVoided ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => patch({ voided: showVoided ? null : "1" })}
                  title="作废的变更单默认隐藏，点这里显示"
                >
                  含已作废 {voidedCount}
                </Button>
              )}
              <Button
                variant={byOwner ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => patch({ by: byOwner ? null : "owner" })}
              >
                <Users className="mr-1 h-3 w-3" />
                按责任人
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {byOwner ? (
            alertsQ.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : ownerGroups.length === 0 ? (
              <EmptyState icon={<Users />} title="当前没有超期或临期的待办项" variant="plain" size="sm" />
            ) : (
              <div className="divide-y">
                {ownerGroups.map(([name, g]) => (
                  <div key={name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
                      {g.overdue > 0 && (
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-600 dark:text-red-400">
                          {g.overdue} 项超期
                        </span>
                      )}
                      {g.near > 0 && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                          {g.near} 项临期
                        </span>
                      )}
                      {g.late > 0 && (
                        <span className="rounded bg-orange-500/10 px-1.5 py-0.5 font-medium text-orange-600 dark:text-orange-400">
                          {g.late} 项迟交
                        </span>
                      )}
                      {g.overdue === 0 && g.near === 0 && g.late === 0 && (
                        <span className="text-muted-foreground">{g.total} 项</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              {tableItems.length === 0 && !listQ.isLoading ? (
                <EmptyState
                  icon={<Inbox />}
                  title={risk ? `没有${RISK_LABEL[risk] ?? risk}的变更单` : "这个项目还没有变更单"}
                  description={risk ? "点上面的预警条可以取消筛选" : "点右上角「新建变更单」开始记录"}
                  variant="plain"
                  size="sm"
                />
              ) : (
                <ChangeListTable
                  items={tableItems}
                  isLoading={listQ.isLoading}
                  onRowClick={(id) => patch({ c: String(id) })}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 预警明细（超期 / 临期 / 迟交，必带责任人） */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            预警明细
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {risk ? `仅看${RISK_LABEL[risk] ?? risk} · ` : ""}
              按严重度排序
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ChangeAlertTable
            items={alertsQ.data ?? []}
            isLoading={alertsQ.isLoading}
            mode="flat"
            onRowClick={(a) => patch({ c: String(a.change_id) })}
            emptyText="这个项目目前没有超期或临期的待办项"
          />
        </CardContent>
      </Card>
    </>
  );

  /* ----------------------------------------------------------- 渲染 */

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1500px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-8 sm:px-8">
          <div className="mx-auto max-w-[1400px]">
            {/* ★★ 固定顶部区（2026-10-06 用户钦定）：「标题栏 + L0 统计卡 ×5」
                用户原话：「不仅要看项目哪里有问题，也要看有哪些项目，整体的情况是什么。
                          这个〔标题 + 统计卡〕就一直放在最上面。」
                → 这一区**不折叠、不下移**，滚动时吸顶（lg+）：老板滚到下面的折叠区时，
                  仍然看得见"有多少活、多少在着火"。
                ★ 只在 lg+ 吸顶的原因：390px 上统计卡是 2 列 × 3 行 ≈200px，再叠标题
                  接近 1/3 屏，吸顶会把正文压没；手机上只保证"排在最上面"（`static`）。
                ★ 底/边与 SiteHeader 同款（`bg-background/95` + `backdrop-blur`，
                  站点顶栏高 56px = `lg:top-14`），负边距是为了让底色铺满 main 的左右内边距。 */}
            <div className="z-30 -mx-6 bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-8 sm:px-8 lg:sticky lg:top-14 lg:pt-1">
              {titleBar}
              {!hasProject && statsBand}
            </div>

            {hasProject ? projectView : analysisOpen ? analysisView : wallView}
          </div>
        </main>
      </div>

      {/* 弹窗与抽屉 */}
      <ChangeTypeDialog open={typeOpen} onOpenChange={setTypeOpen} />
      <ChangeImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ChangeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        presetProjectId={pid}
        onCreated={(id) => {
          setFormOpen(false);
          patch({ c: String(id) });
        }}
      />
      <ChangeDetailSheet
        changeId={changeParam}
        open={changeParam !== null}
        onOpenChange={(o) => {
          if (!o) patch({ c: null });
        }}
      />

      {/* 整项目归档确认 */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => {
          if (!o) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              归档「{archiveTarget?.project_name}」的变更？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该项目下 {(archiveTarget?.total ?? 0) + (archiveTarget?.voided ?? 0)} 张变更单会一并冻结并转为只读（不能再改任务、时间和状态），
              项目会从「进行中」移到「已归档」。
              <br />
              <br />
              <span className="font-medium text-foreground">其他模块不受影响</span>
              —— 供需、份额、库存的项目选择器照旧。归档记录会写一条留痕，之后随时可以「取消归档」退回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doArchiveProject} disabled={archiveProject.isPending}>
              确认归档
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
