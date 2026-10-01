/** 库存信号塔：动态库存与 DOH 风险监控看板 —— 类型定义（与后端 schemas.py 对齐） */

/** 预警状态（与后端 INV_STATUS_* 一致） */
export const INV_STATUS = {
  stockout: "stockout", // 深红：期末 ≤ 0
  red: "red", // 浅红：期末 < SS 或 DOH < 安全天数
  yellow: "yellow", // 黄：DOH 贴近安全线 [安全, 安全×1.25)
  blue: "blue", // 蓝：DOH > 过剩天数（积压）
  ok: "ok",
} as const;
export type InvStatus = (typeof INV_STATUS)[keyof typeof INV_STATUS];

/** 波动标签 */
export const INV_COV_LABEL = {
  high: "high",
  mid: "mid",
  low: "low",
  na: "na",
} as const;
export type InvCovLabel = (typeof INV_COV_LABEL)[keyof typeof INV_COV_LABEL];

/** 需求来源：master = 与底表联动（客户需求 × BOM）；snapshot = 档案自带快照 */
export const INV_SOURCE = {
  master: "master",
  snapshot: "snapshot",
} as const;
export type InvSource = (typeof INV_SOURCE)[keyof typeof INV_SOURCE];

/** 产能校验状态（与后端 INV_CAPACITY_* 一致） */
export const INV_CAPACITY = {
  ok: "ok", // 占用 ≤ 70%：充足
  tight: "tight", // 70% ~ 100%：紧张
  short: "short", // > 100%：超出分配额度
  na: "na", // 额度未录入，无法校验
} as const;
export type InvCapacityStatus = (typeof INV_CAPACITY)[keyof typeof INV_CAPACITY];

