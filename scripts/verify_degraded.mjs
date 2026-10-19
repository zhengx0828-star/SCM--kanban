/**
 * 「结论降级态」验收 —— 用 CDP 响应拦截喂合成数据，覆盖四个结论生成器的所有分支。
 *
 * 为什么需要它：
 *   四张图各自带一行「一句话结论」（ChangeInsight），结论由数据算出。真实库里
 *   只会出现其中一种数据形状（比如"每个项目都滞后"），于是**降级分支永远不被执行**：
 *     · 空库      → "还没有变更单…"/"暂无数据"
 *     · 进度快于计划 / 完全一致 → good 分支
 *     · 所有项目都不落后       → good 分支
 *     · 只有一种变更类型        → 单类型分支
 *     · 归档 Tab 无归档项目     → "还没有归档的项目"
 *   这些分支平时看不见，一旦线上命中就会以**白屏或缺字**的形式暴露。
 *
 * ★ 关键手法：不往正式库造数据，而是用 Fetch.enable + Fetch.fulfillRequest
 *   在**浏览器侧**把 /api/changes/* 的响应换成合成 payload。
 *   好处：① 一个字节都不写数据库（造测试实体进正式库必须先问用户）；
 *        ② 可以构造现实中不存在的极端形状（如 actual > plan 且差距持续扩大）；
 *        ③ 跑完即走，无需清理，可反复跑。
 *   ⚠ Fetch.enable 的 pattern 用 `*​/api/changes*`（尾部单个 *），
 *     写成 `/api/changes/*` 会漏掉 `/api/changes?page=1`（没有结尾斜杠）。
 *
 * 用法：node scripts/verify_degraded.mjs [baseUrl]
 *   默认 http://127.0.0.1
 */

import { spawn } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.argv[2] ?? "http://127.0.0.1";
/** 设了就按场景存整页截图（复核用；手机上只能看截图，不能读控制台） */
const SHOT_DIR = process.env.SHOT_DIR ?? "";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `cdp-degraded-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "[OK]" : "[!!]"} ${name}${extra ? ` —— ${extra}` : ""}`);
  ok ? pass++ : fail++;
};

/* ============================================================ 合成 payload 构造器 */

/** 项目卡片墙的一行（ChangeProjectOverview 全字段，缺字段前端会读到 undefined）
 *  ★ 三个比率字段默认给 0 而不是 100：avg_deviation 必须等于 avg_time_rate − task_done_rate，
 *    否则截图上会出现"时间进度 62% / 完成率 55%"却标"超前"的自相矛盾 —— 那是 mock 不自洽，
 *    不是页面缺陷，但复核的人看不出来，会当成真 bug。
 *  ★ 口径（2026-10-06 起）：total = **有效单**（不含作废、不含归档）→ 必须满足 total === active + done。
 *    open_tasks 是项目饼图「待办项数」口径的数据源，不填会渲染成 undefined。 */
const proj = (over = {}) => ({
  project_id: 1,
  project_code: "PRJ-001",
  project_name: "项目A",
  total: 1,
  active: 1,
  done: 0,
  voided: 0,
  archived: 0,
  open_tasks: 0,
  overdue_changes: 0,
  overdue_tasks: 0,
  near_changes: 0,
  near_tasks: 0,
  task_done_rate: 0,
  change_done_rate: 0,
  avg_time_rate: 0,
  avg_deviation: 0,
  type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 1 }],
  most_urgent: null,
  ...over,
});

/** 全零汇总（空库形状）。task_state_counts / overdue_buckets 服务端固定带 0 档，这里同样保留。 */
const EMPTY_SUMMARY = {
  total: 0, active: 0, done: 0, voided: 0, archived: 0,
  overdue_changes: 0, overdue_tasks: 0, near_changes: 0, near_tasks: 0,
  project_count: 0, material_count: 0, type_count: 0,
  type_counts: [],
  task_state_counts: [
    { state: "todo", label: "进行中", count: 0 },
    { state: "soon", label: "临期", count: 0 },
    { state: "overdue", label: "超期未完成", count: 0 },
    { state: "done", label: "按时完成", count: 0 },
    { state: "late", label: "迟交完成", count: 0 },
  ],
  overdue_buckets: [
    { label: "1-3 天", count: 0 },
    { label: "4-7 天", count: 0 },
    { label: "8-14 天", count: 0 },
    { label: "> 14 天", count: 0 },
  ],
  unassigned_tasks: 0,
  max_overdue_days: 0,
};

