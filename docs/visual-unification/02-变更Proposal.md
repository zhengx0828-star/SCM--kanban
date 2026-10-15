# SCM 看板 · 视觉统一变更 Proposal（v1.1）

> 这份是**施工清单**：每一行 = 一个具体文件里的具体改动，从「现状」变成「目标」。
> 改完一页截图复核一页，再进下一页。总原则见 `01-视觉统一规范.md`。

## 施工进度（2026-10-15）

| 项 | 状态 |
|---|---|
| 0.1 `lib/chart-palette.ts` 共享色板 | ✅ 已建（引用替换并入第 5 步一起做） |
| 2.1 Dashboard 删 sky | ✅ 已改（卡5图标 → `bg-primary/10 text-primary`） |
| 1.1 供需 KpiCard → 顶部色条 + 深色数字 + 图标块 | ✅ 已改（对齐 DohBucketCards 基准） |
| 1.2 供需 ProjectCard → `<Card>` + Badge | ✅ 已改（键盘/点击语义保留） |
| 1.3 AnalysisSection | ✅ 无需改（已是统一骨架，作为标题栏卡片的范本） |
| 2.3 Dashboard 页头 text-4xl → text-2xl | ✅ 已改 |
| 3.1 OrderTimingBar → `<Card>` | ✅ 已改（L1 视图截图验证正常） |
| 3.2 库存页头 text-xl → text-2xl | ✅ 已改 |
| 6.2 全站页头字号收敛 text-2xl | ✅ 已改（供需/产品/规则/份额/份额明细/供应商列表/变更 共 7 页） |
| 4.1 ProjectChangeCard → `<Card>`（红/黄/灰 ring 信号保留） | ✅ 已改 |
| 4.2 GanttChart 容器 & 空态 → `<Card>` | ✅ 已改 |
| 4.3 GanttChart 状态角标透明度 /15 → /10 | ✅ 已改（保留紧凑 span，不进 Badge，因是树内行内角标） |
| 5.1 ShareQuadrantChart 散点蓝 → CHART_PALETTE 蓝 | ✅ 已改（图例同步 inline style 取同色） |
| 5.2 types/share.ts mismatch violet 保留 | ✅ 核对无改动需要 |
| 0.1 三张图表色板 → CHART_PALETTE 唯一出口 | ✅ 已改（LINE_COLORS/DEMAND_COLORS/CAPACITY_COLORS 已删除，全部引用 `lib/chart-palette.ts`；`CHART_PALETTE` 改为引用 `CATEGORY_PALETTE` 作唯一定义源 + 追加 2 色；产能柱取色错开半轮避免与需求折线同色） |
| 6.1 全局 rounded-xl/2xl 清理 | ✅ 已改（v1.2 补全：用户指出遗漏后，补改 10 处弹窗/图表/表格卡片，见下方 v1.2 说明） |
| 0.2 Badge 状态变体规整 | ✅ 已改（用户拍板全量统一：16 处 `bg-*-500/15` → `/10`，覆盖 ConceptHints 图例、SharePage 四色 chip、INV_DOH_BUCKET_META、InventoryDetailSheet 圆点、TaskTreeEditor、InventoryRow、ProjectCardWall；`fill-amber-400/15` 是 SVG 图表填充非徽章，保留） |
| 2.2（图标块保留状态色，结论不变） | ✅ v1.3 升级：5 卡补上顶部 3px 色条（`StatItem.bar`，与 chip 同语义色），hover 由无效的 border 改为 shadow-sm |
| 2.4 变更页 StatTile 统计卡 | ✅ v1.3：数字变色 → 顶部色条 + 深色数字（`STAT_TONE_BAR` 映射，Card 化 + 键盘语义保留；active 态对齐 DohBucketCards 的 `ring-2 ring-primary`） |

