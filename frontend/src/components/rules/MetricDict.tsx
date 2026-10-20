/**
 * 指标字典：每个指标「怎么算 / 怎么判 / 在哪看」。
 *
 * 只做展示，数据全部来自 `lib/metric-docs.ts`（阈值在那里集中维护）。
 * chips 用与业务页同一套语义色：缺口=红、紧张=黄、充足=绿 —— 看规则和看数据不用换脑子。
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChipTone, MetricChip, MetricGroup } from "@/lib/metric-docs";

const TONE_CLS: Record<ChipTone, string> = {
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400",
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  green:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400",
  violet:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};

function Chip({ chip }: { chip: MetricChip }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded border px-1.5 py-px font-mono text-[11.5px] leading-[1.5]",
        TONE_CLS[chip.tone]
      )}
    >
      {chip.label}
    </span>
  );
}

export function MetricDict({ groups }: { groups: MetricGroup[] }) {
  const [q, setQ] = useState("");
  const keyword = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!keyword) return groups;
    return groups
      .map((g) => ({
        ...g,
        metrics: g.metrics.filter((m) =>
          [m.name, m.unit ?? "", m.formula, m.formulaNote ?? "", ...(m.chips ?? []).map((c) => c.label)]
            .join(" ")
            .toLowerCase()
            .includes(keyword)
        ),
      }))
      .filter((g) => g.metrics.length > 0);
  }, [groups, keyword]);

  const total = useMemo(() => groups.reduce((s, g) => s + g.metrics.length, 0), [groups]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜指标或公式，如 DOH、COV、30%"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <span className="text-[12px] text-muted-foreground">
          {keyword ? `匹配 ${filtered.reduce((s, g) => s + g.metrics.length, 0)} 项` : `共 ${total} 项`}
        </span>
      </div>

      {filtered.length === 0 && (
        <p className="rounded-lg border border-dashed py-10 text-center text-[13px] text-muted-foreground">
          没有匹配的指标
        </p>
      )}

      {filtered.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-[13.5px] font-semibold">{g.title}</h3>
            <span className="text-[11.5px] text-muted-foreground">{g.metrics.length} 项</span>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="w-[18%] px-3 py-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground">
                    指标
                  </th>
                  <th className="w-[30%] px-3 py-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground">
                    怎么算
                  </th>
                  <th className="w-[34%] px-3 py-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground">
                    怎么判
                  </th>
                  <th className="w-[18%] px-3 py-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground">
                    在哪看
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.metrics.map((m) => (
                  <tr key={m.name} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium leading-snug">{m.name}</div>
                      {m.unit && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{m.unit}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] leading-[1.6]">
                        {m.formula}
                      </code>
                      {m.formulaNote && (
                        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                          {m.formulaNote}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(m.chips ?? []).map((c) => (
                          <Chip key={c.label} chip={c} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] leading-snug text-muted-foreground">
                      {m.where}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
