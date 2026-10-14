/**
 * 地图点位布局：同坐标供应商的重叠处理（纯函数，无运行时依赖，便于单独验证）。
 *
 * 背景：地图坐标取「省份中心」（如广东 → 广州），所以**同一省份的供应商坐标完全相同**，
 * 散点会完全重合、只显示最上面一个。这里统一处理：
 *
 *   - 单点             → 原样
 *   - 同坐标 2~8 家    → **确定性环形散开**（按 id 升序取固定角度）
 *                        确定性很重要：否则每次刷新 / 切换项目切片，点位都会乱跳
 *   - 同坐标 > 8 家    → 聚合成一个**计数气泡**（显示家数，按组内最严重风险着色）
 *
 * 分组键用坐标保留 2 位小数（约 1km）：足以合并"同省会"点位，又不会误并不同城市。
 */

/** 风险键（与前端展示键一致；null = 未评估） */
export type MapRiskKey = "red" | "yellow" | "green" | "none";

/** 布局所需的最小供应商字段（`Supplier` 结构上兼容，无需强耦合主类型） */
export interface MapPointSupplier {
  id: number;
  name: string;
  longitude: number | null;
  latitude: number | null;
  city: string | null;
  supply_material: string | null;
  risk_level: "red" | "yellow" | "green" | null;
}

/** 单个散点（已算好最终展示坐标） */
export interface PlacedPoint {
  supplierId: number;
  name: string;
  lng: number;
  lat: number;
  city: string;
  supply_material: string;
  risk: MapRiskKey;
}

/** 聚合计数气泡 */
export interface ClusterPoint {
  lng: number;
  lat: number;
  count: number;
  city: string;
  risk: MapRiskKey;
}

/** 同坐标超过该家数 → 聚合成计数气泡（避免圆环挤成一团） */
export const OVERLAP_RING_MAX = 8;

/** 环形散开基准半径（单位：度，约 30km）；家数越多半径略增，避免点挨在一起 */
export const RING_BASE_RADIUS = 0.28;

const RISK_RANK: Record<MapRiskKey, number> = { red: 3, yellow: 2, green: 1, none: 0 };

/** 归一化风险等级：非法 / null → "none"（未评估） */
export function riskKeyOf(level: "red" | "yellow" | "green" | null | undefined): MapRiskKey {
  return level === "red" || level === "yellow" || level === "green" ? level : "none";
}

/** 取一组供应商里最严重的风险等级（用于聚合气泡着色：组内有红就显示红） */
export function pickSevereRisk(list: MapPointSupplier[]): MapRiskKey {
  let best: MapRiskKey = "none";
  for (const s of list) {
    const k = riskKeyOf(s.risk_level);
    if (RISK_RANK[k] > RISK_RANK[best]) best = k;
  }
  return best;
}

/** 按坐标归组（保留 2 位小数，约 1km 精度） */
export function groupByCoordinate(suppliers: MapPointSupplier[]): Map<string, MapPointSupplier[]> {
  const groups = new Map<string, MapPointSupplier[]>();
  for (const s of suppliers) {
    if (s.longitude == null || s.latitude == null) continue; // 地图字段未补全的不上图
    const key = `${s.longitude.toFixed(2)},${s.latitude.toFixed(2)}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }
  return groups;
}

/**
 * 计算所有供应商的最终展示点位。
 * 返回值：`points` = 普通散点（含散开后的坐标），`clusters` = 聚合计数气泡。
 */
export function computeSupplierPlacements(suppliers: MapPointSupplier[]): {
  points: PlacedPoint[];
  clusters: ClusterPoint[];
} {
  const groups = groupByCoordinate(suppliers);
  const points: PlacedPoint[] = [];
  const clusters: ClusterPoint[] = [];

  for (const arr of groups.values()) {
    // 单点：原样
    if (arr.length === 1) {
      const s = arr[0];
      points.push(toPoint(s, s.longitude as number, s.latitude as number));
      continue;
    }

    // 家数过多：聚合成计数气泡
    if (arr.length > OVERLAP_RING_MAX) {
      const head = arr[0];
      clusters.push({
        lng: head.longitude as number,
        lat: head.latitude as number,
        count: arr.length,
        city: head.city ?? "-",
        risk: pickSevereRisk(arr),
      });
      continue;
    }

    // 环形散开：按 id 升序 → 固定角度（确定性，刷新不乱跳）
    const ordered = [...arr].sort((a, b) => a.id - b.id);
    const radius = RING_BASE_RADIUS + 0.07 * (ordered.length - 2);
    ordered.forEach((s, i) => {
      const theta = (2 * Math.PI * i) / ordered.length;
      const lng = (s.longitude as number) + radius * Math.cos(theta);
      const lat = (s.latitude as number) + radius * Math.sin(theta);
      points.push(toPoint(s, lng, lat));
    });
  }

  return { points, clusters };
}

function toPoint(s: MapPointSupplier, lng: number, lat: number): PlacedPoint {
  return {
    supplierId: s.id,
    name: s.name,
    lng,
    lat,
    city: s.city ?? "-",
    supply_material: s.supply_material ?? "-",
    risk: riskKeyOf(s.risk_level),
  };
}
