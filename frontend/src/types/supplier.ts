/** 供应商风险等级（地图点位红黄绿显示规则） */
export type SupplierRiskLevel = "red" | "yellow" | "green";

/** 未评估的风险等级占位（后端返回 null，前端归一为 "none"） */
export type SupplierRiskKey = SupplierRiskLevel | "none";

/** 风险等级展示元信息（红=高 / 黄=中 / 绿=正常 / 灰=未判定）
 *
 * ★ 地图颜色读的是接口里的 `risk.level`（后端实时判定，见 `backend/app/supplier_risk.py`），
 *   不是表里的 `risk_level`（人工标红，只允许加红）。
 *   口径（2026-11-03 用户确认）：
 *     红 = 凡影响交付：红牌 / 黄牌 / 已断货 / 库存跌破 / 供需缺口 / 人工标红
 *     黄 = 不影响交付：有进行中的变更 / 唯一货源（独供但当前有货）
 *     绿 = 其余（含没有台账的 —— 用户明确「只要在地图上的就是绿的」）
 */
export const RISK_META: Record<
  SupplierRiskKey,
  { label: string; color: string; dot: string; desc: string }
> = {
  red: {
    label: "高风险",
    color: "#ef4444",
    dot: "bg-red-500",
    desc: "红牌或黄牌生效、已断货、库存跌破安全线、供需缺口、人工标红，命中任一",
  },
  yellow: {
    label: "中风险",
    color: "#f59e0b",
    dot: "bg-amber-500",
    desc: "有进行中的变更、唯一货源（仅此一家供应），命中任一",
  },
  green: {
    label: "正常",
    color: "#22c55e",
    dot: "bg-green-500",
    desc: "以上红黄情形一条都不命中（含未录份额/库存台账的）",
  },
  none: {
    label: "未判定",
    color: "#94a3b8",
    dot: "bg-slate-400",
    desc: "接口未返回判定结果",
  },
};

/** 地图/统计展示顺序：红 → 黄 → 绿 → 未评估 */
export const RISK_ORDER: SupplierRiskKey[] = ["red", "yellow", "green", "none"];

/**
 * 由后端 risk_level 值归一为前端展示键。
 * null / undefined → "none"（未评估）；后端若出现未登记的取值也只回落 "none"，
 * 避免 `RISK_META[x]` 取到 undefined 后读属性把整页渲染打崩。
 */
export function riskKeyOf(level: SupplierRiskLevel | null | undefined): SupplierRiskKey {
  return level && RISK_ORDER.includes(level as SupplierRiskKey) ? (level as SupplierRiskKey) : "none";
}

export const RISK_OPTIONS: { value: SupplierRiskLevel; label: string }[] = [
  { value: "red", label: "红 · 高风险" },
  { value: "yellow", label: "黄 · 中风险" },
  { value: "green", label: "绿 · 正常" },
];

/** 供应商关联的物料简要信息 */
export interface SupplierMaterial {
  id: number;
  pn: string;
  name: string;
  category: string | null;
}

/** 一条红黄绿判定依据（后端已按规则聚合，detail 带数字） */
export interface SupplierRiskReason {
  code:
    | "card_red"
    | "stockout"
    | "shortage"
    | "card_yellow"
    | "change"
    | "sole_low_stock"
    | "manual_red"
    | string;
  label: string;
  detail: string;
}

/** 供应商级红黄绿（实时算，不落库） */
export interface SupplierRisk {
  level: SupplierRiskLevel;
  reasons: SupplierRiskReason[];
  stats: Record<string, number>;
}

/** 供应商实体（与后端 SupplierRead 对应）
 *
 * 供应商主数据层承载身份信息（代码/名称/地图点位/联系人）。
 * `risk` 是接口实时下发的判定结果；`risk_level` 是库里的人工标记（只允许加红）。
 */
export interface Supplier {
  id: number;
  code: string;
  name: string;
  /** 城市/经纬度为地图场景字段，底表供应商可为 null */
  city: string | null;
  longitude: number | null;
  latitude: number | null;
  contact_person: string | null;
  phone: string | null;
  supply_material: string | null;
  /** 人工风险标记（库字段）：只用于「加红」，不参与降级 */
  risk_level: SupplierRiskLevel | null;
  /** 实时红黄绿（地图/统计的唯一颜色来源） */
  risk?: SupplierRisk;
  remark: string | null;
  materials: SupplierMaterial[];
  created_at: string;
  updated_at: string;
}

/** 供应商颜色取值：优先实时判定，缺失才回落人工值/未判定 */
export function supplierRiskOf(s: Pick<Supplier, "risk" | "risk_level">): SupplierRiskKey {
  return riskKeyOf(s.risk?.level ?? s.risk_level);
}

/** 新增供应商请求体（底表录入只需 code/name；risk_level 不要求提供，默认未评估） */
export interface SupplierCreateInput {
  code: string;
  name: string;
  city?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  contact_person?: string;
  phone?: string;
  supply_material?: string;
  risk_level?: SupplierRiskLevel | null;
  remark?: string;
}

/** 更新供应商请求体（地图录入时补全地图字段，字段均可选；传 null 或空串会清空字段） */
export interface SupplierUpdateInput {
  city?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  contact_person?: string | null;
  phone?: string | null;
  supply_material?: string | null;
  risk_level?: SupplierRiskLevel | null;
  remark?: string | null;
}
