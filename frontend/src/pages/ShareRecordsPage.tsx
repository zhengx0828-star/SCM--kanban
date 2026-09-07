import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarRange,
  FileUp,
  Inbox,
  Plus,
  Search,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { ShareImportDialog } from "@/components/share/ShareImportDialog";
import { ShareRecordCreateDialog } from "@/components/share/ShareRecordCreateDialog";
import {
  useDeleteShareRecord,
  useRolloverShare,
  useShareProjects,
  useShareRecords,
  useUpdateShareRecord,
} from "@/hooks/use-share";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { QDC_SCORES, type ShareBase, type ShareRecord, type ShareRecordUpdateInput, type ShareSummary } from "@/types/share";

/* -------------------------------------------------------------------------- */
/*  工具                                                                      */
/* -------------------------------------------------------------------------- */

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

/** 聚合当月记录 → 基地并集列。lines 取该基地出现最多的拉线数（众数），列序按首现顺序。 */
function aggregateBaseCols(
  records: ShareRecord[]
): { base: string; lines: number }[] {
  const linesByBase = new Map<string, number[]>();
  for (const r of records) {
    for (const b of r.bases ?? []) {
      if (!b.base) continue;
      if (!linesByBase.has(b.base)) linesByBase.set(b.base, []);
      if (b.lines != null && b.lines >= 1) linesByBase.get(b.base)!.push(b.lines);
    }
  }
  const out: { base: string; lines: number }[] = [];
  for (const [base, arr] of linesByBase) {
    const cnt = new Map<number, number>();
    for (const l of arr) cnt.set(l, (cnt.get(l) ?? 0) + 1);
    let best = 1;
    let bestN = -1;
    for (const [l, n] of cnt) {
      if (n > bestN) {
        best = l;
        bestN = n;
      }
    }
    out.push({ base, lines: best });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  页面                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 份额管理 · 明细页（独立页面）。
 *
 * - 供应商按项目固定；明细只维护每月本份额和 QDC，行内直接改（类 Excel）。
 * - 月末结转：把上月供应关系沿用至新月（share_current/Q/D/C 清空，仅保留
 *   share_prev / quota_prev），供应商不变。
 * - 物料展示：PN 大字在上，物料名小字在下；供应商名称 + 代码同样双行。
 */
export default function ShareRecordsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(searchParams.get("month") ?? currentMonth());
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [deleting, setDeleting] = useState<ShareRecord | null>(null);

  const { data: projects } = useShareProjects();
  const list = projects ?? [];
  const urlProjectId = searchParams.get("project_id");
  const [selected, setSelected] = useState<number | null>(() =>
    urlProjectId ? Number(urlProjectId) : null
  );
  const projectId = selected ?? list[0]?.project_id ?? null;
  const activeProject = list.find((p) => p.project_id === projectId);

  const { data: recordsData, isLoading: recordsLoading } = useShareRecords(projectId, month, keyword);
  const records = recordsData?.items ?? [];
  const options = useMemo(() => monthOptions(), []);

  // 基地列 = 当月全部记录 bases 的基地并集（每条记录自带 lines；同基地跨记录拉线数应一致）。
  // 每基地列头显示该基地出现最多的拉线数；行内该基地配额以该记录自己的值为准。
  const baseCols = useMemo(() => aggregateBaseCols(records), [records]);

  const rollover = useRolloverShare();
  const deleteRec = useDeleteShareRecord();

  const handleDelete = () => {
    if (!deleting) return;
    const target = deleting;
    deleteRec.mutate(target.id, {
      onSuccess: () => {
        toast.success(`「${target.material_name} · ${target.supplier_name}」份额记录已删除`);
        setDeleting(null);
      },
      onError: (e) => toast.error(getApiErrorMessage(e)),
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(keywordInput.trim());
  };

  const handleRollover = () => {
    if (!projectId) return;
    const from = prevMonth(month);
    rollover.mutate(
      { projectId, fromMonth: from, toMonth: month },
      {
        onSuccess: (res: ShareSummary) => {
          const total = res?.total_relations;
          toast.success(
            `已从 ${from} 结转到 ${month}：新增 ${typeof total === "number" ? total : 0} 条空档`
          );
          setRolloverOpen(false);
        },
        onError: (e) => toast.error(getApiErrorMessage(e)),
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={() => navigate("/share")}
                  className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  返回份额概览
                </button>
                <h1 className="text-4xl font-semibold tracking-tight">份额明细</h1>
                <p className="mt-2 max-w-3xl text-muted-foreground">
                  项目 {activeProject ? `「${activeProject.name}」` : ""} 的 {month} 份额：供应商固定，直接在表格里改份额和 QDC；
                  月末结转可一键翻月，供应商不变。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={projectId ?? ""}
                  onChange={(e) => setSelected(Number(e.target.value))}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {list.length === 0 && <option value="">暂无项目</option>}
                  {list.map((p) => (
                    <option key={p.project_id} value={p.project_id}>
                      {p.name}（{p.code}）
                    </option>
                  ))}
                </select>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {options.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <Button variant="outline" onClick={() => setRolloverOpen(true)} disabled={!projectId}>
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  月末结转
                </Button>
                <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!projectId}>
                  <FileUp className="mr-1.5 h-4 w-4" />
                  导入 Excel
                </Button>
                <Button onClick={() => setCreateOpen(true)} disabled={!projectId}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  手动录入
                </Button>
              </div>
            </div>

            {/* 明细表 */}
            <Card className="mt-8">
              <CardContent className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CalendarRange className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-medium">{month} 份额明细</h2>
                    <Badge variant="secondary" className="font-normal">
                      {recordsData?.total ?? 0} 条
                    </Badge>
                  </div>
                  <form onSubmit={handleSearch} className="relative w-64">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      placeholder="搜索 PN / 物料名 / 供应商…"
                      className="pl-9"
                    />
                  </form>
                </div>

                {recordsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : records.length === 0 ? (
                  <EmptyState
                    icon={<Inbox className="h-6 w-6" />}
                    title={projectId ? `${month} 暂无份额数据` : "请先选择项目"}
                    description={
                      projectId
                        ? `点击「月末结转」从 ${prevMonth(month)} 一键生成新月空档（供应商沿用），或「手动录入 / 导入 Excel」维护数据。`
                        : "顶部选择项目后查看份额明细"
                    }
                    action={
                      projectId ? (
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => setRolloverOpen(true)}>
                            <Wand2 className="mr-1.5 h-4 w-4" />
                            月末结转
                          </Button>
                          <Button onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-1.5 h-4 w-4" />
                            手动录入
                          </Button>
                        </div>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px]">物料</TableHead>
                          <TableHead className="min-w-[160px]">供应商</TableHead>
                          <TableHead className="text-right">本月份额</TableHead>
                          {baseCols.map((b) => (
                            <TableHead key={b.base} className="text-right">
                              {b.base}
                              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                {b.lines}线
                              </span>
                            </TableHead>
                          ))}
                          <TableHead className="text-right">上期份额</TableHead>
                          <TableHead className="w-[72px] text-center">Q</TableHead>
                          <TableHead className="w-[72px] text-center">D</TableHead>
                          <TableHead className="w-[72px] text-center">C</TableHead>
                          <TableHead className="text-right">加权分</TableHead>
                          <TableHead className="text-right">建议配额</TableHead>
                          <TableHead className="text-center">风险</TableHead>
                          <TableHead className="w-10 text-center">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>
                              <div className="font-mono text-sm font-medium tracking-tight">
                                {r.pn}
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {r.material_name}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{r.supplier_name}</div>
                              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                {r.supplier_code}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <ShareInlineCell record={r} />
                            </TableCell>
                            {baseCols.map((b) => (
                              <TableCell key={b.base} className="text-right">
                                <BaseInlineCell record={r} col={b} />
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {fmt(r.share_prev)}
                            </TableCell>
                            <TableCell className="text-center">
                              <QdcInlineCell record={r} field="q_score" />
                            </TableCell>
                            <TableCell className="text-center">
                              <QdcInlineCell record={r} field="d_score" />
                            </TableCell>
                            <TableCell className="text-center">
                              <QdcInlineCell record={r} field="c_score" />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.weighted_score?.toFixed(2) ?? "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span
                                className={cn(
                                  r.risk_deviation && "font-medium text-amber-600 dark:text-amber-400"
                                )}
                              >
                                {fmt(r.quota_suggested)}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <RiskChips record={r} />
                            </TableCell>
                            <TableCell className="text-center">
                              <button
                                type="button"
                                onClick={() => setDeleting(r)}
                                aria-label={`删除 ${r.material_name} ${r.supplier_name} 的份额记录`}
                                title="删除"
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <ShareRecordCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        month={month}
      />
      <ShareImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        month={month}
      />

      {/* 月末结转确认 */}
      <Dialog open={rolloverOpen} onOpenChange={setRolloverOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>月末结转确认</DialogTitle>
            <DialogDescription>
              将项目「{activeProject?.name}」从 <b>{prevMonth(month)}</b> 的供应关系结转到 <b>{month}</b>：
              <br />
              · 供应商不变（沿用同一供应关系）
              <br />
              · 新月份额 / Q / D / C 清空，仅继承 share_prev / quota_prev
              <br />
              · {month} 已有记录将跳过
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRolloverOpen(false)}
              disabled={rollover.isPending}
            >
              取消
            </Button>
            <Button onClick={handleRollover} disabled={rollover.isPending}>
              {rollover.isPending ? "结转中…" : "确认结转"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除份额记录确认（不可逆） */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除份额记录</DialogTitle>
            <DialogDescription>
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                此操作不可撤销。剩余记录会按当前 QDC 自动重算建议配额和风险标记。
              </div>
              {deleting && (
                <div className="mt-3 space-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">物料：</span>
                    <span className="font-mono">{deleting.pn}</span>
                    <span className="text-muted-foreground"> · {deleting.material_name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">供应商：</span>
                    {deleting.supplier_name}
                    <span className="text-muted-foreground"> · {deleting.supplier_code}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">月份：</span>
                    {deleting.month}
                    <span className="ml-2 text-muted-foreground">本月份额</span>
                    <span className="ml-1 font-medium">{fmt(deleting.share_current)}</span>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deleteRec.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteRec.isPending}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {deleteRec.isPending ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  行内编辑组件                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 单元格：本月份额。点击进入编辑，回车 / 失焦提交，Esc 取消。
 * 留空按 0 处理（业务上 0 = 当月不供货，符合"录入必录"语义）。
 */
function ShareInlineCell({ record }: { record: ShareRecord }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(
    record.share_current != null ? String(record.share_current) : ""
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const update = useUpdateShareRecord();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setVal(record.share_current != null ? String(record.share_current) : "");
    }
  }, [record.share_current, editing]);

  const commit = () => {
    const trimmed = val.trim();
    const next = trimmed === "" ? 0 : Number(trimmed);
    if (Number.isNaN(next) || next < 0 || next > 100) {
      toast.error("份额应为 0-100 之间的数字");
      setVal(record.share_current != null ? String(record.share_current) : "");
      setEditing(false);
      return;
    }
    if (next === record.share_current) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: record.id, data: { share_current: next } },
      {
        onSuccess: () => toast.success(`「${record.material_name}」份额已更新`),
        onError: (e) => {
          toast.error(getApiErrorMessage(e));
          setVal(record.share_current != null ? String(record.share_current) : "");
        },
      }
    );
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        min={0}
        max={100}
        step={1}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setVal(record.share_current != null ? String(record.share_current) : "");
            setEditing(false);
          }
        }}
        className="h-7 w-20 text-right tabular-nums"
      />
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        "inline-flex h-7 min-w-[3.5rem] cursor-pointer items-center justify-end rounded px-2 tabular-nums transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        record.risk_fluctuation && "font-medium text-amber-600 dark:text-amber-400",
        record.share_current == null && "italic text-muted-foreground"
      )}
      title="点击修改"
    >
      {fmt(record.share_current)}
    </span>
  );
}

/**
 * 单元格：该供应商在某基地的份额（%）。
 * 每条份额记录自带 bases（[{base, lines, share}]）——行内直接改该基地的份额：
 * - 记录里没有该基地行（该供应商不供此基地）→ 显示「—」，点击可录入；
 * - 编辑只 PUT bases（不传 share_current）→ 后端按 Σ(份额×拉线) ÷ Σ拉线 自动重算本月份额并清手改标记。
 * 同基地的拉线数量以记录自身值为准（列头展示的是当月众数，仅作参考）。
 */
function BaseInlineCell({
  record,
  col,
}: {
  record: ShareRecord;
  col: { base: string; lines: number };
}) {
  const row = record.bases?.find((b) => b.base === col.base);
  const current = row?.share != null ? row.share : null;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current != null ? String(current) : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const update = useUpdateShareRecord();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setVal(current != null ? String(current) : "");
    }
  }, [current, editing]);

  const reset = () => {
    setVal(current != null ? String(current) : "");
    setEditing(false);
  };

  const commit = () => {
    const trimmed = val.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && (Number.isNaN(next) || next < 0 || next > 100)) {
      toast.error("份额应为 0-100 之间的数字（%）：不供该基地请清空");
      reset();
      return;
    }
    if (next === (current ?? null)) {
      setEditing(false);
      return;
    }
    // 重写该记录的 bases：保留其他基地行；目标基地行更新/新增/清份额
    const existing = (record.bases ?? []).map((b) => ({ ...b }));
    const idx = existing.findIndex((b) => b.base === col.base);
    const lines = row?.lines != null && row.lines >= 1 ? row.lines : col.lines;
    if (next == null) {
      // 清空份额 = 不供该基地：保留行（拉线仍计入分母），share 置空
      if (idx >= 0) existing[idx] = { base: col.base, lines, share: null };
      else return reset(); // 本来就无此行且清空 → 无变化
    } else if (idx >= 0) {
      existing[idx] = { base: col.base, lines, share: next };
    } else {
      existing.push({ base: col.base, lines, share: next });
    }
    update.mutate(
      { id: record.id, data: { bases: existing } },
      {
        onSuccess: () => toast.success(`「${record.supplier_name}」${col.base} 份额已更新，本月份额已自动重算`),
        onError: (e) => {
          toast.error(getApiErrorMessage(e));
          reset();
        },
      }
    );
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            reset();
          }
        }}
        className="h-7 w-20 text-right tabular-nums"
      />
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        "inline-flex h-7 min-w-[3.5rem] cursor-pointer items-center justify-end rounded px-2 tabular-nums transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current == null && "italic text-muted-foreground"
      )}
      title={current == null ? "该供应商不供此基地，点击录入份额" : "点击修改基地份额（%）"}
    >
      {current != null ? `${current}%` : "—"}
    </span>
  );
}