const summaryWith = (over = {}) => ({ ...EMPTY_SUMMARY, ...over });

/**
 * 五色任务档位。**合计 = 页面「待办项」总数**。
 * 不填的话 EMPTY_SUMMARY 的全 0 会让截图出现「超期未完成 2」旁边站着一个「待办项 0」——
 * 又是 mock 自相矛盾，复核的人会当成真 bug。但凡 overdue_tasks > 0，就得在这里补上。
 */
const states = ({ todo = 0, soon = 0, overdue = 0, done = 0, late = 0 } = {}) => [
  { state: "todo", label: "进行中", count: todo },
  { state: "soon", label: "临期", count: soon },
  { state: "overdue", label: "超期未完成", count: overdue },
  { state: "done", label: "按时完成", count: done },
  { state: "late", label: "迟交完成", count: late },
];

/** 超期时长分档（4 档）。合计应等于 overdue_tasks ——
 *  全 0 会让截图出现「超期 2 项，只落在 0 个区间里」这种鬼话。 */
const buckets = ({ d1 = 0, d4 = 0, d8 = 0, d14 = 0 } = {}) => [
  { label: "1-3 天", count: d1 },
  { label: "4-7 天", count: d4 },
  { label: "8-14 天", count: d8 },
  { label: "> 14 天", count: d14 },
];

/**
 * 燃尽图。points 的 plan/actual 直接决定 burndownInsight 走哪个分支：
 *   gap = actual − plan，取最后一个点；gap>0 落后 / =0 咬紧 / <0 超前。
 * ★ 注意 total 用首点的 plan 值兜底，避免图表 y 轴出现 NaN。
 */
const burn = (pairs) => {
  const points = pairs.map(([date, plan, actual]) => ({
    date, plan_remaining: plan, actual_remaining: actual,
  }));
  return {
    total: pairs[0]?.[1] ?? 0,
    start: pairs[0]?.[0] ?? null,
    end: pairs[pairs.length - 1]?.[0] ?? null,
    step: 1,
    points,
  };
};

const EMPTY_LIST = { items: [], total: 0, page: 1, page_size: 100, total_pages: 0 };

/**
 * ★ 2026-10-06 第三次重排后，**一个场景的内容跨了两个视图**：
 *   - 主页（`/changes`）：三张饼（任务构成 / 类型分布 / 项目分布）的降级结论
 *   - 分析视图（`/changes?view=analysis`）：燃尽图 / 偏差榜 / 待办项的降级结论
 *   所以执行器对每个场景**两个视图各取一次**，结论在任一侧命中即算命中 ——
 *   否则会出现"内容搬走了 → 断言假失败"（上一轮 todos/trend 那次踩的是同一个坑）。
 *   旧参数 ?todos/?trend/?deep 现在会被前端兼容映射到分析视图，本脚本不再使用。
 *
 * 场景定义。
 *   payloads：按 URL 关键字给响应体（返回 undefined 的关键字走 fallback：/api/changes/* 一律给 []）
 *   expect  ：必须在页面上出现的结论片段；dot 为期望的语义色（bad=red / good=emerald / warn=amber / info=blue）
 *   absent  ：必须**不**出现的片段（防止降到错的分支还说"通过"）
 */
