import { useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet, FileUp, Loader2 } from "lucide-react";
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
import { useImportShare } from "@/hooks/use-share";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 份额数据 Excel 导入弹窗（按项目导入）。
 *
 * 文件选择方式与供需管理一致：点「选择文件」从本机挑选 .xlsx/.xls，
 * 文件内容随请求体上传（后端 openpyxl 解析，校验规则不变）。
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = () => {
    if (!projectId) {
      setError("请先选择项目");
      return;
    }
    if (!file) {
      setError("请先选择 Excel 文件");
      return;
    }
    setError(null);
    importMutation.mutate(
      { projectId, month, file },
      {
        onSuccess: (res) => {
          if (res.errors.length > 0) {
            toast.warning(`部分行未导入：${res.errors.slice(0, 3).join("；")}`);
          } else {
            toast.success(`导入完成：新增 ${res.imported} 条，更新 ${res.updated} 条，跳过 ${res.skipped} 条`);
          }
          onOpenChange(false);
          reset();
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入份额数据（{month}）</DialogTitle>
          <DialogDescription>
            按当前项目导入同月份份与 QDC 评分。手动修改过的记录将被跳过（不覆盖）；同物料份额和 ≠ 100% 时整批不导入。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 文件选择（与供需管理一致） */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              disabled={importMutation.isPending}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              disabled={importMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              选择文件
            </Button>
            {file && <span className="truncate text-sm text-muted-foreground">{file.name}</span>}
          </div>

          {error && (
            <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">导入校验规则（规则页 SOP）</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>列顺序：物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C | 基地A_份额 | 基地A_线数…（基地成对两列）</li>
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
