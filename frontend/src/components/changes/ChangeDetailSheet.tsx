import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, CheckCircle2, RotateCcw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useArchiveChange,
  useChangeDetail,
  useChangeOwners,
  useChangeTypes,
  useDeleteChange,
  useRestoreChange,
  useUnarchiveChange,
  useUpdateChange,
  useVoidChange,
} from "@/hooks/use-changes";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { changeStatusMeta } from "@/types/change";
import { BurndownChart } from "./BurndownChart";
import { GanttChart } from "./GanttChart";
import { TaskTreeEditor } from "./TaskTreeEditor";
import { useChangeBurndown } from "@/hooks/use-changes";

/**
 * 变更单详情抽屉（三个 Tab）。
 *
 * 交互习惯沿用项目既有的右侧 Sheet（库存的 InventoryDetailSheet 是同一个范式）。
 * 三个 Tab 分别回答：这单是什么 / 干到哪了 / 谁在什么时候干什么。
 * 归档后整单只读（用户确认：归档 = 冻结，要改先取消归档）。
 */

type Tab = "info" | "gantt" | "tasks";

interface Props {
  changeId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关闭后父级可用来刷新外部列表（本组件内部已自动失效缓存） */
  onChanged?: () => void;
}

export function ChangeDetailSheet({ changeId, open, onOpenChange, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>("info");
  const { data, isLoading } = useChangeDetail(open ? changeId : null);
  const { data: types = [] } = useChangeTypes(false);
  const { data: owners = [] } = useChangeOwners();
  const { data: burndown } = useChangeBurndown({ change_id: changeId ?? undefined }, Boolean(changeId) && open);

  const updateChange = useUpdateChange();
  const voidChange = useVoidChange();
  const restoreChange = useRestoreChange();
  const deleteChange = useDeleteChange();
  const archiveChange = useArchiveChange();
  const unarchiveChange = useUnarchiveChange();

  useEffect(() => {
    if (open) setTab("info");
  }, [open, changeId]);

  const isArchived = Boolean(data?.archived_at);

  const patch = async (payload: Record<string, unknown>, ok?: string) => {
    if (!changeId) return;
    try {
      await updateChange.mutateAsync({ id: changeId, data: payload });
      if (ok) toast.success(ok);
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const status = changeStatusMeta(data?.status);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[860px]">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="min-w-0 flex-1 truncate">
              {isLoading
                ? "加载中…"
                : data
                  ? `#${data.id} ${data.title}`
                  : "变更单不存在或已被删除"}
            </SheetTitle>
            {data && (
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", status.cls)}>
                {status.label}
              </span>
            )}
            {isArchived && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                已归档 · 只读
              </span>
            )}
          </div>
          {data && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {data.project_name}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="font-mono">{data.material_pn}</span> {data.material_name}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              责任人 {data.owner || "未指派"}
            </p>
          )}
          {/* Tab 切换 */}
          <div className="mt-3 flex items-center gap-1">
            {(
              [
                ["info", "基本信息"],
                ["gantt", "甘特图"],
                ["tasks", `任务清单（${data?.leaf_total ?? 0}）`],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  tab === key ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </SheetHeader>

        <SheetBody className="px-5 py-4">
          {isLoading || !data ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : tab === "info" ? (
            <div className="space-y-4">
              {/* 派生指标一览 —— 这个模块真正要看的数 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard label="完成率" value={`${data.done_rate}%`} hint={`${data.leaf_done}/${data.leaf_total} 个叶子任务`} />
                <MetricCard label="时间进度" value={`${data.time_rate}%`} hint="已过时长比例（自动）" />
                <MetricCard
                  label="偏差"
                  value={`${data.deviation > 0 ? "+" : ""}${data.deviation}pt`}
                  hint={data.deviation > 0 ? "时间跑在人前面 = 滞后" : "正常"}
                  danger={data.deviation > 0 && data.status === "active"}
                />
                <MetricCard
                  label="超期 / 临期"
                  value={`${data.overdue_leaf} / ${data.near_leaf}`}
                  hint={`已迟交 ${data.late_leaf} 项`}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">变更类型</Label>
                  <Select
                    value={String(data.change_type_id)}
                    disabled={isArchived}
                    onValueChange={(v) => patch({ change_type_id: Number(v) }, "变更类型已更新")}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {types.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">总责任人</Label>
                  <Input
                    className="h-8 text-xs"
                    defaultValue={data.owner ?? ""}
                    disabled={isArchived}
                    list="change-owner-options-sheet"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (data.owner ?? "")) patch({ owner: v || null }, "责任人已更新");
                    }}
                  />
                  <datalist id="change-owner-options-sheet">
                    {owners.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                  <p className="text-[10px] text-muted-foreground">
                    任务没单独填责任人时，会跟随这个总责任人
                  </p>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">变更标题</Label>
                  <Input
                    className="h-8 text-xs"
                    defaultValue={data.title}
                    disabled={isArchived}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== data.title) patch({ title: v }, "标题已更新");
                      else if (!v) e.target.value = data.title;
                    }}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">变更内容</Label>
                  <Textarea
                    className="min-h-[80px] text-xs"
                    defaultValue={data.description ?? ""}
                    disabled={isArchived}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (data.description ?? "")) patch({ description: v || null }, "内容已更新");
                    }}
                  />
                </div>

                <div className="text-[11px] text-muted-foreground sm:col-span-2">
                  计划起止 <span className="tabular-nums text-foreground">{data.plan_start ?? "—"}</span> ~{" "}
                  <span className="tabular-nums text-foreground">{data.plan_end ?? "—"}</span>
                  <span className="ml-2 text-muted-foreground/70">（由叶子任务自动汇总，不用手填）</span>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-3">
                <p className="mb-1 text-xs font-medium">燃尽（计划阶梯线 vs 实际线）</p>
                <BurndownChart data={burndown} />
              </div>
            </div>
          ) : tab === "gantt" ? (
            <GanttChart
              tasks={data.tasks}
              storageKey={`changes:collapse:single:${data.id}`}
              emptyText="这张变更单还没有任务"
            />
          ) : (
            <TaskTreeEditor
              changeId={data.id}
              tasks={data.tasks}
              owners={owners}
              disabled={isArchived}
            />
          )}
        </SheetBody>

        {data && (
          <SheetFooter className="flex-wrap justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {isArchived ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => act(() => unarchiveChange.mutateAsync(data.id), "已取消归档，可以继续编辑")}
                >
                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                  取消归档
                </Button>
              ) : (
                <>
                  {data.status === "active" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (data.leaf_done < data.leaf_total) {
                            const left = data.leaf_total - data.leaf_done;
                            if (!window.confirm(`还有 ${left} 项没有勾完成，确定现在标记为已完成吗？`)) return;
                          }
                          patch({ status: "done" }, "已标记完成");
                        }}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        标记完成
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!window.confirm("作废后这单会从活跃列表隐藏（记录仍可查）。确定作废吗？")) return;
                          act(() => voidChange.mutateAsync(data.id), "已作废");
                        }}
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        作废
                      </Button>
                    </>
                  )}
                  {data.status === "done" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => act(() => restoreChange.mutateAsync(data.id), "已改回进行中")}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      改回进行中
                    </Button>
                  )}
                  {data.status === "voided" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => act(() => restoreChange.mutateAsync(data.id), "已恢复为进行中")}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      取消作废
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => act(() => archiveChange.mutateAsync({ id: data.id }), "已归档（只读）")}
                  >
                    <Archive className="mr-1.5 h-3.5 w-3.5" />
                    归档
                  </Button>
                </>
              )}
            </div>

            {!isArchived && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  const msg =
                    data.status === "voided"
                      ? "彻底删除这张已经作废的变更单（含全部任务）？此操作不可恢复。"
                      : "删除后这张单会从列表隐藏（软删除，可恢复）。确定删除吗？";
                  if (!window.confirm(msg)) return;
                  act(
                    () => deleteChange.mutateAsync({ id: data.id, hard: data.status === "voided" }),
                    "已删除"
                  );
                  onOpenChange(false);
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                删除
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetricCard({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-medium tabular-nums", danger && "text-red-600 dark:text-red-400")}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground/80">{hint}</p>
    </div>
  );
}