const SCENARIOS = [
  {
    name: "S1 空库 —— 四张图全部降级",
    url: "/changes",
    payloads: {
      summary: EMPTY_SUMMARY,
      "project-overview": [],
      burndown: burn([]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      { text: "还没有任务，或任务未填计划时间，暂时画不出燃尽曲线", dot: "muted" },
      { text: "暂无数据", dot: "muted" },
      { text: "还没有变更单，点右上角「新建变更单」开始记录", dot: "muted" },
    ],
    absent: ["实际剩余比计划", "所有项目都不落后", "最多，"],
  },
  {
    name: "S2 单类型 + 进度完全一致（good）",
    // ★ 偏差榜结论（deviationInsight）在**默认折叠**的深度分析区里，不带 deep=1 根本不渲染 ——
    //   只验文字会得到"未找到"，误判成缺陷。实测踩过。
    url: "/changes",
    payloads: {
      // 只有一类 → 走 list.length===1 分支；无作废 → 不该出现「另有」标注
      summary: summaryWith({
        total: 5, active: 5, type_count: 1, project_count: 1, material_count: 5,
        type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 5 }],
        task_state_counts: states({ todo: 12, done: 3 }),
      }),
      "project-overview": [
        proj({
          project_id: 1, project_name: "项目A", total: 5, active: 5, open_tasks: 12,
          type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 5 }],
        }),
      ],
      // 每个点 actual 与 plan 相等 → 末点 gap === 0
      burndown: burn([
        ["2026-09-01", 5, 5], ["2026-09-08", 4, 4], ["2026-09-15", 3, 3], ["2026-09-22", 2, 2],
      ]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      { text: "目前只有「二供导入」一类，共 5 张", dot: "blue" },
      { text: "实际剩余与计划完全一致（各 2 项），进度咬得很紧", dot: "emerald" },
      { text: "所有项目都不落后于时间进度（共 1 个）", dot: "emerald" },
    ],
    // ★ 不能出现作废说明：voided = 0 时披露是噪音
    absent: ["另有", "未计入"],
  },
  {
    name: "S3 进度快于计划（good）",
    url: "/changes",
    payloads: {
      summary: summaryWith({
        total: 4, active: 4, type_count: 2, project_count: 2, material_count: 4,
        type_counts: [
          { change_type_id: 1, type_name: "二供导入", count: 3 },
          { change_type_id: 2, type_name: "设计变更", count: 1 },
        ],
        task_state_counts: states({ todo: 10, done: 2 }),
      }),
      "project-overview": [
        // 偏差 = 时间进度 − 完成率：A: 52−70=−18；B: 55−62=−7 → 最大者仍 ≤ 0 → 「都不落后」
        // 卡片上会显示类型 chip（合计必须 == 该项目 total），且两卡相加要等于 summary.type_counts
        proj({ project_id: 1, project_name: "项目A", total: 2, active: 2, open_tasks: 6, task_done_rate: 70, avg_time_rate: 52, avg_deviation: -18,
          type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 2 }] }),
        proj({ project_id: 2, project_code: "PRJ-002", project_name: "项目B", total: 2, active: 2, open_tasks: 4, task_done_rate: 62, avg_time_rate: 55, avg_deviation: -7,
          type_counts: [
            { change_type_id: 1, type_name: "二供导入", count: 1 },
            { change_type_id: 2, type_name: "设计变更", count: 1 },
          ] }),
      ],
      // 末点 gap = 2 − 4 = −2 → good
      burndown: burn([
        ["2026-09-01", 6, 6], ["2026-09-08", 6, 5], ["2026-09-15", 5, 4], ["2026-09-22", 4, 2],
      ]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      { text: "实际剩余比计划少 2 项，进度快于计划", dot: "emerald" },
      { text: "二供导入最多，3/4 张（75%）；共 2 种类型", dot: "blue" },
      { text: "所有项目都不落后于时间进度（共 2 个）", dot: "emerald" },
    ],
    absent: ["实际剩余比计划多", "个百分点"],
  },
  {
    name: "S4 落后但差距不再扩大（warn）",
    url: "/changes",
    payloads: {
      // 新口径：total = 有效单 = active + done = 6 + 1 = 7（作废单另记「另有作废」，不再混进总数）
      summary: summaryWith({
        total: 7, active: 6, done: 1, voided: 1, type_count: 3,
        project_count: 1, material_count: 7,
        overdue_changes: 1, overdue_tasks: 2, max_overdue_days: 6,
        type_counts: [
          { change_type_id: 1, type_name: "二供导入", count: 3 },
          { change_type_id: 2, type_name: "设计变更", count: 2 },
          { change_type_id: 3, type_name: "质量问题", count: 2 },
        ],
        task_state_counts: states({ todo: 6, overdue: 2, done: 4 }),
        overdue_buckets: buckets({ d4: 2 }),
      }),
      "project-overview": [
        proj({
          project_id: 1, project_name: "项目A", total: 7, active: 6, done: 1, voided: 1,
          open_tasks: 8, overdue_tasks: 2, overdue_changes: 1,
          avg_deviation: 12, task_done_rate: 50, avg_time_rate: 62,
          most_urgent: null,
          type_counts: [
            { change_type_id: 1, type_name: "二供导入", count: 3 },
            { change_type_id: 2, type_name: "设计变更", count: 2 },
            { change_type_id: 3, type_name: "质量问题", count: 2 },
          ],
        }),
      ],
      // gap: 2,2,2,2,2 → 恒定 >0，从未扩大 → slipIdx = −1 → 「已不再扩大」分支；gap 2 < 8 → warn
      burndown: burn([
        ["2026-09-01", 20, 22], ["2026-09-08", 18, 20], ["2026-09-15", 16, 18],
        ["2026-09-22", 14, 16], ["2026-09-29", 12, 14],
      ]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      { text: "实际剩余比计划多 2 项（还剩 14 项没勾）；差距已不再扩大，最近没有新的掉链子", dot: "amber" },
      // 同一屏另两处：类型饼图与「变更总数」已是同一口径（都不含作废）→ 分母都该是 7，
      // 且**不再**出现「另有 N 张作废未计入」的兜底说明
      { text: "二供导入最多，3/7 张（43%）；共 3 种类型", dot: "blue" },
      // 偏差榜：唯一项目滞后 12 个百分点（<20 → warn），不是"全部不落后"
      { text: "「项目A」完成率 50% 垫底 —— 时间已过 62%，落后 12 个百分点；1/1 个项目滞后", dot: "amber" },
    ],
    absent: ["张作废未计入"],
  },
  {
    name: "S5 持续掉链子 + 严重滞后（bad）",
    url: "/changes",
    payloads: {
      summary: summaryWith({
        total: 6, active: 6, overdue_changes: 3, overdue_tasks: 5, type_count: 1,
        project_count: 3, material_count: 6, max_overdue_days: 21,
        type_counts: [{ change_type_id: 3, type_name: "质量问题", count: 6 }],
        task_state_counts: states({ todo: 1, overdue: 5, done: 3 }),
        overdue_buckets: buckets({ d4: 2, d8: 2, d14: 1 }),
      }),
      "project-overview": [
        // 3 个项目，1 个滞后 25 个百分点（≥20 → bad）；overdue_tasks 3+2+0 == summary 5
        proj({ project_id: 1, project_name: "项目A", total: 3, active: 3, open_tasks: 3, overdue_tasks: 3, overdue_changes: 3, avg_deviation: 25, task_done_rate: 35, avg_time_rate: 60,
          type_counts: [{ change_type_id: 3, type_name: "质量问题", count: 3 }] }),
        proj({ project_id: 2, project_code: "PRJ-002", project_name: "项目B", total: 2, active: 2, open_tasks: 2, overdue_tasks: 2, avg_deviation: -4, task_done_rate: 80, avg_time_rate: 76,
          type_counts: [{ change_type_id: 3, type_name: "质量问题", count: 2 }] }),
        proj({ project_id: 3, project_code: "PRJ-003", project_name: "项目C", total: 1, active: 1, open_tasks: 1, avg_deviation: -1, task_done_rate: 90, avg_time_rate: 89,
          type_counts: [{ change_type_id: 3, type_name: "质量问题", count: 1 }] }),
      ],
      // gap: 0,8,12,16,20 → 每一点都在扩大 → slipIdx = 末点；末 gap 20 ≥ 8 → bad
      burndown: burn([
        ["2026-09-01", 40, 40], ["2026-09-08", 34, 42], ["2026-09-15", 28, 40],
        ["2026-09-22", 22, 38], ["2026-09-29", 16, 36],
      ]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      { text: "实际剩余比计划多 20 项（还剩 36 项没勾）；差距最近一次扩大在 09-29", dot: "red" },
      { text: "目前只有「质量问题」一类，共 6 张", dot: "blue" },
      { text: "「项目A」完成率 35% 垫底 —— 时间已过 60%，落后 25 个百分点；1/3 个项目滞后", dot: "red" },
    ],
    absent: ["已不再扩大"],
  },
  {
    name: "S6 归档 Tab 无归档项目",
    url: "/changes?archived=1",
    payloads: {
      summary: summaryWith({
        total: 3, active: 3, type_count: 1, project_count: 1, material_count: 3,
        type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 3 }],
        task_state_counts: states({ todo: 5 }),
      }),
      // 全是「未归档」的项目 → archivedTab 下 tabRows 为空
      "project-overview": [
        proj({ project_id: 1, project_name: "项目A", total: 3, active: 3, open_tasks: 5, archived: 0,
          type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 3 }] }),
      ],
      burndown: burn([["2026-09-01", 3, 3], ["2026-09-08", 2, 2]]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      { text: "还没有归档的项目", dot: "muted" },
    ],
    absent: ["还没有变更单，点右上角"],
  },
  {
    name: "S7 项目饼图口径切到「超期项」（warn）",
    url: "/changes?metric=overdue",
    payloads: {
      summary: summaryWith({
        total: 5, active: 5, type_count: 2, overdue_changes: 3, overdue_tasks: 7,
        project_count: 2, material_count: 5,
        type_counts: [
          { change_type_id: 1, type_name: "二供导入", count: 3 },
          { change_type_id: 3, type_name: "质量问题", count: 2 },
        ],
        task_state_counts: states({ overdue: 7, done: 2 }),
        overdue_buckets: buckets({ d1: 4, d4: 3 }),
      }),
      "project-overview": [
        // open_tasks ≥ overdue_tasks 是硬约束（overdue 是 open 的子集）
        proj({ project_id: 1, project_name: "项目A", total: 3, active: 3, open_tasks: 5, overdue_tasks: 5, overdue_changes: 2,
          type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 3 }] }),
        proj({ project_id: 2, project_code: "PRJ-002", project_name: "项目B", total: 2, active: 2, open_tasks: 2, overdue_tasks: 2, overdue_changes: 1,
          type_counts: [{ change_type_id: 3, type_name: "质量问题", count: 2 }] }),
      ],
      burndown: burn([["2026-09-01", 5, 6], ["2026-09-08", 4, 7]]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      // 标签取自 METRIC_LABEL：changes=变更单数 / tasks=待办项数 / overdue=超期项数
      { text: "按超期项数：「项目A」5 最多，共 2 个项目有变更", dot: "amber" },
    ],
    // metric=overdue 时不应再追加「超期项最多的是…」（自己就是超期口径，重复说一遍是废话）
    absent: ["超期项最多的是"],
  },
  {
    name: "S8 项目饼图口径切到「待办项」",
    url: "/changes?metric=tasks",
    payloads: {
      summary: summaryWith({
        total: 5, active: 5, type_count: 2, project_count: 2, material_count: 5,
        overdue_tasks: 5, overdue_changes: 2,
        type_counts: [
          { change_type_id: 1, type_name: "二供导入", count: 3 },
          { change_type_id: 2, type_name: "设计变更", count: 2 },
        ],
        task_state_counts: states({ overdue: 5, done: 1 }),
        overdue_buckets: buckets({ d1: 3, d4: 2 }),
      }),
      "project-overview": [
        // tasks 口径 = 后端 open_tasks（**不是** total − voided − archived，那样会重复减作废）；
        // 项目A total=3（active 3）+ 另有作废 2，open_tasks 4 → 饼图取 4
        proj({ project_id: 1, project_name: "项目A", total: 3, active: 3, voided: 2, open_tasks: 4, overdue_tasks: 4, overdue_changes: 1,
          type_counts: [{ change_type_id: 1, type_name: "二供导入", count: 3 }] }),
        proj({ project_id: 2, project_code: "PRJ-002", project_name: "项目B", total: 2, active: 2, open_tasks: 1, overdue_tasks: 1, overdue_changes: 1,
          type_counts: [{ change_type_id: 2, type_name: "设计变更", count: 2 }] }),
      ],
      burndown: burn([["2026-09-01", 5, 5], ["2026-09-08", 4, 4]]),
      alerts: [],
      "/api/changes?": EMPTY_LIST,
    },
    expect: [
      // tasks 口径下仍会追加「超期项最多的是…」（metric !== overdue）——顺序对不上就是口径串了
      { text: "按待办项数：「项目A」4 最多，共 2 个项目有变更；超期项最多的是「项目A」（4 项）", dot: "blue" },
    ],
    absent: [],
  },
];

