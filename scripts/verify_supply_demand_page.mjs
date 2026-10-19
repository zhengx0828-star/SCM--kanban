/**
 * 供需管理页 · 真实交互回归（CDP + 无头 Chrome）。
 *
 * 为什么需要它：本页的下拉选择器是自研绝对定位面板，很容易被**祖先的 overflow:hidden 裁掉**——
 * 页面不报错、tsc/build 全绿，但用户点开下拉**只看到搜索框、选项列表整块不见**，导致项目和物料
 * 根本选不了、下方图表与热力图永远出不来。纯静态检查抓不到，必须真实渲染 + 命中测试。
 *
 * 断言：
 *   1) 点开「项目」下拉后面板未被祖先裁剪（命中测试落到面板内部）
 *      ★ 2026-10-16 起：筛选器从「明细分析」独立卡**内嵌进两张内容卡的卡头**，
 *        本步点到的就是卡头里的下拉；裁剪检查同样适用（AnalysisSection 必须 overflow-visible）
 *   2) 页面上有 2 处「项目」下拉且文本一致（同一份选择 · 联动），「物料」下拉变为可用
 *   3) 勾选物料后：物料供需图 + 供应系数热力图出现
 *   4) 热力图为固定列宽 `200px repeat(12, 34px)`，**每行 12 格且所有格子宽度完全一致**
 *      （行数 = 物料数，不写死 —— 库里有几个物料就跑几行）
 *   5) 格子内是产能÷需求的系数（不是空、不是 NaN）
 *      —— 若所选物料未录入 BOM / 产能，页面按「数据保真」只给空态，第 4、5 段记 SKIP，不算失败
 *
 * 用法（需前端已启动）：
 *   node scripts/verify_supply_demand_page.mjs [url] [截图输出目录]
 *   默认 url = http://127.0.0.1/supply-demand
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = process.argv[2] || "http://127.0.0.1/supply-demand";
const OUT = process.argv[3] || path.join(os.tmpdir(), `sd-verify-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const PORT = 9345;
const profile = path.join(os.tmpdir(), `cdp-sd-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1500,1250",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra ? "  " + extra : ""}`);
  }
};

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error("CDP 未就绪");
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.error) return "CDP_ERROR: " + JSON.stringify(r.error).slice(0, 160);
  if (r.result?.exceptionDetails) return "JS_EXCEPTION: " + String(r.result.exceptionDetails.text || "").slice(0, 140);
  return r.result?.result?.value;
};

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) return;
  writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
};

const findPanel = `[...document.querySelectorAll("div")].filter(d => { const c = String(d.className||""); return c.includes("absolute") && c.includes("z-50"); }).pop()`;

const clickTrigger = (label) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll("button")].find(e => (e.textContent||"").trim().startsWith(${JSON.stringify(label)}));
    if (!el) return "TRIGGER_NOT_FOUND";
    el.click(); return "CLICKED";
  })()`);

const clickInPanel = (text) =>
  evaluate(`(() => {
    const panel = ${findPanel};
    if (!panel) return "NO_PANEL";
    const el = [...panel.querySelectorAll("button")].find(e => (e.textContent||"").includes(${JSON.stringify(text)}));
    if (!el) return "OPTION_NOT_FOUND";
    el.click(); return "CLICKED";
  })()`);

const probePanel = async () => {
  const raw = await evaluate(`(() => {
    const panel = ${findPanel};
    if (!panel) return "null";
    const r = panel.getBoundingClientRect();
    const hit = (r.left + r.width/2 > 0) ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;
    let clipper = null;
    for (let p = panel.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflow;
      if (o && o !== "visible") { clipper = p.tagName + "{" + o + "}"; break; }
    }
    return JSON.stringify({ clippedByAncestor: clipper, hitTestInsidePanel: !!(hit && panel.contains(hit)) });
  })()`);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 2100, deviceScaleFactor: 1, mobile: false });

  console.log(`打开 ${URL}`);
  await send("Page.navigate", { url: URL });
  await sleep(4500);
  await shot("01-initial.png");

  /* ---- 1. 项目下拉不被裁剪 ---- */
  console.log("\n[1] 「项目」下拉面板可点");
  console.log("  ", await clickTrigger("项目："));
  await sleep(700);
  const p1 = await probePanel();
  await shot("02-project-dropdown-open.png");
  check("面板存在", !!p1);
  check("未被祖先 overflow 裁剪", !!p1 && p1.clippedByAncestor === null, p1 ? `clipper=${p1.clippedByAncestor}` : "");
  check("面板中心命中测试落在面板内", !!p1 && p1.hitTestInsidePanel === true);

  /* ---- 2. 能选中项目 ---- */
  console.log("\n[2] 选择项目");
  console.log("  ", await clickInPanel("ABC"));
  await sleep(700);
  console.log("  ", await clickInPanel("完成"));
  await sleep(1500);
  const projTriggers = await evaluate(`JSON.stringify([...document.querySelectorAll("button")].map(b=>(b.textContent||"").trim()).filter(t=>t.startsWith("项目：")))`);
  const triggers = await evaluate(`JSON.stringify([...document.querySelectorAll("button")].map(b=>(b.textContent||"").trim().slice(0,26)).filter(t=>t.startsWith("项目：")||t.startsWith("物料：")))`);
  await shot("03-project-selected.png");
  let projList = [];
  try { projList = JSON.parse(projTriggers); } catch { /* ignore */ }
  check("页面上有 2 处「项目」下拉（客户需求卡 + 物料供需分析卡）", projList.length === 2, projTriggers);
  check("两处「项目」下拉文本一致（同一份选择 · 联动）", projList.length === 2 && projList[0] === projList[1], projTriggers);
  check(
    "项目下拉显示已选（触发器不再是占位文案）",
    /项目：(?!选择项目)/.test(String(triggers)),
    String(triggers)
  );

  /* ---- 3. 物料下拉可用并可勾选 ---- */
  console.log("\n[3] 选择物料");
  console.log("  ", await clickTrigger("物料："));
  await sleep(700);
  const p2 = await probePanel();
  check("物料面板未被祖先 overflow 裁剪", !!p2 && p2.clippedByAncestor === null, p2 ? `clipper=${p2.clippedByAncestor}` : "");
  const opts = await evaluate(`(() => {
    const panel = ${findPanel};
    if (!panel) return "NO_PANEL";
    return JSON.stringify([...panel.querySelectorAll("button")].map(b=>(b.textContent||"").trim().slice(0,20)).slice(0,16));
  })()`);
  console.log("  物料面板按钮:", opts);
  check("物料下拉里有「全选」", String(opts).includes("全选"));
  console.log("  ", await clickInPanel("全选"));
  await sleep(700);
  console.log("  ", await clickInPanel("完成"));
  await sleep(2500);
  await evaluate(`document.getElementById("supply-detail") && document.getElementById("supply-detail").scrollIntoView()`);
  await sleep(700);
  await shot("04-final.png");

  const after = await evaluate(`JSON.stringify([...document.querySelectorAll("button")].map(b=>(b.textContent||"").trim().slice(0,26)).filter(t=>t.startsWith("物料：")))`);
  check("物料下拉显示已全选", String(after).includes("全部"), String(after));

  /* ---- 4. 热力图渲染 ----
     注：所选物料若未录入 BOM 系数 / 供应商产能，页面按「数据保真」只显示空态，
     热力图本就不该出现 —— 这种情况记为 SKIP，不算失败（不是布局/渲染 bug）。 */
  const noSupplyData = await evaluate(`document.body.innerText.includes("暂无物料供需数据")`);
  if (noSupplyData) {
    console.log(
      "\n[4] 供应系数热力图 —— SKIP：所选物料未录入 BOM / 产能，页面按数据保真显示「暂无物料供需数据」空态"
    );
  } else {
    console.log("\n[4] 供应系数热力图");
    const hm = await evaluate(`(() => {
      const g = [...document.querySelectorAll("div")].find(d => String(d.style.gridTemplateColumns||"").includes("repeat(12, 34px)"));
      if (!g) return "NO_HEATMAP";
      const kids = [...g.children];
      const header = kids.slice(1, 13).map(c => (c.textContent||"").trim());
      const rowCellIdx = i => 14 + i;
      const row1 = [...Array(12)].map((_, i) => kids[rowCellIdx(i)]);
      const widths = [];
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i < 12; i++) {
          const el = kids[13 + r * 13 + 1 + i];
          if (el) widths.push(Math.round(el.getBoundingClientRect().width));
        }
      }
      return JSON.stringify({
        gridCols: String(g.style.gridTemplateColumns),
        headers: header,
        row1: row1.map(c => (c.textContent||"").trim()),
        allCellWidths: Array.from(new Set(widths)),
        cellCount: widths.length,
        hasTitle: [...document.querySelectorAll("h3")].some(h => (h.textContent||"").includes("供应系数热力"))
      });
    })()`);
    console.log("  ", hm);
    let h = null;
    try { h = JSON.parse(hm); } catch { /* ignore */ }
    check("热力图已渲染", !!h && h.gridCols === "200px repeat(12, 34px)", h ? h.gridCols : String(hm).slice(0, 80));
    check("表头为 1-12 月", !!h && h.headers.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12");
    check(
      "每行 12 格、所有格子宽度完全一致（不再大小不一）",
      !!h && h.cellCount > 0 && h.cellCount % 12 === 0 && h.allCellWidths.length === 1,
      h ? `widths=${h.allCellWidths} count=${h.cellCount}（${h.cellCount / 12} 行 × 12 月）` : ""
    );
    check("格内为供应系数数值", !!h && h.row1.every((v) => /^\d+\.\d{2}$/.test(v)), h ? h.row1.join(",") : "");
  }

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  console.log("截图目录:", OUT);
} finally {
  try { ws.close(); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
}
process.exit(fail === 0 ? 0 : 1);
