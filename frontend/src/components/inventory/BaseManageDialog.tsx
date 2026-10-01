import { useEffect, useState } from "react";
import { Check, Factory, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBases, useCreateBase, useDeleteBase, useUpdateBase } from "@/hooks/use-inventory";
import { getApiErrorMessage } from "@/lib/utils";
import type { BaseSite } from "@/types/inventory";

/**
 * 基地主数据管理。
 *
 * 基地是「我方生产基地 / 仓库」，与供应商所在地无关。库存档案以它作为外键维度，
 * 所以必须受控维护，避免「常州 / 常州市 / 常州基地」同义异名把同一实体拆成多行。
 * 被库存档案引用的基地不允许删除（后端会拒绝），以免产生孤儿档案。
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface Draft {
  code: string;
  name: string;
  city: string;
}

const EMPTY: Draft = { code: "", name: "", city: "" };

export function BaseManageDialog({ open, onOpenChange }: Props) {
  const { data: bases, isLoading } = useBases();
  const createBase = useCreateBase();
  const updateBase = useUpdateBase();
  const deleteBase = useDeleteBase();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(EMPTY);
      setEditingId(null);
      setShowForm(false);
      setError(null);
    }
  }, [open]);

  const startCreate = () => {
    setEditingId(null);
    setDraft(EMPTY);
    setError(null);
    setShowForm(true);
  };

  const startEdit = (b: BaseSite) => {
    setEditingId(b.id);
    setDraft({ code: b.code, name: b.name, city: b.city ?? "" });
    setError(null);
    setShowForm(true);
  };

  const submit = () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!code || !name) {
      setError("基地编码与名称都不能为空");
      return;
    }
    const payload = { code, name, city: draft.city.trim() || null };
    const done = () => {
      setShowForm(false);
      setEditingId(null);
      setDraft(EMPTY);
      setError(null);
    };
    if (editingId !== null) {
      updateBase.mutate(
        { id: editingId, data: payload },
        { onSuccess: () => { toast.success("基地已更新"); done(); }, onError: (e) => setError(getApiErrorMessage(e)) }
      );
    } else {
      createBase.mutate(payload, {
        onSuccess: () => { toast.success("基地已新增"); done(); },
        onError: (e) => setError(getApiErrorMessage(e)),
      });
    }
  };

  const remove = (b: BaseSite) => {
    if (b.plan_count > 0) {
      toast.error(`基地「${b.name}」仍被 ${b.plan_count} 条库存档案引用，请先处理这些档案`);
      return;
    }
    deleteBase.mutate(b.id, {
      onSuccess: () => toast.success(`已删除基地「${b.name}」`),
      onError: (e) => toast.error(getApiErrorMessage(e)),
    });
  };

  const pending = createBase.isPending || updateBase.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>基地主数据</DialogTitle>
          <DialogDescription>
            基地是「我方生产基地 / 仓库」，库存档案按 项目 × 物料 × 供应商 × 基地 建立。被档案引用的基地不可删除。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!showForm && (
            <Button size="sm" variant="outline" onClick={startCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新增基地
            </Button>
          )}

          {showForm && (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">基地编码</Label>
                  <Input
                    className="h-8 text-xs"
                    value={draft.code}
                    onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                    placeholder="如 CZ"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">基地名称</Label>
                  <Input
                    className="h-8 text-xs"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="如 常州"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">所在城市</Label>
                  <Input
                    className="h-8 text-xs"
                    value={draft.city}
                    onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
                    placeholder="选填"
                  />
                </div>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submit} disabled={pending}>
                  {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                  {editingId !== null ? "保存修改" : "确认新增"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(null); }} disabled={pending}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  取消
                </Button>
              </div>
            </div>
          )}

          <div className="max-h-[380px] overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">编码</th>
                  <th className="px-3 py-2 text-left font-medium">名称</th>
                  <th className="px-3 py-2 text-left font-medium">城市</th>
                  <th className="px-3 py-2 text-right font-medium">档案数</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </td>
                  </tr>
                ) : (bases ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      <Factory className="mx-auto mb-1.5 h-5 w-5 opacity-50" />
                      暂无基地，点击上方「新增基地」开始维护
                    </td>
                  </tr>
                ) : (
                  (bases ?? []).map((b) => (
                    <tr key={b.id} className="border-t hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono">{b.code}</td>
                      <td className="px-3 py-2 font-medium">{b.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.city || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.plan_count}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => startEdit(b)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-red-600 hover:text-red-700"
                            onClick={() => remove(b)}
                            disabled={deleteBase.isPending}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
