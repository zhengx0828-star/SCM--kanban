import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LineChart, ShieldAlert } from "lucide-react";
import { DemandLineChart, type DemandProjectSeries } from "@/components/charts/DemandLineChart";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHART_PALETTE } from "@/lib/chart-palette";
import { riskStatusOf, supplyCoefOf, type RiskStatus } from "@/lib/supply-risk";
import { cn } from "@/lib/utils";
import type { DemandVersion } from "@/types/project";

/**
 * 版本对比弹窗（方案 §6.4 落点 ⑤）。
 *
 * ★ 为什么用弹窗而不是新增卡片：「对比」是偶尔看的动作，不该常驻占版面；
 *   项目详情页本来就有物料详情 / 快速新增 / Excel 导入三个 dialog，
 *   再加一个完全符合页面既有模式，**页面本体一行都不用改**。
 *
 * 三块内容：
 *   1. 折线：**当前版实线 + 对比版虚线**（虚线不带点，参照物不抢眼）
 *   2. 转置差异表：列为 `1月…12月 | 年合计`，行为 `对比版 / 当前版 / Δ / Δ%`
 *   3. 风险迁移：产能与 BOM 恒定 ⇒ 系数只跟需求走，只列发生变化的「物料×月」
 *
 * 口径见 `docs/demand-versioning/01-方案定稿.md` §4。
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

/** 对比版线条颜色：刻意用灰，与当前版的主色拉开，且不占用语义色（红=缺口 / 绿=正常） */
const BASELINE_COLOR = "#94a3b8";

const STATUS_TEXT: Record<RiskStatus, string> = {
  shortage: "缺口",
  tight: "紧张",
  surplus: "充足",
  none: "无需求",
};

const STATUS_CLS: Record<RiskStatus, string> = {
  shortage: "bg-[#f09595] text-[#501313] dark:bg-[#7a2f2f] dark:text-[#f7c1c1]",
  tight: "bg-[#fac775] text-[#412402] dark:bg-[#7a5518] dark:text-[#fac775]",
  surplus: "bg-[#c0dd97] text-[#27500a] dark:bg-[#425c1e] dark:text-[#c0dd97]",
  none: "bg-muted text-muted-foreground",
};

/** 越靠前越严重，用于排序与「变差」判定 */
const RANK: Record<RiskStatus, number> = { shortage: 0, tight: 1, surplus: 2, none: 3 };

interface CompareMaterial {
  pn: string;
  name: string;
  /** BOM 用量系数（项目×物料）；为 null 表示未设，跳过该物料的计算 */
  bom: number | null;
  /** 该物料全部供应商的月度产能合计（长度 12） */
  capacity: number[];
}

interface DemandCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: DemandVersion[];
  current: DemandVersion | null;
  materials: CompareMaterial[];
  /** 打开时默认选中的对比基准 seq（一般是「当前版的上一版」） */
  initialBaselineSeq?: number | null;
}

const total = (arr: number[] | null | undefined) => (arr ?? []).reduce((a, b) => a + b, 0);
const fmt = (n: number) => Math.round(n).toLocaleString("zh-CN");
const sign = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;

