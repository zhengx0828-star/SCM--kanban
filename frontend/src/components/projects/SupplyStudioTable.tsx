import { AlertCircle, CheckCircle2, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Supply Studio：物料供需平衡表（按月）。
 * - 每行：月份（含年合计行）= 客户需求 × BOM = 物料需求合计 × Σ 供应商产能 × 差额 = 状态
 * - 状态：
 *   · 盈余（产能 > 需求）：绿色 ✓
 *   · 紧张（|差额| <= 5% 需求）：黄色 ≈
 *   · 缺口（产能 < 需求）：红色 ⚠
 *
 * 数据来源：在父组件聚合（按月 + 物料维度求和）。
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

export interface SupplyStudioRow {
  monthIndex: number; // 0..11；-1 表示年合计
  /** 该月的客户需求合计（来自选中项目 × demand[m]） */
  customerDemand: number;
  /** 该月的物料需求合计（Σ demand × bom） */
  materialDemand: number;
  /** 该月的供应商产能合计（Σ capacity） */
  supplierCapacity: number;
}

interface SupplyStudioTableProps {
  rows: SupplyStudioRow[];
  /** 渲染模式：表格（默认）；表格会再多 1 行年合计 */
  className?: string;
}

/** 状态判定 */
function statusOf(demand: number, capacity: number): {
  kind: "surplus" | "tight" | "shortage" | "none";
  icon: React.ReactNode;
  text: string;
  cls: string;
} {
  if (demand === 0 && capacity === 0) {
    return {
      kind: "none",
      icon: <Minus className="h-3.5 w-3.5" />,
      text: "—",
      cls: "text-muted-foreground/60",
    };
  }
  if (capacity >= demand) {
    // 盈余
    return {
      kind: "surplus",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      text: capacity > demand ? "盈余" : "刚好",
      cls: "text-emerald-600 dark:text-emerald-400",
    };
  }
  // 缺口：需求量大于供给
  return {
    kind: "shortage",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    text: `缺口 ${(demand - capacity).toLocaleString()}`,
    cls: "text-rose-600 dark:text-rose-400",
  };
}

export function SupplyStudioTable({ rows, className }: SupplyStudioTableProps) {
  // 计算年合计
  const yearly: SupplyStudioRow = {
    monthIndex: -1,
    customerDemand: rows.reduce((a, r) => a + r.customerDemand, 0),
    materialDemand: rows.reduce((a, r) => a + r.materialDemand, 0),
    supplierCapacity: rows.reduce((a, r) => a + r.supplierCapacity, 0),
  };

  return (
    <Card className={className}>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
          <div>
            <h3 className="text-sm font-medium">Supply Studio · 供需平衡（按月汇总）</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              物料需求（客户需求 × BOM）vs. 供应商产能合计；按月呈现盈余 / 紧张 / 缺口
            </p>
          </div>
          <Legend />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="min-w-[80px] px-3 py-2 text-left">月份</th>
                <th className="px-3 py-2 text-right tabular-nums">客户需求</th>
                <th className="px-3 py-2 text-right tabular-nums">物料需求</th>
                <th className="px-3 py-2 text-right tabular-nums">供应商产能</th>
                <th className="px-3 py-2 text-right tabular-nums">差额</th>
                <th className="px-3 py-2 text-left">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.supplierCapacity - r.materialDemand;
                const s = statusOf(r.materialDemand, r.supplierCapacity);
                return (
                  <tr key={r.monthIndex} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 text-muted-foreground">{MONTHS[r.monthIndex]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.customerDemand ? r.customerDemand.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.materialDemand ? r.materialDemand.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.supplierCapacity ? r.supplierCapacity.toLocaleString() : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        diff > 0 && "text-emerald-600 dark:text-emerald-400",
                        diff < 0 && "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${diff.toLocaleString()}`}
                    </td>
                    <td className={cn("px-3 py-2 text-xs", s.cls)}>
                      <span className="inline-flex items-center gap-1">{s.icon}{s.text}</span>
                    </td>
                  </tr>
                );
              })}
              {/* 年合计行 */}
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="px-3 py-2">年合计</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {yearly.customerDemand.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {yearly.materialDemand.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {yearly.supplierCapacity.toLocaleString()}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    yearly.supplierCapacity - yearly.materialDemand > 0 &&
                      "text-emerald-600 dark:text-emerald-400",
                    yearly.supplierCapacity - yearly.materialDemand < 0 &&
                      "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {yearly.supplierCapacity - yearly.materialDemand === 0
                    ? "—"
                    : `${(yearly.supplierCapacity - yearly.materialDemand).toLocaleString()}`}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-xs",
                    statusOf(yearly.materialDemand, yearly.supplierCapacity).cls
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {statusOf(yearly.materialDemand, yearly.supplierCapacity).icon}
                    {statusOf(yearly.materialDemand, yearly.supplierCapacity).text}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> 盈余
      </span>
      <span className="inline-flex items-center gap-1">
        <AlertCircle className="h-3 w-3 text-rose-600" /> 缺口
      </span>
    </div>
  );
}
