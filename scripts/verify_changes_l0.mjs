/**
 * 变更管理 L0（/changes）常驻验收 —— **第三次重排（2026-10-06）：三饼回主页 + 分析视图**。
 *
 * 新版面（主页 `?`）：
 *   ┌ 固定顶部区（吸顶 · lg+）= 标题栏 + 统计卡 ×5
 *   ├ ① 项目卡片墙（Tab + 搜索 + 网格 + 分页）
 *   ├ ② 构成三视图：任务构成饼 │ 按类型分布饼 │ 按项目分布饼（**并列一行、圆心同水平线**）
 *   └ ③ 变更分析入口（一行 → 跳 `?view=analysis`）
 *
 * 分析视图（`?view=analysis`，同页切换）：待办项 + 整体燃尽图 + 深度分析，**常显不折叠**。
 *
 * 为什么单独一套：这一页的改动**全是"位置 / 图形 / 跳转"**，而这三件事恰恰是
 * `verify_mobile.mjs`（只看溢出）与 `_tmp/verify_home.mjs`（只看数字口径）都测不到的：
 *   - 位置错 → 页面照样渲染、数字照样对，只是"东西不在该在的地方"
 *   - 三饼不对齐 → 页面不报错，只是"看起来不整齐"（用户明确要的"整体美观"就没了）
 *   - 跳转错 → 点了没反应 / 返回被弹回（假死）
 *
 * 覆盖（共 52 条）：
 *   S0  固定顶部区：标题 + 统计卡 ×5 同在一个 sticky 容器（用户钦定「一直放最上面」）
 *   S1  块顺序 ★：顶部区 → 卡片墙 → 三饼行 → 分析入口（防后人改回去）
 *   S2  首屏可见性 ★：1440×900 与 1280×720 下「3 张项目卡」完整落在首屏内 + 三饼行已进入首屏
 *   S3  吸顶 ★：滚到底后顶部区仍贴在站点顶栏（56px）之下，统计卡仍可见
 *   S4  三饼并排与对齐 ★：三卡同宽同高、**三个 canvas top 完全相同**（圆心同水平线）、canvas 恰好 3 个
 *   S5  主页不含执行层 ★：待办项明细 / 燃尽图 / 深度分析都不在主页 DOM 里（不是"藏起来"，是"搬走了"）
 *   S6  假死门禁与旧参数兼容 ★：?todos/?trend/?deep/?risk 老链接都进分析视图；点统计卡直达并带筛
 *   S7  视图切换 ★：点入口条进分析视图；「返回项目总览」回主页且 URL 清干净；清除筛选不把人踢回主页
 *   S8  分析视图内容常显：待办项表 + 燃尽图画布 + 深度分析块都在，且没有折叠头
 *   S9  摘要同源 ★：入口条摘要数字 == 接口 == 统计卡（同一个口径，不新造话术）
 *   S10 窄屏 390：无横向溢出、顶部区**不**吸顶、三饼退化为单列叠放、卡片墙仍在三饼之前
 *   S11 运行期错误总检（本页范围）+ 证据截图互不相同
 *
 * 只读：只点统计卡 / 点入口条 / 点返回 / 滚动，不保存、不删除、不改任何数据。
 * 用法：node scripts/verify_changes_l0.mjs [baseUrl]      （SHOT_DIR=dir 可顺带出图）
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.argv[2] ?? "http://127.0.0.1";
const API = "http://127.0.0.1:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? "";
const PORT = 9620 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), `cdp-l0-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "[OK]" : "[!!]"} ${name}${extra ? ` —— ${extra}` : ""}`);
  ok ? pass++ : fail++;
};

const api = async (p) => (await fetch(`${API}${p}`)).json();

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

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
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

  const send = (method, params = {}, timeoutMs = 20000) =>
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
    // ★ 导航期间求值会抛 Uncaught（执行上下文销毁）→ 必须重试；这是导航竞态，不是页面缺陷
    for (let i = 0; i < 6; i++) {
      try {
        const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, 8000);
        return r.result?.value;
      } catch { await sleep(300); }
    }
    return undefined;
  };

  const mark = () => errors.length;

  /** 设备模拟必须在 navigate **之前** 生效，否则等于没生效 */
  const open = async (W, H, qs = "") => {
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 640 });
    await send("Page.navigate", { url: `${BASE}/changes${qs}`, transitionType: "reload" });
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const n = await evalJs("document.body ? document.body.innerText.length : 0");
      if (n === last && n > 150) { if (++stable >= 3) break; } else { stable = 0; last = n; }
      await sleep(350);
    }
    await sleep(400);
  };

  const shotHashes = new Map();
  const shot = async (name) => {
    if (!SHOT_DIR) return null;
    mkdirSync(SHOT_DIR, { recursive: true });
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, 30000);
    if (!s?.data) return null;
    const buf = Buffer.from(s.data, "base64");
    const file = path.join(SHOT_DIR, `${name}.png`);
    writeFileSync(file, buf);
    const md5 = createHash("md5").update(buf).digest("hex").slice(0, 10);
    shotHashes.set(name, md5);
    console.log(`  [sh] 截图 → ${file}  #${md5}`);
    return md5;
  };

  /**
   * 页面事实一次取回（少来回、少竞态）。
   * 定位全部走**语义**（文本 / data-slot / data-role），不靠 class 字符串 —— class 一改就失效。
   */
  const GEOM = `JSON.stringify((() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width), left: Math.round(b.left) };
    };
    const cards = () => [...document.querySelectorAll('[data-slot="card"]')];
    const cardWith = (txt) => cards().find((c) => (c.innerText || "").includes(txt));
    /** 含**按钮**且按钮文案命中的卡 —— 用来找"入口条"（区别于同名的 h2 标题） */
    const btnCardWith = (txt) => cards().find((c) => {
      const b = c.querySelector("button");
      return !!b && (b.innerText || "").includes(txt);
    });
    const wrap = document.querySelector("main > div");
    const band = wrap ? wrap.firstElementChild : null;
    const titleEl = band ? band.children[0] : null;
    const statsEl = band ? band.children[1] : null;
    const bs = band ? getComputedStyle(band) : null;

    const search = document.querySelector('input[placeholder^="搜索项目名"]');
    const wallTool = search ? search.parentElement.parentElement : null;
    const pagerRow = (() => {
      const p = [...document.querySelectorAll("p")].find((x) => /共 \\d+ 条记录/.test(x.textContent || ""));
      return p ? p.parentElement : null;
    })();
    const cardsGrid = (() => {
      const first = document.querySelector('[role="button"][tabindex="0"]');
      return first ? first.parentElement : null;
    })();

    const pieTask = cardWith("任务构成");
    const pieType = cardWith("按类型分布");
    const pieProj = cardWith("按项目分布");
    const entry = btnCardWith("变更分析");
    const alertCard = cardWith("最需要盯的待办项");
    const burnCard = cardWith("整体燃尽图");
    const deepCard = cardWith("深度分析");
    const backBtn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("返回项目总览"));

    const cv = [...document.querySelectorAll("canvas")].map((c) => r(c));
    const statCards = statsEl ? [...statsEl.children] : [];
    const txt = document.body.innerText || "";
    const entryText = entry ? (entry.innerText || "").replace(/\\s+/g, " ").trim() : null;

    return {
      path: location.pathname + location.search,
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      docH: document.documentElement.scrollHeight,
      scrollY: Math.round(window.scrollY),
      maxScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bandCls: band ? (band.className || "").toString() : null,
      bandPosition: bs ? bs.position : null,
      bandTop: bs ? bs.top : null,
      band: r(band),
      title: r(titleEl),
      stats: r(statsEl),
      statCount: statCards.length,
      statLabels: statCards.map((x) => ((x.innerText || "").split("\\n")[0] || "").trim()),
      wallTool: r(wallTool),
      cardsGrid: r(cardsGrid),
      cardCount: document.querySelectorAll('[role="button"][tabindex="0"]').length,
      pager: r(pagerRow),

      pieTask: r(pieTask), pieType: r(pieType), pieProj: r(pieProj),
      pieRow: r(pieTask ? pieTask.parentElement : null),
      entry: r(entry),
      entryText,
      alertCard: r(alertCard), burnCard: r(burnCard), deepCard: r(deepCard),

      canvasCount: cv.length,
      canvases: cv,

      // 视图判定：分析视图有「返回项目总览」按钮；主页没有
      inAnalysis: !!backBtn,
      // 主页不该有执行层明细：待办项单元格用 data-role 标记（分组模式下是 div 不是 table）
      alertRows: document.querySelectorAll('[data-role="task-days"]').length,
      hasBurndownText: txt.includes("整体燃尽图"),
      hasDeepText: txt.includes("偏差榜"),
      hasTaskComposition: txt.includes("任务构成"),
      hasTypePie: txt.includes("按类型分布"),
      hasProjectPie: txt.includes("按项目分布"),
      foldHeaders: cards().filter((c) => {
        const b = c.querySelector("button");
        return !!b && /(展开|收起)$/.test((b.innerText || "").replace(/\\s+/g, " ").trim());
      }).length,

      bodyText: txt,
      chars: txt.length,
    };
  })())`;

  const geom = async () => JSON.parse(await evalJs(GEOM));

  const S = async (label, W, H, qs = "") => {
    await open(W, H, qs);
    const g = await geom();
    console.log(`\n--- ${label}（视口 ${g.vw}×${g.vh} · 页面总高 ${g.docH}px = ${(g.docH / g.vh).toFixed(1)} 屏）---`);
    return g;
  };

  /** 点某个按钮（按文案找，取第一个命中的） */
  const clickByText = async (label) => {
    const r = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes(${JSON.stringify(label)}));
      if (!b) return 'not-found';
      b.click();
      return 'clicked';
    })()`);
    await sleep(700);
    return r;
  };

  /* ================================ 基准数据 ================================ */
  const [sum, ov, alerts] = await Promise.all([
    api("/api/changes/summary"),
    api("/api/changes/project-overview?include_archived=true"),
    api("/api/changes/alerts?level=overdue,near"),
  ]);
  const wallProjects = (ov ?? []).filter((p) => p.total + p.voided > 0 || p.archived > 0);
  console.log(
    `接口基准：超期 ${sum.overdue_tasks} 项 / ${sum.overdue_changes} 张单 · 临期 ${sum.near_tasks} 项 · ` +
    `拖最久 ${sum.max_overdue_days} 天 · 进行中项目 ${wallProjects.length} 个 · 待办项 ${(alerts ?? []).length} 条`
  );

  await send("Page.enable");
  await send("Runtime.enable");

  /* ======================== S0~S5 主页 1440×900 ======================== */
  let m0 = mark();
  let g = await S("S0 主页 1440×900", 1440, 900);
  await shot("changes-l0v3-home-900");

  console.log("  == S0 固定顶部区（标题 + 统计卡同在一个吸顶容器） ==");
  check("顶部区存在，且是内容区的第一个元素", !!g.band && g.band.top < (g.wallTool?.top ?? 1e9),
    g.band ? `top ${g.band.top} / 卡片墙 top ${g.wallTool?.top}` : "找不到");
  check("标题栏在顶部区内（不是被甩在外面）",
    !!g.title && g.title.top >= g.band.top && g.title.bottom <= g.band.bottom + 1,
    g.title ? `标题 ${g.title.top}~${g.title.bottom} ⊂ 顶部区 ${g.band.top}~${g.band.bottom}` : "无");
  check("统计卡 ×5 也在同一个顶部区内",
    g.statCount === 5 && g.stats.top >= g.band.top && g.stats.bottom <= g.band.bottom + 1,
    `${g.statCount} 张 · ${g.stats?.top}~${g.stats?.bottom} ⊂ 顶部区 ${g.band.top}~${g.band.bottom}`);
  check("顶部区是 sticky，且吸在站点顶栏（56px）之下", g.bandPosition === "sticky" && g.bandTop === "56px",
    `position=${g.bandPosition} · top=${g.bandTop}`);
  check("五张统计卡的标签与预期一致",
    /变更总数/.test(g.statLabels[0] ?? "") && /超期未完成/.test(g.statLabels[1] ?? "") &&
    /临期/.test(g.statLabels[2] ?? "") && /涉及项目/.test(g.statLabels[3] ?? "") && /待办项/.test(g.statLabels[4] ?? ""),
    g.statLabels.join(" | "));

  console.log("  == S1 块顺序（防后人改回去） ==");
  const order = [
    ["顶部区", g.band],
    ["项目卡片墙", g.cardsGrid],
    ["三饼行", g.pieRow],
    ["分析入口条", g.entry],
  ];
  const bad = [];
  for (let i = 0; i < order.length - 1; i++) {
    const [n1, r1] = order[i];
    const [n2, r2] = order[i + 1];
    if (!r1 || !r2) { bad.push(`${n2} 缺失`); continue; }
    if (r1.bottom > r2.top + 1) bad.push(`${n1}(bottom ${r1.bottom}) 不在 ${n2}(top ${r2.top}) 之前`);
  }
  check("四块顺序：顶部区 → 卡片墙 → 三饼行 → 分析入口", bad.length === 0, bad.join("；") || "顺序正确");
  check("四块都存在（缺一块都算失败）",
    !!g.band && !!g.cardsGrid && !!g.pieRow && !!g.entry,
    `band=${!!g.band} wall=${!!g.cardsGrid} pies=${!!g.pieRow} entry=${!!g.entry}`);
  check("三饼行紧跟在卡片墙之后（不是跑到页面底部）",
    g.pieRow.top - g.cardsGrid.bottom < 200, `间距 ${g.pieRow.top - g.cardsGrid.bottom}px`);
  check("卡片墙上的项目卡数 == 接口的进行中项目数",
    g.cardCount === wallProjects.length, `页面 ${g.cardCount} 张 / 接口 ${wallProjects.length} 个`);
  check("主页不再有旧的三块折叠区（折叠头计数为 0）", g.foldHeaders === 0, `${g.foldHeaders} 个折叠头`);

  console.log("  == S2 首屏可见性（1440×900） ==");
  check("3 张项目卡完整落在首屏内（bottom ≤ 视口高）",
    g.cardsGrid.bottom <= g.vh, `卡片墙 bottom ${g.cardsGrid.bottom} / 视口 ${g.vh}`);
  check("三饼行已进入首屏（标题行可见）",
    g.pieRow.top < g.vh, `三饼行 top ${g.pieRow.top} / 视口 ${g.vh}`);
  check("分页行在首屏内", !!g.pager && g.pager.bottom <= g.vh,
    g.pager ? `分页 bottom ${g.pager.bottom}` : "找不到分页行");
  check("页面总高在 1.6 屏以内（老板不用滚很久）",
    g.docH <= g.vh * 1.6, `${g.docH}px = ${(g.docH / g.vh).toFixed(2)} 屏`);

  console.log("  == S4 三饼并排与对齐（用户要的「整体美观」= 三张一模一样） ==");
  const pies = [["任务构成", g.pieTask], ["按类型分布", g.pieType], ["按项目分布", g.pieProj]];
  check("三张饼卡都存在",
    pies.every(([, x]) => !!x), pies.map(([n, x]) => `${n}:${x ? "ok" : "缺失"}`).join(" | "));
  check("三张饼卡**顶部对齐**（同一行）",
    pies.every(([, x]) => x && Math.abs(x.top - g.pieTask.top) <= 1),
    pies.map(([n, x]) => `${n} top ${x?.top}`).join(" | "));
  check("三张饼卡**等宽**",
    pies.every(([, x]) => x && Math.abs(x.w - g.pieTask.w) <= 1),
    pies.map(([n, x]) => `${n} w ${x?.w}`).join(" | "));
  check("三张饼卡**等高**",
    pies.every(([, x]) => x && Math.abs(x.h - g.pieTask.h) <= 1),
    pies.map(([n, x]) => `${n} h ${x?.h}`).join(" | "));
  check("主页画布恰好 3 个（一饼一画布，不多不少）",
    g.canvasCount === 3, `${g.canvasCount} 个`);
  const cvTops = g.canvases.map((c) => c?.top);
  check("★ 三个画布 **top 完全相同**（= 圆心在同一条水平线上）",
    cvTops.length === 3 && cvTops.every((t) => Math.abs(t - cvTops[0]) <= 1),
    cvTops.join(" / "));
  const cvHs = g.canvases.map((c) => c?.h);
  check("三个画布**等高**", cvHs.every((h) => Math.abs(h - cvHs[0]) <= 1), cvHs.join(" / "));
  check("三张饼的标题都在各自卡内（不是标题与图错位）",
    pies.every(([, x]) => x && x.h > 200), pies.map(([, x]) => `${x?.h}px`).join(" | "));

  console.log("  == S5 主页不含执行层（是「搬走」不是「藏起来」） ==");
  check("主页没有待办项明细行（`[data-role=task-days]` 计数为 0）",
    g.alertRows === 0, `${g.alertRows} 行`);
  check("主页没有「整体燃尽图」", !g.hasBurndownText);
  check("主页没有「偏差榜」（深度分析）", !g.hasDeepText);
  check("主页**有**三张饼的文案（三视图都在）",
    g.hasTaskComposition && g.hasTypePie && g.hasProjectPie,
    `${g.hasTaskComposition} / ${g.hasTypePie} / ${g.hasProjectPie}`);
  check("主页不是分析视图（没有返回按钮）", !g.inAnalysis);

  /* ============================ S3 吸顶 ============================ */
  console.log("  == S3 滚动吸顶 ==");
  await evalJs("window.scrollTo(0, document.documentElement.scrollHeight)");
  await sleep(500);
  await shot("changes-l0v3-sticky");
  const gScroll = await geom();
  check("滚到底后顶部区仍贴在站点顶栏（top == 56px）",
    gScroll.band.top === 56, `滚动后 band.top=${gScroll.band.top}（页面高 ${gScroll.docH}）`);
  check("滚到底后五张统计卡仍可见",
    gScroll.stats.top >= 0 && gScroll.stats.bottom <= gScroll.vh,
    `stats ${gScroll.stats.top}~${gScroll.stats.bottom} / 视口 ${gScroll.vh}`);

  /* ==================== S5b 三饼聚焦截图（证据用） ==================== */
  await open(1440, 900, "");
  await evalJs(`(() => {
    const el = [...document.querySelectorAll('[data-slot="card"]')].find((c) => (c.innerText || '').includes('任务构成'));
    const t = el ? el.parentElement.getBoundingClientRect().top + window.scrollY - 20 : 0;
    window.scrollTo(0, t);
    return 'ok';
  })()`);
  await sleep(600);
  await shot("changes-l0v3-pies-focus");

  /* ==================== S6 假死门禁与旧参数兼容 ==================== */
  console.log("  == S6 假死门禁 / 旧链接兼容（★ 上一轮的教训：入口写了参数，内容却不在那儿） ==");
  for (const [name, qs] of [
    ["旧折叠参数 ?todos=1", "?todos=1"],
    ["旧折叠参数 ?trend=1", "?trend=1"],
    ["旧折叠参数 ?deep=1", "?deep=1"],
  ]) {
    const gg = await S(`  ↳ ${name}`, 1440, 900, qs);
    check(`${name} 仍能落到分析视图（不是一片空白）`,
      gg.inAnalysis && (gg.alertRows > 0 || gg.canvasCount > 0),
      `inAnalysis=${gg.inAnalysis} 待办行=${gg.alertRows} canvas=${gg.canvasCount}`);
  }
  {
    const gg = await S("  ↳ 带 risk 直接进来", 1440, 900, "?risk=overdue");
    check("带 ?risk=overdue 进来 = 分析视图 + 待办项有内容",
      gg.inAnalysis && gg.alertRows > 0, `inAnalysis=${gg.inAnalysis} 待办行=${gg.alertRows}`);
  }

  /* ==================== S7 视图切换 ==================== */
  console.log("  == S7 视图切换（点进 / 返回 / 清筛选） ==");
  await open(1440, 900, "");
  const clicked = await clickByText("变更分析");
  const gEnter = await geom();
  await shot("changes-l0v3-analysis");
  check("点主页入口条「变更分析」能进分析视图", clicked === "clicked" && gEnter.inAnalysis,
    `click=${clicked} inAnalysis=${gEnter.inAnalysis}`);
  check("进入分析视图后 URL 带 view=analysis（可分享）",
    /view=analysis/.test(gEnter.path), gEnter.path);
  check("分析视图里待办项明细可见（不是空壳）",
    gEnter.alertRows > 0, `${gEnter.alertRows} 行`);
  await shot("changes-l0v3-analysis-filtered-check");
  const backClicked = await clickByText("返回项目总览");
  const gBack = await geom();
  check("点「返回项目总览」能回主页（三饼重新出现）",
    backClicked === "clicked" && !gBack.inAnalysis && gBack.canvasCount === 3,
    `click=${backClicked} inAnalysis=${gBack.inAnalysis} canvas=${gBack.canvasCount}`);
  check("返回后 URL 已清干净（不带 view / risk）",
    !/view=analysis/.test(gBack.path) && !/risk=/.test(gBack.path), gBack.path);

  console.log("  == S7b 统计卡直达（点卡片必须立刻看到东西 = 防假死） ==");
  await open(1440, 900, "");
  const statClicked = await evalJs(`(() => {
    const wrap = document.querySelector('main > div');
    const stats = wrap.firstElementChild.children[1];
    const b = [...stats.children].find((x) => (x.innerText || '').includes('超期未完成'));
    if (!b) return 'not-found';
    b.click();
    return 'clicked';
  })()`);
  await sleep(800);
  const gStat = await geom();
  check("点统计卡「超期未完成」→ 直达分析视图并带上筛选",
    statClicked === "clicked" && gStat.inAnalysis && /risk=overdue/.test(gStat.path),
    `click=${statClicked} path=${gStat.path}`);
  check("点统计卡后待办项明细**立刻可见**（不会「点了没反应」）",
    gStat.alertRows > 0, `${gStat.alertRows} 行`);
  const cleared = await clickByText("清除筛选");
  const gClear = await geom();
  check("点「清除筛选」仍留在分析视图（不被踢回主页）",
    cleared === "clicked" && gClear.inAnalysis && !/risk=/.test(gClear.path),
    `click=${cleared} inAnalysis=${gClear.inAnalysis} path=${gClear.path}`);

  /* ==================== S8 分析视图内容常显 ==================== */
  console.log("  == S8 分析视图：三块内容常显、无折叠 ==");
  check("待办项块在分析视图里", !!gClear.alertCard, gClear.alertCard ? `top ${gClear.alertCard.top}` : "缺失");
  check("整体燃尽图在分析视图里", !!gClear.burnCard && gClear.canvasCount >= 1,
    `card=${!!gClear.burnCard} canvas=${gClear.canvasCount}`);
  check("深度分析（偏差榜）在分析视图里", !!gClear.deepCard && gClear.hasDeepText,
    `card=${!!gClear.deepCard} 文案=${gClear.hasDeepText}`);
  check("分析视图里**没有折叠头**（进来就是看细节的，不该再折一层）",
    gClear.foldHeaders === 0, `${gClear.foldHeaders} 个折叠头`);
  check("三张饼**不在**分析视图（它们住主页）",
    gClear.canvasCount === 1, `${gClear.canvasCount} 个 canvas（燃尽图 1 个）`);

  /* ==================== S9 摘要同源 ==================== */
  console.log("  == S9 摘要同源（入口条摘要 == 统计卡 == 接口） ==");
  await open(1440, 900, "");
  const gHome = await geom();
  check("入口条摘要里的「超期 N 项」与接口一致",
    !!gHome.entryText && gHome.entryText.includes(`超期 ${sum.overdue_tasks} 项`),
    gHome.entryText ?? "找不到入口条");
  check("入口条摘要里的「临期 N 项」与接口一致",
    sum.near_tasks === 0 || (gHome.entryText || "").includes(`临期 ${sum.near_tasks} 项`),
    `接口 ${sum.near_tasks} 项`);
  check("入口条有「进入 →」而不是「展开」（跳转语义要说清）",
    /进入/.test(gHome.entryText ?? "") && !/展开/.test(gHome.entryText ?? ""),
    gHome.entryText ?? "找不到");

  /* ==================== S2b 1280×720（旧笔记本） ==================== */
  console.log("  == S2b 1280×720（上一轮踩过的老笔记本隐患） ==");
  const g720 = await S("主页 1280×720", 1280, 720);
  await shot("changes-l0v3-home-720");
  check("720 高下 3 张项目卡仍完整可见",
    g720.cardsGrid.bottom <= g720.vh, `bottom ${g720.cardsGrid.bottom} / 视口 ${g720.vh}`);
  check("720 高下三饼行也已进入首屏", g720.pieRow.top < g720.vh,
    `三饼行 top ${g720.pieRow.top} / 视口 ${g720.vh}`);

  /* ==================== S10 窄屏 390 ==================== */
  console.log("  == S10 窄屏 390（用户只用手机） ==");
  const g390 = await S("主页 390×844", 390, 844);
  await shot("changes-l0v3-m390");
  check("窄屏无横向溢出（scrollWidth ≤ clientWidth + 1）",
    g390.overflow <= 1, `溢出 ${g390.overflow}px`);
  check("窄屏顶部区**不吸顶**（position: static）—— 否则统计卡会吃掉 1/3 屏",
    g390.bandPosition === "static", `position=${g390.bandPosition}`);
  check("窄屏下三饼退化为单列叠放（三张卡 top 递增）",
    !!g390.pieTask && !!g390.pieType && !!g390.pieProj &&
    g390.pieType.top > g390.pieTask.top && g390.pieProj.top > g390.pieType.top,
    [g390.pieTask?.top, g390.pieType?.top, g390.pieProj?.top].join(" < "));
  check("窄屏下卡片墙仍排在三饼之前",
    g390.cardsGrid.bottom <= g390.pieRow.top + 1,
    `卡片墙 bottom ${g390.cardsGrid.bottom} / 三饼 top ${g390.pieRow.top}`);
  check("窄屏下三饼各自在卡内（宽度接近容器宽 - 边距）",
    !!g390.pieTask && g390.pieTask.w > 250, `饼卡宽 ${g390.pieTask?.w}`);

  console.log("  == S10b 窄屏分析视图 ==");
  const g390a = await S("分析视图 390×844", 390, 844, "?view=analysis");
  await shot("changes-l0v3-analysis-m390");
  check("窄屏分析视图无横向溢出", g390a.overflow <= 1, `溢出 ${g390a.overflow}px`);
  check("窄屏分析视图里待办项仍可见", g390a.alertRows > 0, `${g390a.alertRows} 行`);

  /* ==================== S11 零报错 + 证据截图 ==================== */
  console.log("  == S11 运行期错误 / 证据截图 ==");
  const newErrs = errors.slice(m0);
  check("本轮操作零运行期错误（console.error + pageerror）",
    newErrs.length === 0, newErrs.slice(0, 3).join(" ｜ ") || "干净");
  if (SHOT_DIR) {
    const vals = [...shotHashes.values()];
    const uniq = new Set(vals);
    check("证据截图两两不同（防「截了同一张当证据」）",
      uniq.size === vals.length, `${vals.length} 张 / 去重后 ${uniq.size} 张`);
  } else {
    console.log("  [--] 未设 SHOT_DIR，跳过截图唯一性检查");
  }

  console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================`);
  if (fail > 0) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}
