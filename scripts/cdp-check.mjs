/**
 * 用 CDP 驱动无头 Chrome 做「真实交互」验收：打开库存页 → 悬停/点击目标 → 抓文本/截图。
 *
 * 为什么要它：--dump-dom 只能看首屏，弹窗（Radix Portal）与悬停浮层按需挂载，不交互就看不到，
 * 而 agent-browser 在本机不可用。Node 22 自带全局 WebSocket，可直接讲 CDP 协议。
 *
 * 用法：node scripts/cdp-check.mjs <url> <目标文案> <输出目录> [action]
 *   action = hover（默认，真实鼠标移动触发 onMouseEnter）| click
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [url, targetText, outDir, action = "hover"] = process.argv.slice(2);
if (!url || !targetText || !outDir) {
  console.error("usage: node cdp-check.mjs <url> <targetText> <outDir> [hover|click]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const PORT = 9333;
const profile = path.join(os.tmpdir(), `cdp-check-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1600,1100",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
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

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " / " + (r.result?.description ?? ""));
  return r.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(6000);

// 找「最深的」命中元素：命中集合里不含其它命中子元素的那些，避免点到外层容器
const FIND = `(() => {
  const t = ${JSON.stringify(targetText)};
  const all = [...document.querySelectorAll('button, span, div, th, td, a, p, b')];
  const hits = all.filter(el => (el.innerText || '').includes(t));
  const deepest = hits.filter(el => !hits.some(o => o !== el && el.contains(o)));
  const el = deepest[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName, text: (el.innerText||'').slice(0, 60) };
})()`;

const box = await evalJs(FIND);
if (!box) {
  console.log("TARGET NOT FOUND ->", targetText);
  writeFileSync(path.join(outDir, `miss-${targetText}.txt`), await evalJs("document.body.innerText"), "utf8");
} else {
  console.log("target ->", JSON.stringify(box));
  if (action === "hover") {
    // 先移到别处，再移进去，确保触发一次真实的 mouseenter
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, button: "none" });
    await sleep(150);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, button: "none" });
  } else {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, button: "none" });
    await sleep(200);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
  await sleep(2200);

  // 定位体检：浮层是否被视口裁掉、是否盖住了触发点
  const geo = await evalJs(`(() => {
    const d = document.querySelector('[data-concept-hint]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
             w: Math.round(r.width), h: Math.round(r.height),
             viewport: [window.innerWidth, window.innerHeight],
             scrollable: d.scrollHeight > d.clientHeight + 1 };
  })()`);
  console.log("hint rect ->", JSON.stringify(geo), "| trigger ->", JSON.stringify({ x: box.x, y: box.y }));

  const hint = await evalJs(
    `(() => { const d = document.querySelector('[data-concept-hint]'); return d ? d.innerText : '__NO_HINT__'; })()`
  );
  writeFileSync(path.join(outDir, `hint-${targetText}.txt`), hint ?? "", "utf8");
  console.log("hint length ->", hint ? hint.length : 0);
  console.log("--- hint head ---");
  console.log((hint ?? "").slice(0, 1500));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(outDir, `hint-${targetText}.png`), Buffer.from(shot.data, "base64"));
}

ws.close();
chrome.kill();
await sleep(400);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* 忽略：临时 profile 清理失败不影响结论 */
}
process.exit(0);
