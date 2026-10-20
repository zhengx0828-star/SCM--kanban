/**
 * 单个模块的操作 SOP 卡：流程图 + 截图标注 + 编号步骤。
 *
 * 联动关系（这是「点哪里一目了然」的关键）：
 *   鼠标移到右侧任意一步 → 截图上的对应编号放大；
 *   鼠标移到截图上的编号 → 右侧对应那一步高亮。
 * 两侧用同一个 `active`（步骤号）驱动，不用逐对绑定。
 */

import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, MoveRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SopModule, SopStep } from "@/lib/sop-docs";

/**
 * 流程图：节点直接由 steps 生成，编号与下方步骤、图上标注同源。
 * 不用另写一份流程数据 —— 那必然会出现「图说 4 步、文字说 5 步」。
 */
function FlowChart({ steps }: { steps: SopStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="mr-1 text-[11px] font-medium tracking-wide text-muted-foreground">流程</span>
      {steps.map((s, i) => (
        <Fragment key={s.no}>
          {i > 0 && <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" strokeWidth={2} />}
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12.5px]">
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{s.no}</span>
            <span className="font-medium">{s.flowLabel}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export function SopCard({ mod }: { mod: SopModule }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* 卡头 */}
        <div className="flex items-center gap-2.5 border-b px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{mod.name}</h2>
          <Link
            to={mod.to}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-accent"
          >
            进入模块
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* 流程图 */}
        <div className="border-b bg-muted/30 px-5 py-2.5">
          <FlowChart steps={mod.steps} />
        </div>

        {/* 截图：独占整行，尽量给大 */}
        <div className="p-4 lg:p-5">
          <figure className="relative m-0 overflow-hidden rounded-lg border bg-background">
            <img
              src={mod.shot}
              alt={`${mod.name} 界面`}
              className="block w-full"
              loading="lazy"
            />
            {mod.pins.map((p) => (
              <span
                key={`${p.no}-${p.x}`}
                onMouseEnter={() => setActive(p.no)}
                onMouseLeave={() => setActive(null)}
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  backgroundColor: active === p.no ? "#1d4ed8" : "#2563eb",
                }}
                className={cn(
                  "absolute grid h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-default place-items-center rounded-full text-[12px] font-bold tabular-nums text-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] ring-2 ring-white transition-transform",
                  active === p.no ? "z-20 scale-125" : "z-10"
                )}
              >
                {p.no}
              </span>
            ))}
          </figure>
        </div>

        {/* 步骤：两列排布，编号与图上一致 */}
        <ol className="m-0 grid list-none gap-x-6 gap-y-2.5 px-4 pb-5 sm:grid-cols-2 lg:px-5">
          {mod.steps.map((s) => (
            <li
              key={s.no}
              onMouseEnter={() => setActive(s.no)}
              onMouseLeave={() => setActive(null)}
              className={cn(
                "-mx-1.5 flex gap-2.5 rounded-md px-1.5 py-1 transition-colors",
                active === s.no && "bg-accent"
              )}
            >
              <span
                className={cn(
                  "mt-[2px] grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full text-[10.5px] font-bold tabular-nums text-white transition-colors",
                  active === s.no ? "bg-blue-800" : "bg-blue-600"
                )}
              >
                {s.no}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] leading-snug">{s.text}</p>
                {s.tip && (
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{s.tip}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
