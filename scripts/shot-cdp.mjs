/**
 * 用 Chrome DevTools Protocol 截「有点击状态」的图（弹窗类无法靠 URL 直达）。
 * 用法：node scripts/shot-cdp.mjs <url> <outfile> [clickText]
 */
import fs from "node:fs";

const [, , url, out, clickText, scrollY] = process.argv;

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
await send("Page.navigate", { url });
await sleep(3500);

for (const text of (clickText ? clickText.split("|") : [])) {
  const res = await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().includes(${JSON.stringify(text)}));
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`,
    returnByValue: true,
  });
  console.log(`click ${text}:`, res?.result?.value);
  await sleep(1200);
}

if (scrollY) {
  await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${Number(scrollY)})` });
  await sleep(800);
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved", out);
ws.close();
