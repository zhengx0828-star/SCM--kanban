/**
 * 供需风险判定与聚合（纯函数，无运行时依赖，便于单独验证）。
 *
 * 口径（2026-10-14 与用户确认，第二版）：
 *   · **供应系数 = 产能 ÷ 需求**，格子里直接显示这个商（如 0.85 = 只够需求的 85%）
 *   · 状态三档 + 无数据：
 *       系数 < 1.0        → shortage 缺口（红）
 *       1.0 ≤ 系数 ≤ 1.3  → tight 紧张（黄）
 *       系数 > 1.3        → surplus 充足（绿）
 *       需求 = 0（含需求 0 但产能 > 0）→ none 无数据（灰，除不出系数）
 *   · 旧口径「紧张 = |差额| ≤ 需求 × 5%」已作废，改为上面的比值口径
 *   · 覆盖率 = Σ产能 ÷ Σ需求（全年总量比）；另给「最差物料覆盖率」兜底，
 *     避免总量够、单个物料却严重缺口的情况被掩盖
 */

export type RiskStatus = "shortage" | "tight" | "surplus" | "none";

/** 紧张区间下界（含）：系数 ≥ 1.0 即不再是缺口 */
export const TIGHT_RATIO_MIN = 1.0;
/** 紧张区间上界（含）：系数 ≤ 1.3 仍算紧张，超过才算充足 */
export const TIGHT_RATIO_MAX = 1.3;

export const MONTH_COUNT = 12;

/**
 * 供应系数 = 产能 ÷ 需求。
 * 需求 ≤ 0 时无意义（除零）→ 返回 null，调用方显示为「—」并着色为灰。
 */
export function supplyCoefOf(demand: number, capacity: number): number | null {
  if (!(demand > 0)) return null;
  return capacity / demand;
}

/**
 * 单月风险状态（比值口径）。
 * - 需求 = 0 → none（灰，无论产能多少）
 * - 系数 < 1.0 → shortage；1.0 ≤ 系数 ≤ 1.3 → tight；> 1.3 → surplus
 */
export function riskStatusOf(demand: number, capacity: number): RiskStatus {
  const coef = supplyCoefOf(demand, capacity);
  if (coef == null) return "none";
  if (coef < TIGHT_RATIO_MIN) return "shortage";
  if (coef <= TIGHT_RATIO_MAX) return "tight";
  return "surplus";
}

/** 某物料在任一月份处于「缺口」或「紧张」→ 视为有风险（用于物料下拉的红/绿点） */
export function isRiskyMonthly(demand: number, capacity: number): boolean {
  const s = riskStatusOf(demand, capacity);
  return s === "shortage" || s === "tight";
}

export interface MonthRisk {
  /** 该月物料需求（客户需求 × BOM） */
  demand: number;
  /** 该月该物料所有供应商产能合计 */
  capacity: number;
  /** capacity - demand */
  diff: number;
  /** 供应系数 = 产能 ÷ 需求；需求为 0 → null */
  coef: number | null;
  status: RiskStatus;
}

export interface MaterialRisk {
  pn: string;
  name: string;
  /** 长度 12（1-12 月） */
  monthly: MonthRisk[];
  totalDemand: number;
  totalCapacity: number;
  /** 全年最大缺口比例 = max(0, demand - capacity) / demand（0~1）；无缺口为 0 */
  worstGapRatio: number;
  /** 最大缺口所在月份下标（0-11）；无缺口为 -1 */
  worstMonthIndex: number;
  /** 是否存在任一月份处于「缺口」（不含紧张） */
  hasShortage: boolean;
  /** 是否存在任一月份处于「缺口」或「紧张」 */
  hasRisk: boolean;
}

/** 由「物料需求 12 月」+「该物料产能 12 月」构造风险行 */
export function buildMaterialRisk(
  pn: string,
  name: string,
  demandSeries: number[],
  capacitySeries: number[]
): MaterialRisk {
  const monthly: MonthRisk[] = [];
  let totalDemand = 0;
  let totalCapacity = 0;
  let worstGapRatio = 0;
  let worstMonthIndex = -1;
  let hasShortage = false;
  let hasRisk = false;

  for (let t = 0; t < MONTH_COUNT; t++) {
    const demand = demandSeries[t] ?? 0;
    const capacity = capacitySeries[t] ?? 0;
    const status = riskStatusOf(demand, capacity);
    monthly.push({ demand, capacity, diff: capacity - demand, coef: supplyCoefOf(demand, capacity), status });
    totalDemand += demand;
    totalCapacity += capacity;
    if (status === "shortage") {
      hasShortage = true;
      const ratio = demand > 0 ? (demand - capacity) / demand : 1;
      if (ratio > worstGapRatio) {
        worstGapRatio = ratio;
        worstMonthIndex = t;
      }
    }
    if (status === "shortage" || status === "tight") hasRisk = true;
  }

  return {
    pn,
    name,
    monthly,
    totalDemand,
    totalCapacity,
    worstGapRatio,
    worstMonthIndex,
    hasShortage,
    hasRisk,
  };
}

export interface SupplyRiskSummary {
  /** 存在缺口的物料数 */
  shortageMaterialCount: number;
  /** 存在缺口或紧张的物料数 */
  riskyMaterialCount: number;
  /** 参与统计的物料数 */
  materialCount: number;
  /** 全年产能覆盖率 = Σ产能 / Σ需求；无需求 → null */
  coverageRatio: number | null;
  /** 最差物料的年度覆盖率（仅统计有需求的物料）；无 → null */
  worstMaterialCoverage: number | null;
  /** 最早出现「缺口」的月份下标（0-11）；无缺口 → null */
  firstShortageMonth: number | null;
  /** 缺口比例最高的物料；无缺口 → null */
  worst: MaterialRisk | null;
  /** 全年缺口总量（Σ 月度正缺口） */
  totalGap: number;
}

export function summarizeSupplyRisk(materials: MaterialRisk[]): SupplyRiskSummary {
  const shortageMaterials = materials.filter((m) => m.hasShortage);
  const withDemand = materials.filter((m) => m.totalDemand > 0);

  const totalDemand = materials.reduce((a, m) => a + m.totalDemand, 0);
  const totalCapacity = materials.reduce((a, m) => a + m.totalCapacity, 0);
  const coverageRatio = totalDemand > 0 ? totalCapacity / totalDemand : null;

  const worstMaterialCoverage =
    withDemand.length > 0
      ? Math.min(...withDemand.map((m) => m.totalCapacity / m.totalDemand))
      : null;

  let firstShortageMonth: number | null = null;
  for (let t = 0; t < MONTH_COUNT; t++) {
    if (materials.some((m) => m.monthly[t]?.status === "shortage")) {
      firstShortageMonth = t;
      break;
    }
  }

  const worst = shortageMaterials.length
    ? shortageMaterials.reduce((a, b) => (b.worstGapRatio > a.worstGapRatio ? b : a))
    : null;

  const totalGap = materials.reduce(
    (a, m) => a + m.monthly.reduce((s, x) => s + Math.max(0, x.demand - x.capacity), 0),
    0
  );

  return {
    shortageMaterialCount: shortageMaterials.length,
    riskyMaterialCount: materials.filter((m) => m.hasRisk).length,
    materialCount: materials.length,
    coverageRatio,
    worstMaterialCoverage,
    firstShortageMonth,
    worst,
    totalGap,
  };
}
