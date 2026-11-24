import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { computeSupplierPlacements, type MapRiskKey } from "@/lib/supplier-map-points";
import { RISK_META, RISK_ORDER, supplierRiskOf, type Supplier, type SupplierRiskKey } from "@/types/supplier";

/**
 * 中国地图（ECharts 渲染）。
 * 数据源：阿里云 DataV 官方边界数据（frontend/public/maps/china.json），
 * 含 34 个省级行政区 + 台湾省 + 香港/澳门特别行政区 + 南海诸岛（九段线），保证领土完整。
 * 地图仅为静态 GeoJSON 渲染，不涉及任何地图服务 API / Key。
 *
 * 供应商点位：以 scatter 散点叠加在地图上，按风险等级着色（红/黄/绿/灰=未评估），
 * 点击点位通过 onSupplierClick 回调暴露供应商 id。
 *
 * pickMode（地图取点）：为「录入供应商」服务——开启后点击地图任意行政区，
 * 通过 convertFromPixel 反算点击坐标（经纬度），并从区域名识别省份，经 onMapPick 回调返回。
 * 点击海洋等区域外（无行政区名）不响应。
 *
 * 地图不展示任何省份维度的演示数据——只显示真实录入的供应商点位。
 *
 * 风险可读性（2026-11-03）：
 *   - 悬浮省份 → tooltip 列出该省全部供应商（名字 + 颜色 + 判定依据），红家排最前；
 *   - 悬浮点位 / 聚合气泡 → 同样给出名字与原因，气泡最多列 6 家 + 「另 N 家」；
 *   - 有红/黄的省份把省名常显在地图上（颜色同风险等级，白描边保证可读）；
 *   - 点击省份 → 该省高亮 + 右上角卡片列出名单，再点一次或点关闭取消。
 *
 * 同省重叠：坐标取的是省份中心，**同省供应商坐标完全相同**，散点会重合只显示一个。
 * 处理方式（见 @/lib/supplier-map-points）：
 *   2~8 家同坐标 → 确定性环形散开；> 8 家 → 聚合成计数气泡（显示家数）。
 *
 * 刷新机制：地图实例只初始化一次（跟随主题重建），suppliers 变化时仅增量更新散点系列，
 * 避免整图重建带来的竞态，保证录入后点位即时刷新。
 */

let chinaGeoPromise: Promise<unknown> | null = null;

