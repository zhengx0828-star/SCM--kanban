# 项目复现提示词：SCM 供应链看板

> 用法：把本文件完整粘贴给 opencode（或任何 AI 编程助手），让它在一个空目录中从零搭建整个项目。
> 目标环境：Windows（Git Bash / PowerShell 均可），Python 3.10+，Node.js 18+，pnpm（未安装自动回退 npm）。

---

## 一、项目定位

构建一个「供应链控制台」Web 应用，包含：项目供需管理（客户需求 / BOM / 供应商产能 / 供需平衡分析）、供应商与物料主数据管理、全国供应商分布地图、SOP 规则手册。前后端分离，本地一键启动。

界面为中文（简体）。整体视觉风格参考 shadcn/ui 官网文档站：顶部 Header + 左侧固定 Sidebar + 右侧内容区，克制、留白充足、无花哨动效。

## 二、技术栈（必须严格使用）

**后端**（`backend/`）
- FastAPI `>=0.115,<1.0` + uvicorn
- SQLAlchemy 2.0（`Mapped` / `mapped_column` 声明式）
- Pydantic v2（`ConfigDict(from_attributes=True)`）
- SQLite（数据库文件固定为 `backend/products.db`，路径用 `Path(__file__).resolve().parent.parent / "products.db"`，不依赖 cwd）
- 启动时 `Base.metadata.create_all(bind=engine)` 自动建表，**不写种子数据**（保留空白底表）

**前端**（`frontend/`）
- React 18 + TypeScript + Vite 5（`@vitejs/plugin-react` + `@tailwindcss/vite`，Tailwind CSS v4）
- shadcn/ui 风格组件（radix-ui 基底），手写实现以下 UI 原语：button / card / dialog / alert-dialog / input / label / select / skeleton / badge / textarea / checkbox / popover / command / table / pagination / sonner(toast)
- TanStack Query v5、axios、react-router-dom v6、lucide-react 图标、echarts 6（图表 + 中国地图）、next-themes（明暗主题）
- 路径别名 `@` → `./src`；开发服务器 5173，`/api` 代理到 `http://127.0.0.1:8000`

**一键启动脚本**（根目录 `start-all.bat` + `start-all.sh`，Win/mac 各一份）：自动建后端 venv → 装后端依赖 → 装前端依赖 → 拉起前后端 → 打开浏览器。

## 三、架构：三层五表（核心设计，必须遵守）

| 层 | 表 | 说明 |
|---|---|---|
| L1 主数据 | `suppliers` | 供应商主数据，`code` 唯一；只承载身份 + 地图字段（city/longitude/latitude/contact_person/phone/supply_material/risk_level/remark） |
| L1 主数据 | `materials` | 物料主档，`pn` 唯一（物料编码），含 name/category/spec/remark |
| L2 供应关系 | `supply_relations` | 四元组主数据：物料PN·物料名称·供应商名称·供应商代码。`UNIQUE(material_id, supplier_id)`。同一物料多家供应商=多条；**不含任何项目信息**。其他模块统一从这里取基础数据 |
| L3 项目 | `projects` | 项目主数据，`code` 唯一，status: active/planning/closed |
| L3 项目明细 | `project_supply_relations` | `UNIQUE(project_id, supply_relation_id)`；四元组 + 项目专属字段。**各模块特殊字段都扩展在这里，不动主数据层** |

另外两张辅助表：`products`（演示 CRUD，含软删除 is_deleted + SKU 部分唯一索引）、`rules`（SOP 规则，module/title/content/sort_order）。

### project_supply_relations 字段（扩展点）
- 基础：`role`（主供/备选/认证中…）、`is_primary`、`unit_price`、`quota`（如 60%）、`lead_time`、`valid_from`、`valid_to`、`remark`
- 供需管理特殊字段：
  - `demand`：客户需求 1-12 月，**Text 列存 JSON 数组（长度 12）**。**项目级**：客户给的是产品总需求，录一次同步到该项目下所有明细行（不区分物料）
  - `capacity`：供应商产能 1-12 月，**Text 列存 JSON 数组（长度 12）**。**供应商级**：每家供应商各自维护
  - `bom_factor`：BOM 用量系数（1 台产品需要几个该物料），**项目×物料**，单一值全年通用；**物料需求 = 客户需求 × bom_factor**