> **6.1 判定完成的依据**：全站 `rounded-2xl` 已无残留；`rounded-xl` 经 `@theme inline` 的 `--radius-xl: calc(var(--radius) + 4px)` 全站统一为一个值（14px），不存在"散落不一致"。所有**信息卡**（ProjectCard、ProjectChangeCard、KpiCard、OrderTimingBar、GanttChart 容器）已全部改为 `<Card>` 组件。剩余的手写 `rounded-xl border bg-card` 均为**表格容器 / 可点击按钮 / 浮层 / 提示条**（ChangeListTable、ChangeAlertTable、ProductsPage 表格壳、SharePage/ChangesPage/SupplierMasterPage 的列表项、ConceptHints popover），语义上不是"信息卡"，不应套 Card 组件——强行改属过度设计且引入布局回归风险（Card 自带 flex/gap/py 默认行为）。
>
> **★ v1.2 修正（2026-10-16，用户指出遗漏）**：上面的判定**错了一半**——"表格容器/图表容器/弹窗内 section"视觉上就是卡片外壳，用户要的统一包含它们。已补改 10 处：
>
> | 文件 | 处数 | 内容 |
> |---|---|---|
> | `MaterialDetailDialog.tsx` | 4 | 弹窗内 `<section>` 信息卡 → `<Card className="gap-0 p-4">` |
> | `ChangeAlertTable.tsx` | 3 | 空态卡 / 平铺表格容器 / 三级分组卡 → `<Card className="gap-0 p-0">` |
> | `ChangeListTable.tsx` | 1 | 表格容器 → `<Card className="gap-0 p-0">` |
> | `MaterialSupplyCharts.tsx` | 1 | 组合图容器（`rounded-md border`）→ `<Card className="gap-0 p-0">` |
> | `SupplyCoefHeatmap.tsx` | 1 | 热力图容器 → `<Card className="gap-0 p-0">` |
> | `InventoryToolbar.tsx` | 1 | L1 工具栏容器 → `<Card className="gap-0 space-y-3 p-3">` |
> | `ChangeDetailSheet.tsx` | 1 | 燃尽图卡片 → `<Card className="gap-0 p-3">` |
> | `ProductsPage.tsx` | 1 | 表格卡片（手写 ring 模拟 Card）→ `<Card className="gap-0 p-0">` |
>
> `gap-0` 的作用：Card 默认 `flex flex-col gap-4`，直接换容器会在"标题栏↔内容 / 表格"之间多出 16px 空隙；`gap-0` 显式禁用，保持原布局像素级不变。
>
> **真正的"非卡片"边界（不改，终版）**：① 弹窗内灰底说明块（`bg-muted/20`，弱化语义非卡片）；② 弹窗内滚动列表区（`max-h-* overflow-auto`）；③ 输入控件（button/input/select/textarea/下拉面板）；④ 提示条（绿告警、虚线说明）；⑤ 可点击列表项/开关/统计按钮（交互控件语义）；⑥ TaskTreeEditor 编辑器内部结构。

> **透明度 /15 → /10 的边界（重要）**：全站还剩 `types/inventory.ts`、`types/share.ts`、`InventoryRow.tsx`、`InventoryDetailSheet.tsx`、`ProjectCardWall.tsx`、`SharePage.tsx`、`ConceptHints.tsx`、`TaskTreeEditor.tsx` 共 8 处 `/15`。其中 `types/*.ts` 的 META 是**已验证正确的语义色实现**（记忆里明确"不改其语义色取值"），且 `/15` 与 `/10` 视觉差异极小。**决定：不盲目全量扫**，只在"已改骨架的组件"里顺手规整（GanttChart 已做）。其余留作一次性决策，不单独做 diff。

---

## 第 0 步：新增两个共享层（先做，后面全部引用它）

### 0.1 新增 `frontend/src/lib/chart-palette.ts`（图表分类色板唯一出口）

**现状**：三张色板各自为政 ——
- `DemandLineChart.tsx` 的 `LINE_COLORS`（10 色，含红黄绿）
- `MaterialSupplyCharts.tsx` 的 `DEMAND_COLORS` / `CAPACITY_COLORS`（10 色，绿调为主）
- `types/change.ts` 的 `CATEGORY_PALETTE`（8 色，**正确避开红黄绿**）

**改成**：新建 `chart-palette.ts`，以 `CATEGORY_PALETTE` 为基准扩成一张 10 色分类板，
导出 `CHART_PALETTE` + `categoryColor(index)`。**三处图表全部从这里取色。**

```ts
// chart-palette.ts（示意）
export const CHART_PALETTE = [
  "#378ADD", // blue
  "#7F77DD", // purple
  "#1D9E75", // teal
  "#D85A30", // coral
  "#D4537E", // pink
  "#BA7517", // amber(棕调，非状态黄)
  "#0F6E56", // deep teal
  "#888780", // gray
  "#185FA5", // deep blue
  "#3C3489", // deep purple
] as const;
export function categoryColor(index: number): string { /* 越界回卷 + 空兜底灰 */ }
```

**约束**：分类色板**不含** `#ef4444`(红)/`#f59e0b`(黄)/`#22c55e`(绿) 的状态语义色。
红黄绿只允许以「状态」身份出现。