/**
 * 单元格：Q / D / C 五档下拉。值变化即提交。
 */
function QdcInlineCell({
  record,
  field,
}: {
  record: ShareRecord;
  field: "q_score" | "d_score" | "c_score";
}) {
  const update = useUpdateShareRecord();
  const value = record[field];
  return (
    <Select
      value={value != null ? String(value) : undefined}
      onValueChange={(v) => {
        update.mutate(
          { id: record.id, data: { [field]: Number(v) } },
          {
            onSuccess: () => {
              // react-query 自动 invalidate；toast 由用户在批量改动后感知
            },
            onError: (e) => toast.error(getApiErrorMessage(e)),
          }
        );
      }}
    >
      <SelectTrigger
        className={cn(
          "mx-auto h-7 w-14 tabular-nums",
          value == null && "text-muted-foreground"
        )}
      >
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {QDC_SCORES.map((s) => (
          <SelectItem key={s} value={String(s)}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RiskChips({ record }: { record: ShareRecord }) {
  const chips: { label: string; cls: string }[] = [];
  if (record.risk_sole) chips.push({ label: "独供", cls: "bg-red-500/10 text-red-600 dark:text-red-400" });
  if (record.risk_fluctuation)
    chips.push({ label: "波动", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" });
  if (record.risk_deviation)
    chips.push({ label: "偏差", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" });
  if (chips.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c.cls}`}
        >
          {c.label}
        </span>
      ))}
    </span>
  );
}