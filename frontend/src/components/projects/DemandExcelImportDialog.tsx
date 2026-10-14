import { useMemo, useRef, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, Loader2 } from "lucide-react";
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
import { projectApi } from "@/lib/api";
import {
  useProjectRelations,
  useUpdateProjectBom,
  useUpdateProjectDemand,
  useUpdateProjectRelation,
} from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";
import type { ProjectSupplyRelation } from "@/types/project";

/**
 * 供需管理 Excel 导入弹窗（**双 sheet**）。
 *
 * 与「供应商列表」的四元组模板**职责不同**：
 *   · 供应商列表 Excel = 建关系（PN · 物料名 · 供应商名 · 供应商代码），可新建主数据
 *   · 本弹窗         = 录数值（客户需求 · BOM系数 · 供应商产能），只写项目明细扩展字段，
 *                      **不新建任何物料-供应商关系**——关系不存在时该行报错跳过。
 *
 * 两个工作表：
 *   `客户需求`       项目代码 | 1月 … 12月                     （项目级，一行一个项目）
 *   `物料BOM与产能`  项目代码 | 物料PN | 物料名称 | BOM系数 |
 *                    供应商代码 | 供应商名称 | 产能_1月 … 产能_12月
 *                                                             （一行 = 项目×物料×供应商）
 *
 * 语义：
 *   - 需求/S 是项目级 → 走 PUT /projects/{id}/demand（一次覆盖该项目全部月份）
 *   - BOM 是项目×物料级 → 走 PUT /projects/{id}/bom（同步到该物料所有行）
 *   - 产能是明细级 → 走 PATCH /projects/{id}/relations/{linkId}（整行覆盖该明细的 12 月产能）
 *   - 关系不存在 → 该行记入失败清单，**不静默创建**（职责分离）
 */

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

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

