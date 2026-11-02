import { useRef, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, Loader2 } from "lucide-react";
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
import { useImportSegments } from "@/hooks/use-segments";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 评价 Excel 导入。
 *
 * ★ **一行错，整批不写**。返回的 errors 逐条列出（带行号），改完重导即可。
 *   批量补录最怕「错了 1 行、进了 49 行」—— 事后没人对得出来少的是哪一行。
 * ★ 期间取文件里的「期间」列；该列为空时才用页面上选中的月份（作为 default_period）。
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultPeriod: string;
  onImported: () => void;
}

export function SegmentImportDialog({ open, onOpenChange, defaultPeriod, onImported }: Props) {
  const importMutation = useImportSegments();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<string[]>([]);

  const reset = () => {
    setFile(null);
    setError(null);
    setRowErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = () => {
    if (!file) {
      setError("请先选择 Excel 文件");
      return;
    }
    setError(null);
    setRowErrors([]);
    importMutation.mutate(
      { file, defaultPeriod },
      {
        onSuccess: (res) => {
          if (res.errors.length > 0) {
            setRowErrors(res.errors);
            setError(`有 ${res.errors.length} 处问题，整批未导入 —— 改完再导一次`);
            return;
          }
          toast.success(`导入完成：新增 ${res.created} 条，更新 ${res.updated} 条`);
          onOpenChange(false);
          onImported();
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Excel 导入评价</DialogTitle>
          <DialogDescription>
            一行 = 一个期间 × 一个物料 PN × 一家供应商。档位只认 1 / 0.7 / 0.5 / 0.3 / 0；
            留空表示未评，不要用 0 代替。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
                setRowErrors([]);
              }}
              disabled={importMutation.isPending}
              className="hidden"
            />
            <Button type="button" variant="outline" disabled={importMutation.isPending} onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              选择文件
            </Button>
            <Button type="button" variant="ghost" asChild>
              <a href="/templates/segment-import-template.xlsx" download="供应商细分导入模板.xlsx">
                <Download className="mr-1.5 h-4 w-4" />
                下载模板
              </a>
            </Button>
            {file && <span className="truncate text-sm text-muted-foreground">{file.name}</span>}
          </div>

          {error && (
            <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          {rowErrors.length > 0 && (
            <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-[11px] leading-4 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {rowErrors.map((item) => (
                <li key={item} className="break-all">
                  {item}
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">列顺序（固定 19 列）</p>
            <p className="mt-0.5 break-all font-mono text-[10px] leading-4">
              期间 | 物料PN | 物料名称 | 供应商代码 | 供应商名称 | 质量绩效 | 交付达成率 | 合格率 | 成本 | CFT稽查 |
              质量服务分 | 降价意愿 | 建库意愿 | 紧急交付 | 沟通态度 | 回复及时率 | 产能弹性 | 打分人 | 备注
            </p>
            <p className="mt-2 font-medium text-foreground">校验规则</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>期间 YYYY-MM；本列留空时按当前选中的日期 {defaultPeriod}</li>
              <li>物料 PN 与供应商代码必须已存在于主数据（按代码匹配，不按名称）</li>
              <li>档位只认 1 / 0.7 / 0.5 / 0.3 / 0，也接受 100 / 70 / 50 / 30 / 0 与 70% 写法</li>
              <li>同一文件里 期间 + PN + 供应商 重复 → 报错，请合并成一行</li>
              <li>12 项全空的行会被拒；已存在的同一条评价会按本次内容覆盖</li>
              <li>只要有一处报错，整批都不写入</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={importMutation.isPending || !file}>
            {importMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
