/**
 * 库存信号塔 · 术语图解浮层（悬停出现 + 可钉住）
 *
 * 为什么做：ROP / 安全天数 / SS 这些口径只写在规则页里，看盘的人不会去翻，
 * 结果就是「数字看得到、道理不知道」。把图解挂到正在看的那个数字上，边看边懂。
 *
 * 三张图：
 *  ① RopTimingDiagram —— 再订货点与补货时机：为什么下单日要早于耗尽日（LT 交期）；
 *  ② SafetyStockDiagram —— COV → 安全天数 → 安全库存：需求越不稳，安全库存留得越多；
 *  ③ CapacityDiagram —— 产能校验：分子/分母分别是什么、阈值怎么分档、为什么分母不是集团总产能。
 *
 * 三张图都是「原理画法 + 本行真实数字」：几何形状固定保证永远看得清，
 * 标注的数值全部取当前行的实际参数，图上还带一行结论直接回答「来不来得及 / 排不排得下」。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info, Pin, PinOff, X } from "lucide-react";
import { INV_CAPACITY_META, INV_COV_META, INV_SOURCE, type InventoryPlan } from "@/types/inventory";

/* ------------------------------------------------------------------ */
/* 数值工具                                                            */
/* ------------------------------------------------------------------ */

/** 最多两位小数、去掉多余的 0 —— 图注里的数字要短 */
function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Number(v.toFixed(digits));
  return String(r);
}

