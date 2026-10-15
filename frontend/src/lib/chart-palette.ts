/**
 * 全站图表分类色板（唯一出口）。
 *
 * 背景：之前有三张互不相干的分类色板 ——
 *   - DemandLineChart.tsx 的 LINE_COLORS（10 色，含红黄绿，与状态语义撞）
 *   - MaterialSupplyCharts.tsx 的 DEMAND_COLORS / CAPACITY_COLORS（绿调为主）
 *   - types/change.ts 的 CATEGORY_PALETTE（8 色，正确避开红黄绿）
 *
 * 本文件以 CATEGORY_PALETTE 为**唯一定义源**，扩成 10 色，作为全站唯一出口。
 * 变更模块的 `categoryColor()` 仍走 CATEGORY_PALETTE（8 色），与本板前 8 色完全一致。
 *
 * ★ 硬约束（见 docs/visual-unification/01-视觉统一规范.md §8.5）：
 *   分类色板必须避开红/黄/绿 —— 那三色是「状态语义」（危险/警告/正常），
 *   拿去做分类色会让人误以为"这个类别出问题了"。分类与状态必须分得开。
 */

import { CATEGORY_PALETTE } from "@/types/change";

export const CHART_PALETTE = [
  ...CATEGORY_PALETTE,
  "#185FA5", // deep blue
  "#3C3489", // deep purple
] as const;

/** 取分类色，越界自动回卷；越界兜底为中性灰 */
export function categoryColor(index: number): string {
  const n = CHART_PALETTE.length;
  return CHART_PALETTE[((index % n) + n) % n] ?? "#888780";
}
