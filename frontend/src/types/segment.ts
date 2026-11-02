/** 供应商细分（意愿 × 能力四象限） */

/** 12 项唯一合法的档位值。与后端 `app/scoring.py` 的 TIERS 一一对应。 */
export const SEGMENT_TIERS = [1, 0.7, 0.5, 0.3, 0] as const;
export type SegmentTier = (typeof SEGMENT_TIERS)[number];

/** 档位展示文案（0 显示为 0，不能显示成空 —— 空是「未评」） */
export function tierLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export type Quadrant = "partner" | "dependent" | "nurture" | "exit" | "incomplete";

export interface QuadrantMeta {
  key: Quadrant;
  label: string;
  /** 点/标签主色 */
  color: string;
  /** 象限底色（markArea 用，浅） */
  soft: string;
  action: string;
}

/**
 * 四象限元数据 —— 名称、配色、动作建议的唯一来源。
 * 颜色刻意与「红黄绿状态色」区分开：这里的绿只表示「能力意愿都过关」，
 * 不表示「没问题」；红同理只表示「双低」，不表示告警等级。
 */
export const QUADRANTS: QuadrantMeta[] = [
  { key: "partner", label: "意愿高、能力强", color: "#16a34a", soft: "#ecfdf5", action: "加份额 · 优先新项目 · 联合降本" },
  { key: "dependent", label: "意愿低、能力强", color: "#2563eb", soft: "#eff6ff", action: "保供优先 · 启动第二来源 · 高层对话" },
  { key: "nurture", label: "意愿高、能力弱", color: "#d97706", soft: "#fffbeb", action: "给辅导与试单 · 份额设上限" },
  { key: "exit", label: "意愿低、能力弱", color: "#dc2626", soft: "#fef2f2", action: "不新增份额 · 变更单立项切换" },
  { key: "incomplete", label: "未评级", color: "#94a3b8", soft: "#f8fafc", action: "补录后再评" },
];

export const QUADRANT_MAP: Record<Quadrant, QuadrantMeta> = QUADRANTS.reduce(
  (acc, item) => ({ ...acc, [item.key]: item }),
  {} as Record<Quadrant, QuadrantMeta>
);

export type CardColor = "red" | "yellow";

export const CARD_META: Record<CardColor, { label: string; color: string; action: string }> = {
  red: { label: "红牌", color: "#dc2626", action: "停止新增份额，启动替代" },
  yellow: { label: "黄牌", color: "#d97706", action: "不新增份额，限期整改" },
};

export const CAP_DIMS = [
  { key: "a1", label: "PN 质量绩效" },
  { key: "a2", label: "交付达成率" },
  { key: "a3", label: "合格率" },
  { key: "a4", label: "成本" },
  { key: "a5", label: "CFT 飞行稽查" },
  { key: "a6", label: "质量服务分" },
] as const;

export const WILL_DIMS = [
  { key: "w1", label: "降价意愿" },
  { key: "w2", label: "建库意愿" },
  { key: "w3", label: "紧急交付" },
  { key: "w4", label: "沟通态度" },
  { key: "w5", label: "回复及时率" },
  { key: "w6", label: "产能弹性" },
] as const;

export type TierKey =
  | "tier_a1"
  | "tier_a2"
  | "tier_a3"
  | "tier_a4"
  | "tier_a5"
  | "tier_a6"
  | "tier_w1"
  | "tier_w2"
  | "tier_w3"
  | "tier_w4"
  | "tier_w5"
  | "tier_w6";

/** 12 项档位字段（键名与后端一致，便于直接透传） */
export type TierValues = { [K in TierKey]: number | null };

export interface Segment extends TierValues {
  id: number;
  period: string;
  material_id: number;
  pn: string;
  material_name: string;
  segment: string | null;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  cap_score: number | null;
  will_score: number | null;
  quadrant: Quadrant;
  card_snapshot: CardColor | null;
  /** 该期间实际生效的牌（可能与快照不同：牌可能是事后补录的） */
  card: CardColor | null;
  cap_filled: number;
  will_filled: number;
  evaluator: string | null;
  evaluated_on: string | null;
  note: string | null;
  updated_at: string | null;
}

export interface SegmentUpsertInput extends Partial<TierValues> {
  period: string;
  material_code: string;
  supplier_code: string;
  evaluator?: string | null;
  evaluated_on?: string | null;
  note?: string | null;
}

export interface SegmentSummary {
  period: string;
  total: number;
  by_quadrant: Record<string, number>;
  avg_cap: number | null;
  avg_will: number | null;
  incomplete: number;
  card_count: number;
  red_card_count: number;
}

export interface SegmentCopyResult {
  from_period: string;
  to_period: string;
  copied: number;
  skipped: number;
}

export interface SegmentImportResult {
  created: number;
  updated: number;
  /** 非空 = 整批未写入（一个错都不放行） */
  errors: string[];
}

export interface SegmentConfig {
  threshold: number;
  weights: Record<string, Record<string, number>>;
  preset: "business" | "equal";
}

export interface SegmentPrefill {
  found: boolean;
  period: string | null;
  tiers: Partial<TierValues>;
}

export interface SupplierCard {
  id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  card: CardColor;
  reason: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  released_by: string | null;
  release_reason: string | null;
  active: boolean;
}

export interface SupplierCardCreateInput {
  supplier_id: number;
  card: CardColor;
  reason: string;
  effective_from?: string;
  created_by?: string;
}

export interface SupplierCardReleaseInput {
  release_reason: string;
  effective_to?: string;
  released_by?: string;
}
