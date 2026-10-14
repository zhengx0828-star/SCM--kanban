/**
 * 地图点位布局回归验证（同省供应商重叠处理）。
 *
 * 被测：`frontend/src/lib/supplier-map-points.ts`
 *   - 单点原样；同坐标 2~8 家确定性环形散开；> 8 家聚合成计数气泡
 *
 * 运行（无需浏览器）：
 *   node scripts/verify_map_points.mjs
 *
 * 说明：脚本用 frontend 内的 esbuild 把 TS 模块即时打包成 CJS 再跑断言，
 * 不修改任何业务数据（全部用内存里的构造样例）。
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const esbuild = requireFromFrontend("esbuild");

const OUT = path.join(os.tmpdir(), `smp_check_${process.pid}_${Date.now()}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "frontend/src/lib/supplier-map-points.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  logLevel: "error",
});

const { computeSupplierPlacements, pickSevereRisk, OVERLAP_RING_MAX, RING_BASE_RADIUS } = requireFromFrontend(OUT);

const GD = { lng: 113.26, lat: 23.13 }; // 广东（广州）
const JS = { lng: 118.78, lat: 32.04 }; // 江苏（南京）
const BJ = { lng: 116.4, lat: 39.9 }; // 北京

const mk = (id, name, coord, risk = null) => ({
  id,
  name,
  longitude: coord.lng,
  latitude: coord.lat,
  city: name,
  supply_material: null,
  risk_level: risk,
});
const round = (n) => Math.round(n * 10000) / 10000;

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

console.log(`阈值: OVERLAP_RING_MAX = ${OVERLAP_RING_MAX} | RING_BASE_RADIUS = ${RING_BASE_RADIUS}\n`);

/* 场景 1：同省 3 家 + 异地各 1 家 */
console.log("[场景 1] 广东 3 家 + 江苏 1 家 + 北京 1 家");
const s1 = [
  mk(1, "XS", GD, "red"),
  mk(2, "IKD", GD, "yellow"),
  mk(3, "YM", GD, "green"),
  mk(4, "FRD", JS, null),
  mk(5, "KL", BJ, "green"),
];
const r1 = computeSupplierPlacements(s1);
console.log(`  points = ${r1.points.length} | clusters = ${r1.clusters.length}`);
for (const p of r1.points) console.log(`    id=${p.supplierId} ${p.risk.padEnd(6)} -> (${round(p.lng)}, ${round(p.lat)})`);
check("5 家都生成散点（无聚合）", r1.points.length === 5 && r1.clusters.length === 0);
const gdPts = r1.points.filter((p) => p.supplierId <= 3);
check("广东 3 家坐标互不相同", new Set(gdPts.map((p) => `${round(p.lng)},${round(p.lat)}`)).size === 3);
check("广东 3 家仍在广东附近（偏移 < 1 度）", gdPts.every((p) => Math.abs(p.lng - GD.lng) < 1 && Math.abs(p.lat - GD.lat) < 1));
check("江苏/北京各 1 家坐标未偏移", (() => {
  const js = r1.points.find((p) => p.supplierId === 4);
  const bj = r1.points.find((p) => p.supplierId === 5);
  return round(js.lng) === JS.lng && round(js.lat) === JS.lat && round(bj.lng) === BJ.lng && round(bj.lat) === BJ.lat;
})());
check("风险色跟随各自供应商（红/黄/绿）", gdPts.map((p) => p.risk).sort().join(",") === "green,red,yellow");

/* 场景 2：确定性 */
console.log("\n[场景 2] 确定性：同输入两次 / 输入顺序打乱");
check("两次结果完全一致（刷新不会乱跳）", JSON.stringify(computeSupplierPlacements(s1)) === JSON.stringify(computeSupplierPlacements(s1)));
const byId = (res) => Object.fromEntries(res.points.map((p) => [p.supplierId, `${round(p.lng)},${round(p.lat)}`]));
const m1 = JSON.stringify(byId(computeSupplierPlacements(s1)));
const m2 = JSON.stringify(byId(computeSupplierPlacements([...s1].reverse())));
check("输入顺序打乱 → 每家坐标不变（按 id 固定角度）", m1 === m2);

/* 场景 3：超阈值 → 聚合 */
console.log(`\n[场景 3] 广东 ${OVERLAP_RING_MAX + 1} 家（超阈值 1 家）→ 应聚合`);
const s3 = Array.from({ length: OVERLAP_RING_MAX + 1 }, (_, i) => mk(100 + i, "S" + i, GD, i === 3 ? "red" : "green"));
const r3 = computeSupplierPlacements(s3);
console.log(`  points = ${r3.points.length} | clusters = ${r3.clusters.length}`);
if (r3.clusters[0]) console.log(`  cluster: ${JSON.stringify(r3.clusters[0])}`);
check("聚合成 1 个气泡", r3.points.length === 0 && r3.clusters.length === 1);
check("气泡家数正确", r3.clusters[0]?.count === OVERLAP_RING_MAX + 1);
check("气泡按组内最严重风险着色（red）", r3.clusters[0]?.risk === "red");

/* 场景 4：恰好等于阈值 → 仍散开 */
console.log(`\n[场景 4] 广东恰好 ${OVERLAP_RING_MAX} 家 → 仍散开`);
const s4 = Array.from({ length: OVERLAP_RING_MAX }, (_, i) => mk(200 + i, "S" + i, GD));
const r4 = computeSupplierPlacements(s4);
check(`恰好 ${OVERLAP_RING_MAX} 家不聚合`, r4.points.length === OVERLAP_RING_MAX && r4.clusters.length === 0);
check("坐标互不相同", new Set(r4.points.map((p) => `${round(p.lng)},${round(p.lat)}`)).size === OVERLAP_RING_MAX);

/* 场景 5：混合 */
console.log("\n[场景 5] 广东 4 家散开 + 江苏 10 家聚合 + 北京 1 家单点");
const s5 = [
  ...Array.from({ length: 4 }, (_, i) => mk(300 + i, "A" + i, GD)),
  ...Array.from({ length: 10 }, (_, i) => mk(400 + i, "B" + i, JS)),
  mk(500, "C", BJ),
];
const r5 = computeSupplierPlacements(s5);
console.log(`  points = ${r5.points.length} | clusters = ${r5.clusters.length}`);
check("散点 = 4(广东) + 1(北京) = 5", r5.points.length === 5);
check("聚合 = 1(江苏 10 家)", r5.clusters.length === 1 && r5.clusters[0]?.count === 10);

/* 场景 6：无坐标不上图 */
console.log("\n[场景 6] 无坐标供应商不上图");
const r6 = computeSupplierPlacements([
  mk(1, "OK", GD),
  { id: 2, name: "NULL", longitude: null, latitude: 23, city: null, supply_material: null, risk_level: null },
]);
check("只输出 1 个点", r6.points.length === 1 && r6.clusters.length === 0);

/* 场景 7：最严重风险优先级 */
console.log("\n[场景 7] 聚合气泡着色取最严重风险");
check("有红取红", pickSevereRisk([mk(1, "a", GD, "green"), mk(2, "b", GD, "red"), mk(3, "c", GD, "yellow")]) === "red");
check("无红取黄", pickSevereRisk([mk(1, "a", GD, "green"), mk(2, "b", GD, "yellow")]) === "yellow");
check("全未评估 → none", pickSevereRisk([mk(1, "a", GD, null), mk(2, "b", GD, null)]) === "none");

console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
try {
  fs.unlinkSync(OUT);
} catch {
  /* ignore */
}
process.exit(fail === 0 ? 0 : 1);