function loadChinaGeo() {
  if (!chinaGeoPromise) {
    chinaGeoPromise = fetch("/maps/china.json")
      .then((res) => {
        if (!res.ok) throw new Error(`地图数据加载失败: ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        chinaGeoPromise = null; // 允许重试
        throw err;
      });
  }
  return chinaGeoPromise;
}

/** 供应商散点数据结构（value = [经度, 纬度]） */
interface SupplierScatterItem {
  name: string;
  value: [number, number];
  supplierId: number;
  city: string;
  supply_material: string;
  /** 判定依据第一句（红黄绿为什么是这个色） */
  reason?: string;
  /** 该点风险等级（tooltip 用，避免再按颜色反推） */
  risk: MapRiskKey;
}

/** 计数气泡数据（同坐标供应商过多时聚合展示） */
interface ClusterScatterItem {
  name: string;
  value: [number, number];
  count: number;
  city: string;
}

/** 构建散点系列（带 id，供增量 setOption 按 id 合并更新）。
 *
 * 坐标由 `computeSupplierPlacements` 统一计算：单点原样、同坐标 2~8 家环形散开、
 * > 8 家聚合成计数气泡。这里只负责按风险等级分组着色：
 * 红/黄/绿/灰（未评估），未评估不冒充红黄绿。
 */
function buildScatterSeries(suppliers: Supplier[]): echarts.SeriesOption[] {
  // ★ 颜色取接口实时判定 risk.level，人工 risk_level 只作为兜底
  const withRisk = suppliers.map((s) => ({ ...s, risk_level: s.risk?.level ?? s.risk_level }));
  const { points, clusters } = computeSupplierPlacements(withRisk);

  const reasons = new Map<number, string>();
  for (const s of suppliers) {
    const r = s.risk?.reasons?.[0];
    if (r) reasons.set(s.id, `${r.label}：${r.detail}`);
  }

  const scatterByRisk: Record<SupplierRiskKey, SupplierScatterItem[]> = {
    red: [],
    yellow: [],
    green: [],
    none: [],
  };
  for (const p of points) {
    scatterByRisk[p.risk].push({
      name: p.name,
      value: [p.lng, p.lat],
      supplierId: p.supplierId,
      city: p.city,
      supply_material: p.supply_material,
      reason: reasons.get(p.supplierId),
      risk: p.risk,
    });
  }

  const series = RISK_ORDER.map((risk) => {
    const riskColor = RISK_META[risk].color;
    return {
      id: `scatter-${risk}`,
      name: RISK_META[risk].label,
      type: "scatter",
      coordinateSystem: "geo",
      zlevel: 4,
      // 未评估点位略小，红/黄/绿稍大便于辨识
      symbolSize: risk === "none" ? 14 : risk === "red" ? 22 : risk === "yellow" ? 19 : 17,
      itemStyle: {
        color: riskColor,
        borderColor: "#0f172a",
        borderWidth: 1.2,
        opacity: 1,
      },
      emphasis: {
        scale: 1.6,
        itemStyle: {
          color: riskColor,
          borderColor: "#0f172a",
          borderWidth: 2,
        },
      },
      data: scatterByRisk[risk].map((d) => ({
        ...d,
        itemStyle: { color: riskColor, borderColor: "#0f172a", borderWidth: 1.2 },
      })),
    } as echarts.SeriesOption;
  });

  // 计数气泡：同坐标供应商超过阈值时聚合，显示家数，按组内最严重风险着色
  if (clusters.length > 0) {
    series.push({
      id: "scatter-cluster",
      name: "多供应商点位",
      type: "scatter",
      coordinateSystem: "geo",
      zlevel: 5,
      symbolSize: (_value: unknown, params: { data?: ClusterScatterItem }) => {
        const n = params.data?.count ?? 1;
        return Math.min(26 + n * 1.5, 58);
      },
      label: {
        show: true,
        formatter: (params: { data?: ClusterScatterItem }) => String(params.data?.count ?? ""),
        color: "#ffffff",
        fontSize: 12,
        fontWeight: 500,
      },
      itemStyle: {
        color: "#64748b",
        borderColor: "#0f172a",
        borderWidth: 2,
      },
      emphasis: { scale: 1.2 },
      data: clusters.map((c) => ({
        name: `${c.count} 家供应商`,
        value: [c.lng, c.lat],
        count: c.count,
        city: c.city,
        members: c.members,
        itemStyle: { color: RISK_META[c.risk].color, borderColor: "#0f172a", borderWidth: 2 },
      })),
    } as unknown as echarts.SeriesOption);
  }

  return series;
}

/** 商务风地图配色（低饱和灰蓝，背景用于突出供应商点位） */
const MAP_THEME = {
  light: {
    area: "#d8e0ec",
    border: "#7e8ea5",
    emphasis: "#bcd0e8",
  },
  dark: {
    area: "#141e30",
    border: "#33445e",
    emphasis: "#22324d",
  },
} as const;

function buildOption(
  dark: boolean,
  suppliers: Supplier[],
  /** 省份分组用 getter：tooltip formatter 是长生命周期闭包，直接传数组会一直用初始化时的空值 */
  getGroups: () => ProvinceGroup[],
  activeShort: string | null,
): echarts.EChartsOption {
  const groups = getGroups();
  const isDark = dark;
  const textColor = isDark ? "#e2e8f0" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  return {
    tooltip: {
      trigger: "item",
      backgroundColor: isDark ? "#1e293b" : "#ffffff",
      borderColor: isDark ? "#334155" : "#e2e8f0",
      textStyle: { color: textColor, fontSize: 12 },
      extraCssText: "max-width:340px;white-space:normal;",
      formatter: (params: unknown) => {
        const p = params as {
          componentType?: string;
          seriesType?: string;
          name?: string;
          data?: unknown;
        };


        if (p.seriesType !== "scatter") return "";
        const d = p.data as
          | {
              name?: string;
              city?: string;
              supply_material?: string;
              count?: number;
              reason?: string;
              risk?: MapRiskKey;
              members?: { name: string; risk: MapRiskKey }[];
            }
          | undefined;

        // 聚合气泡：组内成员逐家列出（红家在前）
        if (d?.count != null) {
          const members = d.members ?? [];
          const rows = members
            .slice(0, 6)
            .map((m) => {
              const meta = RISK_META[m.risk];
              return (
                `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">` +
                riskDot(meta.color) +
                `<span>${m.name}</span>` +
                `<span style="margin-left:auto;font-size:11px;opacity:.65">${meta.label}</span>` +
                `</div>`
              );
            })
            .join("");
          const rest = d.count - Math.min(6, members.length);
          return (
            `<div style="font-weight:600">${d.city ?? "-"} · ${d.count} 家供应商</div>` +
            rows +
            (rest > 0
              ? `<div style="margin-top:5px;font-size:11px;opacity:.6">另 ${rest} 家（点击省份看全部）</div>`
              : "")
          );
        }

        // 单点：名字 + 等级 + 物料 + 第一句判定依据
        const meta = RISK_META[d?.risk ?? "none"];
        return (
          `<div style="font-weight:600">${d?.name ?? p.name ?? "-"}</div>` +
          `<div style="margin-top:3px">${riskDot(meta.color)}<span style="margin-left:5px">${meta.label}</span></div>` +
          `<div style="margin-top:3px;opacity:.75">城市：${d?.city ?? "-"} · 物料：${d?.supply_material ?? "-"}</div>` +
          (d?.reason ? `<div style="margin-top:4px">${d.reason}</div>` : "")
        );
      },
    },
    legend: {
      data: RISK_ORDER.map((r) => RISK_META[r].label),
      orient: "horizontal",
      left: 16,
      top: 8,
      textStyle: { color: subTextColor, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 12,
      icon: "circle",
      backgroundColor: isDark ? "rgba(15,23,42,0.6)" : "rgba(255,255,255,0.72)",
      borderRadius: 6,
      itemGap: 12,
    },
    geo: {
      map: "china",
      roam: true,
      zoom: 1.15,
      // 省份名默认不显示；有红/黄的省份由 province-risk-label 系列单独常显
      label: { show: false },
      silent: false,
      itemStyle: {
        areaColor: isDark ? MAP_THEME.dark.area : MAP_THEME.light.area,
        borderColor: isDark ? MAP_THEME.dark.border : MAP_THEME.light.border,
        borderWidth: 0.7,
      },
      emphasis: {
        label: { show: true, color: textColor, fontWeight: 500 },
        itemStyle: { areaColor: isDark ? MAP_THEME.dark.emphasis : MAP_THEME.light.emphasis },
      },
      // 区域 tooltip 必须挂在 geo 上：ECharts 的 geo 区域提示不走全局 tooltip.formatter
      tooltip: {
        show: true,
        backgroundColor: isDark ? "#1e293b" : "#ffffff",
        borderColor: isDark ? "#334155" : "#e2e8f0",
        textStyle: { color: textColor, fontSize: 12 },
        extraCssText: "max-width:340px;white-space:normal;",
        formatter: (params: unknown) => {
          const q = params as { name?: string };
          const g = getGroups().find((x) => x.short === normalizeProvince(q.name));
          if (!g) return "";
          return (
            `<div style="font-weight:600">${q.name ?? g.short} · ${g.count} 家供应商</div>` +
            supplierRowsHtml(g.suppliers, 8)
          );
        },
      },
      // 选中的省份加深底色（只改区域配色，不重建地图，roam / zoom 不丢）
      regions: buildRegions(groups, activeShort, isDark),
    },
    series: [...buildScatterSeries(suppliers), ...buildProvinceLabelSeries(groups, isDark)],
    animationDuration: 500,
  };
}