### suppliers.risk_level（重要）
- 取值 `red/yellow/green`，**可空 = NULL = 未评估 = 地图灰色**
- **判定规则未定**：录入时不带颜色、不默认任何色；规则确定后由对应模块联动填充
- 前端归一函数 `riskKeyOf(level)` → "none"，`RISK_ORDER=[red,yellow,green,none]`

## 四、后端 API 规格（全部前缀 `/api`）

### 产品（演示 CRUD，软删除）
- `GET /products` 分页（page/page_size/keyword/status）；`GET /products/{id}`；`POST /products`（SKU 冲突 409）；`PUT/PATCH /products/{id}`；`DELETE /products/{id}` 软删除

### 供应商
- `GET /suppliers` 全量（含 materials 列表，地图直接消费）；`POST /suppliers`（code 唯一 409）；`PATCH /suppliers/{id}`（补全地图字段）；`DELETE /suppliers/{id}`（级联删供应关系与项目明细）

### 物料
- `GET /materials` 分页（keyword 搜 PN/名称/分类；返回 supplier_count）；`POST /materials`（pn 唯一 409）；`DELETE /materials/{id}`

### 供应关系（四元组）
- `GET /supply-relations` 分页（keyword 搜物料PN/物料名/供应商名/供应商代码）；`GET /supply-relations/options` 全量（下拉消费）；`POST /supply-relations`（material_id + supplier_id，重复 409）；`DELETE /supply-relations/{id}`；`GET /supply-relations/{id}/projects`（被哪些项目引用）

### 项目
- `GET /projects` 分页（keyword 搜代码/名称/负责人；返回 relation_count）；`POST /projects`；`PATCH /projects/{id}`；`DELETE /projects/{id}`
- `GET /projects/{id}/relations` 项目供应明细列表（四元组 + 项目字段，demand/capacity 以 number[] 返回）
- `POST /projects/{id}/relations` 挂载供应关系（带项目字段）
- `POST /projects/{id}/relations/quick-add` **快速录入**：传 pn/material_name/supplier_name/supplier_code 四元组，自动创建/复用主数据（物料按 pn 查、供应商按 code 查、供应关系按组合查）再挂载；重复 409
- `PATCH /projects/{id}/relations/{link_id}` 更新明细字段
- `DELETE /projects/{id}/relations/{link_id}` 解除挂载
- `PUT /projects/{id}/demand` 批量维护客户需求：body `{demand: number[12]}`，同步到该项目下**所有**明细行；项目下无明细则 404
- `PUT /projects/{id}/bom` 批量维护 BOM：body `{material_pn, bom_factor}`，同步到该项目下**该物料**的所有明细行
- `GET /projects/{id}/materials` 项目下关联物料（按 PN 去重，供物料选择器）
- `GET /projects/{id}/suppliers` 项目下关联供应商（去重；**每个供应商的 materials 只包含该项目下关联的物料**，勿带出其他项目的）

### 规则
- `GET /rules` 分页（module 精确 + keyword 模糊；按 module 升序、sort_order 升序）；`POST /rules`；`PATCH /rules/{id}`；`DELETE /rules/{id}`

## 五、前端页面规格

路由（`App.tsx`）：`/` → 重定向 `/dashboard`；`/dashboard`；`/materials`；`/supply-demand`；`/supply-demand/projects/:projectId`；`/rules`；`/products`（演示）；`/projects` → 重定向 `/materials`；`*` → `/dashboard`。全局挂 `<Toaster richColors position="top-right" />`。

公共布局：`SiteHeader`（顶栏：Logo「供应链控制台」+ 主题切换按钮）+ `SiteSidebar`（左侧导航：Dashboard / 供需管理 / 份额管理(建设中toast) / 库存管理(建设中) / 变更管理(建设中) / 供应商列表 / 规则；NavLink 高亮）。