### 0.2 收敛状态徽章到 `Badge` 组件（`frontend/src/components/ui/badge.tsx`）

**现状**：状态 chip 有 3 套写法 ——
1. `Badge` 的 `success`/`warning` 变体（`bg-emerald-100 text-emerald-700`，用 100 底）
2. 各模块 META 的 `chipCls`（`bg-red-500/10 text-red-600`，用 500/10）
3. 手写内联 `<span class="rounded bg-red-500/15 ...">`（用 500/15，且是 div 不是 Badge）

**改成**：`Badge` 新增/规整三个**状态变体**，色值统一 `*-500/10 底 + *-600 字`，
全站状态徽章一律 `<Badge variant="danger|warn|ok">`：

```ts
danger: "bg-red-500/10 text-red-600 dark:text-red-400",
warn:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
ok:     "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
```

现有 `success`/`warning` 变体**删除**（或改名归并到 `ok`/`warn`），
`types/` 里所有 `chipCls` 的 `*-500/15` 统一改成 `*-500/10`。

---

## 第 1 步：供需管理页（问题最集中，先改）

### 1.1 `pages/SupplyDemandPage.tsx` → `KpiCard`（数字变色 → 色条+深色数字）

**现状**（L434-471）：
```tsx
tone === "danger" ? "text-rose-600" : "warn" ? "text-amber-600" : "ok" ? "text-emerald-600" : "text-foreground"
// 大数字 <p class="text-2xl ... tabular-nums" toneCls>
```

**改成**：
```tsx
// 状态色从「数字」移到「顶部 3px 色条」，数字统一 text-foreground
<Card className="overflow-hidden">
  <span className={cn("block h-[3px]", tone === "danger" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-emerald-500" : "bg-muted")} />
  <CardContent className="p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
    {/* hint 保留危险/警告文字色 */}
  </CardContent>
</Card>
```
> 与 `DohBucketCards.tsx` 的「顶部色条」完全对齐（那是最佳实践，见规范 §4）。

### 1.2 `pages/SupplyDemandPage.tsx` → `ProjectCard`（手写 button → `<Card>`）

**现状**（L651-681）：`<button class="... rounded-lg border bg-card p-5 ...">`

**改成**：用 `<Card>` 包一个 `<button>`（或 `<Card role="button">`），圆角/边框交给 Card 组件：
```tsx
<Card role="button" onClick={onClick} className="cursor-pointer p-5 transition-all hover:border-primary/40 hover:shadow-sm">
  {/* 内容不变 */}
</Card>
```
> `ProjectCard` 里的状态 chip（`STATUS_META.chip`）同步走 0.2 的 Badge 变体。

### 1.3 `pages/SupplyDemandPage.tsx` → `AnalysisSection`（自绘标题栏 → 统一骨架）

**现状**（L574-597）：`<Card>` + 手写 `<div class="border-b px-5 py-3.5">`

**改成**：保留结构（这其实已是「标题行+分隔线+内容」的标准骨架），仅对齐：
- 标题行高度/内边距统一为 `px-5 py-3`；
- 圆角由 Card 组件管（不再额外写）。

---

## 第 2 步：Dashboard（删 sky、图标块收敛、页头对齐）

### 2.1 `pages/DashboardPage.tsx` → 卡 5「变更进行中」图标（删 sky）

**现状**（L94）：`chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400"`

**改成**：`chip: "bg-primary/10 text-primary"`（强调色，与卡 1 一致）。

### 2.2 `pages/DashboardPage.tsx` → 5 卡图标块（装饰色收敛成「状态色」）

**现状**（L237/246/67）：卡 2 用 `emerald`、卡 3 用 `red`、卡 4 用 `amber`、卡 5 用 `sky`。

**改成**：
- 卡 1「项目/物料」：`primary`（中性强调，保持）
- 卡 2「份额波动」：`emerald` → 保留（它是「正常」语义，可留）
- 卡 3「重点独供」：`red`（高风险，保留，语义正确）
- 卡 4「库存 <3」：`amber`（警告，保留）
- 卡 5「变更进行中」：`sky` → **改 `primary`**（没有状态含义）

> 结论：只删 sky，其余因「本来就是状态色」保留。图标块颜色 = 状态色，不再是装饰。

### 2.3 `pages/DashboardPage.tsx` → 页头字号（text-4xl → text-2xl）

**现状**（L278）：`<h1 className="text-4xl font-semibold tracking-tight">Dashboard</h1>`

**改成**：`<h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>`

---

## 第 3 步：库存页（OrderTimingBar 改 Card、页头对齐）

