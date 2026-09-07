import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { RISK_META, RISK_ORDER, riskKeyOf, type Supplier, type SupplierRiskKey } from "@/types/supplier";

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
}

/** 构建散点系列（带 id，供增量 setOption 按 id 合并更新）。
 * 按风险等级分组着色：红/黄/绿/灰（未评估），未评估不冒充红黄绿。 */
function buildScatterSeries(suppliers: Supplier[]): echarts.SeriesOption[] {
  const scatterByRisk: Record<SupplierRiskKey, SupplierScatterItem[]> = {
    red: [],
    yellow: [],
    green: [],
    none: [],
  };
  for (const s of suppliers) {
    // 底表供应商可能暂无坐标（地图字段未补全），不上地图
    if (s.longitude == null || s.latitude == null) continue;
    const key = riskKeyOf(s.risk_level);
    scatterByRisk[key].push({
      name: s.name,
      value: [s.longitude, s.latitude],
      supplierId: s.id,
      city: s.city ?? "-",
      supply_material: s.supply_material ?? "-",
    });
  }

  return RISK_ORDER.map((risk) => {
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
        borderColor: "rgba(15,23,42,0.75)",
        borderWidth: 1.5,
        shadowBlur: 16,
        shadowColor: "rgba(15,23,42,0.4)",
        opacity: 1,
      },
      emphasis: {
        scale: 1.6,
        itemStyle: {
          color: riskColor,
          borderColor: "#0f172a",
          borderWidth: 2,
          shadowBlur: 24,
          shadowColor: "rgba(15,23,42,0.5)",
        },
      },
      data: scatterByRisk[risk].map((d) => ({
        ...d,
        itemStyle: { color: riskColor, borderColor: "rgba(15,23,42,0.75)", borderWidth: 1.5 },
      })),
    } as echarts.SeriesOption;
  });
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

function buildOption(dark: boolean, suppliers: Supplier[]): echarts.EChartsOption {
  const isDark = dark;
  const textColor = isDark ? "#e2e8f0" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  return {
    tooltip: {
      trigger: "item",
      backgroundColor: isDark ? "#1e293b" : "#ffffff",
      borderColor: isDark ? "#334155" : "#e2e8f0",
      textStyle: { color: textColor, fontSize: 12 },
      // 仅响应散点：供应商详情
      formatter: (params: unknown) => {
        const p = params as { seriesType?: string; name?: string; data?: unknown };
        if (p.seriesType !== "scatter") return "";
        const d = p.data as { name?: string; city?: string; supply_material?: string } | undefined;
        return (
          `<div style="font-weight:600;margin-bottom:4px">${d?.name ?? p.name ?? "-"}</div>` +
          `<div>城市：${d?.city ?? "-"}</div>` +
          `<div>供应物料：${d?.supply_material ?? "-"}</div>`
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
      // 省份只作为底图轮廓，不显示名称标签、不响应 hover（避免假数据感知）
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
    },
    series: [...buildScatterSeries(suppliers)],
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
        // 使用最新的 suppliers（防止 suppliers 早于地图加载完成的时序）
        chart.setOption(buildOption(dark, suppliersRef.current), true);
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

  /* 供应商数据变化：地图就绪后仅增量更新散点系列（按 id 合并），点位即时刷新 */
  useEffect(() => {
    const el = ref.current;
    if (!el || !geoReadyRef.current) return;
    const chart = echarts.getInstanceByDom(el);
    if (!chart) return;
    chart.setOption({ series: buildScatterSeries(suppliers) });
  }, [suppliers]);

  return <div ref={ref} className={cn("h-full w-full", className)} />;
}
