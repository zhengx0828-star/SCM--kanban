/**
 * 预警中心类型（Dashboard 即预警中心，无独立页面）。
 *
 * 数据结构与后端 `backend/app/routers/alerts.py` 一一对应。
 * 三条硬约定：
 *   1. `severity` 是**唯一**可跨来源比较的字段（p0 已发生 / p1 将发生 / p2 偏离）；
 *   2. `impact` 单位因 kind 而异（件 / 天 / 百分点 / 单元数），只在同 kind 内可比；
 *      `due_in_days` 才是唯一可比的排序量（距出事天数，负数=已发生，null=无事件日）；
 *   3. `as_of` 每条自带时间口径 —— 份额是月快照、库存是今日、供需是某月，
 *      页面上不允许统一写「本月」。
 */

export type AlertSeverity = "p0" | "p1" | "p2";
export type AlertSource = "supply" | "inventory" | "change" | "share" | "data";

export interface AlertRef {
  project_id: number | null;
  material_id: number | null;
  pn: string | null;
  supplier_id: number | null;
  supplier_code: string | null;
  base_id: number | null;
  month: string | null;
  task_id: number | null;
  change_id: number | null;
  bucket: string | null;
}

export interface AlertProjectBrief {
  project_id: number;
  code: string;
  name: string;
}

export interface AlertItem {
  /** 稳定标识：同一问题反复出现时值不变（列表 key + 将来做「忽略」的锚点） */
  fingerprint: string;
  source: AlertSource;
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  as_of: string;
  impact: number;
  /** 距出事天数：负数或 0 = 已经发生/今天到点；null = 无事件日（份额、数据缺口） */
  due_in_days: number | null;
  project: AlertProjectBrief;
  ref: AlertRef;
}

export interface AlertDimStat {
  severity: AlertSeverity | null;
  count: number;
}

export interface AlertProjectWorst {
  kind: string;
  title: string;
  as_of: string;
}

export interface AlertProjectRow {
  project_id: number;
  code: string;
  name: string;
  severity: AlertSeverity | null;
  counts: Record<string, number>;
  dims: Partial<Record<AlertSource, AlertDimStat>>;
  worst: AlertProjectWorst | null;
}

export interface AlertThresholds {
  supply: { tight_min: number; tight_max: number };
  share: { fluctuation_ratio: number; deviation_pt: number };
  inventory: { urgent_doh: number };
}

export interface AlertResponse {
  generated_at: string;
  /** 份额口径基准月（最新有实际份额的月份，跳过月末结转的空档月） */
  base_month: string;
  horizon: string[];
  thresholds: AlertThresholds;
  counts: Record<string, number>;
  by_source: Record<string, number>;
  by_project: AlertProjectRow[];
  items: AlertItem[];
}

/* -------------------------------------------------------------------------- */
/*  展示元数据                                                                 */
/* -------------------------------------------------------------------------- */

export const ALERT_SEVERITY_ORDER: AlertSeverity[] = ["p0", "p1", "p2"];

export const ALERT_SEVERITY_META: Record<
  AlertSeverity,
  { label: string; hint: string; bar: string; chip: string; text: string; dot: string }
> = {
  p0: {
    label: "已发生",
    hint: "数量已经不够，或已经逾期。今天不动就出事。",
    bar: "bg-red-500",
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
  p1: {
    label: "将发生",
    hint: "有明确时间窗，或数据缺口让预警静默。",
    bar: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  p2: {
    label: "偏离",
    hint: "已完成但迟，或口径在恶化。不紧急。",
    bar: "bg-blue-500",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
};

/**
 * 目前五类。**第 6 类「供应商红黄绿」尚未接入**：地图点位已按 risk_level 着色，
 * 但判定规则没定义（人工打标）。规则定了再加 "supplier" 到本数组 ——
 * 加的时候必须同时补 ALERT_SOURCE_LABEL 与 lib/alert-link.ts 的 ALERT_TARGET_LABEL，
 * 否则矩阵会多出一个无标题列。
 */
export const ALERT_SOURCE_ORDER: AlertSource[] = ["supply", "inventory", "change", "share", "data"];

export const ALERT_SOURCE_LABEL: Record<AlertSource, string> = {
  supply: "供需",
  inventory: "库存",
  change: "变更",
  share: "份额",
  data: "数据缺口",
};

/** 矩阵列头（顺序固定，与后端 ALERT_SOURCE_ORDER 一致） */
export const ALERT_MATRIX_COLUMNS = ALERT_SOURCE_ORDER;
