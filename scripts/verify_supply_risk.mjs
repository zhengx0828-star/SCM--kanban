/**
 * 供需风险计算回归验证。
 *
 * 被测：`frontend/src/lib/supply-risk.ts`
 *   - **供应系数 = 产能 ÷ 需求**，三档 + 无数据：
 *       系数 < 1.0        → 缺口 shortage（红）
 *       1.0 ≤ 系数 ≤ 1.3  → 紧张 tight（黄）
 *       系数 > 1.3        → 充足 surplus（绿）
 *       需求 = 0（含需求 0 但产能 > 0）→ 无数据 none（灰）
 *   - 物料风险行（最严重缺口比例 + 月份 + hasRisk）
 *   - 汇总指标：覆盖率、最差物料覆盖率、首个缺口月份、最严重缺口、缺口总量
 *
 * 运行（无需浏览器、不碰任何业务数据）：
 *   node scripts/verify_supply_risk.mjs
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const esbuild = requireFromFrontend("esbuild");

const OUT = path.join(os.tmpdir(), `risk_check_${process.pid}_${Date.now()}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "frontend/src/lib/supply-risk.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  logLevel: "error",
});

const {
  riskStatusOf,
  supplyCoefOf,
  buildMaterialRisk,
  summarizeSupplyRisk,
  TIGHT_RATIO_MIN,
  TIGHT_RATIO_MAX,
} = requireFromFrontend(OUT);

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

const m12 = (fill) => Array.from({ length: 12 }, () => fill);

console.log(`紧张区间 TIGHT_RATIO = [${TIGHT_RATIO_MIN}, ${TIGHT_RATIO_MAX}]\n`);

/* ---------- 1. 供应系数 ---------- */
console.log("[1] 供应系数 = 产能 ÷ 需求");
check("需求 0 → 系数 null（除不出）", supplyCoefOf(0, 100) === null);
check("需求负数 → 系数 null", supplyCoefOf(-5, 100) === null);
check("需求 1000 / 产能 850 → 0.85", supplyCoefOf(1000, 850) === 0.85);
check("需求 100 / 产能 0 → 0", supplyCoefOf(100, 0) === 0);
check("需求 100 / 产能 135 → 1.35", supplyCoefOf(100, 135) === 1.35);

/* ---------- 2. 状态三档 + 无数据 ---------- */
console.log("\n[2] 状态判定（比值口径）");
check("0 / 0 → 无数据 none", riskStatusOf(0, 0) === "none");
check("需求 0 但有产能 → 无数据 none（旧口径是盈余，已改）", riskStatusOf(0, 50) === "none");
check("有需求无产能（系数 0）→ 缺口 shortage", riskStatusOf(100, 0) === "shortage");
check("系数 0.99 → 缺口 shortage", riskStatusOf(100, 99) === "shortage");
check("系数 1.00 → 紧张 tight（边界含）", riskStatusOf(100, 100) === "tight");
check("系数 1.30 → 紧张 tight（边界含）", riskStatusOf(100, 130) === "tight");
check("系数 1.31 → 充足 surplus", riskStatusOf(100, 131) === "surplus");
check("系数 2.00 → 充足 surplus", riskStatusOf(100, 200) === "surplus");

/* ---------- 3. 物料风险行 ---------- */
console.log("\n[3] 物料风险行");
const demandA = [100, 100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100];
const capA = m12(150);
capA[7] = 50; // 8 月产能暴跌 → 需求 200 / 产能 50 = 系数 0.25，缺口 150 → 比例 75%
const a = buildMaterialRisk("A", "物料A", demandA, capA);
check("识别出存在缺口", a.hasShortage === true);
check("该物料有风险（缺口或紧张）", a.hasRisk === true);
check("8 月供应系数 = 0.25", Math.abs((a.monthly[7].coef ?? 0) - 0.25) < 1e-9, `=${a.monthly[7].coef}`);
check("最严重缺口月份 = 8 月（下标7）", a.worstMonthIndex === 7, `worstMonthIndex=${a.worstMonthIndex}`);
check("最严重缺口比例 = 75%", Math.abs(a.worstGapRatio - 0.75) < 1e-9, `worstGapRatio=${a.worstGapRatio}`);
check("全年需求合计 = 1300", a.totalDemand === 1300, `totalDemand=${a.totalDemand}`);
check("全年产能合计 = 1700", a.totalCapacity === 1700, `totalCapacity=${a.totalCapacity}`);

const b = buildMaterialRisk("B", "物料B", m12(100), m12(400));
check("产能全面覆盖 → 无缺口", b.hasShortage === false && b.worstGapRatio === 0);
check("产能全面覆盖 → 无风险", b.hasRisk === false);
check("每格系数 = 4.00", b.monthly.every((x) => x.coef === 4));