/** 波动/预警的展示文案与配色（与规则页 SOP 同口径） */
export const INV_STATUS_META: Record<InvStatus, { label: string; cellCls: string; textCls: string; bar: string }> = {
  stockout: { label: "已断货", cellCls: "bg-red-700 text-white", textCls: "text-red-600 dark:text-red-400", bar: "bg-red-700" },
  red: { label: "偏低", cellCls: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300", textCls: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
  yellow: { label: "贴近安全", cellCls: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300", textCls: "text-amber-600 dark:text-amber-400", bar: "bg-amber-400" },
  blue: { label: "过剩", cellCls: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300", textCls: "text-blue-600 dark:text-blue-400", bar: "bg-blue-500" },
  ok: { label: "正常", cellCls: "bg-muted/40", textCls: "text-muted-foreground", bar: "bg-emerald-500" },
};

export const INV_COV_META: Record<InvCovLabel, { label: string; cls: string }> = {
  high: { label: "高波动", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  mid: { label: "中波动", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  low: { label: "低波动", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  na: { label: "不可算", cls: "bg-muted text-muted-foreground" },
};

/* ------------------------------------------------------------------ */
/* 顶部四卡口径：今日 DOH 四档                                          */
/* 与「预警状态（每格颜色）」是两套口径：颜色看期末/SS/安全线，四卡只看今日 DOH。 */
/* 判定唯一入口 = 后端 routes/inventory.py::_doh_bucket_of（前端不重算，防漂移）。 */
/* ------------------------------------------------------------------ */

export const INV_DOH_BUCKET = {
  stockout: "stockout", // ① DOH <= 0
  urgent: "urgent", // ② DOH < 安全天数，或 DOH < 绝对阈值（INV_URGENT_DOH_THRESHOLD=3 天）
  low: "low", // ③ 安全天数 <= DOH < LeadTime
  ok: "ok", // ④ DOH >= LeadTime
  unknown: "unknown", // ⑤ 需求不可用三档，绝不入正常档
} as const;
export type InvDohBucket = (typeof INV_DOH_BUCKET)[keyof typeof INV_DOH_BUCKET];

/**
 * 四档展示配置。
 * ⚠️ 枚举兜底：取值一律 `INV_DOH_BUCKET_META[x] ?? INV_DOH_BUCKET_FALLBACK`，
 * 否则后端新增取值时 `undefined.cardCls` 会白屏（同 INV_STATUS_META 的历史坑）。
 */
export const INV_DOH_BUCKET_META: Record<
  InvDohBucket,
  {
    label: string;
    desc: string;
    hint: string;
    cardCls: string;
    bar: string;
    textCls: string;
    chipCls: string;
    order: number;
  }
> = {
  stockout: {
    label: "库存耗尽",
    desc: "DOH ≤ 0",
    hint: "期末库存已归零，或今日已断货 —— 立即处理",
    cardCls: "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10",
    bar: "bg-red-700",
    textCls: "text-red-700 dark:text-red-400",
    chipCls: "bg-red-700 text-white",
    order: 0,
  },
  urgent: {
    label: "紧急",
    desc: "DOH < 安全天数，或 DOH < 3 天",
    hint: "已跌破安全库存线，或库存不足 3 天 —— 需立即安排采购",
    cardCls: "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/5",
    bar: "bg-red-500",
    textCls: "text-red-600 dark:text-red-400",
    chipCls: "bg-red-500/15 text-red-700 dark:text-red-400",
    order: 1,
  },
  low: {
    label: "偏低",
    desc: "DOH < LeadTime",
    hint: "剩余覆盖不足以走完一次采购周期 —— 排进补货计划",
    cardCls: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/5",
    bar: "bg-amber-400",
    textCls: "text-amber-700 dark:text-amber-400",
    chipCls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  order: 2,
  },
  ok: {
    label: "充足",
    desc: "DOH ≥ LeadTime",
    hint: "覆盖完整采购周期 —— 维持观察",
    cardCls: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/5",
    bar: "bg-emerald-500",
    textCls: "text-emerald-700 dark:text-emerald-400",
    chipCls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    order: 3,
  },
  unknown: {
    label: "无法评估",
    desc: "需求数据不可用",
    hint: "缺需求数据 / BOM 系数为 0 / 需求为 0 —— 先补录底层数据才会参与预警",
    cardCls: "border-border bg-muted/40",
    bar: "bg-muted-foreground/40",
    textCls: "text-muted-foreground",
    chipCls: "bg-muted text-muted-foreground",
    order: 4,
  },
};

/** 兜底项（后端新增取值时使用，绝不显示 undefined） */
export const INV_DOH_BUCKET_FALLBACK = {
  label: "未知档",
  desc: "—",
  hint: "后端返回了未登记的档位取值",
  cardCls: "border-border bg-muted/40",
  bar: "bg-muted-foreground/40",
  textCls: "text-muted-foreground",
  chipCls: "bg-muted text-muted-foreground",
  order: 99,
};

/** 四卡展示顺序：① 耗尽 → ② 紧急 → ③ 偏低 → ④ 充足 → ⑤ 无法评估 */
export const INV_DOH_BUCKET_ORDER: InvDohBucket[] = ["stockout", "urgent", "low", "ok", "unknown"];

/** 某档的展示配置（带兜底） */
export function dohBucketMeta(bucket: string) {
  return INV_DOH_BUCKET_META[bucket as InvDohBucket] ?? INV_DOH_BUCKET_FALLBACK;
}

/* ------------------------------------------------------------------ */
/* L0 项目卡片墙                                                        */
/* ------------------------------------------------------------------ */

/** 项目级 DOH 分布（含「无法评估」三档成因细分） */
export interface InventoryDohBuckets {
  stockout: number;
  urgent: number;
  low: number;
  ok: number;
  unknown: number;
  unknown_no_series: number; // 缺需求数据
  unknown_bom_zero: number; // BOM 系数为 0
  unknown_demand_blank: number; // 需求为 0
}

/** 项目内最紧急的推算单元 */
export interface InventoryMostUrgent {
  material_name: string;
  pn: string;
  base_name: string;
  doh: number;
  bucket: string;
}

/** 项目卡片（L0）：不含任何物料明细 */
export interface InventoryProjectOverview {
  project_id: number;
  project_code: string;
  project_name: string;
  plan_count: number;
  material_count: number;
  doh_buckets: InventoryDohBuckets;
  most_urgent: InventoryMostUrgent | null;
}

/** 列表密度 */
export type InventoryDensity = "comfortable" | "compact";

/** 列表排序字段 */
export type InventorySortKey = "doh" | "pn" | "replenish" | "lt" | "order";

/** 产能校验的展示文案与配色 */
export const INV_CAPACITY_META: Record<
  InvCapacityStatus,
  { label: string; cls: string; bar: string; dot: string; hint: string }
> = {
  ok: { label: "产能充足", cls: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", dot: "bg-emerald-500", hint: "占用不超过 70%" },
  tight: { label: "产能紧张", cls: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", dot: "bg-amber-500", hint: "占用 70% 至 100%" },
  short: {
    label: "产能不足",
    cls: "text-red-600 dark:text-red-400",
    bar: "bg-red-500",
    dot: "bg-red-500",
    hint: "超出当月分配额度；若显示「当月未分配额度」= 该月额度显式为 0，任何补货量都超额度",
  },
  na: {
    label: "未录额度",
    cls: "text-muted-foreground",
    bar: "bg-muted-foreground/40",
    dot: "bg-muted-foreground/50",
    hint: "该供应商在本项目上的月产能未录入 —— 到「供需管理」→ 物料明细 → 供应商产能明细 补录后即可校验",
  },
};

/** 30 天矩阵中某一日的完整单元格 */
export interface InventoryCell {
  date: string; // YYYY-MM-DD
  sys_demand: number; // 系统预测需求（摊日均或已被覆盖）
  sys_overridden: boolean; // 系统预测格是否被手工改过
  manual_demand: number; // 手工修正需求
  manual_in: number; // 手工修正入库
  ending: number; // 期末库存
  ending_overridden: boolean; // 期末是否被直接覆盖
  doh: number; // 动态 DOH
  doh_capped: boolean; // 是否 30+（窗口内未耗尽）
  status: InvStatus;
  manual: boolean; // 该日是否有任一手工数据
}

/** 推算单元行（左冻结列 + 30 天矩阵 + 补货建议 + 产能校验） */
export interface InventoryPlan {
  id: number;
  project_id: number;
  project_code: string;
  project_name: string;
  supplier_id: number;
  supplier_name: string;
  supplier_code: string;
  base_id: number;
  base_name: string;
  material_id: number;
  pn: string;
  material_name: string;
  lead_time_days: number;
  on_hand: number;

  demand_source: InvSource;
  bom_factor: number | null;
  /** 需求序列存在但窗口日均需求 ≈ 0（漏录 / 客户需求为 0）—— 不能当「正常」看 */
  demand_blank: boolean;
  /** 底表联动且 BOM 系数显式为 0（需求被乘成 0） */
  bom_zero: boolean;
  cov: number | null;
  cov_label: InvCovLabel;
  avg_daily: number;
  hist: { m: string; q: number }[];
  fcast: { m: string; q: number }[];

  service_z: number; // 服务水平系数 Z
  safe_days: number; // 安全天数 = Z × COV × √LT
  safe_days_derived: boolean; // false = COV 不可算，回退兜底值
  ss: number; // 安全库存
  rop: number; // 再订货点

  replenish_qty: number | null; // 建议补货量（一个周期量）
  order_by_date: string | null; // 最晚下单日
  stockout_date: string | null; // 预计耗尽日
  days_until_order: number | null; // 距最晚下单日的天数（= 窗口下标，0 = 今天；不会为负）

  capacity_limit: number | null; // 该项目当月分配额度
  capacity_used: number | null; // 供应商当月总产能
  capacity_usage: number | null; // 占用率
  capacity_status: InvCapacityStatus;
  capacity_month: string | null;

  /** 顶部四卡档位（后端判定，前端直接用；不重算防口径漂移） */
  doh_bucket: string;
  /** 今日 DOH（capped 按窗口长度 30），四卡/排序/展示共用 */
  doh_today: number | null;

  days: InventoryCell[]; // 长度 30
}

/** 基地主数据 */
export interface BaseSite {
  id: number;
  code: string;
  name: string;
  city: string | null;
  remark: string | null;
  plan_count: number;
  created_at: string;
  updated_at: string;
}

export interface BaseSiteInput {
  code: string;
  name: string;
  city?: string | null;
  remark?: string | null;
}

/** 底表中可建档的「项目 × 物料 × 供应商」组合 */
export interface InventoryCandidate {
  project_id: number;
  project_code: string;
  project_name: string;
  material_id: number;
  pn: string;
  material_name: string;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  bom_factor: number | null;
  demand_months: number;
  planned_base_ids: number[];
}

export interface InventoryPlanCreateInput {
  project_id: number;
  material_id: number;
  supplier_id: number;
  base_id: number;
  lead_time_days: number;
  on_hand: number;
}

export interface InventoryBulkCreateResult {
  created: number;
  skipped: number;
  errors: string[];
}

/** 遗留 KPI 概览（当前页面未调用；顶部四卡已改版为「风险时间漏斗」） */
export interface InventorySummary {
  total_plans: number;
  stockout_pns: number;
  irreversible_pns: number;
  high_cov_pns: number;
  manual_cells: number;
  today: string;
}

/** 单日单元格批量更新项（date 外的字段：null=不改动；overrides 传 null=清空覆盖） */
export interface InventoryDayUpdateInput {
  date: string;
  demand_override?: number | null;
  manual_demand?: number | null;
  manual_in?: number | null;
  ending_override?: number | null;
  doh_target?: number | null;
}

/** 计划级更新（LeadTime / 初始库存） */
export interface InventoryPlanUpdateInput {
  lead_time_days?: number;
  on_hand?: number;
}

/** 列表/汇总的过滤参数 */
export interface InventoryFilter {
  project_ids?: string; // 逗号分隔；**必填**（L0 未选项目时不加载物料）
  base_ids?: string;
  supplier_ids?: string;
  pns?: string;
  bucket?: string; // 顶部四卡过滤：stockout / urgent / low / ok / unknown
  sort?: string; // doh(默认) / pn / replenish / lt / order
  service_z?: number;
  excess?: number;
}

/** Excel 导入结果 */
export interface InventoryImportResult {
  imported: number;
  updated: number;
  errors: string[];
}

/** 常用服务水平 ↔ Z 对照（前端下拉用，与后端 INV_SERVICE_LEVEL_OPTIONS 一致） */
export const SERVICE_LEVEL_OPTIONS: { percent: string; z: number }[] = [
  { percent: "90%", z: 1.28 },
  { percent: "95%", z: 1.65 },
  { percent: "97.5%", z: 1.96 },
  { percent: "99%", z: 2.33 },
];
