import { useRef, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, FileUp, Loader2 } from "lucide-react";
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
 *
 * 表结构（模板见 public/templates/share-import-template.xlsx，与用户现有表同构）：
 *      物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C | A份额 | A条数 | B份额 | B条数
 *   基地写在列名里，`<基地>份额` 与 `<基地>条数` 成对出现。
 *   **一个 sheet 可以有多块表头上下堆叠**：块1 基地 A/B、块2 基地 C/D，块间基地列、
 *   列数、列顺序都可以不同；固定列按列名识别，不看第几列。同一 (PN, 供应商) 跨块合并基地。
 *   另一套等价的竖排写法（`段 | 基地 | 拉线数 | 基地份额` 降级成数据列）仍然兼容。
 * - 文件里的 PN / 供应商代码在主档没有 → 按文件名称自动建档并挂到当前项目（已有只复用、不改名）
 * - 份额与基地份额支持 0-100 百分数与 0-1 小数；基地份额整批统一口径（后端归一为百分数）
 * - 条数是基地属性：同一基地每行同一个数，或只在首家填、其余留空沿用
 * - 「本月份额」可留空：后端按 Σ(基地份额 × 条数) ÷ Σ该物料全部基地条数 自动算
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
          } else if (res.by_project.length > 1) {
            // 跨项目导入：逐个项目报，否则用户不知道哪条数落到哪去了
            const lines = res.by_project
              .filter((g) => g.imported || g.updated || g.skipped)
              .map((g) => {
                const name = g.project_name || g.project_code || `项目${g.project_id}`;
                return `${name} ${g.month}：新增 ${g.imported}／更新 ${g.updated}／跳过 ${g.skipped}`;
              });
            toast.success(`导入完成：共 ${res.imported + res.updated} 条，涉及 ${res.by_project.length} 个项目月`, {
              description: lines.join("；"),
            });
          } else {
            const parts = [`新增 ${res.imported} 条`, `更新 ${res.updated} 条`, `跳过 ${res.skipped} 条`];
            const created: string[] = [];
            if (res.created_materials) created.push(`物料 ${res.created_materials}`);
            if (res.created_suppliers) created.push(`供应商 ${res.created_suppliers}`);
            if (res.created_links) created.push(`项目明细 ${res.created_links}`);
            if (created.length) parts.push(`自动建档 ${created.join(" / ")}`);
            toast.success(`导入完成：${parts.join("，")}`);
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>导入份额数据（{month}）</DialogTitle>
          <DialogDescription>
            按 项目 × 月份 导入份额与 QDC 评分。文件里标了项目和月份就以文件为准，没标才用上面选的项目与月份。手动修改过的记录跳过（不覆盖）；任一行有错则整批不导入。
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
            <Button type="button" variant="ghost" asChild>
              <a href="/templates/share-import-template.xlsx" download="份额导入模板.xlsx">
                <Download className="mr-1.5 h-4 w-4" />
                下载模板
              </a>
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
            <p className="font-medium text-foreground">表格结构 · 基地写在列名里，成对出现</p>
            <p className="mt-0.5 break-all font-mono text-[10px] leading-4">
              物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C | A份额 | A条数 | B份额 | B条数
            </p>
            <p className="break-all font-mono text-[10px] leading-4">
              物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C | C份额 | C条数 | D份额 | D条数
            </p>
            <ul className="mt-2 list-inside list-disc space-y-0.5">
              <li>一个 sheet 放多块表头，上下堆叠、中间空行；块与块的基地可以不同（上面两行就是）</li>
              <li>加一个基地 = 加两列（份额 + 条数）；换一套基地就把表头行复制一遍改列名</li>
              <li>「条数」= 这个基地有几条产线，属于基地不属于供应商：同一基地每行填同一个数，或只在第一家填、其余留空沿用；两行填了不同的数会报错并指出行号</li>
              <li>每个基地内部，各供应商「基地份额」合计 = 100%（容差 ±1%）；不同基地互不相干</li>
              <li>「本月份额」留空 → 按 Σ(基地份额 × 条数) ÷ Σ该物料全部基地条数 自动算，缺席基地按 0 计，留空一定合计 100%</li>
              <li>份额可写 50 或 0.5，整批统一一种口径；Q / D / C 仅五档 1 / 0.7 / 0.5 / 0.3 / 0</li>
              <li>段由物料决定，表里不写；主档没段时留空待补，之后在物料管理里改</li>
              <li>PN 与供应商代码在主档没有时，按文件里的名称自动建档并挂到当前项目（已有的只复用、不改名）</li>
              <li>项目和月份默认用上面选的；要一份文件导多个项目，把 sheet 改名成 ABC-2026-11，或在表里加「项目代码」「月份」两列</li>
              <li>手动修改过的记录跳过（不覆盖）；任一行有错则整批不导入</li>
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