/** 取数字：空串/非数字 → 0 */
function toNum(s: string): number {
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------- 解析：客户需求 ------------------------------- */
interface DemandRow {
  project_code: string;
  months: number[]; // length 12
}

function parseDemandSheet(sheet: unknown): DemandRow[] {
  // @ts-ignore - XLSX 用全局声明
  const raw = (window.XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>) ?? [];
  const rows: DemandRow[] = [];
  for (const r of raw) {
    const project_code = pick(r, "项目代码", "项目编码", "项目");
    if (!project_code) continue; // 无项目代码的行直接跳过（含说明行 / 空行）
    const months = MONTHS.map((i) =>
      toNum(pick(r, `${i + 1}月`, `${i + 1} 月`, `M${i + 1}`, `${i + 1}`))
    );
    rows.push({ project_code, months });
  }
  return rows;
}

/* ---------------------------- 解析：物料BOM与产能 ---------------------------- */
interface BomCapacityRow {
  project_code: string;
  pn: string;
  material_name: string;
  bom_factor: number | null;
  supplier_code: string;
  supplier_name: string;
  capacity: number[]; // length 12
}

function parseBomCapacitySheet(sheet: unknown): BomCapacityRow[] {
  // @ts-ignore
  const raw = (window.XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>) ?? [];
  const rows: BomCapacityRow[] = [];
  for (const r of raw) {
    const project_code = pick(r, "项目代码", "项目编码", "项目");
    const pn = pick(r, "物料PN", "物料 PN", "PN", "物料pn");
    if (!project_code || !pn) continue; // 缺关键列 → 视为说明/空行
    const bomRaw = pick(r, "BOM系数", "BOM 系数", "BOM", "用量系数");
    const bom_factor = bomRaw === "" ? null : Number(bomRaw.replace(/,/g, ""));
    const capacity = MONTHS.map((i) =>
      toNum(pick(r, `产能_${i + 1}月`, `产能${i + 1}月`, `产能_${i + 1}`, `${i + 1}月`))
    );
    rows.push({
      project_code,
      pn,
      material_name: pick(r, "物料名称", "物料名", "名称"),
      bom_factor: bom_factor != null && Number.isFinite(bom_factor) ? bom_factor : null,
      supplier_code: pick(r, "供应商代码", "供应商 code", "代码"),
      supplier_name: pick(r, "供应商名称", "供应商名", "供应商"),
      capacity,
    });
  }
  return rows;
}

type FailItem = { sheet: string; row: number; label: string; error: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  projectCode: string;
  projectName: string;
}

export function DemandExcelImportDialog({ open, onOpenChange, projectId, projectCode, projectName }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const demandMutation = useUpdateProjectDemand(projectId);
  const bomMutation = useUpdateProjectBom(projectId);
  const relationMutation = useUpdateProjectRelation(projectId);

  /**
   * 用 relations 建立「物料PN + 供应商代码 → linkId」索引，
   * 用于校验"该关系是否存在"并定位要写产能的明细行。
   */
  const { data: relations = [] } = useProjectRelations(projectId);
  const relationIndex = useMemo(() => {
    const m = new Map<string, ProjectSupplyRelation>();
    for (const r of relations) {
      m.set(`${r.pn}||${r.supplier_code}`, r);
    }
    return m;
  }, [relations]);

  const projectByCode = useMemo(
    () => new Map([[projectCode, projectId]]),
    [projectCode, projectId]
  );

  const [fileName, setFileName] = useState("");
  const [demandRows, setDemandRows] = useState<DemandRow[]>([]);
  const [bomRows, setBomRows] = useState<BomCapacityRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: FailItem[] } | null>(null);

  const reset = () => {
    setFileName("");
    setDemandRows([]);
    setBomRows([]);
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
      const names: string[] = wb.SheetNames ?? [];
      const demandSheetName = names.find((n) => n.includes("需求"));
      const bomSheetName = names.find((n) => n.includes("BOM") || n.includes("产能"));

      if (!demandSheetName && !bomSheetName) {
        setParseError("未找到「客户需求」或「物料BOM与产能」工作表，请使用下载的模板填写");
        setDemandRows([]);
        setBomRows([]);
        return;
      }

      const dRows = demandSheetName ? parseDemandSheet(wb.Sheets[demandSheetName]) : [];
      const bRows = bomSheetName ? parseBomCapacitySheet(wb.Sheets[bomSheetName]) : [];

      if (dRows.length === 0 && bRows.length === 0) {
        setParseError("未解析到任何有效行（请检查表头：项目代码 / 1月…12月 / 物料PN / 产能_1月…产能_12月）");
        setDemandRows([]);
        setBomRows([]);
        return;
      }
      setDemandRows(dRows);
      setBomRows(bRows);
    } catch (err) {
      setParseError(`解析失败：${getApiErrorMessage(err)}`);
      setDemandRows([]);
      setBomRows([]);
    }
  };

  /** Excel 1-based 行号（含表头，所以数据从第 2 行起） */
  const handleImport = async () => {
    if (!projectId || (demandRows.length === 0 && bomRows.length === 0)) return;
    setImporting(true);
    setResult(null);
    const failed: FailItem[] = [];
    let success = 0;

    // ---- Sheet1：客户需求 ----
    for (let i = 0; i < demandRows.length; i++) {
      const r = demandRows[i];
      const excelRow = i + 2;
      if (r.project_code !== projectCode) {
        failed.push({
          sheet: "客户需求",
          row: excelRow,
          label: r.project_code,
          error: `项目代码「${r.project_code}」与当前项目「${projectCode}」不一致，请在对应项目页导入`,
        });
        continue;
      }
      try {
        await demandMutation.mutateAsync({ demand: r.months });
        success++;
      } catch (err) {
        failed.push({ sheet: "客户需求", row: excelRow, label: r.project_code, error: getApiErrorMessage(err) });
      }
    }

    // ---- Sheet2：BOM + 产能 ----
    // 同一「项目×物料」的 BOM 只提交一次（后端会同步到该物料所有行）
    const bomSubmitted = new Set<string>();
    for (let i = 0; i < bomRows.length; i++) {
      const r = bomRows[i];
      const excelRow = i + 2;
      const label = `${r.pn} / ${r.supplier_code}`;

      if (r.project_code !== projectCode) {
        failed.push({
          sheet: "物料BOM与产能",
          row: excelRow,
          label,
          error: `项目代码「${r.project_code}」与当前项目「${projectCode}」不一致，请在对应项目页导入`,
        });
        continue;
      }

      // 1) BOM：按「项目×物料」提交一次
      if (r.bom_factor != null) {
        const bomKey = r.pn;
        if (!bomSubmitted.has(bomKey)) {
          bomSubmitted.add(bomKey);
          try {
            await bomMutation.mutateAsync({ material_pn: r.pn, bom_factor: r.bom_factor });
          } catch (err) {
            // BOM 失败不阻断该行产能导入，仅记录
            failed.push({
              sheet: "物料BOM与产能",
              row: excelRow,
              label: `${r.pn} BOM`,
              error: getApiErrorMessage(err),
            });
          }
        }
      }

      // 2) 产能：必须命中已有明细行，否则报错跳过（不自动建关系）
      if (!r.supplier_code) {
        failed.push({ sheet: "物料BOM与产能", row: excelRow, label, error: "缺少供应商代码" });
        continue;
      }
      const link = relationIndex.get(`${r.pn}||${r.supplier_code}`);
      if (!link) {
        failed.push({
          sheet: "物料BOM与产能",
          row: excelRow,
          label,
          error: "该项目下不存在此「物料-供应商」供应关系，请先在供应商列表挂载后再导入产能",
        });
        continue;
      }
      try {
        await relationMutation.mutateAsync({ linkId: link.id, data: { capacity: r.capacity } });
        success++;
      } catch (err) {
        failed.push({ sheet: "物料BOM与产能", row: excelRow, label, error: getApiErrorMessage(err) });
      }
    }

    setImporting(false);
    setResult({ success, failed });
    if (success > 0 && failed.length === 0) {
      toast.success(`导入完成：成功 ${success} 处`);
    } else if (success > 0) {
      toast.warning(`部分成功：成功 ${success}，失败 ${failed.length}`);
    } else {
      toast.error(`导入失败：${failed.length} 处`);
    }
  };

  const downloadTemplate = () => {
    window.open(projectApi.demandTemplateUrl(), "_blank");
  };

  const totalRows = demandRows.length + bomRows.length;

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
          <DialogTitle>导入供需数据（Excel）</DialogTitle>
          <DialogDescription>
            为「{projectName}」批量导入<b>客户需求</b>、<b>BOM 系数</b>与<b>供应商产能</b>。
            本模板只录数值，<b>不会新建物料-供应商关系</b>；关系不存在时对应行会报错跳过。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 模板说明 + 下载 */}
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">模板结构（两个工作表）</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={downloadTemplate}>
                  <Download className="mr-1 h-3 w-3" />
                  下载模板
                </Button>
              </div>
            </div>
            <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-mono text-foreground">客户需求</span>
                ：项目代码 | 1月 … 12月（一行一个项目，项目级）
              </p>
              <p>
                <span className="font-mono text-foreground">物料BOM与产能</span>
                ：项目代码 | 物料PN | 物料名称 | BOM系数 | 供应商代码 | 供应商名称 | 产能_1月 … 产能_12月
              </p>
              <p className="text-[10px]">
                仅支持当前项目「{projectCode}」的数据；其他项目代码的行会报错跳过。
                BOM 与需求按项目/物料覆盖，产能整行覆盖该明细 12 个月。
              </p>
            </div>
          </div>

          {/* 文件选择 */}
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

          {/* 预览 */}
          {totalRows > 0 && (
            <div className="space-y-2 rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  解析到 客户需求 {demandRows.length} 行 · BOM与产能 {bomRows.length} 行
                </span>
                <Button size="sm" onClick={handleImport} disabled={importing}>
                  {importing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  确认导入
                </Button>
              </div>

              {demandRows.length > 0 && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">客户需求（前 3 行）</p>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-normal">项目代码</th>
                        <th className="py-1 font-normal">年合计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demandRows.slice(0, 3).map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-1 font-mono">{r.project_code}</td>
                          <td className="py-1 tabular-nums">{r.months.reduce((a, b) => a + b, 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {bomRows.length > 0 && (
                <div className="border-t px-3 py-2">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">物料BOM与产能（前 3 行）</p>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-normal">物料PN</th>
                        <th className="py-1 font-normal">BOM</th>
                        <th className="py-1 font-normal">供应商</th>
                        <th className="py-1 font-normal">产能年合计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bomRows.slice(0, 3).map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-1 font-mono">{r.pn}</td>
                          <td className="py-1 tabular-nums">{r.bom_factor ?? "—"}</td>
                          <td className="py-1">{r.supplier_code || "—"}</td>
                          <td className="py-1 tabular-nums">{r.capacity.reduce((a, b) => a + b, 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 结果 */}
          {result && (
            <div className="rounded-lg border p-3">
              <p className="text-sm">
                <span className="text-green-600 dark:text-green-400">成功 {result.success} 处</span>
                {result.failed.length > 0 && (
                  <span className="ml-2 text-red-600 dark:text-red-400">失败 {result.failed.length} 处</span>
                )}
              </p>
              {result.failed.length > 0 && (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border bg-muted/30 p-2 text-xs">
                  {result.failed.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="shrink-0 text-muted-foreground">
                        [{f.sheet}] 第 {f.row} 行{f.label ? `（${f.label}）` : ""}：
                      </span>
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
              onOpenChange(false);
              reset();
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
