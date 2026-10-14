import { cn } from "@/lib/utils";
import type { MaterialRisk, RiskStatus } from "@/lib/supply-risk";

/**
 * 供应系数热力图（行 = 物料 · 列 = 1-12 月）。
 *
 * 口径（2026-10-14 与用户确认）：
 *   · 格子里显示的就是 **供应系数 = 产能 ÷ 需求**（如 0.85 / 1.35）
 *   · 配色三档 + 无数据：<1.0 缺口(红) / 1.0-1.3 紧张(黄) / >1.3 充足(绿) / 需求 0(灰)
 *   · 红色特意用浅红、与琥珀相邻，避免"缺口→紧张"颜色跳变过大
 *
 * 版式要点：**格子固定尺寸**（34×34），用 grid 显式声明列宽 ——
 * 之前用 `<table>` 的自适应布局，10/11/12 月因两位表头被撑宽，导致格子大小不一。
 */

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

/** 格内配色（浅色 / 暗色两套；与用户确认的色值一致） */
const COEF_CELL_CLS: Record<RiskStatus, string> = {
  shortage: "bg-[#f09595] text-[#501313] dark:bg-[#7a2f2f] dark:text-[#f7c1c1]",
  tight: "bg-[#fac775] text-[#412402] dark:bg-[#7a5518] dark:text-[#fac775]",
  surplus: "bg-[#c0dd97] text-[#27500a] dark:bg-[#425c1e] dark:text-[#c0dd97]",
  none: "bg-muted text-muted-foreground",
};

const LEGEND: { status: RiskStatus; label: string }[] = [
  { status: "shortage", label: "缺口 < 1.0" },
  { status: "tight", label: "紧张 1.0 - 1.3" },
  { status: "surplus", label: "充足 > 1.3" },
  { status: "none", label: "无需求" },
];

export function SupplyCoefHeatmap({
  materials,
  className,
}: {
  materials: MaterialRisk[];
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div>
          <h3 className="text-xs font-medium">供应系数热力（行 = 物料 · 列 = 月份）</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            格内数值 = 产能 ÷ 需求；0.85 表示只够需求的 85%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {LEGEND.map((it) => (
            <span key={it.status} className="inline-flex items-center gap-1.5">
              <span className={cn("h-3 w-3 rounded-[2px]", COEF_CELL_CLS[it.status])} />
              {it.label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto p-4">
        <div
          className="grid w-max items-center gap-[3px]"
          style={{ gridTemplateColumns: "200px repeat(12, 34px)" }}
        >
          {/* 表头 */}
          <div className="text-[11px] text-muted-foreground">物料</div>
          {MONTHS.map((t) => (
            <div key={t} className="text-center text-[11px] tabular-nums text-muted-foreground">
              {t + 1}
            </div>
          ))}

          {/* 行 */}
          {materials.map((m) => (
            <Row key={m.pn} material={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ material }: { material: MaterialRisk }) {
  return (
    <>
      <div className="min-w-0 pr-2" title={`${material.pn} · ${material.name}`}>
        <div className="truncate font-mono text-[11px] leading-tight">{material.pn}</div>
        <div className="truncate text-[11px] leading-tight text-muted-foreground">{material.name}</div>
      </div>
      {material.monthly.map((x, t) => (
        <div
          key={t}
          title={
            `${t + 1} 月 · ${material.pn}\n` +
            `需求 ${x.demand.toLocaleString()} · 产能 ${x.capacity.toLocaleString()}\n` +
            (x.coef == null
              ? "该月没有需求，算不出供应系数"
              : `供应系数 ${x.coef.toFixed(2)}\n` +
                (x.diff < 0
                  ? `缺口 ${(-x.diff).toLocaleString()}`
                  : `盈余 ${x.diff.toLocaleString()}`))
          }
          className={cn(
            "flex h-[34px] items-center justify-center rounded-[3px] font-mono text-[11px] tabular-nums",
            COEF_CELL_CLS[x.status]
          )}
        >
          {x.coef == null ? "—" : x.coef.toFixed(2)}
        </div>
      ))}
    </>
  );
}