interface ChinaMapProps {
  className?: string;
  /** 供应商点位数据（红/黄/绿/灰=未评估 散点） */
  suppliers?: Supplier[];
  /** 点击供应商点位回调 */
  onSupplierClick?: (supplier: Supplier) => void;
  /** 地图取点模式：开启后点击地图行政区返回经纬度 + 省份（供录入供应商预填） */
  pickMode?: boolean;
  /** 取点结果回调（经纬度 + 省份名，省份已去掉省/市/自治区等后缀） */
  onMapPick?: (point: { longitude: number; latitude: number; province: string }) => void;
}

/** 地图行政区名 → 供应商 city 常用名（去掉省/市/自治区等后缀；港澳台保留规范前缀） */
const PROVINCE_SUFFIX_RE = /壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市$/;
const REGION_ALIAS: Record<string, string> = {
  台湾: "中国台湾",
  香港: "中国香港",
  澳门: "中国澳门",
};
function normalizeProvince(raw?: string): string {
  if (!raw) return "";
  const n = raw.trim().replace(PROVINCE_SUFFIX_RE, "");
  return REGION_ALIAS[n] ?? n;
}

/** 风险排序（红 > 黄 > 绿 > 未判定） */
const RISK_RANK: Record<MapRiskKey, number> = { red: 3, yellow: 2, green: 1, none: 0 };

