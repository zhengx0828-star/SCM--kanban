import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useChangeTypes,
  useCreateChangeType,
  useDeleteChangeType,
  useUpdateChangeType,
} from "@/hooks/use-changes";
import { getApiErrorMessage } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * 变更类型维护（全局字典，一次维护所有项目共用）。
 *
 * 用户口径：类型「只是一个名字」—— 不做标准任务清单、不带默认责任人。
 * 被变更单引用过的类型**只能停用不能删除**（避免历史单出现孤儿引用）。
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeTypeDialog({ open, onOpenChange }: Props) {
  const { data: types = [], isLoading } = useChangeTypes(true);
  const createType = useCreateChangeType();
  const updateType = useUpdateChangeType();
  const deleteType = useDeleteChangeType();
  const [newName, setNewName] = useState("");

  const onAdd = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("请先填类型名");
      return;
    }
    try {
      await createType.mutateAsync({ name });
      toast.success(`已添加类型「${name}」`);
      setNewName("");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onRename = async (id: number, name: string, old: string) => {
    const v = name.trim();
    if (!v || v === old) return;
    try {
      await updateType.mutateAsync({ id, data: { name: v } });
      toast.success("已改名");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onToggleActive = async (id: number, next: boolean) => {
    try {
      await updateType.mutateAsync({ id, data: { is_active: next } });
      toast.success(next ? "已启用" : "已停用（历史单据不受影响）");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const onDelete = async (id: number, name: string, usage: number) => {
    if (usage > 0) {
      toast.error(`「${name}」已被 ${usage} 张变更单引用，只能停用不能删除`);
      return;
    }
    if (!window.confirm(`确定删除类型「${name}」吗？`)) return;
    try {
      await deleteType.mutateAsync(id);
      toast.success("已删除");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>变更类型</DialogTitle>
          <DialogDescription>
            全局共用，所有项目都能选。被变更单引用过的类型只能停用，不能删除。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-xs"
            placeholder="新类型名，例如：供应商切换"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
          />
          <Button size="sm" onClick={onAdd} disabled={createType.isPending}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            添加
          </Button>
        </div>

        <div className="max-h-[360px] overflow-auto rounded-lg border">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : types.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              还没有变更类型 —— 先在上面的输入框加一个
            </p>
          ) : (
            types.map((t) => (
              <div key={t.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
                <Input
                  className={cn("h-7 flex-1 text-xs", !t.is_active && "text-muted-foreground line-through")}
                  defaultValue={t.name}
                  onBlur={(e) => onRename(t.id, e.target.value, t.name)}
                />
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {t.usage_count} 张单引用
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-[11px]"
                  onClick={() => onToggleActive(t.id, !t.is_active)}
                >
                  {t.is_active ? "停用" : "启用"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  title={t.usage_count > 0 ? "被引用，不能删除" : "删除"}
                  onClick={() => onDelete(t.id, t.name, t.usage_count)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
