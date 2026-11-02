/**
 * 量 SOP 图上的标注点位置，并顺手截一张固定视口的图。
 *
 * 为什么要有这个脚本：`sop-docs.ts` 里的 `pins` 是**相对截图的百分比**，
 * 以前靠眼看 + 猜，改一次版式就要反复试。这里直接在同一个视口里
 * 取 DOM 的 getBoundingClientRect()，除一下宽高就得到百分比，
 * 截图和坐标出自同一次渲染，不会再偏。
 *
 * 用法：node scripts/probe-sop-pins.mjs <url> <outfile> [js表达式JSON]
 */
import fs from "node:fs";

const [, , url, out, probeJson] = process.argv;
const W = Number(process.env.WIDTH || 1560);
const H = Number(process.env.HEIGHT || 820);

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("找不到 page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve) => pending.set(msgId, resolve));
}

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: W,
  height: H,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await sleep(4200);
const scrollY = Number(process.env.SCROLL || 0);
if (scrollY) {
  await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollY})` });
  await sleep(900);
}

const probes = probeJson ? JSON.parse(probeJson) : [];
const expression = `(() => {
  const out = {};
  const W = window.innerWidth, H = window.innerHeight;
  out.__viewport = [W, H];
  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return {
      x: Number(((r.left + r.width / 2) / W * 100).toFixed(1)),
      y: Number(((r.top + r.height / 2) / H * 100).toFixed(1)),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
  };
  const byText = (text, back) => {
    const nodes = [...document.querySelectorAll('button,div,span,p,h2,h3,label')]
      .filter(n => (n.textContent || '').trim() === text || (n.textContent || '').trim().startsWith(text));
    if (!nodes.length) return null;
    // 取最小的那个（最贴近文字本身），避免匹配到整页容器
    nodes.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height
                       - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    let el = nodes[0];
    for (let i = 0; i < (back || 0) && el.parentElement; i++) el = el.parentElement;
    return el;
  };
  const defs = ${JSON.stringify(probes)};
  for (const d of defs) {
    let el = null;
    if (d.text) el = byText(d.text, d.back || 0);
    else if (d.selector) el = document.querySelector(d.selector);
    out[d.name] = rectOf(el);
  }
  return out;
})()`;

const res = await send("Runtime.evaluate", { expression, returnByValue: true });
console.log(JSON.stringify(res?.result?.value, null, 2));

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved", out);
ws.close();
