import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { changeDotClass, changeStatusMeta, type Change } from "@/types/change";

/**
 * L1 项目视图的变更单列表。
 *
 * 行首那个**色点**是这一层的核心：不进详情也能扫出问题单
 *   ● 红 = 这张单里有超期任务 / 黄 = 有临期 / 绿 = 全部完成 / 灰 = 未开始或已作废
 *
 * 「完成」列同时给数量、百分比和**偏差** —— 偏差才是这个模块真正要看的数
 * （时间进度跑在完成率前面 = 滞后，红字标出来）。
 */

interface Props {
  items: Change[];
  isLoading: boolean;
  onRowClick: (id: number) => void;
}

export function ChangeListTable({ items, isLoading, onRowClick }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[52px] text-center">序号</TableHead>
            <TableHead className="min-w-[180px]">物料</TableHead>
            <TableHead className="w-[120px]">变更类型</TableHead>
            <TableHead className="w-[90px]">责任人</TableHead>
            <TableHead className="w-[104px]">计划完成</TableHead>
            <TableHead className="w-[130px]">完成</TableHead>
            <TableHead className="w-[120px]">偏差</TableHead>
            <TableHead className="w-[84px]">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => {
            const status = changeStatusMeta(c.status);
            const late = c.deviation > 0 && c.status !== "voided" && c.status !== "done";
            return (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => onRowClick(c.id)}>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", changeDotClass(c))}
                      title={`超期 ${c.overdue_leaf} · 临期 ${c.near_leaf}`}
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{c.id}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium" title={c.title}>
                      {c.title}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      <span className="font-mono">{c.material_pn}</span>
                      {c.material_name && <span className="ml-1">{c.material_name}</span>}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {c.change_type_name || "未分类"}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{c.owner || <span className="text-muted-foreground/60">未指派</span>}</TableCell>
                <TableCell className="text-xs tabular-nums">{c.plan_end || <span className="text-muted-foreground/60">未排期</span>}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs tabular-nums">
                      {c.leaf_done}/{c.leaf_total}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{c.done_rate}%</span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-blue-500/70" style={{ width: `${c.done_rate}%` }} />
                  </div>
                </TableCell>
                <TableCell>
                  {c.status === "voided" ? (
                    <span className="text-[11px] text-muted-foreground/60">—</span>
                  ) : c.overdue_leaf > 0 ? (
                    <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                      超期 {c.overdue_leaf} 项
                    </span>
                  ) : late ? (
                    <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400">
                      滞后 {c.deviation}pt
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      时间 {c.time_rate}% / 完成 {c.done_rate}%
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", status.cls)}>
                    {status.label}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
