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
  na: { label: "数据不足", cls: "bg-muted text-muted-foreground" },
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
  manual: boolean; // 该日是否有任一手工数据（三角标）
}

/** 推算单元行（左冻结列 + 30 天矩阵） */
export interface InventoryPlan {
  id: number;
  project_id: number;
  project_code: string;
  project_name: string;
  base: string;
  material_id: number;
  pn: string;
  material_name: string;
  lead_time_days: number;
  on_hand: number;
  cov: number | null;
  cov_label: InvCovLabel;
  avg_daily: number;
  ss: number;
  hist: { m: string; q: number }[];
  fcast: { m: string; q: number }[];
  days: InventoryCell[]; // 长度 30
}

/** 遗留 KPI 概览（当前页面未调用；顶部四卡已改版为「风险时间漏斗」，见 InventoryPage 内 RISK_CARDS/firstRiskBucket） */
export interface InventorySummary {
  total_plans: number;
  stockout_pns: number; // 断货高风险 SKU（PN 去重）
  irreversible_pns: number; // 不可逆断货预警
  high_cov_pns: number; // 高波动 SKU
  manual_cells: number; // 人工干预（手改单元格数）
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
  project_ids?: string; // 逗号分隔
  bases?: string;
  pns?: string;
  safe?: number;
  excess?: number;
}

/** Excel 导入结果 */
export interface InventoryImportResult {
  imported: number;
  updated: number;
  errors: string[];
}
