/** 供应商风险等级（地图点位红黄绿显示规则） */
export type SupplierRiskLevel = "red" | "yellow" | "green";

/** 未评估的风险等级占位（后端返回 null，前端归一为 "none"） */
export type SupplierRiskKey = SupplierRiskLevel | "none";

/** 风险等级展示元信息（红=高 / 黄=中 / 绿=正常 / 灰=未评估）
 *
 * 注意：红黄绿判定规则未定，录入供应商时**不带颜色**；颜色由规则确定后的对应模块联动填充。
 * 未评估（none）显示灰色，不冒充红黄绿。
 */
export const RISK_META: Record<
  SupplierRiskKey,
  { label: string; color: string; dot: string; desc: string }
> = {
  red: {
    label: "高风险",
    color: "#ef4444",
    dot: "bg-red-500",
    desc: "重点物料独供 / 存在断供风险",
  },
  yellow: {
    label: "中风险",
    color: "#f59e0b",
    dot: "bg-amber-500",
    desc: "备选有限，需关注",
  },
  green: {
    label: "正常",
    color: "#22c55e",
    dot: "bg-green-500",
    desc: "正常供应，多源竞争",
  },
  none: {
    label: "未评估",
    color: "#94a3b8",
    dot: "bg-slate-400",
    desc: "风险判定规则未定，暂无颜色",
  },
};

/** 地图/统计展示顺序：红 → 黄 → 绿 → 未评估 */
export const RISK_ORDER: SupplierRiskKey[] = ["red", "yellow", "green", "none"];

/** 由后端 risk_level 值归一为前端展示键（null → "none"） */
export function riskKeyOf(level: SupplierRiskLevel | null | undefined): SupplierRiskKey {
  return level ?? "none";
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

/** 供应商实体（与后端 SupplierRead 对应）
 *
 * 供应商主数据层承载身份信息（代码/名称/地图点位/联系人）与 risk_level。
 * risk_level：NULL = 未评估（地图显示灰色）；红黄绿判定规则未定，规则确定后由对应模块联动填充。
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
  /** 风险等级（地图点位颜色）：null = 未评估；录入时不要求提供 */
  risk_level: SupplierRiskLevel | null;
  remark: string | null;
  materials: SupplierMaterial[];
  created_at: string;
  updated_at: string;
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
