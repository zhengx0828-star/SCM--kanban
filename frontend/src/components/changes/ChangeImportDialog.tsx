import { useState } from "react";
import { ClipboardCopy, Download, FileUp, Loader2 } from "lucide-react";
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
import { useImportChanges } from "@/hooks/use-changes";
import { changeApi } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 变更管理 Excel 导入（**双 sheet**）。
 *
 * 现状说明：与库存模块一致，导入走「服务端本地文件路径」（前后端同机），
 * 不做浏览器上传。后续接上传时只需换掉接口入参。
 *
 * 两个工作表：
 *   `变更单`  序号 / 项目代码 / 物料PN / 变更类型 / 责任人 / 标题 / 描述 / 状态
 *   `待办项`  序号 / 变更单序号 / 父项行号 / 层级 / 任务名 / 责任人 / 计划开始 / 计划完成 / 是否完成
 *
 * - **层级**用「父项行号」表达：留空 = 一级待办项；填 `3` = 第 3 行的子项，可层层向上（最多 5 层）
 * - **匹配键**：变更单按 `序号`；序号留空 = 新建（退一步用 项目代码+物料PN+标题 兜底匹配）
 * - 先校验后写入，错误行集中返回，不静默跳过
 */

const SHEET_HEADERS: { sheet: string; cols: string[] }[] = [
  {
    sheet: "变更单",
    cols: ["序号", "项目代码", "物料PN", "变更类型", "责任人", "标题", "描述", "状态"],
  },
  {
    sheet: "待办项",
    cols: ["序号", "变更单序号", "父项行号", "层级", "任务名", "责任人", "计划开始", "计划完成", "是否完成"],
  },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ChangeImportDialog({ open, onOpenChange }: Props) {
  const importMutation = useImportChanges();
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
        const summary =
          `新增变更单 ${res.created_changes} · 更新 ${res.updated_changes} · ` +
          `新增待办项 ${res.created_tasks} · 更新 ${res.updated_tasks}` +
          (res.skipped > 0 ? ` · 跳过 ${res.skipped}` : "");
        if (res.errors.length > 0) {
          toast.warning(`${summary}；${res.errors.length} 行未导入：${res.errors.slice(0, 3).join("；")}`);
        } else {
          toast.success(`导入完成：${summary}`);
        }
        onOpenChange(false);
        setFilePath("");
      },
      onError: (err) => setError(getApiErrorMessage(err)),
    });
  };

  /** 离线友好：把表头用制表符拼好复制走，粘到 Excel 第一行即可当模板 */
  /**
   * 下载空模板（.xlsx 两个 sheet，表头与导入解析一致）。
   * 走浏览器直链下载，和导出 Excel 一个路子；服务端生成，前端不依赖任何 Excel 库。
   */
  const downloadTemplate = () => {
    window.open(changeApi.templateUrl(), "_blank");
  };

  const copyHeaders = async () => {
    const text = SHEET_HEADERS.map(
      (s) => `【${s.sheet}】\n${s.cols.join("\t")}`
    ).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("表头已复制，粘贴到 Excel 第一行即可");
    } catch {
      toast.error("复制失败，请手动选中下方文字复制");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Excel 导入变更单与待办项</DialogTitle>
          <DialogDescription>
            一个工作簿两个工作表（<span className="font-mono">变更单</span> +
            <span className="font-mono"> 待办项</span>）。导入前会先校验项目、物料、类型与层级，
            有问题的行会列出来，不会静默跳过。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Excel 文件路径（服务器本地）</Label>
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="如 C:/changes/2026-10-变更台账.xlsx"
            />
            <p className="text-[11px] text-muted-foreground">
              前后端同机运行，直接填文件在电脑上的绝对路径即可。
            </p>
          </div>

          {/* 模板说明 */}
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">模板列（表头行）</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={downloadTemplate}>
                  <Download className="mr-1 h-3 w-3" />
                  下载空模板
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={copyHeaders}>
                  <ClipboardCopy className="mr-1 h-3 w-3" />
                  复制表头
                </Button>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {SHEET_HEADERS.map((s) => (
                <div key={s.sheet}>
                  <p className="font-mono text-[11px] text-foreground">{s.sheet}</p>
                  <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {s.cols.join(" | ")}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              「父项行号」留空 = 一级待办项；填 <span className="font-mono">3</span> = 第 3 行的子项，
              可层层向上（最多 5 层）。日期请写 <span className="font-mono">YYYY-MM-DD</span>。
              序号留空 = 新建。
            </p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={importMutation.isPending}>
            {importMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileUp className="mr-1.5 h-3.5 w-3.5" />
            )}
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