/** 2026-10-02 → 10/02 */
function md(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

/* ------------------------------------------------------------------ */
/* 通用浮层外壳：悬停出现 + 可钉住                                     */
/* ------------------------------------------------------------------ */

interface HintShellProps {
  /** 悬停目标（inline 元素，建议是已有文字/数字） */
  children: ReactNode;
  title: string;
  subtitle: string;
  /** 浮层内容，高度自适应；改宽度记得同步看定位逻辑 */
  width?: number;
  /** 展开后的图解主体 */
  content: ReactNode;
}

/**
 * 关键点：
 * - 30 天矩阵是 `overflow: auto` 容器，浮层直接挂进去会被裁掉 → createPortal 到 body + fixed 定位；
 * - 打开后监听 scroll（capture，否则接不到内层容器滚动）与 resize，实时跟随目标；
 * - 移开 160ms 才关，给鼠标留出「从数字滑到浮层上点钉住」的时间；
 * - 点击数字 = 钉住（浮层常驻），Esc / 点空白 / 再点一次 解除。
 */
function ConceptHint({ children, title, subtitle, width = 580, content }: HintShellProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - 24);
    const gap = 10;
    // 用 scrollHeight 取「自然高度」：卡片可能正被 maxHeight 压着，
    // 此时 offsetHeight 是被裁后的值，用它反推会让卡片每定位一次就缩一点。
    const cardH = cardRef.current
      ? Math.max(cardRef.current.offsetHeight, cardRef.current.scrollHeight)
      : 360;
    const below = r.bottom + gap; // 下方可用空间的起点
    const spaceBelow = vh - 12 - below;
    const spaceAbove = r.top - gap - 12;
    const want = Math.min(cardH, vh - 24);

    // 偏好顺序：① 下方放得下（允许 40px 内的轻微滚动，避免为几个像素就翻到上方）
    //          ② 上方放得下就翻上去，完整展示；③ 两边都挤 → 选空间大的一侧并限高。
    // 关键：绝不为了「留在下方」把卡片压得只剩个标题——宁可翻上去完整显示，也不让用户在小框里滚。
    const TOL = 40;
    let top: number;
    let maxH: number;
    if (spaceBelow >= want - TOL) {
      top = below;
      maxH = Math.max(spaceBelow, 160);
    } else if (spaceAbove >= want) {
      top = r.top - gap - want;
      maxH = want + 4; // 留 4px 余量：maxHeight 与自然高度差 1~2px 会出现没意义的滚动条
    } else if (spaceBelow >= spaceAbove) {
      top = below;
      maxH = Math.max(spaceBelow, 160);
    } else {
      maxH = Math.max(spaceAbove, 160);
      top = Math.max(12, r.top - gap - maxH);
    }

    const left = Math.max(12, Math.min(r.left, vw - w - 12));
    setPos({ left, top, width: w, maxH });
  }, [width]);

  const clearTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const hoverIn = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer]);

  const hoverOut = useCallback(() => {
    if (pinned) return;
    clearTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  }, [clearTimer, pinned]);

  const close = useCallback(() => {
    clearTimer();
    setPinned(false);
    setOpen(false);
  }, [clearTimer]);

  // 打开时定位 + 跟随滚动/缩放
  useEffect(() => {
    if (!open) return;
    place();
    const t = window.setTimeout(place, 0); // 等浮层渲染出真实高度后再校一次
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  // Esc / 点空白关闭（仅钉住时需要，未钉住时本来就会自己消失）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (!pinned) return;
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || cardRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, pinned, close]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
        onClick={(e) => {
          // 点一下 = 钉住；再点 = 钉住解除并收起。也顺带解决触屏没有 hover 的问题
          e.stopPropagation();
          if (pinned) close();
          else {
            setPinned(true);
            setOpen(true);
          }
        }}
        className={`inline-flex cursor-help flex-wrap items-center gap-x-3 gap-y-0.5 rounded-sm border-b border-dashed border-muted-foreground/40 ${
          open ? "bg-accent/40" : ""
        }`}
        title="悬停看图解；点击钉住"
      >
        {children}
        <Info className="h-3 w-3 shrink-0 text-muted-foreground/70" />
      </span>

      {open &&
        pos &&
        createPortal(
          <div
            ref={cardRef}
            data-concept-hint="1"
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              maxHeight: pos.maxH,
              zIndex: 70,
              overflowY: "auto",
            }}
            className="rounded-xl border bg-popover p-3 text-[11px] text-popover-foreground shadow-xl"
          >
            <div className="mb-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-tight">{title}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setPinned((p) => !p)}
                title={pinned ? "取消钉住" : "钉住（鼠标移开也不消失）"}
                className={`shrink-0 rounded p-1 hover:bg-accent ${pinned ? "text-primary" : "text-muted-foreground"}`}
              >
                {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={close}
                title="关闭"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {content}
            <p className="mt-2 border-t pt-1.5 text-[10px] leading-snug text-muted-foreground">
              数值取本行实际参数，几何为示意画法。
              {pinned ? "已钉住 · Esc 或点空白处关闭。" : "点击可钉住。"}
            </p>
          </div>,
          document.body
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 图一：再订货点与补货时机                                            */
/* ------------------------------------------------------------------ */

const A_W = 560;
// 高度刻意压小：浮层要能塞进表格行下方的剩余空间，少 20px 就少一次「限高滚动条」
const A_H = 172;
const A_M = { left: 44, right: 64, top: 12, bottom: 24 };
const A_PLOT_W = A_W - A_M.left - A_M.right;
const A_PLOT_H = A_H - A_M.top - A_M.bottom;

function RopTimingDiagram({ plan }: { plan: InventoryPlan }) {
  const days = plan.days;
  const lt = Math.round(plan.lead_time_days);
  const rop = plan.rop;
  const ss = plan.ss;
  const replenish = plan.replenish_qty;

  // 事件定位：一律以 30 天矩阵为准，和页面上看到的完全同源
  const orderIdx = days.findIndex((c) => c.ending <= rop);
  const stockoutIdx = days.findIndex((c) => c.ending <= 0);
  const hasOrder = replenish !== null && orderIdx >= 0;
  const arriveIdx = hasOrder ? Math.min(orderIdx + lt, days.length - 1) : -1;

  if (days.length === 0) {
    return <p className="py-6 text-center text-muted-foreground">该行暂无可推算的日度序列。</p>;
  }

  const cols = Math.min(
    days.length,
    Math.max(8, (stockoutIdx >= 0 ? stockoutIdx : orderIdx >= 0 ? orderIdx : 0) + lt + 4, arriveIdx + 4)
  );
  const yMax = Math.max(plan.on_hand, rop, ss, replenish ?? 0, 1) * 1.12;
  const xAt = (i: number) => A_M.left + ((i + 0.5) * A_PLOT_W) / cols;
  const yAt = (v: number) => A_M.top + A_PLOT_H - (Math.min(Math.max(v, 0), yMax) / yMax) * A_PLOT_H;

  const curve = days
    .slice(0, cols)
    .map((c, i) => `${xAt(i).toFixed(1)},${yAt(c.ending).toFixed(1)}`)
    .join(" ");

  const arriveDate = arriveIdx >= 0 ? days[arriveIdx].date : null;
  const stockoutDate = stockoutIdx >= 0 ? days[stockoutIdx].date : null;
  const orderDate = hasOrder ? days[orderIdx].date : null;
  // 到货日 vs 耗尽日：来得及时就是「刚好赶上」，晚到就是在途缺货
  const gapDays =
    arriveIdx >= 0 && stockoutIdx >= 0 ? arriveIdx - stockoutIdx : null;
  const late = gapDays !== null && gapDays > 0;

  return (
    <div>
      <svg viewBox={`0 0 ${A_W} ${A_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* 安全库存带（0 ~ SS） */}
        {ss > 0 && yAt(0) - yAt(ss) > 1.5 && (
          <rect
            x={A_M.left}
            y={yAt(ss)}
            width={A_PLOT_W}
            height={yAt(0) - yAt(ss)}
            className="fill-amber-400/15"
          />
        )}

        {/* LT 等待期：下单 → 到货；来不及则标红 */}
        {hasOrder && arriveIdx > orderIdx && (
          <rect
            x={xAt(orderIdx)}
            y={A_M.top}
            width={Math.max(xAt(arriveIdx) - xAt(orderIdx), 1)}
            height={A_PLOT_H}
            className={late ? "fill-red-500/12" : "fill-primary/10"}
          />
        )}

        {/* 坐标轴 */}
        <line x1={A_M.left} y1={A_M.top} x2={A_M.left} y2={yAt(0)} className="stroke-border" strokeWidth={1} />
        <line x1={A_M.left} y1={yAt(0)} x2={A_M.left + A_PLOT_W} y2={yAt(0)} className="stroke-muted-foreground/50" strokeWidth={1} />
        <text x={A_M.left - 6} y={yAt(0)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[9px]">
          0
        </text>
        <text
          x={A_M.left - 6}
          y={yAt(plan.on_hand)}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-muted-foreground text-[9px]"
        >
          {num(plan.on_hand, 0)}
        </text>

        {/* ROP 线 */}
        <line
          x1={A_M.left}
          y1={yAt(rop)}
          x2={A_M.left + A_PLOT_W}
          y2={yAt(rop)}
          strokeDasharray="5 3"
          className="stroke-red-500"
          strokeWidth={1.4}
        />
        <text x={A_M.left + A_PLOT_W + 5} y={yAt(rop)} dominantBaseline="middle" className="fill-red-500 text-[9px] font-semibold">
          ROP {num(rop, 0)}
        </text>

        {/* SS 线 */}
        {ss > 0 && (
          <>
            <line
              x1={A_M.left}
              y1={yAt(ss)}
              x2={A_M.left + A_PLOT_W}
              y2={yAt(ss)}
              strokeDasharray="3 3"
              className="stroke-amber-500"
              strokeWidth={1.2}
            />
            <text
              x={A_M.left + A_PLOT_W + 5}
              y={yAt(ss)}
              dominantBaseline="middle"
              className="fill-amber-600 text-[9px] font-semibold dark:fill-amber-400"
            >
              SS {num(ss, 0)}
            </text>
          </>
        )}

        {/* 库存消耗曲线（真实 30 天序列） */}
        <polyline points={curve} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" />

        {/* ① 最晚下单日：跌破 ROP 那天 */}
        {hasOrder && (
          <>
            <line
              x1={xAt(orderIdx)}
              y1={yAt(days[orderIdx].ending)}
              x2={xAt(orderIdx)}
              y2={yAt(0)}
              strokeDasharray="2 2"
              className="stroke-red-500"
              strokeWidth={1}
            />
            <circle cx={xAt(orderIdx)} cy={yAt(days[orderIdx].ending)} r={4} className="fill-red-500 stroke-popover" strokeWidth={1.5} />
          </>
        )}

        {/* ② 到货：补一个周期量（向上台阶） */}
        {hasOrder && arriveIdx > orderIdx && (
          <>
            <line
              x1={xAt(arriveIdx)}
              y1={yAt(0)}
              x2={xAt(arriveIdx)}
              y2={yAt(replenish ?? 0)}
              strokeDasharray="3 2"
              className="stroke-blue-500"
              strokeWidth={1.4}
            />
            <polygon
              points={`${xAt(arriveIdx)},${yAt(replenish ?? 0) - 1} ${xAt(arriveIdx) - 3.5},${yAt(replenish ?? 0) + 5} ${
                xAt(arriveIdx) + 3.5
              },${yAt(replenish ?? 0) + 5}`}
              className="fill-blue-500"
            />
            <text
              x={Math.min(xAt(arriveIdx), A_M.left + A_PLOT_W - 34)}
              y={yAt(replenish ?? 0) - 8}
              textAnchor="middle"
              // 补货量 = ROP，所以箭头顶端几乎必然压在 ROP 虚线上，必须描一圈底色才读得清
              style={{ paintOrder: "stroke" }}
              strokeWidth={3}
              className="fill-blue-600 stroke-popover text-[9px] font-semibold dark:fill-blue-400"
            >
              +{num(replenish, 0)} 到货
            </text>
          </>
        )}

        {/* ③ 预计耗尽日 */}
        {stockoutIdx >= 0 && (
          <circle cx={xAt(stockoutIdx)} cy={yAt(0)} r={4} className="fill-red-700 stroke-popover" strokeWidth={1.5} />
        )}

        {/* x 轴日期：每 3 天一个刻度，避免拥挤 */}
        {days.slice(0, cols).map((c, i) =>
          i % 3 === 0 ? (
            <text
              key={c.date}
              x={xAt(i)}
              y={A_H - 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {md(c.date)}
            </text>
          ) : null
        )}
      </svg>

      {/* 事件清单 + 结论 */}
      <div className="mt-1.5 space-y-0.5 leading-snug">
        {hasOrder ? (
          <>
            <p className="flex items-start gap-1.5">
              <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
                1
              </span>
              <span>
                <b className="text-red-600 dark:text-red-400">最晚下单日 {orderDate ? md(orderDate) : "—"}</b>
                <span className="text-muted-foreground">
                  {" "}
                  —— 期末跌破 ROP（{num(rop, 0)}）那天
                  {plan.days_until_order !== null &&
                    (plan.days_until_order <= 0
                      ? `，已逾期 ${Math.abs(plan.days_until_order)} 天`
                      : `，距今 ${plan.days_until_order} 天`)}
                </span>
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold text-white">
                2
              </span>
              <span>
                <b className="text-blue-600 dark:text-blue-400">到货日 {arriveDate ? md(arriveDate) : "—"}</b>
                <span className="text-muted-foreground">
                  {" "}
                  —— 下单后要等 LT {lt} 天，这期间库存还在掉，所以不能等到见底再下单；一次补{" "}
                  {num(replenish, 0)}（一个周期量＝ROP）
                </span>
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-700 text-[8px] font-bold text-white">
                3
              </span>
              <span>
                <b className="text-red-700 dark:text-red-400">
                  预计耗尽 {stockoutDate ? md(stockoutDate) : "30 天内不会"}
                </b>
                <span className="text-muted-foreground"> —— 一直不补的话，库存掉到 0 那天</span>
              </span>
            </p>
            {gapDays !== null && (
              <p
                className={`mt-1 rounded-md px-2 py-1 font-medium ${
                  late
                    ? "bg-red-500/10 text-red-700 dark:text-red-400"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {late
                  ? `到货比耗尽晚 ${gapDays} 天 → 现在下单也来不及，要谈提前期或用替代供应。`
                  : gapDays === 0
                  ? "到货日正好等于耗尽日 → 刚好赶上，一天余量都没有，建议放宽服务水平或 LT。"
                  : `到货比耗尽早 ${Math.abs(gapDays)} 天 → 来得及，按这个日期下单即可。`}
              </p>
            )}
          </>
        ) : (
          <p className="rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
            30 天内期末库存始终高于 ROP（{num(rop, 0)}），暂时不需要下单。
          </p>
        )}
        <p className="pt-0.5 text-[10px] leading-snug text-muted-foreground">
          ROP 算的不是「该补多少」，而是「<b className="text-foreground">该在什么时候动手</b>
          」—— 它把 LT 交期和需求波动一起提前算进去，所以跌破 ROP 就该下单，而不是等库存见底。
        </p>
      </div>
    </div>
  );
}

