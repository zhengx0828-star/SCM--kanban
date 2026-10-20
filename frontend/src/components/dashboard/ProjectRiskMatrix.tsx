import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { buildProjectDimLink } from "@/lib/alert-link";
import { cn } from "@/lib/utils";
import {
  ALERT_MATRIX_COLUMNS,
  ALERT_SEVERITY_META,
  ALERT_SOURCE_LABEL,
  type AlertProjectRow,
  type AlertSeverity,
  type AlertSource,
} from "@/types/alert";

/**
 * 项目风险热点矩阵：项目 × 5 个维度（首页没有明细列表，本卡是唯一的「看具体内容」入口）。
 *
 * 为什么按「项目」组织而不按模块：老板问的是「哪个项目有麻烦」，
 * 不会问「变更模块有几条」。一行一个项目，一眼看完谁最脏。
 *
 * 格子 = 该维度最高紧急程度（P0 > P1 > P2）+ 条数，**点格直接跳到该板块并按该项目过滤**。
 * 灰格「—」= 该维度无信号（**不等于健康**，底部脚注必须保留，否则会变成另一种误判）。
 */
interface Props {
  rows: AlertProjectRow[];
  baseMonth: string;
}

function Cell({ severity, count }: { severity: AlertSeverity | null; count: number }) {
  if (!severity || count === 0) {
    return <span className="text-xs text-muted-foreground/40">—</span>;
  }
  const meta = ALERT_SEVERITY_META[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        meta.chip
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {count}
    </span>
  );
}

export function ProjectRiskMatrix({ rows, baseMonth }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">项目风险热点</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            格子数字 = 该维度预警条数 · 点格进入对应板块（按该项目过滤）
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b">
              <th className="px-5 py-2 text-left text-xs font-medium text-muted-foreground">项目</th>
              {ALERT_MATRIX_COLUMNS.map((src) => (
                <th key={src} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                  {ALERT_SOURCE_LABEL[src]}
                </th>
              ))}
              <th className="px-5 py-2 text-right text-xs font-medium text-muted-foreground">紧急</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = r.severity ? ALERT_SEVERITY_META[r.severity] : null;
              return (
                <tr key={r.project_id} className="border-b last:border-b-0 transition-colors hover:bg-muted/40">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-4 w-1 shrink-0 rounded-full", meta?.bar ?? "bg-transparent")} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.code}
                          {r.counts.p0 > 0 && (
                            <span className="ml-1.5 text-red-600 dark:text-red-400">P0 {r.counts.p0}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {ALERT_MATRIX_COLUMNS.map((src) => {
                    const dim = r.dims[src];
                    const has = !!dim?.severity && (dim?.count ?? 0) > 0;
                    return (
                      <td key={src} className="px-2 py-2.5 text-center">
                        {has ? (
                          <Link
                            to={buildProjectDimLink(r.project_id, src as AlertSource, baseMonth)}
                            className="inline-flex rounded-full transition-shadow hover:ring-2 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring"
                            title={`进入${ALERT_SOURCE_LABEL[src]}（${r.name}）`}
                          >
                            <Cell severity={dim!.severity} count={dim!.count} />
                          </Link>
                        ) : (
                          <Cell severity={null} count={0} />
                        )}
                      </td>
                    );
                  })}
                  <td className="max-w-[280px] px-5 py-2.5 text-right">
                    <span className="line-clamp-1 text-xs text-muted-foreground" title={r.worst?.title}>
                      {r.worst?.title ?? "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t px-5 py-2 text-[11px] text-muted-foreground">
        灰格「—」= 该项目该维度无预警信号，<span className="font-medium">不等于健康</span>（可能是数据没录）。
        <span className="ml-1 inline-flex items-center gap-0.5">
          点格子进入板块 <ArrowUpRight className="inline h-3 w-3" />
        </span>
      </p>
    </div>
  );
}