### 3.1 `components/inventory/OrderTimingBar.tsx` → 容器改 `<Card>`

**现状**（L100）：`<div className="rounded-lg border bg-card px-3 py-2.5">`

**改成**：`<Card className="p-3">`（圆角/边框统一）。

### 3.2 `pages/InventoryPage.tsx` → 页头字号（text-xl → text-2xl）

**现状**（L409）：`<h1 className="text-xl font-semibold tracking-tight">库存信号塔</h1>`

**改成**：`text-2xl font-semibold tracking-tight`。

### 3.3 `components/inventory/OrderTimingBar.tsx` → orange 语义边界

**现状**（L63）：`bar: "bg-orange-500"`（7天内下单）+ 变更模块 `late` 也用 orange。

**改成**：保留（「下单时机」的橙是「紧急度渐变」，与「迟交」的橙语义不同，但视觉都偏橙）。
**记为待定项**，不在本轮强制改（见文末「待拍板」）。

---

## 第 4 步：变更模块（卡片改 Card、状态徽章走 Badge）

### 4.1 `components/changes/ProjectChangeCard.tsx` → 手写 div 改 `<Card>`

**现状**（L39-52）：`<div role="button" class="... rounded-xl border bg-card p-4 ...">`

**改成**：`<Card role="button" ... className="cursor-pointer p-4 transition-all hover:shadow-sm">`，
边框信号 `projectCardClass()` 保留（红边/黄边/灰边语义正确）。

### 4.2 `components/changes/GanttChart.tsx` → 容器 & 空态改 `<Card>`

**现状**（L268/276/283）：`<div className="rounded-xl border bg-card ...">` 三处。

**改成**：空态和容器统一 `<Card>`。

### 4.3 `components/changes/GanttChart.tsx` → 手写状态 chip 改 `Badge`

**现状**（L417/422/427/435/443/448/453）：多处 `<span class="rounded bg-red-500/15 ...">`

**改成**：`<Badge variant="danger|warn|ok">`（`*-500/15` → `*-500/10`）。

---

## 第 5 步：份额模块（图表色板、散点色）

### 5.1 `components/share/ShareQuadrantChart.tsx` → 散点色

**现状**（L132-133）：`fill = isSole ? "#f87171" : "#60a5fa"`（红=独供 / 蓝=正常）

**改成**：保留语义（红=独供是状态色，正确）。蓝色散点用 `CHART_PALETTE` 的 blue `#378ADD`，
统一分类色来源。

### 5.2 `types/share.ts` → `RISK_TYPE_META` 的 mismatch 用 violet

**现状**（L165）：`mismatch: { ... text: "text-violet-600" ... }`（紫）

**改成**：保留（紫是「分类」非「状态」，属可接受的第四色，但要在规范里注明）。

---

## 第 6 步：全局圆角 & 数字排版扫尾

### 6.1 全站散落的 `rounded-xl` / `rounded-2xl`（卡片级）

把「卡片/容器」的 `rounded-xl/2xl` 统一由 `<Card>` 组件承担（Card 已内置 `rounded-xl`）。
手写 `<div class="rounded-xl border bg-card">` 一律改 `<Card>`。

### 6.2 全站 `text-4xl` 页头 → `text-2xl`

涉及 `DashboardPage.tsx`、`SupplyDemandPage.tsx`（两处 `text-4xl`）。

---

## 附：待你拍板的两项（不阻塞主线）

| 项 | 问题 | 我的建议 |
|---|---|---|
| **orange 撞车** | 变更「迟交」和库存「7天内下单」都用橙 | 视觉可接受，暂不改；或给「迟交」换一个专属色 |
| **页头字号** | 现在 text-4xl / text-xl / text-2xl 混 | 统一 `text-2xl`（看板页头不需要 text-4xl 那么大） |
| **violet 第四色** | 份额「错配」用紫，是分类色非状态色 | 保留，规范里注明「紫=分类专用」 |

---

## 执行顺序 & 验收

1. **第 0 步**（抽共享层）→ 跑 `tsc --noEmit` 确保不破编译。
2. **第 1 步**（供需页）→ 小样截图，你复核。
3. **第 2~5 步**逐页 → 每页截图复核。
4. **第 6 步**收尾 → 跑 `verify_mobile.mjs` / `verify_degraded.mjs` 等常驻脚本 + 截图 md5 自证。

**不碰**：`INV_STATUS_META` / `INV_DOH_BUCKET_META` 的语义色取值（它们已正确），
只改「当装饰散落使用」的地方。
