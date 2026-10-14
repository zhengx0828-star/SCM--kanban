import { useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useQuickAddProjectRelation } from "@/hooks/use-projects";
import { cn, getApiErrorMessage } from "@/lib/utils";

/* ---------- 导入 Excel 的四元组行（PN / 物料名称 / 供应商名称 / 供应商代码） ---------- */
type ImportRow = { pn: string; material_name: string; supplier_name: string; supplier_code: string };

/** 灵活匹配表头列名（去空格 + 小写后比较） */
function pick(row: Record<string, unknown>, ...candidates: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const keys = Object.keys(row);
  for (const c of candidates) {
    const target = norm(c);
    const found = keys.find((k) => norm(k) === target);
    if (found) {
      const v = row[found];
      if (v != null) return String(v).trim();
    }
  }
  return "";
}

function parseRowsFromSheet(sheet: unknown): ImportRow[] {
  // @ts-ignore - XLSX 类型用全局声明
  const raw = (window.XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>) ?? [];
  const rows: ImportRow[] = [];
  for (const r of raw) {
    const row: ImportRow = {
      pn: pick(r, "PN", "物料PN", "物料 PN", "物料pn"),
      material_name: pick(r, "物料名称", "物料名", "名称"),
      supplier_name: pick(r, "供应商名称", "供应商名", "供应商"),
      supplier_code: pick(r, "供应商代码", "代码", "供应商 code"),
    };
    // 跳过完全空白行
    if (!row.pn && !row.material_name && !row.supplier_name && !row.supplier_code) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * 导入 Excel 弹窗（项目明细批量录入）。
 * 文件格式约定：列名 PN / 物料名称 / 供应商名称 / 供应商代码（首行表头），可含其他列但会被忽略。
 */
export function ExcelImportDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  projectName: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const quickAddMutation = useQuickAddProjectRelation(projectId);
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    success: number;
    failed: Array<{ row: number; pn: string; error: string }>;
    /** 系统里已存在且名称不一致 → 沿用系统原名（不改全局主数据），这里如实告知 */
    nameKept: Array<{ row: number; pn: string; text: string }>;
  } | null>(null);

  const reset = () => {
    setFileName("");
    setRows([]);
    setParseError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      // @ts-ignore
      const wb = window.XLSX.read(buf, { type: "array" });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        setParseError("文件不含工作表");
        setRows([]);
        return;
      }
      const parsed = parseRowsFromSheet(wb.Sheets[firstSheetName]);
      if (parsed.length === 0) {
        setParseError("未解析到任何有效行（需包含 PN / 物料名称 / 供应商名称 / 供应商代码 四列）");
        setRows([]);
        return;
      }
      setRows(parsed);
    } catch (err) {
      setParseError(`解析失败：${getApiErrorMessage(err)}`);
      setRows([]);
    }
  };

  const handleImport = async () => {
    if (!projectId || rows.length === 0) return;
    setImporting(true);
    setResult(null);
    const failed: Array<{ row: number; pn: string; error: string }> = [];
    const nameKept: Array<{ row: number; pn: string; text: string }> = [];
    let success = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.pn || !r.material_name || !r.supplier_name || !r.supplier_code) {
        failed.push({ row: i + 2, pn: r.pn, error: "四个字段不能为空" });
        continue;
      }
      try {
        const res = await quickAddMutation.mutateAsync({
          pn: r.pn,
          material_name: r.material_name,
          supplier_name: r.supplier_name,
          supplier_code: r.supplier_code,
          // ★ 批量导入**绝不改全局主数据名称**：物料按 PN、供应商按 code 是全项目共用的一条，
          //   改名会连带改掉其它项目页面上的显示（2026-10-14 事故：导入 EP1 把 LFP3 的 191 改成了 CCS）。
          sync_master_names: false,
        });
        success++;
        // 服务端沿用原名 → 如实提示，避免用户以为文件里的名字生效了
        const diff: string[] = [];
        if (res.material_name !== r.material_name) {
          diff.push(`物料 ${r.pn} 系统里已叫「${res.material_name}」`);
        }
        if (res.supplier_name !== r.supplier_name) {
          diff.push(`供应商 ${r.supplier_code} 系统里已叫「${res.supplier_name}」`);
        }
        if (diff.length > 0) {
          nameKept.push({ row: i + 2, pn: r.pn, text: `${diff.join("；")}，已沿用系统原名` });
        }
      } catch (err) {
        failed.push({ row: i + 2, pn: r.pn, error: getApiErrorMessage(err) });
      }
    }
    setImporting(false);
    setResult({ success, failed, nameKept });
    if (success > 0 && failed.length === 0) {
      toast.success(
        nameKept.length > 0
          ? `导入完成：成功 ${success} 条（${nameKept.length} 条沿用了系统原有名称）`
          : `导入完成：成功 ${success} 条`
      );
    } else if (success > 0) {
      toast.warning(`部分成功：成功 ${success}，失败 ${failed.length}`);
    } else {
      toast.error(`导入失败：${failed.length} 条`);
    }
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
          <DialogTitle>导入 Excel</DialogTitle>
          <DialogDescription>
            将「{projectName}」的批量明细从 .xlsx / .xls 导入。文件列约定：<b>PN · 物料名称 · 供应商名称 · 供应商代码</b>（首行表头），其他列会被忽略。
            <br />
            已存在的物料 / 供应商只会被<b>挂载到本项目</b>，<b>不会改动它们的名称</b>（主数据为所有项目共用，改名会影响其它项目）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              disabled={importing}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              选择文件
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>

          {parseError && (
            <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {parseError}
            </p>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  共 {rows.length} 行，预览前 {Math.min(5, rows.length)} 行
                </span>
                <Button size="sm" onClick={handleImport} disabled={importing}>
                  {importing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  确认导入
                </Button>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-1.5 font-normal">#</th>
                    <th className="px-3 py-1.5 font-normal">PN</th>
                    <th className="px-3 py-1.5 font-normal">物料名称</th>
                    <th className="px-3 py-1.5 font-normal">供应商名称</th>
                    <th className="px-3 py-1.5 font-normal">供应商代码</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground">{i + 2}</td>
                      <td className="px-3 py-1.5 font-mono">{r.pn || "—"}</td>
                      <td className="px-3 py-1.5">{r.material_name || "—"}</td>
                      <td className="px-3 py-1.5">{r.supplier_name || "—"}</td>
                      <td className="px-3 py-1.5 font-mono">{r.supplier_code || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result && (
            <div className="rounded-lg border p-3">
              <p className="text-sm">
                <span className="text-green-600 dark:text-green-400">成功 {result.success} 条</span>
                {result.failed.length > 0 && (
                  <span className="ml-2 text-red-600 dark:text-red-400">失败 {result.failed.length} 条</span>
                )}
                {result.nameKept.length > 0 && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    沿用原名 {result.nameKept.length} 条
                  </span>
                )}
              </p>
              {result.nameKept.length > 0 && (
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded border bg-muted/30 p-2 text-xs">
                  {result.nameKept.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="shrink-0 text-muted-foreground">第 {w.row} 行{w.pn ? `（${w.pn}）` : ""}：</span>
                      <span className="text-amber-700 dark:text-amber-400">{w.text}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    导入不会改动其它项目共用的主数据名称；确需改名请到「物料 / 供应商」Tab 手动修改。
                  </p>
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded border bg-muted/30 p-2 text-xs">
                  {result.failed.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-muted-foreground">第 {f.row} 行{f.pn ? `（${f.pn}）` : ""}：</span>
                      <span className="text-red-600 dark:text-red-400">{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (result) {
                // 导入已结束，关闭时把变更传递出去（关弹窗后父组件的列表已 invalidate）
                onOpenChange(false);
                reset();
              } else {
                onOpenChange(false);
                reset();
              }
            }}
            disabled={importing}
          >
            {result ? "完成" : "取消"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
