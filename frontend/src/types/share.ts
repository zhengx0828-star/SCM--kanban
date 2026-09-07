/** 份额管理（L2 供应关系 × 月份快照） */

/** QDC 离散五档（唯一合法值） */
export const QDC_SCORES = [1, 0.7, 0.5, 0.3, 0] as const;
export type QdcScore = (typeof QDC_SCORES)[number];

/** 基地快照单项（每条份额记录里 inline 维护，含拉线数 + 该供应商在该基地的配额）。

    - base   基地名（1-50 字符，必填）
    - lines  该基地的拉线数量（正整数 1-999，必填，每条记录自带）
    - share  该供应商在该基地的配额（0-1 小数为主，也兼容 0-100 百分比；可空表示「该供应商不供该基地」）

    系统份额 = Σ(b.share × b.lines) ÷ Σ(b.lines)（基地配额全部 ≤1 视为小数口径 ×100）
*/
export interface ShareBase {
  base: string;
  lines: number;
  share?: number | null;
}

/** 份额记录（含派生风险信号） */
export interface ShareRecord {
  id: number;
  project_id: number;
  project_name: string;
  supply_relation_id: number;
  month: string;
  pn: string;
  material_name: string;
  supplier_name: string;
  supplier_code: string;
  share_current: number | null;
  share_prev: number | null;
  quota_prev: number | null;
  quota_suggested: number | null;
  is_sole: boolean;
  q_score: number | null;
  d_score: number | null;
  c_score: number | null;
  weighted_score: number | null;
  weight_scheme: "cost" | "quality" | null;
  bases: ShareBase[] | null;
  edited_manually: boolean;
  remark: string | null;
  risk_sole: boolean;
  risk_fluctuation: boolean;
  risk_deviation: boolean;
}

export interface ShareRecordCreateInput {
  project_id: number;
  supply_relation_id: number;
  month: string;
  share_current?: number;
  q_score?: number;
  d_score?: number;
  c_score?: number;
  bases?: ShareBase[];
  remark?: string;
}

export type ShareRecordUpdateInput = Partial<Omit<ShareRecordCreateInput, "project_id" | "supply_relation_id" | "month">>;

export interface ShareRecordListResponse {
  items: ShareRecord[];
  total: number;
}

/** 份额项目简表（入口页项目列表） */
export interface ShareProjectBrief {
  project_id: number;
  code: string;
  name: string;
  months: string[];
}

/** KPI 汇总（项目 × 月） */
export interface ShareSummary {
  project_id: number;
  project_name: string;
  month: string;
  total_materials: number;
  total_relations: number;
  sole_materials: number;
  fluctuation_alerts: number;
  deviation_alerts: number;
  sticky_suppliers: number;
}

/** 风险排行条目 */
export interface ShareRiskItem {
  record_id: number;
  project_id: number;
  pn: string;
  material_name: string;
  supplier_name: string;
  supplier_code: string;
  share_current: number | null;
  share_prev: number | null;
  weighted_score: number | null;
  risk_type: "sole" | "fluctuation" | "deviation" | "mismatch";
  risk_level: "high" | "medium";
  detail: string;
}

/** 四象限散点 */
export interface ShareQuadrantPoint {
  pn: string;
  material_name: string;
  supplier_name: string;
  share: number;
  score: number;
  lines: number;
  is_sole: boolean;
  project_id: number;
}

/** Excel 导入结果 */
export interface ShareImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** 份额首页项目卡片标注：单项目波动/独供「预警条数」（记录级、与 KPI/风险排行同口径；按最新数据月统计） */
export interface ShareProjectRiskBrief {
  project_id: number;
  code: string;
  name: string;
  fluctuation_materials: number;
  sole_materials: number;
}

/** Dashboard 联动统计（跨项目、最新月） */
export interface ShareDashboardStats {
  month: string | null;
  fluctuation_materials: number;
  sole_materials: number;
  by_project: ShareProjectRiskBrief[];
}

/** 风险标签映射（前端展示） */
export const RISK_TYPE_LABELS: Record<ShareRiskItem["risk_type"], string> = {
  sole: "独供风险",
  fluctuation: "份额波动",
  deviation: "建议偏差",
  mismatch: "份额×评分错配",
};

/**
 * 风险类型配色（KPI 卡 / 项目卡 chip / 风险排行条目共用一套，避免上下对不上）：
 * 独供=红（高优先），份额波动 / 建议偏差=琥珀（关注），份额×评分错配=紫。
 * 排行条目按此着色（不再按 risk_level 上色）。
 */
export const RISK_TYPE_META: Record<
  ShareRiskItem["risk_type"],
  { label: string; rowBg: string; dot: string; text: string; hex: string }
> = {
  sole: { label: "独供风险", rowBg: "bg-red-500/10", dot: "bg-red-500", text: "text-red-600 dark:text-red-400", hex: "#ef4444" },
  fluctuation: { label: "份额波动", rowBg: "bg-amber-500/10", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", hex: "#f59e0b" },
  deviation: { label: "建议偏差", rowBg: "bg-amber-500/10", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", hex: "#f59e0b" },
  mismatch: { label: "份额×评分错配", rowBg: "bg-violet-500/10", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", hex: "#8b5cf6" },
};
