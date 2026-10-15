/**
 * 变更管理类型定义与状态元数据。
 *
 * ⚠️ 硬约定（项目门禁 P8 静态扫描）：
 *   所有 META 映射的取值必须走 `xxxMeta()` 的 `?? 兜底`，
 *   否则后端返回未登记取值时会出现 `undefined.cellCls` 白屏。
 *
 * 口径见 `docs/changes-redesign/02-方案定稿-v0.2.md`：
 *   - 任务的五色状态（todo / soon / overdue / done / late）由后端派生，前端只渲染。
 *   - 甘特图内的「父条 / 汇总条」一律中性灰，报警色只出现在卡片、角标、色点上。
 */

export type ChangeStatus = "active" | "done" | "voided";
export type TaskState = "todo" | "soon" | "overdue" | "done" | "late";
export type AlertLevel = "overdue" | "near" | "late";
export type ArchiveScope = "project" | "change";

/* ------------------------------------------------------------------ 实体 */

export interface ChangeType {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  remark: string | null;
  /** 被多少张变更单引用 —— 决定能否删除（>0 只能停用） */
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface Change {
  id: number;
  project_id: number;
  project_code: string;
  project_name: string;
  material_id: number;
  material_pn: string;
  material_name: string;
  change_type_id: number;
  change_type_name: string;
  supplier_id: number | null;
  supplier_name: string | null;
  title: string;
  description: string | null;
  owner: string | null;
  status: ChangeStatus;
  plan_start: string | null;
  plan_end: string | null;
  completed_at: string | null;
  archived_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;

  // ---- 派生 ----
  leaf_total: number;
  leaf_done: number;
  /** 完成率（人给的答案）= 已完叶子 ÷ 叶子总数 × 100 */
  done_rate: number;
  /** 时间进度（自动的标尺）= 已过时长比例 × 100 */
  time_rate: number;
  /** 偏差 = time_rate − done_rate；> 0 表示时间跑在人前面（滞后） */
  deviation: number;
  overdue_leaf: number;
  near_leaf: number;
  late_leaf: number;
  overdue_days: number;
  days_left: number | null;
  is_archived: boolean;
}

export interface ChangeTaskNode {
  id: number;
  change_id: number;
  parent_id: number | null;
  level: number;
  seq: number;
  name: string;
  description: string | null;
  owner: string | null;
  plan_start: string | null;
  plan_end: string | null;
  is_done: boolean;
  done_at: string | null;
  remark: string | null;
  state: TaskState;
  overdue_days: number;
  late_days: number;
  leaf_total: number;
  leaf_done: number;
  children: ChangeTaskNode[];
}

export interface ChangeDetail extends Change {
  tasks: ChangeTaskNode[];
}

export interface ChangeListResponse {
  items: Change[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/* --------------------------------------------------------------- 聚合视图 */

export interface ChangeTypeCount {
  change_type_id: number;
  type_name: string;
  count: number;
}

/** 五色任务构成的其中一格。`state` 用于取色（务必走 taskStateMeta 兜底）。 */
export interface TaskStateCount {
  state: string;
  label: string;
  count: number;
}

/** 超期时长分档的其中一格。服务端固定输出 4 档（含 0）。 */
export interface OverdueBucket {
  label: string;
  count: number;
}

export interface ChangeUrgentBrief {
  change_id: number;
  title: string;
  owner: string | null;
  overdue_days: number;
  overdue_leaf: number;
  material_pn: string;
}

/** 项目卡片墙的一行（老板视角） */
export interface ChangeProjectOverview {
  project_id: number;
  project_code: string;
  project_name: string;
  total: number;
  active: number;
  done: number;
  voided: number;
  archived: number;
  /** ★ 未完成的待办项数（已完成/迟交完成都不算）。
   *  项目饼图「待办项数」口径用它 —— 本模块的「待办项」= change_tasks 实体，不是变更单。 */
  open_tasks: number;
  overdue_changes: number;
  overdue_tasks: number;
  near_changes: number;
  near_tasks: number;
  /** 按任务算的完成率 */
  task_done_rate: number;
  /** 按变更单算的完成率 */
  change_done_rate: number;
  /** 平均时间进度（自动的标尺） */
  avg_time_rate: number;
  /** 平均偏差 = avg_time_rate − task_done_rate，> 0 表示滞后 */
  avg_deviation: number;
  type_counts: ChangeTypeCount[];
  most_urgent: ChangeUrgentBrief | null;
}

export interface ChangeSummary {
  total: number;
  active: number;
  done: number;
  voided: number;
  archived: number;
  overdue_changes: number;
  overdue_tasks: number;
  near_changes: number;
  near_tasks: number;
  project_count: number;
  material_count: number;
  type_count: number;
  type_counts: ChangeTypeCount[];
  /** 五色任务构成（服务端固定按 todo/soon/overdue/done/late 顺序输出，含 0） */
  task_state_counts: TaskStateCount[];
  /** 超期时长分档（固定 4 档，含 0） */
  overdue_buckets: OverdueBucket[];
  /** 未完成（todo/soon/overdue）叶子中无责任人的数量 */
  unassigned_tasks: number;
  /** 拖得最久的那一项超期了多少天（0 = 当前没有超期项） */
  max_overdue_days: number;
}

export interface ChangeAlertItem {
  level: AlertLevel;
  task_id: number;
  task_name: string;
  task_level: number;
  change_id: number;
  change_title: string;
  project_id: number;
  project_code: string;
  project_name: string;
  material_pn: string;
  material_name: string;
  owner: string | null;
  is_unassigned: boolean;
  plan_end: string | null;
  days: number;
}

export interface BurndownPoint {
  date: string;
  plan_remaining: number;
  actual_remaining: number | null;
}

export interface ChangeBurndown {
  total: number;
  start: string | null;
  end: string | null;
  /** 取样步长（天）：1 = 逐日；7 = 跨度 > 180 天时按周取样 */
  step: number;
  points: BurndownPoint[];
}

export interface ChangeArchiveRecord {
  id: number;
  scope: ArchiveScope;
  project_id: number;
  project_code: string;
  project_name: string;
  change_id: number | null;
  change_title: string | null;
  archived_at: string;
  remark: string | null;
}

export interface ChangeImportResult {
  created_changes: number;
  updated_changes: number;
  created_tasks: number;
  updated_tasks: number;
  skipped: number;
  errors: string[];
}

/* ------------------------------------------------------------------ 入参 */

export interface ChangeListParams {
  project_id?: string;
  change_type_id?: number;
  status?: string;
  risk?: string;
  archived?: string;
  q?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export interface ChangeCreateInput {
  project_id: number;
  material_id: number;
  change_type_id: number;
  supplier_id?: number | null;
  title: string;
  description?: string | null;
  owner?: string | null;
  remark?: string | null;
}

export interface ChangeUpdateInput {
  project_id?: number;
  material_id?: number;
  change_type_id?: number;
  supplier_id?: number | null;
  title?: string;
  description?: string | null;
  owner?: string | null;
  status?: ChangeStatus;
  remark?: string | null;
}

export interface ChangeTaskCreateInput {
  parent_id?: number | null;
  name: string;
  description?: string | null;
  owner?: string | null;
  plan_start?: string | null;
  plan_end?: string | null;
}

export interface ChangeTaskUpdateInput {
  name?: string;
  description?: string | null;
  owner?: string | null;
  plan_start?: string | null;
  plan_end?: string | null;
  seq?: number;
  is_done?: boolean;
}

export interface ChangeTypeCreateInput {
  name: string;
  sort_order?: number;
  remark?: string | null;
}

export interface ChangeTypeUpdateInput {
  name?: string;
  sort_order?: number;
  is_active?: boolean;
  remark?: string | null;
}

/* ------------------------------------------------------------------ 元数据 */

export const CHANGE_STATUS_META: Record<ChangeStatus, { label: string; cls: string; dot: string }> = {
  active: { label: "进行中", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  done: { label: "已完成", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  voided: { label: "已作废", cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" },
};

export const TASK_STATE_META: Record<
  TaskState,
  {
    label: string;
    chipCls: string;
    textCls: string;
    fill: string;
    stroke: string;
    text: string;
    /** 饱和实色，供饼图/堆叠条这类需要「一眼分得开」的场景使用（甘特图仍用上面的浅色 fill） */
    solid: string;
  }
> = {
  todo: {
    label: "进行中",
    chipCls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    textCls: "text-muted-foreground",
    fill: "#B5D4F4",
    stroke: "#185FA5",
    text: "#0C447C",
    solid: "#378ADD",
  },
  soon: {
    label: "临期",
    chipCls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    textCls: "text-amber-600 dark:text-amber-400",
    fill: "#FAC775",
    stroke: "#854F0B",
    text: "#633806",
    solid: "#EF9F27",
  },
  overdue: {
    label: "超期未完成",
    chipCls: "bg-red-500/10 text-red-600 dark:text-red-400",
    textCls: "text-red-600 dark:text-red-400",
    fill: "#F7C1C1",
    stroke: "#A32D2D",
    text: "#791F1F",
    solid: "#E24B4A",
  },
  done: {
    label: "按时完成",
    chipCls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    textCls: "text-emerald-600 dark:text-emerald-400",
    fill: "#C0DD97",
    stroke: "#3B6D11",
    text: "#27500A",
    solid: "#639922",
  },
  late: {
    label: "迟交完成",
    chipCls: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    textCls: "text-orange-600 dark:text-orange-400",
    fill: "#F5C4B3",
    stroke: "#993C1D",
    text: "#712B13",
    solid: "#D85A30",
  },
};

/** 甘特图内的父条 / 汇总条：一律中性灰（报警交给卡片与角标） */
export const GANTT_SUMMARY_COLOR = { fill: "#D3D1C7", stroke: "#5F5E5A", text: "#2C2C2A" };

/**
 * 分类维度的固定色板（变更类型 / 项目饼图用）。
 *
 * ★ 按「排序位次」取色，不按 id 取 —— 保证同一份数据每次渲染颜色一致、不跳。
 * ★ 刻意避开红/黄/绿：那三色在本模块是**状态语义**（超期/临期/完成），
 *   拿去做分类色会让人误以为"这个类型出问题了"。分类与状态必须分得开。
 */
export const CATEGORY_PALETTE: readonly string[] = [
  "#378ADD",
  "#7F77DD",
  "#1D9E75",
  "#D85A30",
  "#D4537E",
  "#BA7517",
  "#0F6E56",
  "#888780",
];

/** 取分类色，越界自动回卷；空色板兜底为中性灰 */
export function categoryColor(index: number): string {
  const n = CATEGORY_PALETTE.length;
  if (n === 0) return "#888780";
  return CATEGORY_PALETTE[((index % n) + n) % n] ?? "#888780";
}

/** 五色堆叠条的固定渲染顺序（与后端 _TASK_STATE_ORDER 一致） */
export const TASK_STATE_ORDER: readonly TaskState[] = ["todo", "soon", "overdue", "done", "late"];

/** ★「未完成」状态集合（= 待办项）。
 *  统计卡「待办项」与项目饼图「待办项数」都必须用它 —— 否则同一个词会在同屏给出两个数：
 *  含已完成的全量（33）vs 未完成（21）。五色构成条则相反，本就应该含已完成。 */
export const TASK_STATE_OPEN: readonly TaskState[] = ["todo", "soon", "overdue"];

export const ALERT_LEVEL_META: Record<AlertLevel, { label: string; chipCls: string }> = {
  overdue: { label: "已超期", chipCls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  near: { label: "临期", chipCls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  late: { label: "迟交完成", chipCls: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
};

/* --------------------------------------------------------------- 兜底取值 */

export function changeStatusMeta(s: string | null | undefined) {
  return CHANGE_STATUS_META[(s ?? "") as ChangeStatus] ?? CHANGE_STATUS_META.active;
}

export function taskStateMeta(s: string | null | undefined) {
  return TASK_STATE_META[(s ?? "") as TaskState] ?? TASK_STATE_META.todo;
}

export function alertLevelMeta(s: string | null | undefined) {
  return ALERT_LEVEL_META[(s ?? "") as AlertLevel] ?? ALERT_LEVEL_META.overdue;
}

/** 行首色点：整单最差状态（红 > 黄 > 绿 > 灰） */
export function changeDotClass(c: Pick<Change, "status" | "overdue_leaf" | "near_leaf" | "leaf_total" | "leaf_done">): string {
  if (c.status === "voided") return "bg-muted-foreground/40";
  if (c.overdue_leaf > 0) return "bg-red-500";
  if (c.near_leaf > 0) return "bg-amber-500";
  if (c.leaf_total > 0 && c.leaf_done === c.leaf_total) return "bg-emerald-500";
  return "bg-muted-foreground/30";
}

/** 项目卡边框信号：有超期红边 / 只有临期黄边 / 正常灰边。
 *  ★ 用 ring 而非 border：卡片统一走 `<Card>`（`ring-1 ring-foreground/10`），
 *    信号色要覆盖这条 ring，否则红/黄边会被灰 ring 盖掉。 */
export function projectCardClass(o: Pick<ChangeProjectOverview, "overdue_changes" | "near_changes">): string {
  if (o.overdue_changes > 0) return "ring-red-500/60";
  if (o.near_changes > 0) return "ring-amber-500/60";
  return "";
}

/** 超期天数显示文案（≤ 0 返回 null） */
export function overdueText(days: number): string | null {
  return days > 0 ? `超期 ${days} 天` : null;
}