### 1. `/dashboard` DashboardPage
- 顶部统计卡（5 个）：「项目/物料总数」（实时：projects.total / materials.total，**其余 4 个为演示静态数字，页脚注明**）、份额波动物料、重点物料独供数量、库存天数<3物料、变更进行中
- 整幅中国地图（高 600-680px，ECharts geo + 散点）：供应商点位按 risk_level 着色（红/黄/绿，灰=未评估），无坐标的供应商不上图
- 地图带**项目切片器**（Select）：选项目 → 只显示该项目供应商（调 `/projects/{id}/suppliers`）
- 点点位 → SupplierDetailDialog；「录入供应商」按钮 → SupplierFormDialog（选了项目时，候选供应商限定为该项目的）
- 地图数据文件：`frontend/public/maps/china.json`（阿里云 DataV 官方边界数据，34 省级行政区 + 台湾省 + 香港/澳门特别行政区 + 南海诸岛九段线，保证领土完整）。静态 GeoJSON 渲染，不调任何地图 API/Key
- **硬性规则：地图只显示真实录入数据，禁止演示/假数据**

### 2. `/materials` SupplierMasterPage（供应商列表，Tabs）
- Tab：物料 / 供应商 / 供应关系 / 项目
- 物料 Tab：分页表格（PN/名称/分类/供应商数），新增物料弹窗（仅 PN+名称）、删除
- 供应商 Tab：卡片/表格（代码/名称/城市/供应物料），新增（SupplierMasterFormDialog）、编辑（SupplierDetailDialog 可点地图补全经纬度/风险等级）、删除
- 供应关系 Tab：四元组表格（PN·物料名·供应商名·供应商代码），新增（选择物料+供应商，冲突 409 提示）、删除（级联提示）、「查看项目」按钮 → 弹窗列出引用项目（LinkRelationDialog/EditRelationDialog）
- 项目 Tab：项目列表 + 新建项目（ProjectFormDialog）+ 项目详情（挂载明细：显示 relation 列表、可快速录入四元组 QuickAdd、可解除挂载）

### 3. `/supply-demand` SupplyDemandPage（供需管理首页）
自上而下：
1. **项目卡片网格**（点击进项目详情 `/supply-demand/projects/:id`）：卡片显示 code / name / 状态徽章 / 负责人 / 三个统计（物料数、明细行数、供应商数）；无项目时整区显示 EmptyState「暂无项目」
2. **客户需求折线图 Card**：项目 chip 多选器（MultiSelectFilter，≤12 个平铺 chip，超过切换下拉弹层；每项带"已录需求"徽章）+ 1-12 月折线图（DemandLineChart）
3. **物料供需分析 Card**（核心）：
   - **物料筛选 = MaterialDrawerFilter（右侧抽屉版，见下方专节）**
   - 组合图（MaterialSupplyCharts，ECharts）：物料需求折线（每物料一条，demand×bom 按月求和）+ 供应商产能柱状（每供应商堆叠），tooltip 显示当月各项 + 产能-需求差额
   - SupplyStudioTable 供需平衡表：1-12 月 + 年合计行，列 = 客户需求 / 物料需求 / 供应商产能 / 差额 / 状态（盈余=绿✓、缺口=红⚠、刚好）；状态判定：capacity≥demand 盈余，否则缺口

**页面空态规则（2026-08-30 确定，务必实现）**：
- 项目筛选**允许 0/N**：取消到 0 时，客户需求折线区显示 EmptyState「请选择项目查看需求」，项目筛选器入口保留
- 物料筛选**允许 0/N**：取消到 0 时，物料分析区显示 EmptyState「请选择物料开始分析」，物料抽屉入口保留
- 当物料有但供需数据全空（materialAggregates 与 supplierAggregates 都为 0）时，**整个物料分析 Card 统一显示 EmptyState**，不再出现「图空 + 表满」的割裂
- 统一使用 `EmptyState` 组件（虚框 + 居中 + 图标 + 标题 + 副说明 + 可选 action，尺寸 sm/md/lg）