/** 一个省份下挂的供应商（同省坐标相同，是环形散开/聚合的来源） */
interface ProvinceGroup {
  /** 地图上的行政区全名（陕西省 / 广西壮族自治区），geo.regions 高亮要用 */
  full: string;
  /** 供应商 city 的常见名（陕西），作为 key 与省名标签 */
  short: string;
  lng: number;
  lat: number;
  count: number;
  risk: MapRiskKey;
  /** 组内已按风险从重到轻排序 */
  suppliers: Supplier[];
}

function buildProvinceGroups(suppliers: Supplier[], geoNames: string[]): ProvinceGroup[] {
  const groups = new Map<string, ProvinceGroup>();
  for (const s of suppliers) {
    if (s.longitude == null || s.latitude == null) continue;
    const short = normalizeProvince(s.city ?? "") || (s.city ?? "未知");
    const full = geoNames.find((n) => normalizeProvince(n) === short) ?? s.city ?? short;
    const g = groups.get(short);
    const key = supplierRiskOf(s);
    if (g) {
      g.suppliers.push(s);
      g.count += 1;
      if (RISK_RANK[key] > RISK_RANK[g.risk]) g.risk = key;
    } else {
      groups.set(short, { full, short, lng: s.longitude, lat: s.latitude, count: 1, risk: key, suppliers: [s] });
    }
  }
  for (const g of groups.values()) {
    g.suppliers.sort((a, b) => RISK_RANK[supplierRiskOf(b)] - RISK_RANK[supplierRiskOf(a)]);
  }
  return [...groups.values()];
}

/** 名字前的彩色小圆点（tooltip 是 HTML 字符串，必须内联样式） */
function riskDot(color: string): string {
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};"></span>`;
}

/** tooltip 里的供应商行：名字 + 颜色 + 第一句判定依据 */
function supplierRowsHtml(list: Supplier[], limit: number): string {
  const shown = list.slice(0, limit);
  const rows = shown
    .map((s) => {
      const meta = RISK_META[supplierRiskOf(s)];
      const reason = s.risk?.reasons?.[0];
      const sub = reason
        ? `<div style="margin-top:1px;font-size:11px;opacity:.72">${reason.label}：${reason.detail}</div>`
        : `<div style="margin-top:1px;font-size:11px;opacity:.55">无红黄信号</div>`;
      return (
        `<div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px">` +
        `<span style="flex:0 0 auto;margin-top:4px">${riskDot(meta.color)}</span>` +
        `<div style="min-width:0"><span style="font-weight:500">${s.name}</span>` +
        `<span style="margin-left:6px;font-size:11px;opacity:.6">${meta.label}</span>${sub}</div>` +
        `</div>`
      );
    })
    .join("");
  const rest = list.length - shown.length;
  return rows + (rest > 0 ? `<div style="margin-top:6px;font-size:11px;opacity:.6">另 ${rest} 家</div>` : "");
}

