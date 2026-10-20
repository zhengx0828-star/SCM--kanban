/**
 * 操作 SOP —— 每个模块「怎么点」的结构化数据。
 *
 * 设计约定（改这里就够了，页面只负责渲染）：
 * - 截图存在 `public/sop/{key}.png`，统一 1560×820（1560 宽视口，无滚动条）；
 * - `pins` 的 x/y 是**相对截图的百分比**（0-100，左上角为原点），
 *   所以截图换尺寸、容器换宽度，标注位置都不跑；
 * - **`pins[].no` 与 `steps[].no` 严格一一对应**，流程图节点也直接由 steps 生成 ——
 *   三处编号同源，永远不会出现「图上标 3、文字说 4」；
 * - 步骤文案写祈使句、一句话，不写解释。解释归「指标字典」。
 *
 * 重新截图 / 改版后要同步的只有两处：换 png、调 pins 坐标。
 */

/** 截图上的标注点（相对百分比） */
export interface SopPin {
  no: number;
  x: number;
  y: number;
}

/** 一条操作步骤；流程图的节点就是它 */
export interface SopStep {
  no: number;
  /** 流程图里的短标签（3-5 字） */
  flowLabel: string;
  /** 主文案：点哪里 */
  text: string;
  /** 补充：填什么 / 会怎样，一句话，可不填 */
  tip?: string;
}

export interface SopModule {
  key: string;
  name: string;
  /** 模块路由，「进入模块」按钮用 */
  to: string;
  /** 截图路径（public 下） */
  shot: string;
  steps: SopStep[];
  pins: SopPin[];
}

/**
 * 数据录入总顺序 —— 6 个模块是并排的菜单，但业务上有先后依赖：
 * 没项目就挂不了供应关系，没关系就没份额/产能，没需求就没法算风险。
 * 这条链路回答的是「一个项目从 0 到能看，按什么顺序录」。
 */
export interface SopPipelineNode {
  no: number;
  label: string;
  /** 这一步在哪个模块做 */
  module: string;
  to: string;
}

export const SOP_PIPELINE: SopPipelineNode[] = [
  { no: 1, label: "建项目", module: "供应商列表", to: "/materials" },
  { no: 2, label: "加物料 PN", module: "供应商列表", to: "/materials" },
  { no: 3, label: "加供应商", module: "供应商列表", to: "/materials" },
  { no: 4, label: "挂供应关系", module: "供应商列表", to: "/materials" },
  { no: 5, label: "录需求 / BOM / 产能", module: "供需管理", to: "/supply-demand" },
  { no: 6, label: "录份额", module: "份额管理", to: "/share" },
  { no: 7, label: "建库存塔", module: "库存管理", to: "/inventory" },
  { no: 8, label: "看预警", module: "Dashboard", to: "/dashboard" },
];

