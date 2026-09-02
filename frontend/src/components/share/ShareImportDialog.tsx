import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
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
import { useImportShare } from "@/hooks/use-share";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 份额数据 Excel 导入弹窗（按项目导入）。
 *
 * 说明：当前为本地开发模式，导入走「服务端文件路径」（前端上传后续接）。
 * Excel 列约定（表头行，基地按成对两列）：
 *   物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C |
 *   基地A_份额 | 基地A_线数 | 基地B_份额 | 基地B_线数 | ...
 * - 份额列为百分比（0-100）；基地份额同样为 0-100（不供该基地留空整对）
 * - 「本月份额」可留空：有基地数据时后端按 Σ(基地份额 × 拉线数) ÷ Σ拉线数 自动算
 * - 每条记录自带拉线数（不再有独立的基地拉线配置）
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  month: string;
}

export function ShareImportDialog({ open, onOpenChange, projectId, month }: Props) {
  const importMutation = useImportShare();
  const [filePath, setFilePath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    if (!projectId) {
      setError("请先选择项目");
      return;
    }
    if (!filePath.trim()) {
      setError("请输入 Excel 文件路径");
      return;
    }
    setError(null);
    importMutation.mutate(
      { projectId, month, filePath: filePath.trim() },
      {
        onSuccess: (res) => {
          if (res.errors.length > 0) {
            toast.warning(`部分行未导入：${res.errors.slice(0, 3).join("；")}`);
          } else {
            toast.success(`导入完成：新增 ${res.imported} 条，更新 ${res.updated} 条，跳过 ${res.skipped} 条`);
          }
          onOpenChange(false);
          setFilePath("");
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入份额数据（{month}）</DialogTitle>
          <DialogDescription>
            按当前项目导入同月份份与 QDC 评分。手动修改过的记录将被跳过（不覆盖）；同物料份额和 ≠ 100% 时整批不导入。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Excel 文件路径</Label>
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="如 C:/share/2026-08.xlsx"
            />
            <p className="text-[11px] text-muted-foreground">
              开发模式暂用服务端本地路径；列顺序：物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C |
              基地A_份额 | 基地A_线数 | 基地B_份额 | 基地B_线数…（基地成对两列）
            </p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">导入校验规则（规则页 SOP）</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Q / D / C 仅允许五档：1 / 0.7 / 0.5 / 0.3 / 0</li>
              <li>份额与基地份额均为 0-100；基地线数 ≥ 1（份额、线数成对填写）</li>
              <li>同一物料各供应商份额和 ≈ 100%（容差 ±1%）</li>
              <li>供应商代码与物料 PN 需已存在于主数据</li>
              <li>手动修改过的记录（编辑过份额）不覆盖，跳过</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={importMutation.isPending}>
            {importMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 h-4 w-4" />
            )}
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
