/**
 * 移动端 / 窄屏验收（针对「静默损坏」，不是「明显报错」）。
 *
 * 为什么需要它：桌面端验收全绿，手机端仍可能出问题 —— 而且**不报错、不溢出**，
 * 只是内容被压缩、被截断、被叠在一起。这类缺陷靠肉眼在缩略图上看不出来，必须量化：
 *
 *   1. 横向溢出            documentElement.scrollWidth - clientWidth（必须 0）
 *   2. 文字截断损失        .truncate 元素 scrollWidth - clientWidth（丢太多 = 关键信息被吃掉）
 *   3. 关键元素可见宽度    待办项任务名的实际可见宽度（曾被挤到 55px ≈ 5 个字）
 *   4. 刻度标签重叠        甘特图日期刻度两两比较横向区间（曾重叠成 "08-0808-0808-08"）
 *   5. 多余滚动条          overflow-x:auto 容器的 scrollWidth > clientWidth（桌面不该有）
 *
 * ★ 注意「全站冒烟」有**两节**：第 0 节 @1440、第 0.5 节 @390。
 *   窄屏是另一套响应式分支（布局、显示隐藏、栅格列数、flex 方向都不同），
 *   桌面「无溢出、无嵌套」不代表手机同样成立 —— 必须两套都跑。
 *
 * ★ 必须用 CDP 设备模拟（Emulation.setDeviceMetricsOverride）而不是 --window-size：
 *   Windows 下 Chrome 有最小窗口宽度（请求 390 实际得到 497），窄屏验证会**假通过**。
 *
 * 用法：node scripts/verify_mobile.mjs [baseUrl]
 *   默认 http://127.0.0.1:5173
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `cdp-mobverify-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "[OK]" : "[!!]"} ${name}${extra ? ` —— ${extra}` : ""}`);
  ok ? pass++ : fail++;
};

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let ws;
const pending = new Map();
let id = 0;
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

/** 导航后立即求值会撞上执行上下文销毁 → 固定重试。这是导航竞态，不是页面缺陷。 */
const evalJs = async (expr) => {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, 8000);
      return r.result?.value;
    } catch { await sleep(300); }
  }
  return undefined;
};

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
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") {
      errors.push("pageerror: " + (m.params?.exceptionDetails?.exception?.description ?? "?"));
    } else if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
      errors.push("console.error: " + (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");

  /** 打开页面 + 等正文长度稳定（SPA 渲染完成），可选先点击某段文案 */
  const open = async (url, W, H, click) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width: W, height: H, deviceScaleFactor: 2, mobile: W < 640,
    });
    await send("Page.navigate", { url });
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const n = await evalJs("document.body ? document.body.innerText.length : 0");
      if (n === last && n > 200) { if (++stable >= 3) break; } else { stable = 0; last = n; }
      await sleep(350);
    }
    if (click) {
      await evalJs(`(() => {
        const t = ${JSON.stringify(click)};
        const all = [...document.querySelectorAll("button, span, div, th, td, a, p, b")];
        const hits = all.filter(el => (el.innerText || "").includes(t));
        const el = hits.filter(e => !hits.some(o => o !== e && e.contains(o)))[0];
        if (!el) return false;
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
        el.dispatchEvent(ev);
        return true;
      })()`);
      await sleep(1800);
    }
  };

  /* ------------------------------------------------ 度量收集 */
  const GEOM = `JSON.stringify((() => {
    const html = document.documentElement;
    const out = { ref: html.clientWidth, overflow: html.scrollWidth - html.clientWidth };

    // 可横向滚动容器（ox: auto/scroll 且内容更宽）= 能滚到的宽表
    out.scrollers = [];
    document.querySelectorAll("*").forEach(el => {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
        out.scrollers.push({ cls: String(el.className || "").slice(0, 45), cw: el.clientWidth, sw: el.scrollWidth });
      }
    });

    // 文字截断损失
    out.truncated = [];
    document.querySelectorAll(".truncate").forEach(el => {
      // ★ 折叠区标题行里的摘要（.truncate 且位于 button 内）是**有意为之**的单行预览：
      //   完整内容点一下就展开 —— 不属于"关键信息被吃掉"。2026-10-06 加折叠区后必须豁免，
      //   否则会把「趋势与构成」那行长摘要报成 440px 的截断缺陷（假阳性）。
      if (el.closest("button")) return;
      const lost = el.scrollWidth - el.clientWidth;
      if (lost > 2) out.truncated.push({ lost, cw: el.clientWidth, txt: (el.innerText || "").replace(/\\n/g, " ").slice(0, 45) });
    });
    out.truncated.sort((a, b) => b.lost - a.lost);
    out.truncated = out.truncated.slice(0, 5);

    // 分组待办项的任务名：实际可见宽度（曾被压到 55px）。用 data-role 精确命中，
    // 不能用 class 模糊匹配 —— 项目组头名也是 min-w-0 flex-1 truncate text-xs，
    // 混进来会把断言搞成假失败。
    out.taskNameWidths = [...document.querySelectorAll('[data-role="task-name"]')].map(el => el.clientWidth);

    // 关键数字必须完整可见：待办项「超期/剩 N 天」+ 卡片「最紧急」行的超期天数
    out.keyNumClipped = [];
    document.querySelectorAll('[data-role="task-days"], [data-role="urgent-days"]').forEach(el => {
      const lost = el.scrollWidth - el.clientWidth;
      if (lost > 1) out.keyNumClipped.push({ role: el.dataset.role, lost, txt: el.innerText });
    });

    // 甘特图日期刻度：两两比较横向区间，判断是否重叠
    // ★ 必须取「最内层」命中元素：外层表头行的 innerText 也以「变更任务 / 责任人」开头，
    //   用 find() 取第一个会命中外层，其 nextElementSibling 根本不是时间轴 ——
    //   结果只数到 2 个元素，断言变成假通过。
    out.tickOverlap = null;
    const heads = [...document.querySelectorAll("div")].filter(el => (el.innerText || "").startsWith("变更任务 / 责任人"));
    const head = heads.filter(el => !heads.some(o => o !== el && el.contains(o)))[0];
    if (head) {
      const timeline = head.nextElementSibling;
      if (timeline) {
        const labels = [...timeline.children].map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
        let worst = 0;
        for (let i = 1; i < labels.length; i++) {
          const ov = labels[i - 1].right - labels[i].left;
          if (ov > worst) worst = ov;
        }
        out.tickOverlap = { n: labels.length, worstOverlap: Math.round(worst) };
      }
    }

    // 桌面不该出现的多余滚动条（甘特图内容必须装得下自己要画的东西）
    out.extraScroll = out.scrollers.length;

    // 弹窗 / 抽屉：手机宽度下"表单类弹窗"最容易崩（字段挤压、按钮溢出、整体超出视口）
    out.dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: Math.round(r.left), right: Math.round(r.right),
        w: Math.round(r.width), h: Math.round(r.height),
        // 左右都不能出视口（负值 = 左边被切，right > 视口 = 右边被切）
        inViewport: r.left >= -1 && r.right <= html.clientWidth + 1,
        // 弹窗自身内部横向溢出（内容比弹窗宽 → 有字段被切）
        innerOverflow: el.scrollWidth - el.clientWidth,
        // 底部操作按钮是否可见（弹窗被压扁时按钮会跑出可视区）
        buttons: [...el.querySelectorAll("button")].map(b => (b.innerText || "").trim()).filter(Boolean).slice(0, 8),
        scrollable: cs.overflowY === "auto" || cs.overflowY === "scroll",
      };
    });
    return out;
  })())`;

  const geom = async () => JSON.parse(await evalJs(GEOM));

  /* ================================ 用例 */
  let g; // 各用例复用的几何度量结果（在此声明，避免后面用例先用到而命中 TDZ）
  const mark = () => errors.length; // 取报错游标：控制台报错是异步到达的，必须按区间切分归属

  /** 无效 HTML 嵌套（button 套 button / a 里放 button）：不报错、不溢出，只留一条 validateDOMNesting */
  const nestedHits = async () => {
    const raw = await evalJs(`(() => {
      const hits = [...document.querySelectorAll("button button, a button, button a")].map((el) => {
        const host = el.parentElement?.closest("button,a");
        return ((host?.innerText || el.innerText || "").replace(/\\s+/g, " ").trim() || "(无文本)").slice(0, 36);
      });
      return JSON.stringify(hits);
    })()`);
    return raw ? JSON.parse(raw) : [];
  };

  const SITE_ROUTES = [
    ["/dashboard", "Dashboard"],
    ["/materials", "供应商列表"],
    ["/supply-demand", "供需管理"],
    ["/share", "份额管理"],
    ["/inventory", "库存管理"],
    ["/changes", "变更管理"],
    ["/rules", "规则"],
  ];

  console.log("== 0) 共享 UI 冒烟（改了 ui/ 组件后必跑：全站路由不得横向溢出）");
  const smokeErrs = [];
  for (const [path, label] of SITE_ROUTES) {
    const m = mark();
    await open(`${BASE}${path}`, 1440, 900);
    g = await geom();
    await sleep(400); // 给异步 console.error 一点时间到达
    // ★ 游标必须在 open() **之前**取。取在之后会把本页的报错算进基线，
    //   断言变成恒真（这个 bug 已踩过一次）。
    const mine = errors.slice(m);
    if (mine.length) smokeErrs.push({ path, label, err: mine[0] });
    check(`${label} ${path}`, g.overflow <= 0, `溢出 ${g.overflow}px${mine.length ? ` · ⚠ 控制台 ${mine.length} 条` : ""}`);

    // ★ 无效 HTML 门禁：button 不能嵌 button / a 里不能有 button。
    //   这类嵌套不报错、不溢出，只在控制台留一条 validateDOMNesting —— 属于典型的"静默损坏"：
    //   读屏与键盘焦点会被切成多个相邻控件。既有缺陷就藏在 /materials（物料行 + 项目卡各一处）。
    const nested = await nestedHits();
    check(
      `${label} ${path} 无 button/a 嵌套`,
      nested.length === 0,
      nested.length ? `${nested.length} 处：${nested.join(" / ")}` : "干净"
    );
  }
  for (const s of smokeErrs) {
    const first = s.err.split("\n")[0];
    console.log(`  ⚠ ${s.label} ${s.path} 控制台报错：${first.slice(0, 160)}`);
    console.log(`     ${s.err.split("\n").slice(1, 5).join(" ").trim().slice(0, 200)}`);
  }
  // ★ 范围划分：只有 /changes 的报错算本模块门禁；其他路由的报错单列出来供排期，
  //   不让"别人的既有问题"把本模块的验收卡成永久红。
  const scopeMark = mark();
  console.log("  （以上非 /changes 的报错属本轮范围外，仅报告，不阻断本模块门禁）");

  /* ═══════════════════ 0.5) 全站 7 路由 @390 冒烟 ═══════════════════
     上面第 0 节跑的是 **1440px**，而窄屏是另一套响应式分支（布局、显示/隐藏、
     栅格列数、flex 方向全都不一样）→ 桌面「无溢出、无嵌套」不代表手机同样成立。
     实测：7 条路由里原本只有 `/changes`（第 1~7 节）和 `/materials`（另一套脚本）
     在 390px 下被量过，其余 5 条**从未在手机宽度下验证**。这一节把缺口补上。 */
  console.log("\n== 0.5) 全站 7 路由 @390 冒烟（第 0 节只跑 1440；窄屏是另一套响应式分支）");
  for (const [path, label] of SITE_ROUTES) {
    const m = mark();
    await open(`${BASE}${path}`, 390, 844);
    g = await geom();
    await sleep(400);
    const mine = errors.slice(m);
    check(`${label} ${path} @390 无横向溢出`, g.overflow <= 0,
      `溢出 ${g.overflow}px${mine.length ? ` · ⚠ 控制台 ${mine.length} 条` : ""}`);
    const nested = await nestedHits();
    check(`${label} ${path} @390 无 button/a 嵌套`, nested.length === 0,
      nested.length ? `${nested.length} 处：${nested.join(" / ")}` : "干净");
  }

  console.log("\n== 1) L0 分析视图 @390（手机 · 待办项清单）");
  // ★ 2026-10-06 第三次重排：待办项清单搬进「分析视图」（`?view=analysis`）且**常显**。
  //   要验「任务名可见宽度 / 天数完整」就得进这个视图。
  //   （主页 @390 的三饼单列叠放 / 顶部区不吸顶 / 无溢出断言在 `verify_changes_l0.mjs` 的 S10。）
  await open(`${BASE}/changes?view=analysis`, 390, 844);
  g = await geom();
  check("无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);
  const minTaskW = g.taskNameWidths.length ? Math.min(...g.taskNameWidths) : null;
  check(
    "待办项任务名可见宽度 ≥ 150px（曾被固定 4 列网格挤到 55px）",
    minTaskW !== null && minTaskW >= 150,
    `最窄 ${minTaskW}px（共 ${g.taskNameWidths.length} 行）`
  );
  check(
    "关键数字完整可见（待办项天数；卡片超期天数在主页，由 verify_changes_l0 S10 覆盖）",
    g.keyNumClipped.length === 0,
    g.keyNumClipped.length ? JSON.stringify(g.keyNumClipped.slice(0, 2)) : "全部完整"
  );
  const worstLost = g.truncated[0]?.lost ?? 0;
  check(
    "最长截断损失 ≤ 60px（关键行不做整行 truncate）",
    worstLost <= 60,
    worstLost ? `最狠一条丢 ${worstLost}px：${g.truncated[0].txt}` : "无截断"
  );

  console.log("\n== 2) L0 首页 @1440（桌面回归）");
  await open(`${BASE}/changes`, 1440, 900);
  g = await geom();
  check("无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);
  // 卡片墙是固定列宽网格，长标题按设计就该 truncate + tooltip；
  // 这里只要求「不超过一个字的量级」，避免把正常省略号误判成缺陷。
  check(
    "桌面截断 ≤ 8px（不出现大段文字被吃掉）",
    (g.truncated[0]?.lost ?? 0) <= 8,
    g.truncated.length ? JSON.stringify(g.truncated[0]) : "无截断"
  );
  check(
    "桌面关键数字完整可见",
    g.keyNumClipped.length === 0,
    g.keyNumClipped.length ? JSON.stringify(g.keyNumClipped.slice(0, 2)) : "全部完整"
  );

  console.log("\n== 3) L1 项目视图 @390（宽表必须能滚到）");
  await open(`${BASE}/changes?project=1`, 390, 844);
  g = await geom();
  check("页面无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);
  check(
    "宽表在可横向滚动容器内（右侧列能滚到，不是被裁死）",
    g.scrollers.length >= 1,
    g.scrollers.map((s) => `可滚 ${s.sw - s.cw}px`).join(" / ") || "无滚动容器"
  );

  console.log("\n== 4) L2 详情抽屉 · 甘特图 @390");
  await open(`${BASE}/changes?c=3`, 390, 844, "甘特图");
  g = await geom();
  check("页面无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);
  check(
    "刻度标签不重叠（曾重叠成 08-0808-0808-08）",
    g.tickOverlap !== null && g.tickOverlap.n >= 5 && g.tickOverlap.worstOverlap <= 0,
    g.tickOverlap ? `${g.tickOverlap.n} 个刻度，最大重叠 ${g.tickOverlap.worstOverlap}px` : "未找到刻度"
  );
  check("甘特图在窄屏可横向滚动", g.scrollers.some((s) => s.cls.includes("overflow-x-auto")), `共 ${g.scrollers.length} 个滚动容器`);

  console.log("\n== 5) L2 详情抽屉 · 甘特图 @1440（桌面不得多出滚动条）");
  await open(`${BASE}/changes?c=3`, 1440, 900, "甘特图");
  g = await geom();
  check("页面无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);
  check(
    "甘特图内容装得下（实际完成日已纳入时间轴范围）",
    g.scrollers.length === 0,
    g.scrollers.map((s) => `${s.cls} 溢出 ${s.sw - s.cw}px`).join(" / ") || "无多余滚动条"
  );

  console.log("\n== 6) L2 详情抽屉 · 任务清单 @390");
  await open(`${BASE}/changes?c=3`, 390, 844, "任务清单");
  g = await geom();
  check("页面无横向溢出", g.overflow <= 0, `溢出 ${g.overflow}px`);

  /* ================================ 运行期错误 */
  console.log("\n== 7) 弹窗 / 确认框 @390（表单类弹窗在手机上最容易崩）");
  for (const [name, trigger] of [
    ["新建变更单", "新建变更单"],
    ["Excel 导入", "Excel 导入"],
    ["变更类型", "变更类型"],
    ["归档确认", "归档此项目"],
  ]) {
    await open(`${BASE}/changes`, 390, 844, trigger);
    g = await geom();
    const dlg = g.dialogs[0];
    check(`「${name}」弹窗已打开`, Boolean(dlg), dlg ? `宽 ${dlg.w}px · 高 ${dlg.h}px` : "未打开（DOM 里没有 role=dialog）");
    if (dlg) {
      check(`  弹窗完整落在视口内`, dlg.inViewport, `left=${dlg.left} right=${dlg.right} 视口宽=${g.ref}`);
      check(`  弹窗内无横向溢出`, dlg.innerOverflow <= 0, `溢出 ${dlg.innerOverflow}px`);
      check(`  页面无横向溢出`, g.overflow <= 0, `溢出 ${g.overflow}px`);
    }
  }

  /* ================================ 运行期错误 */
  console.log("\n== 8) 运行期错误（只算 /changes 相关，范围外报错见第 0 节）");
  const changesErrors = errors.slice(scopeMark);
  check(
    "changes 路由无 console.error / pageerror",
    changesErrors.length === 0,
    changesErrors.slice(0, 2).map((e) => e.split("\n")[0].slice(0, 120)).join(" | ") || "干净"
  );
} catch (e) {
  console.log("!! " + (e?.message ?? e));
  fail++;
} finally {
  console.log(`\n结论：${fail === 0 ? "全部通过" : `${fail} 条未通过`}（通过 ${pass}）`);
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(0);