/** 选中省份的高亮：只改区域底色，不动 roam / zoom */
function buildRegions(groups: ProvinceGroup[], activeShort: string | null, dark: boolean) {
  return groups
    .filter((g) => g.full)
    .map((g) => ({
      name: g.full,
      itemStyle:
        activeShort === g.short
          ? {
              areaColor: dark ? "#1e40af" : "#bfdbfe",
              borderColor: "#2563eb",
              borderWidth: 1.4,
            }
          : { areaColor: dark ? MAP_THEME.dark.area : MAP_THEME.light.area },
    }));
}

/** 有红/黄的省份把省名常显在地图上（颜色即风险等级，白描边保证压在点上也看得清） */
function buildProvinceLabelSeries(groups: ProvinceGroup[], dark: boolean): echarts.SeriesOption[] {
  const risky = groups.filter((g) => g.risk === "red" || g.risk === "yellow");
  if (risky.length === 0) return [];
  return [
    {
      id: "province-risk-label",
      type: "scatter",
      coordinateSystem: "geo",
      zlevel: 6,
      symbolSize: 1,
      silent: true,
      label: {
        show: true,
        position: "top",
        distance: 14,
        formatter: (params: { data?: { short?: string } }) => params.data?.short ?? "",
        fontSize: 11,
        fontWeight: 500,
        textBorderColor: dark ? "#0f172a" : "#ffffff",
        textBorderWidth: 3,
      },
      data: risky.map((g) => ({
        name: g.short,
        short: g.short,
        value: [g.lng, g.lat],
        itemStyle: { color: "rgba(0,0,0,0)" },
        label: { color: RISK_META[g.risk].color },
      })),
    } as unknown as echarts.SeriesOption,
  ];
}

