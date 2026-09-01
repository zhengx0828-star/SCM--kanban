import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveShareBaseConfig, useShareBaseConfig } from "@/hooks/use-share";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 项目 × 月基地拉线配置弹窗（公共，全物料共用）。
 *
 * 拉线数量是「基地」的属性：同项目同月所有供应商共用同一组基地拉线数，
 * 作为本月系统份额的加权权重（份额 = Σ(基地配额×拉线数) ÷ Σ拉线数）。
 * 保存后后端自动重算该项目该月所有「未手改覆盖」记录的份额。
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  month: string;
}

interface BaseRow {
  base: string;
  lines: string;
}

const MAX_BASES = 4;

export function ShareBaseConfigDialog({ open, onOpenChange, projectId, month }: Props) {
  const { data: config, isLoading } = useShareBaseConfig(projectId, month);
  const saveMutation = useSaveShareBaseConfig();

  const [rows, setRows] = useState<BaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 打开/数据到达时同步本地编辑行
  useEffect(() => {
    if (open) {
      const src = config?.bases ?? [];
      setRows(src.map((b) => ({ base: b.base, lines: String(b.lines) })));
      setError(null);
    }
  }, [open, config]);

  const updateRow = (i: number, patch: Partial<BaseRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    if (rows.length >= MAX_BASES) return;
    setRows((prev) => [...prev, { base: `基地${String.fromCharCode(65 + prev.length)}`, lines: "" }]);
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSave = () => {
    if (!projectId) return;
    const cleaned: { base: string; lines: number }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const base = r.base.trim();
      const lines = Number(r.lines);
      if (!base) return setError("基地名不能为空");
      if (seen.has(base)) return setError(`基地「${base}」重复`);
      seen.add(base);
      if (!Number.isInteger(lines) || lines <= 0) return setError(`基地「${base}」拉线数量应为正整数`);
      cleaned.push({ base, lines });
    }
    if (cleaned.length === 0) return setError("请至少配置一个基地（或全部删除则视为不启用基地计算）");
    setError(null);
    saveMutation.mutate(
      { projectId, month, bases: cleaned },
      {
        onSuccess: () => {
          toast.success(`基地配置已保存，${month} 未手改的份额已按新拉线数重算`);
          onOpenChange(false);
        },
        onError: (e) => setError(getApiErrorMessage(e)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>基地拉线配置（{month}）</DialogTitle>
          <DialogDescription>
            拉线数量是基地的属性，同项目全物料共用；本月系统份额 = Σ(基地配额 × 拉线数) ÷ Σ拉线数。
            保存后自动重算未手改覆盖的份额。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
              当前月份尚未配置基地。点击下方「添加基地」开始（最多 {MAX_BASES} 个）。
            </p>
          ) : (
            rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">基地名</Label>
                  <Input value={r.base} onChange={(e) => updateRow(i, { base: e.target.value })} />
                </div>
                <div className="w-28 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">拉线数量</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={r.lines}
                    onChange={(e) => updateRow(i, { lines: e.target.value })}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-5 h-8 w-8 shrink-0 text-muted-foreground hover:text-red-500"
                  onClick={() => removeRow(i)}
                  title="删除该基地"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}

          <Button variant="outline" className="w-full" onClick={addRow} disabled={rows.length >= MAX_BASES}>
            <Plus className="mr-1.5 h-4 w-4" />
            添加基地（{rows.length}/{MAX_BASES}）
          </Button>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending || isLoading}>
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