/* ================================================================== CDP 脚手架 */

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let ws;
try {
  let page;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) break;
    } catch {}
    await sleep(250);
  }
  if (!page) throw new Error("Chrome 未就绪");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));

  let id = 0;
  const pending = new Map();
  const errors = [];
  /** 当前生效的场景；拦截回调按它构造响应体 */
  let current = SCENARIOS[0];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);

    // 拦截：把 /api/changes/* 换成合成数据
    if (m.method === "Fetch.requestPaused") {
      const p = m.params;
      const url = p.request.url;
      void (async () => {
        try {
          const sc = current;
          let body;
          if (url.includes("/changes/summary")) body = sc.payloads.summary;
          else if (url.includes("/changes/project-overview")) body = sc.payloads["project-overview"];
          else if (url.includes("/changes/burndown")) body = sc.payloads.burndown;
          else if (url.includes("/changes/alerts")) body = sc.payloads.alerts;
          else if (url.includes("/api/changes?")) body = sc.payloads["/api/changes?"];
          else body = []; // owners / types / 其它 → 空数组
          const payload = Buffer.from(JSON.stringify(body ?? [])).toString("base64");
          await send("Fetch.fulfillRequest", {
            requestId: p.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/json" },
              { name: "Cache-Control", value: "no-store" },
            ],
            body: payload,
          });
        } catch {
          try { await send("Fetch.continueRequest", { requestId: p.requestId }); } catch {}
        }
      })();
      return;
    }

    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push("pageerror: " + (m.params.exceptionDetails?.exception?.description ?? "?"));
    }

    if (m.id && pending.has(m.id)) {
      const pr = pending.get(m.id);
      pending.delete(m.id);
      m.error ? pr.reject(new Error(JSON.stringify(m.error))) : pr.resolve(m.result);
    }
  };

  const send = (method, params = {}, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP 超时: ${method}`)); }, timeoutMs);
      pending.set(i, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const evalJs = async (expr) => {
    // ★ 导航期间求值会抛 Uncaught（执行上下文销毁）→ 必须重试，这是导航竞态不是页面缺陷
    for (let i = 0; i < 6; i++) {
      try {
        const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, 8000);
        return r.result?.value;
      } catch { await sleep(300); }
    }
    return undefined;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/changes*", requestStage: "Request" }] });

  /**
   * 读取页面上所有「一句话结论」行：正文 + 语义色圆点。
   * 圆点色由 ChangeInsight 决定（bad=red / good=emerald / warn=amber / info=blue / default=muted），
   * 只比对文字是不够的 —— 同一句话配错色也是缺陷（绿字说"落后"）。
   */
  const INSIGHTS_EXPR = `[...document.querySelectorAll("p")].filter(px =>
      (px.className || "").includes("leading-relaxed")
    ).map(px => {
      const dot = px.querySelector('span[aria-hidden="true"]');
      const m = /bg-(red|emerald|amber|blue|muted)/.exec(dot ? dot.className : "");
      return { text: (px.innerText || "").replace(/\\s+/g, " ").trim(), dot: m ? m[1] : "?" };
    })`;

  const probe = async () => {
    const j = await evalJs(`JSON.stringify({
      insights: ${INSIGHTS_EXPR},
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chars: document.body.innerText.length,
      text: document.body.innerText
    })`);
    return j ? JSON.parse(j) : null;
  };

  const open = async (url) => {
    await send("Page.navigate", { url: BASE + url, transitionType: "reload" });
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const n = await evalJs("document.body ? document.body.innerText.length : 0");
      if (n === last && n > 150) { if (++stable >= 3) break; } else { stable = 0; last = n; }
      await sleep(350);
    }
  };

  console.log(`结论降级态验收 —— ${BASE}\n（响应拦截合成数据，不触碰数据库）`);

  for (const sc of SCENARIOS) {
    current = sc;
    const mark = errors.length; // ★ 游标必须取在 open() 之前，否则把上一场景的报错算进来 → 断言恒真
    // 主页：三张饼的降级结论住这里
    await open(sc.url);
    const gHome = await probe();
    // 分析视图：燃尽图 / 偏差榜 / 待办项的降级结论住这里
    await open(sc.urlAna ?? "/changes?view=analysis");
    const gAna = await probe();
    // 合并成"同一场景的实际观感"：正文拼接、结论行合并、溢出取较大值
    const g =
      gHome && gAna
        ? {
            ...gAna,
            overflow: Math.max(gHome.overflow, gAna.overflow),
            text: gHome.text + "\n" + gAna.text,
            insights: [...gHome.insights, ...gAna.insights],
          }
        : gHome ?? gAna;
    console.log(`\n== ${sc.name}`);

    if (!g) {
      check("页面可读取", false, "probe 返回空");
      continue;
    }

    for (const e of sc.expect) {
      const hit = g.insights.find((i) => i.text.includes(e.text));
      const okText = Boolean(hit);
      const okDot = okText && (!e.dot || hit.dot === e.dot);
      check(
        `结论：${e.text.length > 42 ? e.text.slice(0, 42) + "…" : e.text}`,
        okText && okDot,
        !okText
          ? `未找到。实际结论 ${g.insights.length} 行：${g.insights.map((i) => i.text.slice(0, 26)).join(" ｜ ")}`
          : okDot ? `色 ${hit.dot}` : `语义色不符：期望 ${e.dot} 实际 ${hit.dot}`
      );
    }

    for (const a of sc.absent ?? []) {
      check(`不应出现「${a}」`, !g.text.includes(a));
    }

    // 降级态最容易出的两种"静默损坏"：NaN 渗进文案、布局被空数据撑破
    check("正文无 NaN", !/\bNaN\b/.test(g.text));
    check("无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);

    const newErrors = errors.slice(mark);
    check("无 console.error / pageerror", newErrors.length === 0, newErrors.slice(0, 2).map((e) => e.split("\n")[0].slice(0, 140)).join(" | ") || "干净");

    if (SHOT_DIR) {
      const file = path.join(SHOT_DIR, `${sc.name.slice(0, 2)}.png`);
      mkdirSync(SHOT_DIR, { recursive: true });
      const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, 25000);
      writeFileSync(file, Buffer.from(s.data, "base64"));
      console.log(`  [sh] 截图 → ${file}`);
    }
  }

  console.log(`\n结论：${fail === 0 ? "全部通过" : `${fail} 条未通过`}（通过 ${pass}）`);
} catch (e) {
  console.log("!! " + (e?.message ?? e));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(0);