export function ChinaMap({ className, suppliers = [], onSupplierClick, pickMode = false, onMapPick }: ChinaMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();
  const onClickRef = useRef(onSupplierClick);
  onClickRef.current = onSupplierClick;
  const onPickRef = useRef(onMapPick);
  onPickRef.current = onMapPick;
  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const suppliersRef = useRef(suppliers);
  suppliersRef.current = suppliers;
  const geoReadyRef = useRef(false);
  /** 地图行政区全名（陕西省 / 广西壮族自治区），把供应商 city 对到 geo.regions */
  const geoNamesRef = useRef<string[]>([]);
  const [geoReady, setGeoReady] = useState(false);
  /** 点中的省份（简称）；再点一次或点关闭取消 */
  const [activeShort, setActiveShort] = useState<string | null>(null);
  const activeShortRef = useRef<string | null>(null);
  activeShortRef.current = activeShort;

  const groups = useMemo(
    () => buildProvinceGroups(suppliers, geoNamesRef.current),
    // geoReady 变化说明全名表刚就绪，需要重算一次
    [suppliers, geoReady]
  );
  const activeGroup = activeShort ? groups.find((g) => g.short === activeShort) : undefined;
  /** tooltip formatter 读这个 ref，保证拿到的永远是最新分组 */
  const groupsRef = useRef<ProvinceGroup[]>([]);
  groupsRef.current = groups;

  /* 取点模式下鼠标呈十字准星 */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.getInstanceByDom(el);
    if (!chart) return;
    chart.getDom().style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  /* 初始化地图实例（仅依赖主题，dark 变化时整图重建以匹配主题色） */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    let disposed = false;
    geoReadyRef.current = false;

    const attachClick = () => {
      chart.off("click");
      chart.on("click", (params: unknown) => {
        const p = params as {
          componentType?: string;
          seriesType?: string;
          name?: string;
          event?: { offsetX?: number; offsetY?: number };
          data?: { supplierId?: number };
        };
        // 取点模式：点击地图行政区 → 反算经纬度 + 省份
        if (pickModeRef.current) {
          if (p.componentType !== "geo") return; // 只响应省份区域（点击散点/海洋不取点）
          const province = normalizeProvince(p.name);
          if (!province) return; // 海洋等区域外无行政区名
          const e = p.event;
          if (e?.offsetX == null || e?.offsetY == null) return;
          const coord = chart.convertFromPixel({ geoIndex: 0 }, [e.offsetX, e.offsetY]);
          if (!Array.isArray(coord)) return;
          const lng = Number(coord[0]);
          const lat = Number(coord[1]);
          if (lng < 73 || lng > 135 || lat < 3 || lat > 54) return;
          onPickRef.current?.({
            longitude: Math.round(lng * 10000) / 10000,
            latitude: Math.round(lat * 10000) / 10000,
            province,
          });
          return;
        }
        // 点击省份：高亮该省并弹出名单（再点一次取消）
        if (p.componentType === "geo") {
          const short = normalizeProvince(p.name);
          if (!short) return;
          setActiveShort((prev) => (prev === short ? null : short));
          return;
        }
        if (p.componentType === "series" && p.seriesType === "scatter" && p.data?.supplierId != null) {
          const supplier = suppliersRef.current.find((s) => s.id === p.data!.supplierId);
          if (supplier) onClickRef.current?.(supplier);
        }
      });
    };

    loadChinaGeo()
      .then((geo) => {
        if (disposed) return;
        echarts.registerMap("china", geo as never);
        // 记下行政区全名，供 geo.regions 高亮使用
        const features = (geo as { features?: { properties?: { name?: string } }[] }).features ?? [];
        geoNamesRef.current = features.map((f) => f.properties?.name ?? "").filter(Boolean);
        setGeoReady(true);
        // 使用最新的 suppliers（防止 suppliers 早于地图加载完成的时序）
        chart.setOption(
          buildOption(dark, suppliersRef.current, () => groupsRef.current, activeShortRef.current),
          true
        );
        attachClick();
        chart.getDom().style.cursor = pickModeRef.current ? "crosshair" : "";
        geoReadyRef.current = true;
      })
      .catch(() => {
        if (disposed) return;
        // 地图加载失败：给出占位提示
        chart.setOption({
          title: { text: "地图数据加载失败", left: "center", top: "middle", textStyle: { fontSize: 14, color: "#94a3b8" } },
        });
      });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      chart.off("click");
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [dark]);

  /* 供应商数据 / 选中省份变化：增量更新（散点 + 风险省名 + 区域高亮），不重建地图。
     replaceMerge 保证系列与最新数据严格一致 —— 聚合气泡是动态增减的系列，
     纯 merge 会让消失的气泡残留（切换项目切片时尤其明显）。 */
  useEffect(() => {
    const el = ref.current;
    if (!el || !geoReadyRef.current) return;
    const chart = echarts.getInstanceByDom(el);
    if (!chart) return;
    const nextGroups = buildProvinceGroups(suppliers, geoNamesRef.current);
    chart.setOption(
      {
        series: [...buildScatterSeries(suppliers), ...buildProvinceLabelSeries(nextGroups, dark)],
        geo: { regions: buildRegions(nextGroups, activeShort, dark) },
      },
      { replaceMerge: ["series"] }
    );
  }, [suppliers, activeShort, dark]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className={cn("h-full w-full", className)} />

      {/* 点中省份后的名单：与 tooltip 同一份数据，省得反复悬停 */}
      {activeGroup && (
        <div className="absolute right-3 top-3 z-10 w-64 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {activeGroup.short} · {activeGroup.count} 家
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">点其他省份切换，再点一次取消</p>
            </div>
            <button
              type="button"
              aria-label="关闭省份名单"
              onClick={() => setActiveShort(null)}
              className="rounded p-0.5 transition-colors hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {activeGroup.suppliers.map((s) => {
              const key = supplierRiskOf(s);
              const reason = s.risk?.reasons?.[0];
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onClickRef.current?.(s)}
                    className="flex w-full items-start gap-1.5 rounded px-1 py-1 text-left transition-colors hover:bg-muted"
                  >
                    <span
                      className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: RISK_META[key].color }}
                    />
                    <span className="min-w-0">
                      <span className="text-xs font-medium">{s.name}</span>
                      <span className="ml-1 text-[11px] text-muted-foreground">{RISK_META[key].label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {reason ? `${reason.label}：${reason.detail}` : "无红黄信号"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