export function DemandCompareDialog({
  open,
  onOpenChange,
  versions,
  current,
  materials,
  initialBaselineSeq,
}: DemandCompareDialogProps) {
  const ordered = useMemo(() => [...versions].sort((a, b) => b.seq - a.seq), [versions]);

  /** 可选的对比基准：排除当前版 */
  const candidates = useMemo(() => ordered.filter((v) => v.seq !== current?.seq), [ordered, current]);

  const [baselineSeq, setBaselineSeq] = useState<number | null>(null);

  /* 每次打开重置基准：优先用调用方给的（当前版的上一版），否则取最新的其它版本 */
  useEffect(() => {
    if (!open) return;
    const fallback = candidates[0]?.seq ?? null;
    const preferred =
      initialBaselineSeq != null && candidates.some((v) => v.seq === initialBaselineSeq)
        ? initialBaselineSeq
        : fallback;
    setBaselineSeq(preferred);
  }, [open, initialBaselineSeq, candidates]);

  const baseline = useMemo(
    () => candidates.find((v) => v.seq === baselineSeq) ?? candidates[0] ?? null,
    [candidates, baselineSeq]
  );

  /* ---------- 折线：当前版实线 + 对比版虚线 ---------- */
  const series: DemandProjectSeries[] = useMemo(() => {
    if (!current || !baseline) return [];
    return [
      {
        projectId: -1,
        code: `V${baseline.version_no}`,
        name: baseline.label ?? "对比版",
        color: BASELINE_COLOR,
        demand: baseline.demand,
        visible: true,
        dash: true,
      },
      {
        projectId: -2,
        code: `V${current.version_no}`,
        name: current.label ?? "当前版",
        color: CHART_PALETTE[0],
        demand: current.demand,
        visible: true,
      },
    ];
  }, [current, baseline]);

  /* ---------- 逐月差异 ---------- */
  const monthly = useMemo(() => {
    const oldArr = baseline?.demand ?? Array(12).fill(0);
    const newArr = current?.demand ?? Array(12).fill(0);
    return Array.from({ length: 12 }, (_, i) => {
      const o = oldArr[i] ?? 0;
      const n = newArr[i] ?? 0;
      const d = n - o;
      return { o, n, d, pct: o ? (d / o) * 100 : null };
    });
  }, [baseline, current]);

  const totOld = total(baseline?.demand);
  const totNew = total(current?.demand);
  const totDelta = totNew - totOld;
  const totPct = totOld ? (totDelta / totOld) * 100 : null;

  /* ---------- 风险迁移：产能与 BOM 恒定，系数只跟需求走 ---------- */
  const riskRows = useMemo(() => {
    if (!current || !baseline) return [];
    const rows: Array<{
      pn: string;
      name: string;
      month: number;
      dOld: number;
      dNew: number;
      cap: number;
      cOld: number | null;
      cNew: number | null;
      sOld: RiskStatus;
      sNew: RiskStatus;
      worse: boolean;
    }> = [];
    for (const m of materials) {
      const bom = m.bom;
      if (bom == null || bom === 0) continue;
      for (let i = 0; i < 12; i++) {
        const dOld = (baseline.demand?.[i] ?? 0) * bom;
        const dNew = (current.demand?.[i] ?? 0) * bom;
        const cap = m.capacity[i] ?? 0;
        const sOld = riskStatusOf(dOld, cap);
        const sNew = riskStatusOf(dNew, cap);
        if (sOld === sNew) continue;
        rows.push({
          pn: m.pn,
          name: m.name,
          month: i,
          dOld,
          dNew,
          cap,
          cOld: supplyCoefOf(dOld, cap),
          cNew: supplyCoefOf(dNew, cap),
          sOld,
          sNew,
          worse: RANK[sNew] < RANK[sOld],
        });
      }
    }
    rows.sort((a, b) => {
      if (a.worse !== b.worse) return a.worse ? -1 : 1;
      if (RANK[a.sNew] !== RANK[b.sNew]) return RANK[a.sNew] - RANK[b.sNew];
      if (a.month !== b.month) return a.month - b.month;
      return a.pn < b.pn ? -1 : 1;
    });
    return rows;
  }, [materials, current, baseline]);

  const toShortage = riskRows.filter((r) => r.sNew === "shortage" && r.sOld !== "shortage").length;
  const worsened = riskRows.filter((r) => r.worse).length;
  const cellCount = materials.filter((m) => m.bom != null && m.bom !== 0).length * 12;

  const noBom = materials.length > 0 && cellCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            版本对比
            {current && baseline && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                V{baseline.version_no} → V{current.version_no}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            产能与 BOM 系数恒定，因此版本之间的差异
            <span className="font-medium text-foreground">只来自客户需求</span>
            ；供应系数（= 产能 ÷ 需求）随之变化。
          </DialogDescription>
        </DialogHeader>

        {!current || candidates.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            本项目还没有可对比的历史版本。录入并保存一次即会产生第二个版本。
          </p>
        ) : (
          <div className="space-y-6">
            {/* 对比基准 */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[260px] space-y-1.5">
                <Label htmlFor="compare-baseline">对比基准</Label>
                <Select
                  value={baseline ? String(baseline.seq) : undefined}
                  onValueChange={(v) => setBaselineSeq(Number(v))}
                >
                  <SelectTrigger id="compare-baseline" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((v) => (
                      <SelectItem key={v.id} value={String(v.seq)}>
                        V{v.version_no}
                        {v.label ? ` · ${v.label}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4 pb-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-0 w-6 border-t-2 border-dashed border-[#94a3b8]" />
                  V{baseline.version_no}（对比版）
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-0 w-6 border-t-2" style={{ borderColor: CHART_PALETTE[0] }} />
                  V{current.version_no}（当前版）
                </span>
              </div>
            </div>

            {/* 折线 */}
            <div className="h-[240px] w-full rounded-md border bg-background p-2">
              <DemandLineChart series={series} />
            </div>

            {/* 转置差异表：列 = 1-12 月 + 年合计，行 = 指标 */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead>
                  <tr className="bg-muted">
                    <th className="border-b px-3 py-2 text-left font-normal text-muted-foreground">指标</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="border-b px-2 py-2 text-right font-normal text-muted-foreground">
                        {m}
                      </th>
                    ))}
                    <th className="border-b px-3 py-2 text-right font-normal text-muted-foreground">年合计</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-b px-3 py-2 text-muted-foreground">V{baseline.version_no}（对比版）</td>
                    {monthly.map((c, i) => (
                      <td key={i} className="border-b px-2 py-2 text-right tabular-nums">
                        {fmt(c.o)}
                      </td>
                    ))}
                    <td className="border-b px-3 py-2 text-right tabular-nums">{fmt(totOld)}</td>
                  </tr>
                  <tr>
                    <td className="border-b px-3 py-2 font-medium">V{current.version_no}（当前版）</td>
                    {monthly.map((c, i) => (
                      <td key={i} className="border-b px-2 py-2 text-right tabular-nums">
                        {fmt(c.n)}
                      </td>
                    ))}
                    <td className="border-b px-3 py-2 text-right tabular-nums">{fmt(totNew)}</td>
                  </tr>
                  <tr>
                    <td className="border-b px-3 py-2 text-muted-foreground">Δ</td>
                    {monthly.map((c, i) => (
                      <td
                        key={i}
                        className={cn(
                          "border-b px-2 py-2 text-right tabular-nums",
                          c.d > 0 ? "text-red-600 dark:text-red-400" : c.d < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        )}
                      >
                        {c.d === 0 ? "—" : sign(c.d)}
                      </td>
                    ))}
                    <td
                      className={cn(
                        "border-b px-3 py-2 text-right font-medium tabular-nums",
                        totDelta > 0 ? "text-red-600 dark:text-red-400" : totDelta < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      )}
                    >
                      {totDelta === 0 ? "—" : sign(totDelta)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border-b px-3 py-2 text-muted-foreground">Δ%</td>
                    {monthly.map((c, i) => (
                      <td
                        key={i}
                        className={cn(
                          "border-b px-2 py-2 text-right tabular-nums",
                          c.d > 0 ? "text-red-600 dark:text-red-400" : c.d < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        )}
                      >
                        {c.d === 0 ? "—" : c.pct == null ? "新增" : `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)}%`}
                      </td>
                    ))}
                    <td
                      className={cn(
                        "border-b px-3 py-2 text-right font-medium tabular-nums",
                        totDelta > 0 ? "text-red-600 dark:text-red-400" : totDelta < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      )}
                    >
                      {totDelta === 0 ? "—" : totPct == null ? "新增" : `${totPct > 0 ? "+" : ""}${totPct.toFixed(1)}%`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <LineChart className="h-3.5 w-3.5" />
              口径：Δ = 新 − 旧；Δ% = Δ ÷ 旧（旧为 0 时显示「新增」）。直接看正负号：正=红、负=绿。
            </p>

            {/* 风险迁移 */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  风险迁移
                </span>
                <Badge variant="secondary" className={toShortage > 0 ? STATUS_CLS.shortage : STATUS_CLS.surplus}>
                  新增缺口格 {toShortage}
                </Badge>
                <Badge variant="secondary" className={worsened > 0 ? STATUS_CLS.tight : STATUS_CLS.surplus}>
                  风险发生变化 {worsened}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  共 {cellCount} 格（{materials.length} 物料 × 12 月）· 产能与 BOM 变化 0
                </span>
              </div>

              {noBom ? (
                <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
                  项目下物料都还没设 BOM 系数，无法折算物料需求 → 风险迁移为空。
                </p>
              ) : riskRows.length === 0 ? (
                <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
                  两版之间没有风险状态变化。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted">
                        <th className="border-b px-3 py-2 text-left font-normal text-muted-foreground">物料</th>
                        <th className="border-b px-2 py-2 text-right font-normal text-muted-foreground">月份</th>
                        <th className="border-b px-3 py-2 text-right font-normal text-muted-foreground">需求 旧→新</th>
                        <th className="border-b px-3 py-2 text-right font-normal text-muted-foreground">产能</th>
                        <th className="border-b px-3 py-2 text-right font-normal text-muted-foreground">系数 旧→新</th>
                        <th className="border-b px-3 py-2 text-right font-normal text-muted-foreground">风险迁移</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskRows.map((r) => (
                        <tr key={`${r.pn}-${r.month}`} className={cn(r.worse && "bg-red-500/5")}>
                          <td className={cn("border-b px-3 py-2", r.worse && "shadow-[inset_3px_0_0_#ef4444]")}>
                            <span className="font-mono">{r.pn}</span>
                            <span className="ml-2 text-muted-foreground">{r.name}</span>
                          </td>
                          <td className="border-b px-2 py-2 text-right">{MONTHS[r.month]}</td>
                          <td className="border-b px-3 py-2 text-right tabular-nums">
                            {fmt(r.dOld)}
                            <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">{fmt(r.dNew)}</span>
                          </td>
                          <td className="border-b px-3 py-2 text-right tabular-nums">{fmt(r.cap)}</td>
                          <td className="border-b px-3 py-2 text-right tabular-nums">
                            {r.cOld == null ? "—" : r.cOld.toFixed(2)}
                            <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">{r.cNew == null ? "—" : r.cNew.toFixed(2)}</span>
                          </td>
                          <td className="border-b px-3 py-2 text-right">
                            <span className={cn("rounded px-1.5 py-0.5", STATUS_CLS[r.sOld])}>{STATUS_TEXT[r.sOld]}</span>
                            <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                            <span className={cn("rounded px-1.5 py-0.5", STATUS_CLS[r.sNew])}>{STATUS_TEXT[r.sNew]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                物料需求 = 客户需求 × BOM；供应系数 = 产能 ÷ 需求。产能与 BOM 恒定 ⇒ 系数只跟需求走。红底行 = 风险变差。
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