### 4. `/supply-demand/projects/:projectId` ProjectSupplyDetailPage（项目详情）
- 顶部：返回按钮 + 项目 code/名称/描述
- **客户需求卡（项目级）**：1-12 月数字输入（12 列网格）+ 年合计 + 「保存客户需求」（PUT demand，项目级同步）
- **物料列表**：搜索框（按 PN/名称，常驻）+ 「展开物料列表（N）」折叠按钮（有搜索词时自动展开）。每物料行 Card：PN + 名称 + 供应商数 + BOM 徽章（未设 BOM 显示琥珀色"未设 BOM"）+ 物料需求年合计（demand×bom）
- 点击物料行 → **MaterialDetailDialog**（大弹窗 max-w-5xl）：
  - BOM 用量系数（数字输入 + 保存）
  - 物料需求折线图（客户需求×BOM，蓝线 + 渐变面积）
  - 供应商产能柱状图（每家供应商一色堆叠 + 物料需求虚线参考）
  - 每家供应商产能 12 月大输入 + 单独保存按钮；供应商名可点击 → SupplierDetailDialog
- 底部提示：修改后点对应保存按钮提交

### 5. `/rules` RulesPage（SOP 手册）
- 按 module 分组的规则卡片列表 + 搜索 + 新增/编辑（弹窗：module 下拉预设[通用/项目/物料/供应商/供应关系/Excel导入]可手输、title、content、sort_order）+ 删除（AlertDialog 确认）
- **定位：业务规则/数据口径手册（"怎么来的""怎么定义"），不写工程实现；待定规则标注"待定"**

### 6. `/products` ProductsPage（演示）
- 标准 CRUD 表格 + 分页 + 表单弹窗 + 删除确认（来自模板项目，可保留）

## 六、关键组件设计（务必按此实现）

### 1. MaterialDrawerFilter（物料右侧抽屉筛选器）—— 解决 20+ 物料堆砌
```tsx
interface MaterialDrawerFilterProps {
  label: string;
  options: { value: string; label: string; sublabel?: string; color?: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;  // 受控
  previewCount?: number;  // 默认 3
  placeholder?: string;
}
```
- **主区第 1 行**：触发按钮 `[⚙ label N/M]`（N=已选，M=总数）+ 0 选中时的提示文案「暂未选择物料（点击「label」打开抽屉）」
- **主区第 2 行**：已选物料 chip 行——每个 chip 用该物料颜色实心填充，显示 `sublabel · label`（PN·名称），末尾 ✕ 点击立即移除；最多显示 previewCount 个，超出折叠为「…+N（点击展开）」按钮，点击展开/收起
- **右侧抽屉**（点击触发按钮滑出，宽 ~360px，遮罩主区，默认收起）：
  - Header：标题 + 副说明「勾选即时生效；可搜索 / 全选 / 反选 / 全清」+ 关闭按钮
  - 搜索框（按 label/sublabel/value 过滤）
  - 工具栏：全选 / 反选 / 全清 + 已选计数
  - 物料复选列表（滚动，max-h 限制）：每行 = 复选框（选中用物料色填充）+ 色点 + label 主行 + sublabel 副行；**点击即时生效**（无"确定"按钮，选完即更新）
  - 底部状态条「勾选即时生效，无需保存」+「完成」按钮
- **约束：允许选中 0 个（onChange 不做 fallback 补选）**；配合父组件 EmptyState

### 2. MultiSelectFilter（通用多选器，项目筛选等场景）
- 智能切换：options ≤ 12 平铺 chip；> 12 切换为「按钮 + Dialog 居中弹层」（弹层内搜索 + 全选/反选/全清 + 滚动复选列表 + 取消/确定）
- 受控组件，父组件维护 selected；允许 0 个选中

### 3. EmptyState（通用空态）
```tsx
{ icon?, title, description?, action?, size?: "sm"|"md"|"lg", variant?: "default"|"plain" }
```
default 变体 = 虚线边框 + bg-muted/20 + 居中；plain = 无框。

### 4. SupplyStudioTable（供需平衡表）
- props: `rows: { monthIndex: -1|0..11, customerDemand, materialDemand, supplierCapacity }[]`
- 状态：盈余(绿 CheckCircle) / 缺口(红 AlertCircle，文案"缺口 N") / 两者为 0 显示 "—"

### 5. MaterialSupplyCharts（组合图）
- props: `demand: {pn,name,demandSeries,color}[]`（折线）+ `capacity: {code,name,capacitySeries,color}[]`（柱状堆叠）
- 底部可滚动 legend；tooltip 分组展示 + 产能-需求差额；X 轴 1-12 月
- 图实例跟随主题重建（dark 变化时 dispose 重建），数据变化时按 id 增量 setOption