/** 挂在建议条上的 ROP / 补货时机图解 */
export function RopTimingHint({ plan, children }: { plan: InventoryPlan; children: ReactNode }) {
  return (
    <ConceptHint
      title="再订货点（ROP）与补货时机"
      subtitle={`${plan.pn} · ${plan.material_name} · ${plan.base_name} —— LT ${Math.round(plan.lead_time_days)} 天，服务水平 Z=${plan.service_z}`}
      content={<RopTimingDiagram plan={plan} />}
    >
      {children}
    </ConceptHint>
  );
}

/* ------------------------------------------------------------------ */
/* 图二：COV → 安全天数 → 安全库存                                     */
/* ------------------------------------------------------------------ */

const B_W = 560;
const B_H = 104;
const B_M = { left: 30, right: 8, top: 14, bottom: 18 };

function HistoryBars({ plan }: { plan: InventoryPlan }) {
  const hist = plan.hist.slice(-12);
  const n = hist.length;
  const plotW = B_W - B_M.left - B_M.right;
  const plotH = B_H - B_M.top - B_M.bottom;
  const maxQ = Math.max(1, ...hist.map((h) => h.q));
  const mean = n ? hist.reduce((a, b) => a + b.q, 0) / n : 0;
  const yAt = (v: number) => B_M.top + plotH - (v / maxQ) * plotH;
  const slot = n ? plotW / n : plotW;
  const barW = Math.min(slot * 0.6, 30);

  return (
    <svg viewBox={`0 0 ${B_W} ${B_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <line x1={B_M.left} y1={yAt(0)} x2={B_M.left + plotW} y2={yAt(0)} className="stroke-muted-foreground/50" strokeWidth={1} />
      {hist.map((h, i) => {
        const cx = B_M.left + slot * (i + 0.5);
        const top = yAt(h.q);
        return (
          <g key={h.m}>
            <rect
              x={cx - barW / 2}
              y={top}
              width={barW}
              height={Math.max(yAt(0) - top, 0.5)}
              rx={2}
              className={h.q >= mean ? "fill-primary/70" : "fill-primary/35"}
            />
            {n <= 8 && (
              <text x={cx} y={top - 3} textAnchor="middle" className="fill-muted-foreground text-[8px]">
                {num(h.q, 0)}
              </text>
            )}
            <text x={cx} y={B_H - 6} textAnchor="middle" className="fill-muted-foreground text-[8px]">
              {Number(h.m.slice(5))}月
            </text>
          </g>
        );
      })}
      {/* 均值线：COV 就是「柱子离这条线有多散」 */}
      <line
        x1={B_M.left}
        y1={yAt(mean)}
        x2={B_M.left + plotW}
        y2={yAt(mean)}
        strokeDasharray="4 3"
        className="stroke-amber-500"
        strokeWidth={1.2}
      />
      {/* 标签靠右放，避免压住左边第一根柱子 */}
      <text
        x={B_M.left + plotW}
        y={yAt(mean) - 3}
        textAnchor="end"
        className="fill-amber-600 text-[8px] font-semibold dark:fill-amber-400"
      >
        均值 {num(mean, 0)}
      </text>
    </svg>
  );
}

function FormulaCell({
  label,
  value,
  note,
  tone = "muted",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "muted" | "primary" | "amber" | "result";
}) {
  const toneCls =
    tone === "result"
      ? "border-primary/40 bg-primary/10"
      : tone === "primary"
      ? "border-border bg-muted/40"
      : tone === "amber"
      ? "border-amber-400/50 bg-amber-400/10"
      : "border-border bg-muted/40";
  return (
    <div className={`min-w-[62px] flex-1 rounded-md border px-2 py-1.5 text-center ${toneCls}`}>
      <div className="text-[9px] leading-tight text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold leading-tight tabular-nums">{value}</div>
      {note && <div className="text-[9px] leading-tight text-muted-foreground">{note}</div>}
    </div>
  );
}

function Op({ children }: { children: ReactNode }) {
  return <span className="self-center px-0.5 text-xs font-semibold text-muted-foreground">{children}</span>;
}

function SafetyStockDiagram({ plan }: { plan: InventoryPlan }) {
  const covMeta = INV_COV_META[plan.cov_label] ?? INV_COV_META.na;
  const lt = plan.lead_time_days;
  const sqrtLt = Math.sqrt(Math.max(lt, 0));
  const derived = plan.safe_days_derived;

  return (
    <div className="space-y-2">
      {derived ? (
        <div>
          <p className="mb-0.5 text-[10px] text-muted-foreground">
            本行历史月度需求（{plan.hist.length} 个月）—— 柱子离均值线越散，COV 越大：
          </p>
          <HistoryBars plan={plan} />
        </div>
      ) : (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-400">
          {plan.hist.length < 2
            ? "历史需求不足 2 个月，COV 算不出来"
            : "历史需求均值 ≤ 0（全为 0 或负值），COV = 0 ÷ 0 无法测算"}
          —— 系统回退用兜底安全天数（{num(plan.safe_days, 1)} 天）。
          {plan.hist.length < 2 ? "补足 2 个月以上的历史需求后" : "补录真实的历史需求后"}
          ，这条链才会自动切回真实 COV。
        </p>
      )}

      {/* 公式流水线：拆成两条等式分别成行，靠 flex-wrap 硬挤会把「×」折到下一行、读不成式子 */}
      <div>
        <p className="mb-1 text-[10px] text-muted-foreground">安全天数怎么来的（本行数值）：</p>
        <div className="space-y-1">
          <div className="flex items-stretch gap-1">
            <span className="flex w-14 shrink-0 items-center justify-end text-[9px] text-muted-foreground">
              安全天数
            </span>
            <span className="self-center text-xs font-semibold text-muted-foreground">=</span>
            <FormulaCell label="服务水平 Z" value={num(plan.service_z)} note="95%" />
            <Op>×</Op>
            <FormulaCell
              label="需求波动 COV"
              value={plan.cov === null ? "—" : num(plan.cov)}
              note={plan.cov === null ? "不可算" : covMeta.label}
            />
            <Op>×</Op>
            <FormulaCell label="√LT" value={num(sqrtLt)} note={`LT ${num(lt, 0)} 天`} />
            <Op>=</Op>
            <FormulaCell
              label="安全天数"
              value={num(plan.safe_days)}
              note={derived ? "天" : "兜底值"}
              tone="result"
            />
          </div>
          <div className="flex items-stretch gap-1">
            <span className="flex w-14 shrink-0 items-center justify-end text-[9px] text-muted-foreground">
              安全库存
            </span>
            <span className="self-center text-xs font-semibold text-muted-foreground">=</span>
            <FormulaCell label="安全天数" value={num(plan.safe_days)} note="天" />
            <Op>×</Op>
            <FormulaCell label="日均需求" value={num(plan.avg_daily)} />
            <Op>=</Op>
            <FormulaCell label="安全库存 SS" value={num(plan.ss)} tone="result" />
          </div>
        </div>
      </div>

      {/* COV 三档色带 */}
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="text-muted-foreground">需求波动档位</span>
        {(
          [
            ["low", "低 < 0.35", "bg-emerald-500/15"],
            ["mid", "中 0.35–0.8", "bg-amber-500/15"],
            ["high", "高 ≥ 0.8", "bg-red-500/15"],
          ] as const
        ).map(([k, label, cls]) => (
          <span
            key={k}
            className={`rounded px-1.5 py-px ${
              plan.cov_label === k ? `${cls} font-semibold text-foreground ring-1 ring-current/30` : "bg-muted text-muted-foreground"
            }`}
          >
            {label}
          </span>
        ))}
        {plan.cov_label === "na" && (
          <span className="rounded bg-muted px-1.5 py-px text-muted-foreground">
            当前：{plan.hist.length < 2 ? "历史样本不足" : "需求均值 ≤ 0，不可算"}
          </span>
        )}
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        <b className="text-foreground">需求越不稳（COV↑）、交期越长（LT↑）、服务水平越高（Z↑），安全天数越多</b>
        ，要压在看板上的 SS 就越高。SS 是「不让你断货的缓冲垫」，不是多余库存。
        {plan.demand_source === INV_SOURCE.master
          ? "本行需求来自底表联动（客户需求 × BOM），底表一改这里跟着重算。"
          : "本行需求来自档案自带的历史/预测快照。"}
      </p>
    </div>
  );
}

/** 挂在口径条（SS / 安全天数 / COV）上的图解 */
export function SafetyStockHint({ plan, children }: { plan: InventoryPlan; children: ReactNode }) {
  return (
    <ConceptHint
      title="安全天数与安全库存（SS）是怎么算出来的"
      subtitle={`${plan.pn} · ${plan.material_name} —— COV 衡量客户需求稳不稳，直接决定要留多少缓冲`}
      content={<SafetyStockDiagram plan={plan} />}
    >
      {children}
    </ConceptHint>
  );
}

/* ------------------------------------------------------------------ */
/* 图三：产能校验 —— 这笔补货量，分给本项目的额度排得下吗               */
/* ------------------------------------------------------------------ */

/** 阈值，与后端 INV_CAPACITY_TIGHT_RATIO / INV_CAPACITY_FULL_RATIO 保持一致 */
const CAP_TIGHT = 0.7;
const CAP_FULL = 1.0;
/** 阈值尺右端留出「超额度」的空间，120% 以上顶格显示 */
const CAP_SCALE = 1.2;

/** 一条横向标尺行：三条用同一个比例尺，才能横向比长短 */
function CapBar({
  label,
  ratio,
  value,
  tone,
  note,
}: {
  label: string;
  ratio: number;
  value: string;
  tone: string;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[96px] shrink-0 truncate text-[10px] text-muted-foreground" title={label}>
        {label}
      </span>
      <span className="h-3 w-[232px] shrink-0 overflow-hidden rounded-sm bg-muted/60">
        <span
          className={`block h-full ${tone}`}
          style={{ width: `${Math.max(0, Math.min(ratio, 1)) * 100}%` }}
        />
      </span>
      <span className="min-w-0 flex-1 truncate tabular-nums">{value}</span>
      {note && <span className="shrink-0 text-[10px] text-muted-foreground/70">{note}</span>}
    </div>
  );
}

/** 阈值尺：0 ~ 120%，绿/琥珀/红三段 + 当前位置指针 */
function CapRuler({ usage }: { usage: number | null }) {
  const W = 556;
  const plotW = W - 20;
  const x = (ratio: number) => 10 + Math.max(0, Math.min(ratio / CAP_SCALE, 1)) * plotW;
  const x70 = x(CAP_TIGHT);
  const x100 = x(CAP_FULL);
  const xNow = usage == null ? null : x(usage);
  const y = 14;

  return (
    <svg width={W} height={40} viewBox={`0 0 ${W} 40`} className="block">
      <rect x={10} y={y} width={x70 - 10} height={9} className="fill-emerald-500/25" />
      <rect x={x70} y={y} width={x100 - x70} height={9} className="fill-amber-500/30" />
      <rect x={x100} y={y} width={10 + plotW - x100} height={9} className="fill-red-500/30" />
      <rect x={10} y={y} width={plotW} height={9} fill="none" className="stroke-border" strokeWidth={1} />

      {/* 阈值刻度 */}
      <line x1={x70} y1={y} x2={x70} y2={y + 14} className="stroke-amber-600" strokeWidth={1} />
      <line x1={x100} y1={y} x2={x100} y2={y + 14} className="stroke-red-600" strokeWidth={1} />
      <text x={x70} y={y + 25} textAnchor="middle" className="fill-amber-600 text-[9px] font-semibold dark:fill-amber-400">
        70%
      </text>
      <text x={x100} y={y + 25} textAnchor="middle" className="fill-red-600 text-[9px] font-semibold dark:fill-red-400">
        100%
      </text>
      <text x={10} y={y + 25} className="fill-muted-foreground text-[9px]">
        0
      </text>

      {/* 当前占用指针。超出标尺右端（>120%）时贴右边并把真实百分比写全，不要截成 ">999%" */}
      {xNow != null && usage != null && (
        <>
          <line x1={xNow} y1={y - 5} x2={xNow} y2={y + 9} className="stroke-foreground" strokeWidth={2} />
          <text
            x={usage > CAP_SCALE ? W - 10 : Math.min(Math.max(xNow, 28), W - 28)}
            y={y - 7}
            textAnchor={usage > CAP_SCALE ? "end" : "middle"}
            className="fill-foreground text-[9px] font-bold"
            style={{ paintOrder: "stroke" }}
            stroke="var(--background, #fff)"
            strokeWidth={3}
          >
            当前 {Math.round(usage * 100)}%{usage > CAP_SCALE ? " · 超出标尺" : ""}
          </text>
        </>
      )}

      {/* 三段的含义 */}
      <text x={10 + (x70 - 10) / 2} y={y + 36} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        充足
      </text>
      <text x={(x70 + x100) / 2} y={y + 36} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        紧张
      </text>
      <text x={Math.min((x100 + 10 + plotW) / 2, W - 20)} y={y + 36} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        不足
      </text>
    </svg>
  );
}

function CapacityDiagram({ plan }: { plan: InventoryPlan }) {
  const qty = plan.replenish_qty; // 分子：本次建议补货量（= 一个周期量 = ROP）
  const limit = plan.capacity_limit; // 分母：本项目在该供应商上的当月分配额度
  const used = plan.capacity_used; // 供应商总产能（集团盘子），仅作参照
  const usage = plan.capacity_usage;
  const meta = INV_CAPACITY_META[plan.capacity_status] ?? INV_CAPACITY_META.na;

  const scaleMax = Math.max(limit ?? 0, used ?? 0, qty ?? 0, 1);
  const r = (v: number | null | undefined) => (v == null ? 0 : Math.max(0, v) / scaleMax);

  const noNeed = qty == null; // 30 天内不跌破 ROP，本次不补
  const noLimit = !noNeed && limit == null; // 额度未录入 → 不判，不误报充足
  const zeroLimit = !noNeed && limit != null && limit <= 0; // 当月没额度 → 一律不足

  /** 一个周期 = LT + 安全天数；每月补货次数 ≈ 30 / 周期 */
  const cycleDays = Math.max(plan.lead_time_days + plan.safe_days, 0.1);
  const cyclesPerMonth = 30 / cycleDays;
  const monthlyCum = qty != null ? qty * cyclesPerMonth : null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">
        三条用同一个比例尺，谁长谁短一眼可见：
      </p>

      <div className="space-y-1.5">
        <CapBar
          label="供应商总产能"
          ratio={r(used)}
          value={used == null ? "未录入" : `${num(used, 0)} / 月`}
          tone="bg-slate-400/70 dark:bg-slate-500/70"
          note="集团盘子，仅参照"
        />
        <CapBar
          label="分给本项目"
          ratio={r(limit)}
          value={limit == null ? "未录入" : `${num(limit, 0)} / 月`}
          tone="bg-sky-500/70"
          note="← 校验分母"
        />
        <CapBar
          label="本次补货量"
          ratio={r(qty)}
          value={qty == null ? "无需补货" : num(qty, 0)}
          tone={meta.bar}
          note="← 校验分子"
        />
      </div>

      {!noNeed && !noLimit && (
        <div className="pt-0.5">
          <CapRuler usage={usage} />
        </div>
      )}

      {/* 结论：直接回答「排得下吗」 */}
      {noNeed ? (
        <p className="rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
          本行 30 天内期末库存不低于 ROP，本次没有补货需求，因此不涉及产能占用。
        </p>
      ) : noLimit ? (
        <p className="rounded-md bg-slate-500/10 px-2 py-1 font-medium text-slate-700 dark:text-slate-300">
          该供应商在「供需管理 → 物料明细」里<strong>没有录入分配给我方的月产能</strong>
          ，分母缺失 → 这一格判「未录额度」，<strong>不会当成产能充足</strong>。录入后即可自动校验。
        </p>
      ) : zeroLimit ? (
        <p className="rounded-md bg-red-500/10 px-2 py-1 font-medium text-red-700 dark:text-red-400">
          当月分配额度为 0：本月这家供应商<strong>没给我们留量</strong>，任何补货量都超额度 → 判「产能不足」。
        </p>
      ) : (
        <p
          className={`rounded-md px-2 py-1 font-medium ${
            plan.capacity_status === "short"
              ? "bg-red-500/10 text-red-700 dark:text-red-400"
              : plan.capacity_status === "tight"
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {meta.label}：本次补货 <b>{num(qty, 0)}</b> ÷ 本项目当月额度 <b>{num(limit, 0)}</b> ={" "}
          <b>{Math.round((usage ?? 0) * 100)}%</b>
          {plan.capacity_status === "short"
            ? " → 超过 100%，本月排不下这么多，需与供应商追加额度或改分批提货。"
            : plan.capacity_status === "tight"
              ? " → 落在 70%~100%，额度快用满了，建议提前锁定产能。"
              : " → 低于 70%，额度充裕。"}
        </p>
      )}

      {/* 口径与坑 */}
      <ul className="space-y-0.5 border-t pt-1.5 text-[10px] leading-snug text-muted-foreground">
        <li>
          · <b className="text-foreground">分子</b> = 本次建议补货量（一个周期量，= ROP）；
          <b className="text-foreground">分母</b> = 本项目在这家供应商上的<strong>当月分配额度</strong>
          （供需管理 → 物料明细录入），<b className="text-foreground">不是</b>供应商的集团总产能。
        </li>
        <li>
          · 分档：低于 70% 充足 · 70%~100% 紧张 · 超过 100% 不足 · 额度未录入则不判。
          <b className="text-foreground">只预警、不拦截</b>，超了也不会挡住建档或下单。
        </li>
        {!noNeed && !limit && (
          <li>· 供应商总产能（集团盘子）目前没有录入入口，所以看不到「我方占了集团多少」。</li>
        )}
        {limit != null && used != null && limit > used && (
          <li className="text-amber-600 dark:text-amber-400">
            · ⚠ 本项目额度（{num(limit, 0)}）已超过该供应商总产能（{num(used, 0)}）
            —— 各项目额度合计可能超分，需要和供应商再确认。
          </li>
        )}
        {!noNeed && !noLimit && monthlyCum != null && (
          <li>
            · <b className="text-foreground">口径提醒</b>：补货量只覆盖一个采购周期
            （LT {num(plan.lead_time_days, 0)} 天 + 安全 {num(plan.safe_days, 1)} 天 ≈{" "}
            {num(cycleDays, 0)} 天），而额度是<b className="text-foreground">月度</b>的。若维持每{" "}
            {num(cycleDays, 0)} 天补一次，全月累计补货 ≈ <b className="text-foreground">{num(monthlyCum, 0)}</b>
            ，用这个数对照月额度更贴近真实月度占用。
          </li>
        )}
      </ul>
    </div>
  );
}

/** 挂在建议条「产能校验」上的图解 */
export function CapacityHint({ plan, children }: { plan: InventoryPlan; children: ReactNode }) {
  return (
    <ConceptHint
      title="产能校验：这笔补货量排得下吗"
      subtitle={`${plan.pn} · ${plan.material_name} · ${plan.supplier_name} —— 额度是「分给本项目的月产能」，不是集团总产能`}
      content={<CapacityDiagram plan={plan} />}
    >
      {children}
    </ConceptHint>
  );
}

