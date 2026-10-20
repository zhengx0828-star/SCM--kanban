/**
 * 指标字典 —— 「每个指标怎么算」的唯一文档源。
 *
 * ★ 核心约定：**阈值不复制数字**。
 *   能 import 的就 import（供应系数 1.0/1.3、QDC 五档）；
 *   只存在后端的库存阈值集中在本文件顶部的 `INV` 里声明一次，并标注对应的后端位置。
 *   改代码 → 这里跟着变，不会出现「文档写 30%、代码改成 25%」。
 *
 * 本文件只放**事实**：怎么算、怎么判、在哪看。
 * 不写「为什么要这么设计」这类解释 —— 那种内容放正文会稀释信息密度。
 */

import { TIGHT_RATIO_MIN, TIGHT_RATIO_MAX } from "@/lib/supply-risk";
import { QDC_SCORES } from "@/types/share";

/**
 * 库存相关阈值 —— 与 `backend/app/schemas.py` 的 INV_* 常量保持一致。
 * 前端没有这些常量的副本，故在此集中声明一次（改后端记得同步这里）。
 */
const INV = {
  /** schemas.py: INV_COV_MID —— 低波动上界 */
  COV_MID: 0.35,
  /** schemas.py: INV_COV_HI —— 中波动上界，≥ 即高波动 */
  COV_HI: 0.8,
  /** schemas.py: INV_SAFE_DOH_DEFAULT —— COV 不可算时的兜底安全天数 */
  SAFE_DOH_DEFAULT: 5,
  /** schemas.py: INV_URGENT_DOH_THRESHOLD —— 紧急档绝对阈值 */
  URGENT_DOH: 3,
  /** schemas.py: INV_YELLOW_RATIO —— 黄灯带上界倍数 */
  YELLOW_RATIO: 1.25,
  /** schemas.py 注释：Z 为服务水平系数，默认 1.65 即 95% */
  SERVICE_Z: 1.65,
  /** DOH 看板窗口长度（天），超过显示 30+ */
  WINDOW_DAYS: 30,
} as const;

/**
 * 预警相关阈值 —— 与 `backend/app/schemas.py` / `routers/alerts.py` 保持一致。
 * 供需三档直接引用 `lib/supply-risk.ts` 的常量（前后端各一份，改一处必须改两处并跑
 * `scripts/verify_alerts.py`）。
 */
const ALERT = {
  /** alerts.py: ALERT_HORIZON_DEFAULT —— 供需关注窗口（月），从基准月起算 */
  HORIZON: 3,
  /** schemas.py: NEAR_DUE_DAYS —— 变更临期窗口（天） */
  NEAR_DUE_DAYS: 3,
} as const;

/** 份额风险阈值 —— 与 `backend/app/schemas.py` 保持一致 */
const SHARE = {
  /** RISK_FLUCTUATION_RATIO —— 份额波动：相对上期变化 ≥ 30% */
  FLUCTUATION_RATIO: 0.3,
  /** RISK_DEVIATION_PT —— 建议偏差：|本月 − 上月建议| > 5 个百分点 */
  DEVIATION_PT: 5,
  /** 错配：份额 ≥ 50% 且加权分 < 0.5 */
  MISMATCH_SHARE: 50,
  MISMATCH_SCORE: 0.5,
  /** 高粘性：当月覆盖物料数 ≥ 3 */
  STICKY_MATERIALS: 3,
} as const;

export type ChipTone = "red" | "amber" | "green" | "blue" | "violet" | "neutral";

export interface MetricChip {
  label: string;
  tone: ChipTone;
}

export interface Metric {
  name: string;
  /** 名称后缀，如「%」「风险」 */
  unit?: string;
  /** 计算公式，用 ÷ × Σ 这类符号，不用文字描述 */
  formula: string;
  /** 公式下面的一行补充（分子分母是什么），可省 */
  formulaNote?: string;
  /** 判定分档 */
  chips?: MetricChip[];
  /** 在哪个页面看 */
  where: string;
}