## 七、ECharts 通用要点
- 图表组件模式：`useRef` 持有实例，`useEffect` 监听主题（`useTheme().dark`）变化时 `echarts.init` + dispose 重建；数据变化用 `JSON.stringify(payload)` digest 做增量 `setOption({ notMerge:false, lazyUpdate:true })`
- 主题色：light 下 axis `#cbd5e1` / label `#64748b` / splitLine `#e2e8f0`；dark 下 `#334155` / `#94a3b8` / `#1e293b`
- 数量格式化：≥1000 显示 `k`（≥10000 取整）

## 八、TypeScript 数据层（types / hooks / api）
- `types/`：product.ts、supplier.ts（含 RISK_META/RISK_ORDER/riskKeyOf）、material.ts、supplyRelation.ts、project.ts（含 ProjectSupplyRelation、ProjectDemandUpdateInput、ProjectBomUpdateInput、ROLE_OPTIONS）、rule.ts（含 MODULE_PRESETS）
- `lib/api.ts`：axios 实例（baseURL `/api`）+ 各资源 api 对象（list/create/update/remove/options/projects 等）
- `hooks/`：TanStack Query 封装（useProjects、useProjectRelations、useProjectMaterials、useProjectSuppliers、useUpdateProjectDemand、useUpdateProjectBom、useQuickAddProjectRelation、useLinkProjectRelation、useUnlinkProjectRelation、useSuppliers、useMaterials、useSupplyRelations、useRules 等），带正确的 invalidateQueries 失效键（项目/供应商/物料/供应关系联动刷新）
- `lib/utils.ts`：cn()（clsx + tailwind-merge）、getApiErrorMessage(err)（提取 FastAPI detail）

## 九、数据计算口径（供需分析）
- **物料需求（月）** = Σ over(项目, 物料) `demand[项目][月] × bom_factor[项目, 物料]`（无 demand 或 bom 为 0/空则跳过）
- **供应商产能（月）** = Σ over(选中物料下的所有供应明细) `capacity[明细][月]`，按 supplier_code 聚合
- **客户需求（月）** = Σ over(有 demand 的项目) `demand[项目][月]`
- **Supply Studio 差额（月）** = 供应商产能合计 - 物料需求合计；状态：产能≥需求 盈余 / 否则缺口

## 十、验收清单（完成后逐项核对）
1. `python -m uvicorn app.main:app --reload --port 8000`（backend 下）启动无报错，`/api/health` 返回 ok
2. `pnpm run dev`（frontend 下）5173 打开，六个页面路由可访问，明暗主题切换生效
3. 在 `/materials` 依次创建：物料 → 供应商 → 供应关系 → 项目 → 项目挂明细（QuickAdd）→ 明细字段可编辑
4. 在 `/supply-demand/projects/:id`：录客户需求 12 月 → 保存后物料列表出现"物料需求年合计"；打开 MaterialDetailDialog 录 BOM + 各供应商产能 → 图表即时更新
5. `/supply-demand`：项目筛选取消到 0/N 显示「请选择项目查看需求」；物料筛选取消到 0/N 显示「请选择物料开始分析」；物料有但数据空 → 整个物料分析 Card 显示 EmptyState；>12 物料时主区只露触发按钮 + 折叠 chip，抽屉可搜索全选反选
6. `/dashboard`：地图渲染，录了经纬度的供应商显示点位，按风险等级着色（未评估灰色），项目切片器生效
7. `/rules`：新增/编辑/删除规则正常，按模块分组
8. 根目录双击 `start-all.bat`（Windows）一键拉起前后端

## 十一、用户长期偏好（务必遵守）
- 三层五表架构是硬约束；模块特殊字段只扩展在 `project_supply_relations`，不动主数据层
- 规则页 = SOP 手册，写业务口径不写工程实现
- Dashboard = 纯 summary；地图禁止演示/假数据
- 风险等级判定规则未定 → 不默认任何色、不留空填色
- 空态偏好：数据塌缩到稀疏态时整个 Card 统一空态，避免「图空 + 表满」割裂
- 筛选器允许 0/N（0 个项目 / 0 个物料都允许，数据区显示 EmptyState 而非强制回填）
- 物料选择：20+ 物料也必须收进右侧抽屉，主区永远只占 ~1 行
