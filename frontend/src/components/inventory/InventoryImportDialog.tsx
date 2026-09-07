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
import { useImportInventory } from "@/hooks/use-inventory";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 库存信号塔 Excel 导入弹窗。
 *
 * 说明：当前为本地开发模式，导入走「服务端文件路径」（前端上传后续接）。
 * Excel 列约定（表头行）：
 *   项目代码 | 基地 | 物料PN | 采购LeadTime(天) | 初始现有库存 |
 *   历史需求_YYYY-MM（任意 N 列）| 未来预测_YYYY-MM（月度总量，须覆盖今天起 30 天所在月）
 * - 未来预测按当月自然日摊日均；重新导入同一单元会清空其手工修正重建推算
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function InventoryImportDialog({ open, onOpenChange }: Props) {
  const importMutation = useImportInventory();
  const [filePath, setFilePath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    if (!filePath.trim()) {
      setError("请输入 Excel 文件路径");
      return;
    }
    setError(null);
    importMutation.mutate(filePath.trim(), {
      onSuccess: (res) => {
        if (res.errors.length > 0) {
          toast.warning(`部分行未导入：${res.errors.slice(0, 3).join("；")}`);
        } else {
          toast.success(`导入完成：新增 ${res.imported} 个推算单元，更新 ${res.updated} 个`);
        }
        onOpenChange(false);
        setFilePath("");
      },
      onError: (err) => setError(getApiErrorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>导入库存推算单元（Excel）</DialogTitle>
          <DialogDescription>
            每行 = 一个「项目 × 基地 × 物料」推算单元；重新导入会更新系统数据并清空该单元的手工修正。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Excel 文件路径</Label>
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="如 C:/inventory/2026-09.xlsx"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">列约定（表头行，基地/月份列可任意数量）</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>项目代码 | 基地 | 物料PN | 采购LeadTime(天) | 初始现有库存</li>
              <li>历史需求_YYYY-MM（任意 N 列，算 COV 建议 ≥ 2 列）</li>
              <li>未来预测_YYYY-MM（月度总量，须覆盖「今天起 30 天」所在月，按当月自然日摊日均）</li>
              <li>LeadTime &gt; 0、初始库存 ≥ 0；项目代码 / 物料PN 需已存在于主数据</li>
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
