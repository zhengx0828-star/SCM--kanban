import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarRange, Copy, FileUp, Info, Inbox, Plus, Search, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { CardDialog } from "@/components/segments/CardDialog";
import { QuadrantChart } from "@/components/segments/QuadrantChart";
import { QuadrantLegend } from "@/components/segments/QuadrantLegend";
import { SegmentDrawer } from "@/components/segments/SegmentDrawer";
import { SegmentFormDialog } from "@/components/segments/SegmentFormDialog";
import { SegmentImportDialog } from "@/components/segments/SegmentImportDialog";
import {
  useCopyPeriod,
  useDeleteSegment,
  useSegmentConfig,
  useSegmentHistory,
  useSegmentPeriods,
  useSegments,
  useSegmentSummary,
  useSupplierCards,
} from "@/hooks/use-segments";
import { cn, getApiErrorMessage } from "@/lib/utils";
import {
  CARD_META,
  QUADRANT_MAP,
  type CardColor,
  type Quadrant,
  type Segment,
} from "@/types/segment";

/**
 * 供应商细分（能力 × 意愿四象限）。
 *
 * 页面只有两块内容：**四象限图**（判断）和**明细表**（核对）。
 * 不做项目筛选 —— 评价单元是「期间 × 物料 × 供应商」，项目只决定
 * 「这家供应商在这个项目里供什么」，进不到评分口径里。
 *
 * 状态纪律：
 *  - 期间为空 = 取最新有数据的月份，不默认「本月」，否则月初打开永远空白。
 *  - 图例点象限、原点气泡点牌色，都会把筛选落到下面的明细表，
 *    而不是弹新窗口 —— 老板看图之后下一步一定是「哪几家」。
 */

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions(periods: string[]): string[] {
  const set = new Set(periods);
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return Array.from(set).sort().reverse();
}