export const SOP_MODULES: SopModule[] = [
  {
    key: "dashboard",
    name: "Dashboard",
    to: "/dashboard",
    shot: "/sop/dashboard.png",
    steps: [
      {
        no: 1,
        flowLabel: "看五卡",
        text: "先看顶部五张卡",
        tip: "项目/物料 · 波动 · 独供 · 库存<3天 · 变更进行中；点卡进对应模块",
      },
      {
        no: 2,
        flowLabel: "看矩阵",
        text: "第二段看项目风险热点",
        tip: "行 = 项目，列 = 供需 / 库存 / 变更 / 份额 / 数据缺口",
      },
      {
        no: 3,
        flowLabel: "点格子",
        text: "点带数字的格子进板块",
        tip: "落地页已按该项目过滤；灰格「—」= 无信号，不等于健康",
      },
      {
        no: 4,
        flowLabel: "读紧急",
        text: "最右「紧急」列看最重的一条",
        tip: "每个项目只写最严重那一条，逐条看走第 3 步",
      },
      {
        no: 5,
        flowLabel: "看地图",
        text: "下方地图看供应商分布",
        tip: "红黄蓝 = 风险等级，灰色 = 未评估",
      },
      {
        no: 6,
        flowLabel: "录供应商",
        text: "「录入供应商」补主数据",
        tip: "只有填了经纬度才会出现在地图上",
      },
    ],
    pins: [
      { no: 1, x: 29, y: 34 },
      { no: 2, x: 24, y: 50.7 },
      { no: 3, x: 49.6, y: 63.4 },
      { no: 4, x: 82, y: 63.4 },
      { no: 5, x: 30, y: 94.3 },
      { no: 6, x: 87.3, y: 86.3 },
    ],
  },
  {
    key: "supply-demand",
    name: "供需管理",
    to: "/supply-demand",
    shot: "/sop/supply-demand.png",
    steps: [
      { no: 1, flowLabel: "看四卡", text: "先看顶部四卡", tip: "缺口物料数 / 最严重缺口月 / 全年覆盖率 / 首个缺口月" },
      { no: 2, flowLabel: "选项目", text: "右上「项目」下拉选范围", tip: "可多选，也可以点「全选」看全部" },
      { no: 3, flowLabel: "进项目", text: "点项目卡片进详情", tip: "录入客户需求、BOM、产能都在详情里" },
      { no: 4, flowLabel: "读柱线", text: "看下方两张明细卡", tip: "柱 = 产能，线 = 需求；系数 = 产能 ÷ 需求" },
    ],
    pins: [
      { no: 1, x: 57, y: 27 },
      { no: 2, x: 85.6, y: 78.9 },
      { no: 3, x: 32.9, y: 47.5 },
      { no: 4, x: 55, y: 93 },
    ],
  },
  {
    key: "share",
    name: "份额管理",
    to: "/share",
    shot: "/sop/share.png",
    steps: [
      { no: 1, flowLabel: "选月份", text: "顶部选月份", tip: "月份是快照，切月份 = 切一整套数" },
      { no: 2, flowLabel: "看预警", text: "看五张预警卡", tip: "独供 / 波动 / 偏差 / 错配 / 高粘性" },
      { no: 3, flowLabel: "切项目", text: "点项目卡切换项目", tip: "预警概览跟着联动" },
      { no: 4, flowLabel: "查排行", text: "风险排行右侧按类型筛", tip: "点条目可直接跳到该条份额记录" },
      { no: 5, flowLabel: "改明细", text: "「份额明细」逐条改", tip: "手改过的行，之后 Excel 导入不会再覆盖" },
      { no: 6, flowLabel: "月末结转", text: "「月末结转」生成下月空档", tip: "本月数会快照成下月的「上月份额」" },
    ],
    pins: [
      { no: 1, x: 27, y: 23.2 },
      { no: 2, x: 58, y: 35.2 },
      { no: 3, x: 34.4, y: 64 },
      { no: 4, x: 74.2, y: 78.9 },
      { no: 5, x: 38.6, y: 23.2 },
      { no: 6, x: 46.1, y: 23.2 },
    ],
  },
  {
    key: "inventory",
    name: "库存管理",
    to: "/inventory",
    shot: "/sop/inventory.png",
    steps: [
      { no: 1, flowLabel: "建塔", text: "首次使用点「从底表建塔」", tip: "按「项目 × 物料 × 供应商」建推算单元，客户需求和 BOM 自动带过来" },
      { no: 2, flowLabel: "配基地", text: "「基地管理」维护拉线数", tip: "产能校验的分母就来自这里；列显示在「视图设置」里调" },
      { no: 3, flowLabel: "批量导入", text: "「Excel 导入」批量建单元", tip: "建好后选项目，列表按 DOH 升序；点行看 30 天逐日" },
    ],
    pins: [
      { no: 1, x: 53.9, y: 45.8 },
      { no: 2, x: 77.8, y: 15.7 },
      { no: 3, x: 84.7, y: 15.7 },
    ],
  },
  {
    key: "changes",
    name: "变更管理",
    to: "/changes",
    shot: "/sop/changes.png",
    steps: [
      { no: 1, flowLabel: "新建单", text: "「新建变更单」开单", tip: "开单后在单里拆任务树，每项挂责任人和计划完成日" },
      { no: 2, flowLabel: "建类型", text: "「变更类型」维护分类", tip: "分类用于「按类型分布」那张图" },
      { no: 3, flowLabel: "批量导入", text: "「Excel 导入」批量开单", tip: "字段和手工开单一致，导入前先下载模板" },
      { no: 4, flowLabel: "切列表", text: "「进行中 / 已归档」切列表", tip: "做完的归档，不影响进行中的统计口径" },
    ],
    pins: [
      { no: 1, x: 92.6, y: 15.5 },
      { no: 2, x: 73.3, y: 15.5 },
      { no: 3, x: 79.3, y: 15.5 },
      { no: 4, x: 22.5, y: 36.4 },
    ],
  },
  {
    key: "materials",
    name: "供应商列表",
    to: "/materials",
    shot: "/sop/materials.png",
    steps: [
      { no: 1, flowLabel: "建项目", text: "「新增项目」先建项目", tip: "项目是所有业务数据的第一层，先有项目才有别的" },
      { no: 2, flowLabel: "加物料", text: "切到「物料PN」加物料", tip: "PN + 名称，全站唯一" },
      { no: 3, flowLabel: "加供应商", text: "切到「供应商」加供应商", tip: "代码必须唯一，Excel 导入按代码匹配、不按名称" },
      { no: 4, flowLabel: "挂关系", text: "项目行点「明细」挂供应关系", tip: "四元组打通后，份额 / 产能 / 库存才有地方挂" },
    ],
    pins: [
      { no: 1, x: 89.5, y: 13.7 },
      { no: 2, x: 27.8, y: 28.3 },
      { no: 3, x: 36, y: 28.3 },
      { no: 4, x: 87, y: 47.4 },
    ],
  },
];
