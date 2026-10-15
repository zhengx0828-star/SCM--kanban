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
import { useImportInventory } from "@/hooks/use-inventory";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 库存信号塔 Excel 导入弹窗。
 *
 * 文件选择方式与供需管理一致：点「选择文件」从本机挑选 .xlsx/.xls，
 * 文件内容随请求体上传（后端 openpyxl 解析，校验规则不变）。
 * Excel 列约定（表头行）：
 *   项目代码 | 基地 | 物料PN | 供应商代码(可选) | 采购LeadTime(天) | 初始现有库存 |
 *   历史需求_YYYY-MM（任意 N 列）| 未来预测_YYYY-MM（月度总量，须覆盖今天起 30 天所在月）
 * - 未来预测按当月自然日摊日均；重新导入同一单元会清空其手工修正重建推算
 * - 供应商代码留空时按「项目 × 物料」自动推断（优先主供）；
 * - 整表不含任何月份列时，该批档案与底表联动（物料需求 = 客户需求 × BOM 系数）
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function InventoryImportDialog({ open, onOpenChange }: Props) {
  const importMutation = useImportInventory();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = () => {
    if (!file) {
      setError("请先选择 Excel 文件");
      return;
    }
    setError(null);
    importMutation.mutate(file, {
      onSuccess: (res) => {
        if (res.errors.length > 0) {
          toast.warning(`部分行未导入：${res.errors.slice(0, 3).join("；")}`);
        } else {
          toast.success(`导入完成：新增 ${res.imported} 个推算单元，更新 ${res.updated} 个`);
        }
        onOpenChange(false);
        reset();
      },
      onError: (err) => setError(getApiErrorMessage(err)),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>导入库存推算单元（Excel）</DialogTitle>
          <DialogDescription>
            每行 = 一个「项目 × 基地 × 物料」推算单元；重新导入会更新系统数据并清空该单元的手工修正。
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
            <p className="font-medium text-foreground">列约定（表头行，基地/月份列可任意数量）</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>项目代码 | 基地 | 物料PN | 供应商代码(可选) | 采购LeadTime(天) | 初始现有库存</li>
              <li>历史需求_YYYY-MM（任意 N 列，算 COV 建议 ≥ 2 列）</li>
              <li>未来预测_YYYY-MM（月度总量，须覆盖「今天起 30 天」所在月，按当月自然日摊日均）</li>
              <li>LeadTime &gt; 0、初始库存 ≥ 0；项目代码 / 物料PN / 基地 需已存在于主数据（基地可在「基地管理」维护）</li>
              <li>供应商代码留空时按「项目 × 物料」自动推断（优先主供）</li>
              <li>整表不含任何月份列 = 该批档案与底表联动（物料需求 = 客户需求 × BOM 系数）</li>
              <li>重新导入同一推算单元 = 清空该单元全部手工修正后重建</li>
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