export default function SegmentsPage() {
  const [period, setPeriod] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [quadrantFilter, setQuadrantFilter] = useState<Quadrant | null>(null);
  const [cardFilter, setCardFilter] = useState<CardColor | null>(null);

  /**
   * 当前打开的抽屉走 URL（?c=<id>）—— 老板把「某家供应商在左下角」这条
   * 直接发链接给采购，对方打开就是同一条，不用自己再找。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get("c");
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Segment | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardMode, setCardMode] = useState<"create" | "release">("create");
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);

  const { data: periods = [] } = useSegmentPeriods();
  const { data: config } = useSegmentConfig();
  const effectivePeriod = period || searchParams.get("period") || periods[0] || currentMonth();
  const threshold = config?.threshold ?? 50;

  const { data: rows = [], isLoading } = useSegments({ period: effectivePeriod, segment: segmentFilter || undefined, q: keyword || undefined });
  const { data: summary } = useSegmentSummary(effectivePeriod);
  const { data: cards = [] } = useSupplierCards({});
  const selected = useMemo(() => rows.find((row) => String(row.id) === activeId) ?? null, [rows, activeId]);
  const { data: history = [] } = useSegmentHistory(selected?.pn ?? null, selected?.supplier_code ?? null);

  function selectSegment(row: Segment | null) {
    const next = new URLSearchParams(searchParams);
    if (row) next.set("c", String(row.id));
    else next.delete("c");
    setSearchParams(next, { replace: true });
  }

  const del = useDeleteSegment();
  const copy = useCopyPeriod();

  const options = useMemo(() => monthOptions(periods), [periods]);
  const prevPeriod = useMemo(() => periods.filter((p) => p < effectivePeriod)[0] ?? null, [periods, effectivePeriod]);

  /** 图例/气泡点出来的筛选只作用于明细表，不动图 —— 图要保留全局分布 */
  const tableRows = useMemo(
    () =>
      rows.filter((row) => {
        if (quadrantFilter && row.quadrant !== quadrantFilter) return false;
        if (cardFilter && row.card !== cardFilter) return false;
        return true;
      }),
    [rows, quadrantFilter, cardFilter]
  );

  const activeCard = useMemo(
    () => cards.find((c) => c.supplier_id === selected?.supplier_id && c.active) ?? null,
    [cards, selected]
  );

  function openCreate() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(row: Segment) {
    setEditTarget(row);
    setFormOpen(true);
  }

  function openCard(row: Segment, mode: "create" | "release") {
    selectSegment(row);
    setCardMode(mode);
    setCardOpen(true);
  }

  async function handleCopy() {
    if (!prevPeriod) {
      toast.error("没有更早的期间可复制");
      return;
    }
    try {
      const res = await copy.mutateAsync({ from: prevPeriod, to: effectivePeriod });
      toast.success(`已复制 ${res.copied} 条${res.skipped ? `，跳过已存在 ${res.skipped} 条` : ""}`);
    } catch (error) {
      toast.error(`复制失败：${getApiErrorMessage(error)}`);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success("已删除");
      setDeleteTarget(null);
      selectSegment(null);
    } catch (error) {
      toast.error(`删除失败：${getApiErrorMessage(error)}`);
    }
  }

  const stat = summary;
  const statCards = [
    { label: "参评条目", value: stat?.total ?? 0, tone: "text-foreground" },
    { label: "战略伙伴", value: stat?.by_quadrant?.partner ?? 0, tone: "text-emerald-600" },
    { label: "观察退出", value: stat?.by_quadrant?.exit ?? 0, tone: "text-red-600" },
    { label: "红牌供应商", value: stat?.red_card_count ?? 0, tone: "text-red-600" },
    { label: "未评级", value: stat?.incomplete ?? 0, tone: "text-muted-foreground" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* 标题 + 动作 */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">供应商细分</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  按重点物料给供应商打 12 项档位，合成能力与意愿两维，落四象限。象限只用来看「该加份额还是该找替代」，评价本身不带项目。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy} disabled={copy.isPending || !prevPeriod}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  复制上期到本期
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileUp className="mr-1 h-3.5 w-3.5" />
                  Excel 导入
                </Button>
                <Button size="sm" onClick={openCreate}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  新增评价
                </Button>
              </div>
            </div>

            {/* 筛选条 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarRange className="h-3.5 w-3.5" />
                期间
              </div>
              <select
                value={effectivePeriod}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {periods.includes(m) ? "" : "（空）"}
                  </option>
                ))}
              </select>
              <select
                value={segmentFilter}
                onChange={(e) => setSegmentFilter(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">全部工艺段</option>
                <option value="模组">模组</option>
                <option value="电芯">电芯</option>
              </select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜 PN / 物料 / 供应商"
                  className="h-9 w-56 pl-8"
                />
              </div>
              {(quadrantFilter || cardFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuadrantFilter(null);
                    setCardFilter(null);
                  }}
                >
                  清除筛选（{tableRows.length} 条）
                </Button>
              )}
            </div>

            {/* 统计条 */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {statCards.map((item) => (
                <Card key={item.label} className="py-3">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className={cn("mt-1 text-2xl font-medium tabular-nums", item.tone)}>{item.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 主图 + 图例 */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="flex items-center justify-between text-sm font-medium">
                    <span>能力 × 意愿</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      十字线 {threshold} · 共 {rows.length} 条
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  {isLoading ? (
                    <Skeleton className="h-[520px] w-full" />
                  ) : rows.length === 0 ? (
                    <EmptyState
                      icon={<Inbox />}
                      title={`${effectivePeriod} 还没有评价`}
                      description="先给重点物料的供应商打一轮档位，或者从上期整批复制过来再改。"
                      action={
                        <div className="flex gap-2">
                          <Button size="sm" onClick={openCreate}>
                            新增评价
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCopy} disabled={!prevPeriod}>
                            {prevPeriod ? `复制 ${prevPeriod}` : "复制上期"}
                          </Button>
                        </div>
                      }
                      className="h-[520px]"
                    />
                  ) : (
                    <div className="h-[520px]">
                      <QuadrantChart
                        data={rows}
                        threshold={threshold}
                        onSelect={(row) => selectSegment(row)}
                        onCardClick={(color) => setCardFilter(color)}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">象限与动作</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <QuadrantLegend
                    byQuadrant={stat?.by_quadrant ?? {}}
                    total={stat?.total ?? 0}
                    onPick={(key) => setQuadrantFilter((prev) => (prev === key ? null : key))}
                    activeQuadrant={quadrantFilter}
                  />
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                    <p className="flex items-center gap-1 font-medium text-foreground">
                      <Info className="h-3.5 w-3.5" />
                      判定口径
                    </p>
                    <p className="mt-1">
                      能力 &gt; {threshold} 且 意愿 &gt; {threshold} 才算过关，正好 {threshold} 分不过关（0.5 档 = 50 分）。
                    </p>
                  </div>
                  {stat && stat.card_count > 0 && (
                    <button
                      type="button"
                      onClick={() => setCardFilter((prev) => (prev === "red" ? null : "red"))}
                      className="flex w-full items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-left text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {stat.card_count} 家挂彩牌，其中红牌 {stat.red_card_count} 家
                    </button>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 明细表 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                  <span>评价明细</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {tableRows.length} 条{tableRows.length !== rows.length ? ` / 共 ${rows.length} 条` : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : tableRows.length === 0 ? (
                  <EmptyState
                    icon={<Inbox />}
                    size="sm"
                    title={rows.length === 0 ? "暂无评价" : "当前筛选下没有数据"}
                    description={rows.length === 0 ? "点右上角「新增评价」开始" : "清除筛选条件再看"}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>期间</TableHead>
                          <TableHead>物料</TableHead>
                          <TableHead>供应商</TableHead>
                          <TableHead className="text-right">能力</TableHead>
                          <TableHead className="text-right">意愿</TableHead>
                          <TableHead>象限</TableHead>
                          <TableHead>牌</TableHead>
                          <TableHead className="text-right">完整度</TableHead>
                          <TableHead>打分人</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((row) => {
                          const meta = QUADRANT_MAP[row.quadrant] ?? QUADRANT_MAP.incomplete;
                          return (
                            <TableRow key={row.id} className="cursor-pointer" onClick={() => selectSegment(row)}>
                              <TableCell className="tabular-nums text-xs text-muted-foreground">{row.period}</TableCell>
                              <TableCell>
                                <span className="font-medium">{row.pn}</span>
                                <span className="ml-1 text-xs text-muted-foreground">{row.material_name}</span>
                              </TableCell>
                              <TableCell>
                                <span>{row.supplier_name}</span>
                                <span className="ml-1 text-xs text-muted-foreground">{row.supplier_code}</span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{row.cap_score ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.will_score ?? "—"}</TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-1.5 text-xs">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                                  {meta.label}
                                </span>
                              </TableCell>
                              <TableCell>
                                {row.card ? (
                                  <Badge
                                    className="border-transparent"
                                    style={{ backgroundColor: `${CARD_META[row.card].color}18`, color: CARD_META[row.card].color }}
                                  >
                                    {CARD_META[row.card].label}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                {row.cap_filled}/6 · {row.will_filled}/6
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{row.evaluator ?? "—"}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEdit(row);
                                    }}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteTarget(row);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <SegmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        segment={editTarget}
        defaultPeriod={effectivePeriod}
        onSaved={() => setEditTarget(null)}
      />

      <SegmentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultPeriod={effectivePeriod}
        onImported={() => undefined}
      />

      <CardDialog
        open={cardOpen}
        onOpenChange={setCardOpen}
        mode={cardMode}
        segment={selected}
        activeCard={activeCard}
        onSaved={() => undefined}
      />

      <SegmentDrawer
        segment={selected}
        threshold={threshold}
        history={history}
        onClose={() => selectSegment(null)}
        onEdit={(row) => {
          setEditTarget(row);
          setFormOpen(true);
        }}
        onDelete={(row) => setDeleteTarget(row)}
        onCard={(row) => openCard(row, "create")}
        onRelease={(row) => openCard(row, "release")}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条评价？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `${deleteTarget.period} · ${deleteTarget.pn} · ${deleteTarget.supplier_name}` : ""}
              ，删除后不可恢复。牌不受影响（牌挂在供应商上）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
