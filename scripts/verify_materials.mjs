/**
 * 供应商列表页（/materials）常驻验收 —— 补 §17.7 的遗留项。
 *
 * 为什么单独一套：`verify_mobile.mjs` 第 0 节的全站冒烟只覆盖**默认渲染**的分支，
 * 而这一页的 4 个 Tab 里藏着不同结构的列表（项目卡 / 物料行 / 供应商表 / 关系表），
 * 默认只渲染「项目」Tab。之前的 button 嵌套缺陷就是靠一次性探针才发现的。
 *
 * 覆盖（共 45 条）：
 *   S0  桌面首屏（项目 Tab）：标题 / 4 个 Tab / 行容器是 div + tabIndex=0 / Tab 单行且全可见 / 无嵌套 / 无溢出 / 控制台干净
 *   S1  物料 / 供应商 / 供应关系 三个 Tab × 桌面：无嵌套 / 无溢出 / 控制台干净
 *   S2  键盘可达性 ★：focus 行容器 → 按 Enter → 必须切到详情视图（不能只是"有个 tabIndex"）
 *       并比对证据截图与首屏不同 —— 防「截图拍在复原之后」这类状态错位
 *   S3  行内按钮不误触 ★：点「编辑」应打开弹窗，且**不**切到详情视图（stopPropagation 仍有效）
 *   S4  数据对账：各 Tab 表格行数 == 对应接口条数
 *   S5  窄屏 390：四个 Tab 逐一无横向溢出、无嵌套、文案不折行、Tab 全可见（不靠横向滑动）
 *   S6  运行期错误总检（本页范围）
 *
 * 只读：只点 Tab / 点行 / 开关弹窗，不保存、不删除。
 * 用法：node scripts/verify_materials.mjs [baseUrl]      （SHOT_DIR=dir 可顺带出图）
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? "";
const PORT = 9560 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), `cdp-materials-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "[OK]" : "[!!]"} ${name}${extra ? ` —— ${extra}` : ""}`);
  ok ? pass++ : fail++;
};

const TABS = ["项目", "物料", "供应商", "供应关系"];

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
    // ★ 导航期间求值会抛 Uncaught（执行上下文销毁）→ 必须重试；这是导航竞态，不是页面缺陷
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

  const mark = () => errors.length;

  /** 设备模拟必须在 navigate **之前** 生效，否则等于没生效 */
  const open = async (W, H) => {
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 640 });
    await send("Page.navigate", { url: `${BASE}/materials`, transitionType: "reload" });
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const n = await evalJs("document.body ? document.body.innerText.length : 0");
      if (n === last && n > 150) { if (++stable >= 3) break; } else { stable = 0; last = n; }
      await sleep(350);
    }
  };

  /**
   * 页面几何 + 待断言事实 一次取回（少来回、少竞态）。
   * rows：所有「行容器」= 带 role="button" 且内部有 button 的元素（本轮把它们的原生 button 换成了 div）。
   */
  const GEOM = `JSON.stringify((() => {
    const rows = [...document.querySelectorAll('[role="button"]:has(button)')];
    const hits = [...document.querySelectorAll("button button, a button, button a")].map((el) => {
      const host = el.parentElement?.closest("button,a");
      return {
        host: ((host?.innerText || el.innerText || "").replace(/\\s+/g, " ").trim() || "(无文本)").slice(0, 34),
        inner: (el.innerText || el.getAttribute("aria-label") || "(图标)").trim().slice(0, 12),
        innerTag: el.tagName.toLowerCase(),
      };
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      text: document.body.innerText,
      chars: document.body.innerText.length,
      nesting: hits,
      rows: rows.map((el) => ({ tag: el.tagName.toLowerCase(), tabIndex: el.tabIndex, text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 26) })),
      // 按语义分开数行：通用 [role=button]:has(button) 会把右侧详情面板里的行也算进来
      projectRows: document.querySelectorAll('[role="button"]:has(button[data-slot="button"])').length,
      materialRows: document.querySelectorAll('[role="button"]:has(button[aria-label="删除物料"])').length,
      // 合法但值得留意的结构：可点容器里再套可点元素（本项目有意为之 —— 卡内图标按钮）。
      // 只记录数量，不作为门禁失败项。
      interactiveInRow: document.querySelectorAll('[role="button"] button').length,
      tableRows: [...document.querySelectorAll("table")].map((t) => t.querySelectorAll("tbody tr").length),
      // ★ Tab 文案行数（窄屏静默降级探针）。
      //   只测「有没有横向溢出」抓不到这种塌陷：中文标签被挤成两行时，
      //   不溢出、不截断、控制台干净，但排版已经坏了。
      //   判法：按钮是「图标 + 文案」的 flex 行，内容区高度 = clientHeight − 上下 padding
      //        （clientHeight 已排除 border）→ 除以 line-height 即行数。
      tabLines: [...document.querySelectorAll("button")]
        .filter((b) => /^(项目|物料|供应商|供应关系)/.test((b.innerText || "").trim()))
        .map((b) => {
          const cs = getComputedStyle(b);
          const lh = parseFloat(cs.lineHeight) || 20;
          const inner = b.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
          return {
            label: (b.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 10),
            lines: Math.max(1, Math.round(inner / lh)),
            h: Math.round(b.getBoundingClientRect().height),
          };
        }),
      // ★ Tab 条宽度账：只看「有没有横向溢出」会漏掉「Tab 被裁掉一半」——
      //   页面不溢出（因为 Tab 条自己 overflow-x-auto 了），但第四个 Tab 滑出视野，
      //   手机上等于不存在。这里量 Tab 条自身的 scrollWidth vs clientWidth，
      //   以及每个按钮是否完整落在容器可视区内。
      tabBar: (() => {
        const btns = [...document.querySelectorAll("button")].filter((b) => /^(项目|物料|供应商|供应关系)/.test((b.innerText || "").trim()));
        const bar = btns[0]?.parentElement;
        if (!bar) return null;
        const barRect = bar.getBoundingClientRect();
        return {
          client: bar.clientWidth,
          scroll: bar.scrollWidth,
          hidden: bar.scrollWidth - bar.clientWidth,
          clipped: btns.filter((b) => {
            const r = b.getBoundingClientRect();
            return r.left < barRect.left - 0.5 || r.right > barRect.right + 0.5;
          }).map((b) => (b.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 10)),
          count: btns.length,
        };
      })(),
    };
  })())`;

  const geom = async () => {
    const s = await evalJs(GEOM);
    return s ? JSON.parse(s) : null;
  };

  /** 点 Tab：取「最内层」命中元素，否则会点到外层容器 */
  const clickTab = async (label) => {
    const r = await evalJs(`(() => {
      const hits = [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").trim().startsWith(${JSON.stringify(label)}));
      const btn = hits.filter((b) => !hits.some((o) => o !== b && b.contains(o)))[0] ?? hits[0];
      if (!btn) return "not-found";
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return "clicked";
    })()`);
    await sleep(700);
    return r;
  };

  /** 截图并返回内容哈希 —— 哈希用于断言「这张图拍到的确实是那个状态」 */
  const shotHashes = {};
  const shot = async (name) => {
    if (!SHOT_DIR) return null;
    mkdirSync(SHOT_DIR, { recursive: true });
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, 25000);
    const buf = Buffer.from(s.data, "base64");
    const file = path.join(SHOT_DIR, `${name}.png`);
    writeFileSync(file, buf);
    const hash = createHash("md5").update(buf).digest("hex").slice(0, 10);
    shotHashes[name] = hash;
    console.log(`  [sh] 截图 → ${file}  #${hash}`);
    return hash;
  };

  /** 每屏公共断言：无无效嵌套 / 无横向溢出 / 控制台干净（按 mark 切分归属）*/
  const screenChecks = async (label, g, m, { overflow = true, nesting = true } = {}) => {
    if (nesting) {
      check(`${label} 无 button/a 无效嵌套`, g.nesting.length === 0,
        g.nesting.length ? `${g.nesting.length} 处：${g.nesting.map((n) => n.innerTag + " 在「" + n.host + "」").join(" / ")}` : "干净");
    }
    if (overflow) check(`${label} 无横向溢出`, g.overflow <= 0, `溢出 ${g.overflow}px`);
    await sleep(300); // 给异步 console.error 一点时间到达
    const mine = errors.slice(m);
    check(`${label} 控制台干净`, mine.length === 0, (mine[0] ?? "").split("\n")[0].slice(0, 150) || "干净");
  };

  console.log(`供应商列表页验收 —— ${BASE}\n（只读：点 Tab / 点行 / 开关弹窗，不保存不删除）`);

  /* ---------------------------------------------------------- S0 桌面首屏 */
  console.log("\n== S0 桌面 1440 · 默认「项目」Tab");
  {
    const m = mark();
    await open(1440, 900);
    const g = await geom();
    if (!g) throw new Error("页面读不到（probe 返回空）");

    check("页面标题「供应商列表」", g.text.includes("供应商列表"));
    check(`${TABS.length} 个 Tab 齐全（${TABS.join(" / ")}）`, TABS.every((t) => g.text.includes(t)));
    check("行容器存在（项目卡 ≥1）", g.rows.length >= 1, `${g.rows.length} 个`);
    // ★ 本轮修复的核心：行容器必须是 div + tabIndex=0，而不是 <button> 套 <button>
    check("行容器全部是 div（不是 button）", g.rows.every((r) => r.tag === "div"),
      g.rows.filter((r) => r.tag !== "div").map((r) => r.tag).join("/") || "全部 div");
    check("行容器全部可键盘聚焦（tabIndex=0）", g.rows.every((r) => r.tabIndex === 0),
      g.rows.filter((r) => r.tabIndex !== 0).map((r) => `${r.text}:${r.tabIndex}`).join(" / ") || "全部 0");
    console.log(`  [ii] 可点容器内含按钮 ${g.interactiveInRow} 处（合法，卡内图标按钮；仅记录）`);
    // 桌面基线：Tab 标签在宽屏本来就该单行 —— 与 S5 窄屏那条互为对照
    const dWrapped = (g.tabLines ?? []).filter((x) => x.lines > 1);
    check("桌面 Tab 标签均为单行（窄屏对照基线）", dWrapped.length === 0,
      dWrapped.length ? dWrapped.map((x) => `「${x.label}」${x.lines} 行`).join(" · ")
        : `均单行（高度 ${(g.tabLines ?? []).map((x) => x.h).join("/")}px）`);
    check("桌面 Tab 条无需滚动、四个 Tab 全部可见", (g.tabBar?.hidden ?? 0) <= 0 && (g.tabBar?.clipped ?? []).length === 0,
      `需滚 ${g.tabBar?.hidden ?? "?"}px · 被裁 ${(g.tabBar?.clipped ?? []).join("/") || "无"}`);
    await screenChecks("项目 Tab", g, m);
    await shot("materials-s0-projects");
  }

  /* ---------------------------------------------- S1 其余三个 Tab × 桌面 */
  console.log("\n== S1 其余 Tab × 桌面 1440");
  for (const t of ["物料", "供应商", "供应关系"]) {
    const m = mark();
    const r = await clickTab(t);
    if (r !== "clicked") { check(`Tab「${t}」可点`, false, r); continue; }
    const g = await geom();
    if (!g) { check(`Tab「${t}」可读`, false, "probe 返回空"); continue; }
    await screenChecks(`Tab「${t}」`, g, m);
    await shot(`materials-s1-${t}`);
  }

  /* ------------------------------------------------- S2 键盘可达性（真激活） */
  console.log("\n== S2 键盘可达性 · focus + Enter 必须真能激活行");
  {
    await clickTab("项目");
    const m = mark();
    // 先确认初始是列表态
    const before = await evalJs(`document.body.innerText.includes("返回项目列表")`);
    check("初始为列表态（无「返回项目列表」）", before === false);
    // 聚焦第一个行容器，再用 CDP 发真实 Enter 键（React 监听原生 keydown，能收到）
    const focused = await evalJs(`(() => {
      const row = document.querySelector('[role="button"]:has(button)');
      if (!row) return "no-row";
      row.focus();
      return document.activeElement === row ? "focused" : "focus-failed";
    })()`);
    check("行容器可获得焦点", focused === "focused", String(focused));
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(800);
    const after = await evalJs(`document.body.innerText.includes("返回项目列表")`);
    check("按 Enter 切到详情视图（键盘可用，不是死 div）", after === true, after ? "已切换" : "没反应 —— 只剩鼠标可用");
    // ★ 截图必须拍在**断言成立的那一刻**。
    //   原先这行写在「复原」之后，拍出来的是返回后的列表态 ——
    //   文件名却叫 keyboard，等于拿一张列表截图当「键盘可达」的证据（还和 S0 字节相同）。
    //   截图与断言的状态错位比没截图更坏：看起来有据可查，其实对不上。
    await shot("materials-s2-keyboard-detail");
    // ★ 门禁：这张证据截图必须与首屏列表态不同。
    //   原先它与 S0 字节完全相同 —— 断言过了、图也「有」，但两图一样，
    //   说明拍的根本不是被断言的那个状态。这种错位不报错、不告警，只能靠比对抓到。
    check("键盘证据截图与首屏列表态不同（拍的确实是切换后的画面）",
      !SHOT_DIR || shotHashes["materials-s2-keyboard-detail"] !== shotHashes["materials-s0-projects"],
      `detail #${shotHashes["materials-s2-keyboard-detail"] ?? "未出图"} vs 首屏 #${shotHashes["materials-s0-projects"] ?? "未出图"}`);
    const mine = errors.slice(m);
    check("键盘操作过程无控制台报错", mine.length === 0, (mine[0] ?? "").split("\n")[0].slice(0, 120) || "干净");
    // 复原：点「返回项目列表」
    await evalJs(`(() => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.innerText || "").includes("返回项目列表"));
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(600);
  }

  /* --------------------------------- S3 行内图标按钮不得把行选中也一起触发 */
  console.log("\n== S3 行内图标按钮（stopPropagation 在换成 div 后仍须有效）");
  {
    const m = mark();
    const clicked = await evalJs(`(() => {
      const row = document.querySelector('[role="button"]:has(button[data-slot="button"])');
      if (!row) return "no-row";
      const btns = row.querySelectorAll("button");
      if (!btns.length) return "no-btn";
      btns[0].scrollIntoView({ block: "center" });
      btns[0].click();
      return "clicked-" + btns.length;
    })()`);
    await sleep(800);
    const txt = await evalJs(`document.body.innerText`);
    check("点「编辑」打开了表单弹窗", /编辑项目|新增项目/.test(txt ?? ""), String(clicked));
    // ★ 这是换元素后最容易出的回归：外层 div 的 onClick 也触发了
    check("未误触发行选中（没有跳到详情视图）", !(txt ?? "").includes("返回项目列表"));
    // 关闭弹窗（Esc），复原现场
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(600);
    const closed = !(await evalJs(`document.body.innerText.includes("编辑项目")`));
    check("Esc 可关闭弹窗", closed === true, closed ? "已关闭" : "仍开着");
    const mine = errors.slice(m);
    check("开关弹窗过程无控制台报错", mine.length === 0, (mine[0] ?? "").split("\n")[0].slice(0, 120) || "干净");
  }

  /* ------------------------------------------------------------- S4 数据对账 */
  console.log("\n== S4 数据对账：页面行数 == 接口条数");
  {
    const apiJson = async (p) => (await fetch(`${API}${p}`)).json();
    const countOf = (j) => (Array.isArray(j) ? j.length : (j.items?.length ?? 0));

    // 物料 Tab（分页 8）
    await clickTab("物料");
    const matFp = await geom();
    const matApi = await apiJson("/api/materials?page=1&page_size=8");
    check(`物料 Tab 物料行数 == 接口本页条数（${matFp.materialRows} vs ${countOf(matApi)}）`, matFp.materialRows === countOf(matApi));

    // 供应商 Tab（全量，无分页）
    await clickTab("供应商");
    const supFp = await geom();
    const supApi = await apiJson("/api/suppliers");
    check(`供应商 Tab 表格行数 == /api/suppliers 条数（${supFp.tableRows[0]} vs ${countOf(supApi)}）`,
      supFp.tableRows[0] === countOf(supApi));

    // 供应关系 Tab（分页 10）
    await clickTab("供应关系");
    const relFp = await geom();
    const relApi = await apiJson("/api/supply-relations?page=1&page_size=10");
    check(`供应关系 Tab 表格行数 == 接口本页条数（${relFp.tableRows[0]} vs ${countOf(relApi)}）`,
      relFp.tableRows[0] === countOf(relApi));
  }

  /* -------------------------------------------------------- S5 窄屏 390 全 Tab */
  console.log("\n== S5 窄屏 390 · 四个 Tab 逐个查（手机上这页是主从布局，最易溢出）");
  {
    const m = mark();
    await open(390, 844);
    for (const t of TABS) {
      const r = t === "项目" ? "clicked" : await clickTab(t);
      const g = await geom();
      if (r !== "clicked" || !g) { check(`窄屏 Tab「${t}」`, false, `tab=${r} probe=${g ? "ok" : "空"}`); continue; }
      check(`窄屏 Tab「${t}」无横向溢出且无嵌套`, g.overflow <= 0 && g.nesting.length === 0,
        `溢出 ${g.overflow}px · 嵌套 ${g.nesting.length} 处`);
      // ★ 这一条专抓「静默降级」：不溢出但中文标签被挤成两行。
      const wrapped = (g.tabLines ?? []).filter((x) => x.lines > 1);
      check(`窄屏 Tab「${t}」四个标签文案均为单行（未被挤成两行）`, wrapped.length === 0,
        wrapped.length ? wrapped.map((x) => `「${x.label}」${x.lines} 行/${x.h}px`).join(" · ")
          : `均单行（高度 ${(g.tabLines ?? []).map((x) => x.h).join("/")}px）`);
      // ★ 页面不溢出 ≠ Tab 没被裁：Tab 条自己 overflow-x-auto 后就「不溢出」了，
      //   但第四个 Tab 滑出视野，手机上根本发现不了。必须查 Tab 条自身的宽度账。
      const tb = g.tabBar;
      check(`窄屏 Tab「${t}」四个 Tab 全部可见（不依赖横向滑动）`,
        !!tb && tb.count === TABS.length && tb.hidden <= 0 && tb.clipped.length === 0,
        tb ? `Tab ${tb.count} 个 · 需滚 ${tb.hidden}px · 被裁 ${tb.clipped.join("/") || "无"}` : "读不到 Tab 条");
      if (t === "项目" || t === "物料") await shot(`materials-s5-${t}-m390`);
    }
    const mine = errors.slice(m);
    check("窄屏全程控制台干净", mine.length === 0, (mine[0] ?? "").split("\n")[0].slice(0, 150) || "干净");
  }

  /* ------------------------------------------------------------- S6 总检 */
  console.log("\n== S6 运行期错误总检（本页范围）");
  check("全流程无 console.error / pageerror", errors.length === 0,
    errors.slice(0, 2).map((e) => e.split("\n")[0].slice(0, 140)).join(" | ") || "干净");

  console.log(`\n结论：${fail === 0 ? "全部通过" : `${fail} 条未通过`}（通过 ${pass}）`);
} catch (e) {
  console.log("!! " + (e?.message ?? e));
  fail++;
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(fail === 0 ? 0 : 1);