export interface MetricGroup {
  key: string;
  title: string;
  metrics: Metric[];
}

const pct = (v: number) => `${v * 100}%`;

export const METRIC_GROUPS: MetricGroup[] = [
  {
    key: "alert",
    title: "预警",
    metrics: [
      {
        name: "紧急程度",
        unit: "P0 / P1 / P2",
        formula: "P0 已造成影响 → P1 条件不健康 → P2 偏离",
        formulaNote: "按响应时效逐类给定，不由公式算出；跨来源唯一可比的就是它",
        chips: [
          { label: "P0 已造成影响", tone: "red" },
          { label: "P1 条件不健康", tone: "amber" },
          { label: "P2 偏离不影响交付", tone: "neutral" },
        ],
        where: "Dashboard · 卡片 / 矩阵 / 色条",
      },
      {
        name: "距出事天数",
        unit: "排序键",
        formula: "事件日 − 今天",
        formulaNote: "库存按 DOH（断货 = 0）、变更按计划完成日、供需按缺口月 1 日；负数 = 已过点",
        chips: [
          { label: "≤ 0 已到点", tone: "red" },
          { label: "1 – 30 天", tone: "amber" },
          { label: "> 30 天", tone: "blue" },
          { label: "无事件日 沉底", tone: "neutral" },
        ],
        where: "Dashboard · 条目排序",
      },
      {
        name: "影响量",
        unit: "同天数的次级键",
        formula: "件 · 天 · 百分点 · 物料数",
        formulaNote: "单位由类型决定，只在同档同天数内降序，不跨类相加",
        chips: [
          { label: "缺口 件数", tone: "red" },
          { label: "超期 天数", tone: "amber" },
          { label: "份额 百分点", tone: "neutral" },
          { label: "物料 个数", tone: "neutral" },
        ],
        where: "Dashboard · 条目排序",
      },
      {
        name: "排序",
        unit: "优先级",
        formula: "紧急程度 ↑ → 距出事天数 ↑ → 影响量 ↓",
        formulaNote: "来源顺序只在同档同天数时兜底：件、天、百分点不能相加，跨来源只有天数能比",
        chips: [{ label: "越靠左越优先", tone: "neutral" }],
        where: "Dashboard · 卡片 / 矩阵",
      },
      {
        name: "供需缺口",
        unit: "预警",
        formula: "产能 ÷ 需求，窗口内取最差月",
        formulaNote: `窗口 ${ALERT.HORIZON} 个月；分母是该物料当月需求，不是项目总需求`,
        chips: [
          { label: `< ${TIGHT_RATIO_MIN.toFixed(1)} 缺口 P0`, tone: "red" },
          { label: `${TIGHT_RATIO_MIN.toFixed(1)} – ${TIGHT_RATIO_MAX.toFixed(1)} 偏紧 P1`, tone: "amber" },
        ],
        where: "Dashboard · 供需列",
      },
      {
        name: "库存断货 / 紧急",
        unit: "预警",
        formula: "DOH = 现存 ÷ 日均需求",
        formulaNote: "按推算单元算（项目×物料×供应商×基地），不按 PN 去重",
        chips: [
          { label: "DOH ≤ 0 或已断货 P0", tone: "red" },
          { label: `< 安全天数 或 < 3 天 紧急 P0`, tone: "red" },
          { label: "< 采购提前期 偏低 P1", tone: "amber" },
        ],
        where: "Dashboard · 库存列",
      },
      {
        name: "库存额度占用",
        unit: "预警",
        formula: "计划量 ÷ 分配额度",
        formulaNote: "分母是分给该供应商的额度，不是集团总产能",
        chips: [{ label: "> 100% 超额度 P1", tone: "amber" }],
        where: "Dashboard · 库存列",
      },
      {
        name: "变更超期 / 临期 / 迟交",
        unit: "预警",
        formula: "计划完成日 − 今天",
        formulaNote: `按末级任务算，不按变更单算；临期窗口 ${ALERT.NEAR_DUE_DAYS} 天`,
        chips: [
          { label: "已过未完成 超期 P0", tone: "red" },
          { label: `0 – ${ALERT.NEAR_DUE_DAYS} 天 临期 P1`, tone: "amber" },
          { label: "已完成但晚于计划 迟交 P2", tone: "neutral" },
        ],
        where: "Dashboard · 变更列",
      },
      {
        name: "份额风险",
        unit: "四类",
        formula: "独供 / 波动 / 建议偏差 / 错配",
        formulaNote: "一条记录只归入优先级最高的一类，不重复计数",
        chips: [
          { label: "独供 P1", tone: "red" },
          { label: "波动 P1", tone: "amber" },
          { label: "建议偏差 P2", tone: "amber" },
          { label: "错配 P2", tone: "violet" },
        ],
        where: "Dashboard · 份额列",
      },
      {
        name: "数据缺口",
        unit: "预警",
        formula: "缺需求 / BOM = 0 / 需求 = 0",
        formulaNote: "按「项目 × 成因」聚合成一条；这些物料供需与库存两处都不出数，静默即假绿",
        chips: [{ label: "命中即 P1", tone: "amber" }],
        where: "Dashboard · 数据缺口列",
      },
    ],
  },
  {
    key: "supply",
    title: "供需",
    metrics: [
      {
        name: "供应系数",
        formula: "产能 ÷ 需求",
        formulaNote: "单月、单物料；分母是该物料需求，不是项目总需求",
        chips: [
          { label: `< ${TIGHT_RATIO_MIN.toFixed(1)} 缺口`, tone: "red" },
          { label: `${TIGHT_RATIO_MIN.toFixed(1)} – ${TIGHT_RATIO_MAX.toFixed(1)} 紧张`, tone: "amber" },
          { label: `> ${TIGHT_RATIO_MAX.toFixed(1)} 充足`, tone: "green" },
          { label: "需求 = 0 无数据", tone: "neutral" },
        ],
        where: "供需 · 明细格",
      },
      {
        name: "全年覆盖率",
        formula: "Σ产能 ÷ Σ需求",
        formulaNote: "12 个月总量比",
        chips: [
          { label: "≥ 100% 总量够", tone: "blue" },
          { label: "< 100% 总量缺口", tone: "red" },
        ],
        where: "供需 · KPI 卡",
      },
      {
        name: "最差物料覆盖率",
        formula: "min ( 单品年产能 ÷ 单品年需求 )",
        formulaNote: "兜底：抓「总量够、单品崩」",
        chips: [
          { label: "≥ 100%", tone: "blue" },
          { label: "< 100% 有单品缺口", tone: "red" },
        ],
        where: "供需 · KPI 卡",
      },
      {
        name: "最大缺口比例",
        formula: "max ( 需求 − 产能 ) ÷ 需求",
        formulaNote: "只在缺口月取最大，定位最危险那个月",
        chips: [
          { label: "0 < x ≤ 100%", tone: "red" },
          { label: "无缺口 = 0", tone: "neutral" },
        ],
        where: "供需 · 风险行",
      },
      {
        name: "全年缺口总量",
        formula: "Σ max(0, 需求 − 产能)",
        formulaNote: "富余月按 0 计，不冲抵缺口月",
        chips: [
          { label: "> 0 有缺口", tone: "red" },
          { label: "= 0 无缺口", tone: "green" },
        ],
        where: "供需 · KPI 卡",
      },
    ],
  },
  {
    key: "share",
    title: "份额",
    metrics: [
      {
        name: "系统份额",
        unit: "%",
        formula: "Σ(基地份额 × 拉线数) ÷ Σ拉线数",
        formulaNote: "有基地数据时自动算，无基地则直接录本月份额",
        chips: [{ label: "同项目同物料合计 = 100%（±1%）", tone: "neutral" }],
        where: "份额 · 主表",
      },
      {
        name: "QDC 评分",
        formula: `Q / D / C ∈ {${QDC_SCORES.join(", ")}}`,
        formulaNote: "五档离散值，不能填其他数",
        chips: [
          { label: "1 优", tone: "green" },
          { label: "0.7", tone: "blue" },
          { label: "0.5 中", tone: "amber" },
          { label: "0.3", tone: "amber" },
          { label: "0 差", tone: "red" },
        ],
        where: "份额 · 录入",
      },
      {
        name: "加权评分",
        formula: "Q×wq + D×wd + C×wc",
        formulaNote: "成本配比 Q20 / D10 / C70；质量配比 Q70 / D10 / C20",
        chips: [
          { label: "0 – 1", tone: "neutral" },
          { label: "< 0.5 且份额 ≥ 50% → 错配", tone: "red" },
        ],
        where: "份额 · KPI / 四象限",
      },
      {
        name: "份额波动",
        unit: "风险",
        formula: "本月份额 vs 上月份额",
        formulaNote: `相对变化 ≥ ${pct(SHARE.FLUCTUATION_RATIO)} 触发`,
        chips: [
          { label: `≥ 上月 × ${1 + SHARE.FLUCTUATION_RATIO}`, tone: "red" },
          { label: `≤ 上月 × ${1 - SHARE.FLUCTUATION_RATIO}`, tone: "red" },
          { label: "任一为空 → 不判", tone: "neutral" },
        ],
        where: "份额 · 风险排行",
      },
      {
        name: "建议偏差",
        unit: "风险",
        formula: "| 本月份额 − 上月建议 |",
        formulaNote: `偏离 > ${SHARE.DEVIATION_PT} 个百分点触发`,
        chips: [
          { label: `> ${SHARE.DEVIATION_PT} pt 报警`, tone: "amber" },
          { label: `≤ ${SHARE.DEVIATION_PT} pt 正常`, tone: "green" },
        ],
        where: "份额 · 风险排行",
      },
      {
        name: "独供风险",
        formula: "该项目该物料供应商数 = 1",
        formulaNote: "项目内口径，不是集团口径",
        chips: [
          { label: "= 1 独供", tone: "red" },
          { label: "≥ 2 家", tone: "green" },
        ],
        where: "份额 · KPI / 排行",
      },
      {
        name: "份额 × 评分错配",
        formula: `份额 ≥ ${SHARE.MISMATCH_SHARE}% 且 加权分 < ${SHARE.MISMATCH_SCORE}`,
        formulaNote: "两个条件同时满足才命中",
        chips: [{ label: "命中即错配", tone: "violet" }],
        where: "份额 · KPI / 四象限",
      },
      {
        name: "高粘性供应商",
        formula: `当月覆盖物料数 ≥ ${SHARE.STICKY_MATERIALS}`,
        formulaNote: "按物料数算，不按份额算",
        chips: [
          { label: `≥ ${SHARE.STICKY_MATERIALS} 个物料`, tone: "amber" },
          { label: `< ${SHARE.STICKY_MATERIALS}`, tone: "green" },
        ],
        where: "份额 · KPI",
      },
    ],
  },
  {
    key: "inventory",
    title: "库存",
    metrics: [
      {
        name: "DOH",
        unit: "库存天数",
        formula: "期末库存 ÷ 日均需求",
        formulaNote: `看板只算 ${INV.WINDOW_DAYS} 天，超出显示 ${INV.WINDOW_DAYS}+`,
        chips: [
          { label: "≤ 0 耗尽", tone: "red" },
          { label: `< 安全天数 或 < ${INV.URGENT_DOH} 天 紧急`, tone: "red" },
          { label: "< LeadTime 偏低", tone: "amber" },
          { label: "≥ LeadTime 充足", tone: "green" },
          { label: "需求不可用 无法评估", tone: "neutral" },
        ],
        where: "库存 · 四卡 / 列表",
      },
      {
        name: "COV",
        unit: "需求波动",
        formula: "样本标准差 ÷ 均值",
        formulaNote: "至少 2 个月样本；均值 ≤ 0 也不可算",
        chips: [
          { label: `< ${INV.COV_MID} 低波动`, tone: "green" },
          { label: `${INV.COV_MID} – ${INV.COV_HI} 中波动`, tone: "amber" },
          { label: `≥ ${INV.COV_HI} 高波动`, tone: "red" },
          { label: "样本不足 不可算", tone: "neutral" },
        ],
        where: "库存 · 明细",
      },
      {
        name: "安全天数",
        formula: `Z × COV × √LT`,
        formulaNote: `Z = ${INV.SERVICE_Z}（95% 服务水平）；COV 不可算时回退 ${INV.SAFE_DOH_DEFAULT} 天`,
        chips: [
          { label: "公式推导", tone: "neutral" },
          { label: `回退值 ${INV.SAFE_DOH_DEFAULT} 天（非推导）`, tone: "amber" },
        ],
        where: "库存 · 明细",
      },
      {
        name: "安全库存 SS",
        formula: "日均需求 × 安全天数",
        formulaNote: "由日均需求和安全天数推导，不单独录入",
        chips: [{ label: "期末 < SS → 偏低", tone: "red" }],
        where: "库存 · 明细",
      },
      {
        name: "ROP",
        unit: "再订货点",
        formula: "( LeadTime + 安全天数 ) × 日均需求",
        formulaNote: "期末跌到 ROP 触发下单；ROP 管时机，不管补多少",
        chips: [{ label: "期末 ≤ ROP → 触发下单", tone: "red" }],
        where: "库存 · 下单时机",
      },
      {
        name: "产能校验",
        unit: "占用率",
        formula: "计划量 ÷ 分配额度",
        formulaNote: "分母是分给该供应商的额度，不是集团总产能",
        chips: [
          { label: "≤ 70% 充足", tone: "green" },
          { label: "70 – 100% 紧张", tone: "amber" },
          { label: "> 100% 超额度", tone: "red" },
          { label: "额度未录 无法校验", tone: "neutral" },
        ],
        where: "库存 · 明细",
      },
      {
        name: "预警状态",
        unit: "格子颜色",
        formula: "期末库存 vs SS / DOH vs 安全天数",
        formulaNote: `与顶部四卡是两套口径：四卡只看今日 DOH`,
        chips: [
          { label: "期末 ≤ 0 断货", tone: "red" },
          { label: "期末 < SS 偏低", tone: "red" },
          { label: `DOH < 安全 × ${INV.YELLOW_RATIO} 贴近安全`, tone: "amber" },
          { label: "DOH > 过剩天数 积压", tone: "blue" },
          { label: "其余 正常", tone: "green" },
        ],
        where: "库存 · 30 天矩阵",
      },
    ],
  },
  {
    key: "change",
    title: "变更",
    metrics: [
      {
        name: "超期项数",
        formula: "计划完成日 < 今天 且 未完成",
        formulaNote: "按任务算，不按变更单算",
        chips: [{ label: "命中即超期", tone: "red" }],
        where: "变更 · 统计卡",
      },
      {
        name: "临期项数",
        formula: `0 ≤ 剩余天数 ≤ ${ALERT.NEAR_DUE_DAYS}`,
        formulaNote: "未超期，但已进入预警窗（阈值取 NEAR_DUE_DAYS）",
        chips: [{ label: "进入预警窗", tone: "amber" }],
        where: "变更 · 统计卡",
      },
      {
        name: "任务完成率",
        formula: "已完成任务数 ÷ 任务总数",
        formulaNote: "按任务算，权重一律相等",
        chips: [{ label: "0 – 100%", tone: "blue" }],
        where: "变更 · 项目排行",
      },
      {
        name: "迟交时长",
        formula: "实际完成日 − 计划完成日",
        formulaNote: "仅对已完成任务计算",
        chips: [
          { label: "1 – 7 天", tone: "amber" },
          { label: "8 – 30 天", tone: "amber" },
          { label: "> 30 天", tone: "red" },
        ],
        where: "变更 · 偏差榜",
      },
    ],
  },
];