const z = buildMaterialRisk("Z", "零需求", m12(0), m12(0));
check("需求全 0 → 每格 coef 为 null", z.monthly.every((x) => x.coef === null));
check("需求全 0 → 每格状态 none（灰）", z.monthly.every((x) => x.status === "none"));
check("需求全 0 → 无风险", z.hasRisk === false);

const t = buildMaterialRisk("T", "刚好紧张", m12(100), m12(115));
check("系数 1.15 → 全月紧张", t.monthly.every((x) => x.status === "tight"));
check("系数 1.15 → hasRisk 为真（紧张也算风险）", t.hasRisk === true);
check("系数 1.15 → 无缺口", t.hasShortage === false);

/* ---------- 4. 汇总指标 ---------- */
console.log("\n[4] 汇总指标");
const s = summarizeSupplyRisk([a, b]);
check("有缺口物料数 = 1", s.shortageMaterialCount === 1, `=${s.shortageMaterialCount}`);
check("物料总数 = 2", s.materialCount === 2);
// Σ产能 1700+4800=6500；Σ需求 1300+1200=2500 → 260%
check("覆盖率 = 260%", Math.abs((s.coverageRatio ?? 0) - 2.6) < 1e-9, `coverageRatio=${s.coverageRatio}`);
// 物料A 覆盖率 1700/1300 = 130.8% → 最差 = 130.8%
check(
  "最差物料覆盖率 = 物料A 的 130.8%",
  Math.abs((s.worstMaterialCoverage ?? 0) - 1700 / 1300) < 1e-9,
  `=${((s.worstMaterialCoverage ?? 0) * 100).toFixed(1)}%`
);
check("首个缺口月份 = 8 月（下标7）", s.firstShortageMonth === 7, `=${s.firstShortageMonth}`);
check("最严重缺口指向物料A", s.worst?.pn === "A");
check("全年缺口总量 = 150", s.totalGap === 150, `=${s.totalGap}`);

/* ---------- 5. 总量达标但单物料严重缺口（覆盖率掩盖效应） ---------- */
console.log("\n[5] 总量够、单个物料却严重缺口 → 靠最差物料覆盖率兜底");
const big = buildMaterialRisk("BIG", "大物料", m12(1000), m12(2000)); // 系数 2.0
const small = buildMaterialRisk("SMALL", "小物料", m12(100), m12(0)); // 系数 0
const s2 = summarizeSupplyRisk([big, small]);
check("总量覆盖率 > 100%（掩盖）", (s2.coverageRatio ?? 0) > 1, `=${((s2.coverageRatio ?? 0) * 100).toFixed(0)}%`);
check("最差物料覆盖率 = 0%（暴露）", s2.worstMaterialCoverage === 0);
check("有缺口物料数 = 1", s2.shortageMaterialCount === 1);

/* ---------- 6. 无缺口 / 空数据 ---------- */
console.log("\n[6] 无缺口与空数据");
const s3 = summarizeSupplyRisk([b]);
check("无缺口 → 首个缺口月份 null", s3.firstShortageMonth === null);
check("无缺口 → 最严重缺口 null", s3.worst === null);
check("无缺口 → 缺口总量 0", s3.totalGap === 0);
check("无缺口 → 有缺口物料数 0", s3.shortageMaterialCount === 0);
const s4 = summarizeSupplyRisk([]);
check("空数据 → 覆盖率 null", s4.coverageRatio === null);
check("空数据 → 最差物料覆盖率 null", s4.worstMaterialCoverage === null);
check("空数据 → 首个缺口月份 null", s4.firstShortageMonth === null);

/* ---------- 7. 首个缺口月份取最早 ---------- */
console.log("\n[7] 首个缺口月份取最早");
const early = buildMaterialRisk("E", "早缺", m12(100), m12(80)); // 系数 0.8，每月都缺
const late = buildMaterialRisk("L", "晚缺", m12(100), [...m12(200).slice(0, 5), 10, ...m12(200).slice(6)]); // 6 月起缺
const s5 = summarizeSupplyRisk([early, late]);
check("首个缺口月份 = 1 月（下标0）", s5.firstShortageMonth === 0, `=${s5.firstShortageMonth}`);

/* ---------- 8. 用户口径三档抽样 ---------- */
console.log("\n[8] 用户口径三档抽样");
check("0.85 → 红（缺口）", riskStatusOf(1000, 850) === "shortage");
check("1.00 → 黄（紧张）", riskStatusOf(1000, 1000) === "tight");
check("1.25 → 黄（紧张）", riskStatusOf(1000, 1250) === "tight");
check("1.30 → 黄（紧张，边界）", riskStatusOf(1000, 1300) === "tight");
check("1.35 → 绿（充足）", riskStatusOf(1000, 1350) === "surplus");

console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
try {
  fs.unlinkSync(OUT);
} catch {
  /* ignore */
}
process.exit(fail === 0 ? 0 : 1);
