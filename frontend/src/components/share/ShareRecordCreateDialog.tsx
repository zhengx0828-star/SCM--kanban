import { useEffect, useMemo, useState } from "react";
import { Calculator, Loader2, Plus, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateShareRecord, useShareRecords } from "@/hooks/use-share";
import { useProjectRelations } from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";
import { QDC_SCORES } from "@/types/share";

/**
 * 手动新增份额记录 —— 多基地行内录入。
 *
 * 每条记录自己携带基地数据（不再有独立的「基地拉线配置」弹窗）：
 * 每行 = 基地名 + 拉线数量 + 该供应商在该基地的份额（%）。
 * 本月系统份额 = Σ(基地份额 × 拉线数量) ÷ Σ拉线数量，实时预览、保存时后端自动算。
 *
 * 录入一致性：
 * - 打开弹窗时聚合当月已有记录中同名基地的拉线数，预填基地行（用户只需确认 + 填份额）；
 * - 新增行基地名自动续号，拉线数沿用同基地已有值（若存在）；
 * - 同一基地的拉线数量在同项目同月内应保持一致（基地属性），由录入习惯保证。
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
  share: string; // 该供应商在该基地的份额（%）
}

const MAX_BASES = 4;
const SCORE_OPTIONS = QDC_SCORES.map((s) => String(s));

/** 聚合当月记录：基地名 → 该基地已录入的拉线数（众数优先，保证同基地一致） */
function aggregateBaseLines(
  records: { bases: { base: string; lines: number }[] | null }[] | undefined
): Map<string, number> {
  const byBase = new Map<string, Map<number, number>>();
  for (const r of records ?? []) {
    for (const b of r.bases ?? []) {
      if (!b.base || !(b.lines >= 1)) continue;
      if (!byBase.has(b.base)) byBase.set(b.base, new Map());
      const cnt = byBase.get(b.base)!;
      cnt.set(b.lines, (cnt.get(b.lines) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>();
  for (const [base, cnt] of byBase) {
    let best = 1;
    let bestN = -1;
    for (const [lines, n] of cnt) {
      if (n > bestN) {
        best = lines;
        bestN = n;
      }
    }
    out.set(base, best);
  }
  return out;
}

/** 生成下一个未被占用的基地名（基地A → 基地B → …） */
function nextBaseName(taken: Set<string>): string {
  for (let i = 0; i < 26; i++) {
    const name = `基地${String.fromCharCode(65 + i)}`;
    if (!taken.has(name)) return name;
  }
  return `基地${taken.size + 1}`;
}

export function ShareRecordCreateDialog({ open, onOpenChange, projectId, month }: Props) {
  const createMutation = useCreateShareRecord();
  // 供应关系只取「当前项目已挂载」的，不带出全量
  const { data: projectRelations, isLoading: relationsLoading } = useProjectRelations(projectId);
  // 同月已有记录 → 聚合同基地拉线数，预填基地行，减少重复录入
  const { data: recordsData } = useShareRecords(projectId, month);
  const aggLines = useMemo(() => aggregateBaseLines(recordsData?.items), [recordsData]);

  const [relationId, setRelationId] = useState<string>("");
  const [rows, setRows] = useState<BaseRow[]>([]);
  const [q, setQ] = useState("");
  const [d, setD] = useState("");
  const [c, setC] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 打开弹窗 → 重置；按当月已有基地预填行（份额留空，由用户填）
  useEffect(() => {
    if (!open) return;
    setRelationId("");
    setQ("");
    setD("");
    setC("");
    setRemark("");
    setError(null);
    if (aggLines.size > 0) {
      setRows(
        [...aggLines.entries()].map(([base, lines]) => ({
          base,
          lines: String(lines),
          share: "",
        }))
      );
    } else {
      setRows([{ base: "基地A", lines: "", share: "" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // aggLines 异步到达后再兜底一次（打开瞬间 records 尚未加载完的情况）
  useEffect(() => {
    if (!open) return;
    if (rows.length === 1 && rows[0].share === "" && rows[0].lines === "" && rows[0].base === "基地A") {
      if (aggLines.size > 0) {
        setRows([...aggLines.entries()].map(([base, lines]) => ({ base, lines: String(lines), share: "" })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, aggLines]);

  // 供应关系选项：仅当前项目挂载的（project_supply_relations → supply_relation_id）
  const relOptions = useMemo(() => {
    return (projectRelations ?? [])
      .filter((r) => r.supply_relation_id != null)
      .sort((a, b) => a.pn.localeCompare(b.pn))
      .map((r) => ({
        id: String(r.supply_relation_id),
        label: `${r.pn} ${r.material_name} × ${r.supplier_name}`,
      }));
  }, [projectRelations]);

  /** 自动算份额预览（与后端 _auto_share_from_bases 同口径）：
      - 分母 = 所有带拉线数量的基地行（含未填份额的行，份额空视为不供该基地）
      - 分子 = Σ(有份额的行 份额 × 拉线)
  */
  const autoShare = useMemo(() => {
    const parsed = rows.map((r) => ({
      lines: Number(r.lines),
      share: r.share.trim() === "" ? null : Number(r.share),
    }));
    const totalLines = parsed.reduce((s, x) => s + (Number.isInteger(x.lines) && x.lines > 0 ? x.lines : 0), 0);
    const valued = parsed.filter((x) => x.share != null && !Number.isNaN(x.share));
    if (valued.length === 0) return null;
    if (valued.some((x) => Number.isNaN(x.lines))) return NaN;
    if (totalLines <= 0) return NaN;
    const sum = valued.reduce((s, x) => s + x.share! * x.lines, 0);
    return sum / totalLines;
  }, [rows]);

  const updateRow = (i: number, patch: Partial<BaseRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setError(null);
  };

  const addRow = () => {
    if (rows.length >= MAX_BASES) return;
    const taken = new Set(rows.map((r) => r.base.trim()).filter(Boolean));
    const name = nextBaseName(taken);
    setRows((prev) => [...prev, { base: name, lines: String(aggLines.get(name) ?? ""), share: "" }]);
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setError(null);
  };

  const handleSave = () => {
    if (!projectId) return setError("请先选择项目");
    if (!relationId) return setError("请选择供应关系（物料 × 供应商）");

    // 行级校验：基地名非空且不重复；拉线数量正整数；份额 0-100（空 = 不供该基地）
    const cleaned: { base: string; lines: number; share: number | null }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const base = r.base.trim();
      const linesRaw = r.lines.trim();
      const shareRaw = r.share.trim();
      if (!base) return setError("基地名不能为空（可删除不需要的行）");
      if (seen.has(base)) return setError(`基地「${base}」重复`);
      seen.add(base);
      if (linesRaw === "") {
        // 整行空白 → 丢弃（不参与计算）；若填了份额却无拉线则报错
        if (shareRaw !== "") return setError(`基地「${base}」填写了份额，请补拉线数量`);
        continue;
      }
      const lines = Number(linesRaw);
      if (!Number.isInteger(lines) || lines <= 0) return setError(`基地「${base}」拉线数量应为正整数`);
      if (shareRaw === "") {
        // 不供该基地：保留行（拉线计入分母，份额为空不参与分子）
        cleaned.push({ base, lines, share: null });
      } else {
        const sn = Number(shareRaw);
        if (Number.isNaN(sn) || sn < 0 || sn > 100) return setError(`基地「${base}」份额应为 0-100 之间的数字`);
        cleaned.push({ base, lines, share: sn });
      }
    }
    if (!cleaned.some((b) => b.share != null)) return setError("请至少填写一个基地的份额");
    if (autoShare == null || Number.isNaN(autoShare)) return setError("自动算份额失败，请检查基地份额与拉线数量");

    setError(null);
    createMutation.mutate(
      {
        project_id: projectId,
        supply_relation_id: Number(relationId),
        month,
        bases: cleaned.map((b) => ({ base: b.base, lines: b.lines, share: b.share ?? undefined })),
        ...(q !== "" ? { q_score: Number(q) } : {}),
        ...(d !== "" ? { d_score: Number(d) } : {}),
        ...(c !== "" ? { c_score: Number(c) } : {}),
        ...(remark !== "" ? { remark } : {}),
      },
      {
        onSuccess: () => {
          toast.success(
            `份额记录已新增，本月系统份额自动算为 ${autoShare.toFixed(2)}%（Σ份额×拉线 ÷ Σ拉线）`
          );
          onOpenChange(false);
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>手动录入份额（{month}）</DialogTitle>
          <DialogDescription>
            逐基地录入：基地名 + 拉线数量 + 该供应商在该基地的份额（%）。多基地时填多行，
            本月系统份额 = Σ(份额 × 拉线) ÷ Σ拉线，实时预览、保存后自动计算。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>供应关系 <span className="text-red-500">*</span></Label>
            <Select value={relationId || undefined} onValueChange={setRelationId}>
              <SelectTrigger>
                <SelectValue placeholder="选择物料 × 供应商" />
              </SelectTrigger>
              <SelectContent>
                {relationsLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">加载中…</div>
                ) : relOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">该项目暂无挂载的供应关系</div>
                ) : (
                  relOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 基地行内录入 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>基地份额 <span className="text-red-500">*</span></Label>
              <span className="text-[11px] text-muted-foreground">
                同基地拉线数建议保持一致（最多 {MAX_BASES} 个基地）
              </span>
            </div>

            <div className="grid grid-cols-[1fr_5.5rem_5.5rem_2rem] items-center gap-2">
              <div className="text-[11px] text-muted-foreground">基地</div>
              <div className="text-center text-[11px] text-muted-foreground">拉线数量</div>
              <div className="text-center text-[11px] text-muted-foreground">份额（%）</div>
              <div />
            </div>

            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_5.5rem_2rem] items-center gap-2">
                <Input
                  value={r.base}
                  onChange={(e) => updateRow(i, { base: e.target.value })}
                  placeholder="基地名"
                  className="h-8"
                />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={r.lines}
                  onChange={(e) => updateRow(i, { lines: e.target.value })}
                  placeholder="线数"
                  className="h-8 text-center tabular-nums"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={r.share}
                  onChange={(e) => updateRow(i, { share: e.target.value })}
                  placeholder="%"
                  className="h-8 text-center tabular-nums"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-500"
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1}
                  title="删除该基地行"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addRow}
              disabled={rows.length >= MAX_BASES}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              添加基地（{rows.length}/{MAX_BASES}）
            </Button>

            {autoShare != null && !Number.isNaN(autoShare) && (
              <p className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                <Calculator className="h-3.5 w-3.5" />
                本月系统份额（自动算）=
                <b className="text-foreground">{autoShare.toFixed(2)}%</b>
                <span className="text-[10px]">Σ(份额×拉线) ÷ Σ拉线</span>
              </p>
            )}
            {rows.some((r) => r.share.trim() !== "") &&
              autoShare != null &&
              !Number.isNaN(autoShare) &&
              rows.filter((r) => r.share.trim() !== "").length !== rows.length && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  未填份额的基地行 = 该供应商不供此基地：不计入分子，但其拉线仍计入分母（总拉线数）。
                </p>
              )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Q 质量</Label>
              <Select value={q || undefined} onValueChange={setQ}>
                <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {SCORE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>D 交付</Label>
              <Select value={d || undefined} onValueChange={setD}>
                <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {SCORE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>C 成本</Label>
              <Select value={c || undefined} onValueChange={setC}>
                <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {SCORE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
