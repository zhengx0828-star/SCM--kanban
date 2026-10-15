import { useState } from "react";
import { ChevronDown, ChevronRight, ListPlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useBatchCreateTasks,
  useCreateTask,
  useDeleteTask,
  useToggleTask,
  useUpdateTask,
} from "@/hooks/use-changes";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { taskStateMeta, type ChangeTaskNode } from "@/types/change";

/**
 * 任务树编辑器（详情抽屉 → 任务清单 Tab）。
 *
 * 用户可以在这里：加任意层级的子项（封顶 5 层）、改名字、改责任人、
 * 改计划起止、勾完成、删任务（有子项时级联删，会先提示删几个）。
 *
 * 两个来自需求的硬规则：
 *   - **子项也要能勾**；点有子项的父项 = 一键全勾 / 全取消（后端实现）
 *   - 勾选的那一刻后端自动记 `done_at`，用户零录入
 */

const MAX_LEVEL = 5;

interface Props {
  changeId: number;
  tasks: ChangeTaskNode[];
  owners: string[];
  /** 归档后只读 */
  disabled?: boolean;
}

export function TaskTreeEditor({ changeId, tasks, owners, disabled = false }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [batchText, setBatchText] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const batchCreate = useBatchCreateTasks();

  const toggleCollapse = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const onToggleDone = async (node: ChangeTaskNode) => {
    try {
      await toggleTask.mutateAsync({ taskId: node.id, isDone: !node.is_done });
      toast.success(node.is_done ? "已取消完成" : "已标记完成（系统已自动记录完成时间）");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onPatch = async (taskId: number, data: Record<string, unknown>, okMsg?: string) => {
    try {
      await updateTask.mutateAsync({ taskId, data });
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onAddChild = async (parent: ChangeTaskNode | null) => {
    const level = parent ? parent.level + 1 : 1;
    if (level > MAX_LEVEL) {
      toast.error(`最多支持 ${MAX_LEVEL} 层，这一层不能再加子项了`);
      return;
    }
    try {
      await createTask.mutateAsync({
        changeId,
        data: { parent_id: parent?.id ?? null, name: "新任务" },
      });
      toast.success(parent ? "已添加子项" : "已添加待办项");
      if (parent) {
        const next = new Set(collapsed);
        next.delete(parent.id);
        setCollapsed(next);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onDelete = async (node: ChangeTaskNode) => {
    const count = countNodes(node);
    const msg =
      count > 1
        ? `「${node.name}」下面还有 ${count - 1} 个子项，会一起删除。确定吗？`
        : `确定删除「${node.name}」吗？`;
    if (!window.confirm(msg)) return;
    try {
      await deleteTask.mutateAsync(node.id);
      toast.success("已删除");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onBatch = async () => {
    const text = batchText.trim();
    if (!text) {
      toast.error("请先粘贴任务名（一行一个）");
      return;
    }
    try {
      const res = await batchCreate.mutateAsync({ changeId, text });
      toast.success(`已添加 ${res.created} 条待办项`);
      setBatchText("");
      setBatchOpen(false);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const renderRows = (nodes: ChangeTaskNode[]): React.ReactNode =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(node.id);
      const meta = taskStateMeta(node.state);
      const allDone = node.leaf_total > 0 && node.leaf_done === node.leaf_total;

      return (
        <div key={node.id}>
          <div
            className={cn(
              "flex flex-wrap items-center gap-1.5 border-b py-1.5 last:border-b-0",
              hasChildren && "bg-muted/20"
            )}
            style={{ paddingLeft: 4 + (node.level - 1) * 16 }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapse(node.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={isCollapsed ? "展开" : "收起"}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="w-[18px] shrink-0" />
            )}

            <Checkbox
              checked={node.is_done}
              disabled={disabled}
              onCheckedChange={() => onToggleDone(node)}
              title={hasChildren ? "勾上 = 把下面所有子项一次性全勾 / 全取消" : "标记完成"}
            />

            <Input
              className="h-7 min-w-[140px] flex-1 text-xs"
              defaultValue={node.name}
              disabled={disabled}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== node.name) onPatch(node.id, { name: v }, "任务名已更新");
                else if (!v) e.target.value = node.name;
              }}
            />

            <Input
              className="h-7 w-[88px] text-xs"
              defaultValue={node.owner ?? ""}
              placeholder="责任人"
              list="change-owner-options"
              disabled={disabled}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (node.owner ?? "")) onPatch(node.id, { owner: v || null });
              }}
            />

            <Input
              type="date"
              className="h-7 w-[128px] text-xs"
              defaultValue={node.plan_start ?? ""}
              disabled={disabled}
              onChange={(e) => onPatch(node.id, { plan_start: e.target.value || null })}
              title="计划开始"
            />
            <Input
              type="date"
              className="h-7 w-[128px] text-xs"
              defaultValue={node.plan_end ?? ""}
              disabled={disabled}
              onChange={(e) => onPatch(node.id, { plan_end: e.target.value || null })}
              title="计划完成（预警依据）"
            />

            {hasChildren ? (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                  allDone ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                )}
              >
                {node.leaf_done}/{node.leaf_total}
              </span>
            ) : (
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", meta.chipCls)}>
                {node.overdue_days > 0
                  ? `超期${node.overdue_days}天`
                  : node.late_days > 0
                    ? `迟交${node.late_days}天`
                    : meta.label}
              </span>
            )}

            {!disabled && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  title={node.level >= MAX_LEVEL ? `最多 ${MAX_LEVEL} 层` : "添加子项"}
                  onClick={() => onAddChild(node)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  title="删除"
                  onClick={() => onDelete(node)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>

          {hasChildren && !isCollapsed && renderRows(node.children)}
        </div>
      );
    });

  return (
    <div className="space-y-2">
      {/* 责任人候选（自由文本 + 软提示，不校验、不强制） */}
      <datalist id="change-owner-options">
        {owners.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      {owners.length > 0 && !disabled && (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span>最近用过：</span>
          {owners.slice(0, 8).map((o) => (
            <span key={o} className="rounded bg-muted px-1.5 py-0.5">
              {o}
            </span>
          ))}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
          还没有待办项 —— 点下方「添加待办项」，或直接批量粘贴一批任务名
        </div>
      ) : (
        <div className="rounded-lg border">{renderRows(tasks)}</div>
      )}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onAddChild(null)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            添加待办项
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBatchOpen((v) => !v)}>
            <ListPlus className="mr-1.5 h-3.5 w-3.5" />
            批量粘贴
          </Button>
        </div>
      )}

      {batchOpen && !disabled && (
        <div className="space-y-2 rounded-lg border p-3">
          <Textarea
            className="min-h-[96px] text-xs"
            placeholder={"一行一个任务名，例如：\n样品评估\n小批试产\n产线验证\n量产切换"}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setBatchOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={onBatch} disabled={batchCreate.isPending}>
              添加
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function countNodes(node: ChangeTaskNode): number {
  return 1 + node.children.reduce((acc, c) => acc + countNodes(c), 0);
}
