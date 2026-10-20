import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Edit3, Loader2, MoveRight, Plus, Search, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { MetricDict } from "@/components/rules/MetricDict";
import { SopCard } from "@/components/rules/SopCard";
import { useCreateRule, useDeleteRule, useRules, useUpdateRule } from "@/hooks/use-rules";
import { METRIC_GROUPS } from "@/lib/metric-docs";
import { SOP_MODULES, SOP_PIPELINE } from "@/lib/sop-docs";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { MODULE_PRESETS, type Rule } from "@/types/rule";

/* ---------- 新增/编辑规则弹窗（团队补充说明） ---------- */
function RuleFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Rule | null;
}) {
  const createMutation = useCreateRule();
  const updateMutation = useUpdateRule();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const [module, setModule] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setModule(editing?.module ?? "");
      setTitle(editing?.title ?? "");
      setContent(editing?.content ?? "");
      setSortOrder(editing?.sort_order ?? 0);
      setError(null);
    }
  }, [open, editing]);

  const handleSubmit = () => {
    if (!module.trim()) return setError("请选择/输入模块");
    if (!title.trim()) return setError("请输入标题");
    if (!content.trim()) return setError("请输入正文");
    setError(null);
    const payload = { module: module.trim(), title: title.trim(), content: content.trim(), sort_order: sortOrder };
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => { toast.success("规则已更新"); onOpenChange(false); },
          onError: (err) => setError(getApiErrorMessage(err)),
        }
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => { toast.success("规则已新增"); onOpenChange(false); },
        onError: (err) => setError(getApiErrorMessage(err)),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑规则" : "新增规则"}</DialogTitle>
          <DialogDescription>补充系统内置说明之外的内容：内部约定、踩过的坑、特殊口径。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>模块 <span className="text-red-500">*</span></Label>
              <Input
                value={module}
                onChange={(e) => setModule(e.target.value)}
                placeholder="如：Excel 导入"
                list="module-presets"
              />
              <datalist id="module-presets">
                {MODULE_PRESETS.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>标题 <span className="text-red-500">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：Excel 导入模板格式" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>正文 <span className="text-red-500">*</span></Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="支持换行，可写多段说明…"
              rows={6}
            />
          </div>
          <div className="space-y-1.5">
            <Label>排序 <span className="text-xs text-muted-foreground">（同模块内升序）</span></Label>
            <Input
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value || 0))}
              className="w-32"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "保存" : "新增"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 团队补充说明（原有规则条目） ---------- */
function TeamRules() {
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("__all__");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  const params: { keyword?: string; module?: string; page_size: number } = { page_size: 200 };
  if (keyword) params.keyword = keyword;
  if (moduleFilter !== "__all__") params.module = moduleFilter;
  const { data: list, isLoading } = useRules(params);
  const deleteMutation = useDeleteRule();

  const items = list?.items ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const r of items) {
      if (!map.has(r.module)) map.set(r.module, []);
      map.get(r.module)!.push(r);
    }
    return Array.from(map.entries()).map(([mod, rules]) => ({ module: mod, rules }));
  }, [items]);

  const existingModules = useMemo(() => Array.from(new Set(items.map((r) => r.module))).sort(), [items]);
  const allModuleOptions = Array.from(new Set([...existingModules, ...MODULE_PRESETS])).sort();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(keywordInput.trim());
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteMutation.mutate(deleting.id, {
      onSuccess: () => { toast.success("规则已删除"); setDeleting(null); },
      onError: (err) => toast.error(getApiErrorMessage(err)),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={handleSearch} className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="搜索标题或正文…"
            className="pl-9"
          />
        </form>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部模块</SelectItem>
            {allModuleOptions.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" />
          新增规则
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {keyword || moduleFilter !== "__all__"
              ? "未找到匹配的规则"
              : "还没有补充说明。系统内置的 SOP 和指标口径不在这里，点上方标签切换。"}
          </CardContent>
        </Card>
      ) : (
        grouped.map(({ module: mod, rules }) => (
          <section key={mod}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{mod}</h2>
              <Badge variant="secondary" className="font-normal">{rules.length} 条</Badge>
            </div>
            <div className="space-y-2">
              {rules.map((r) => (
                <Card key={r.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium">{r.title}</h3>
                          <span className="text-[11px] text-muted-foreground">#{r.sort_order}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{r.content}</p>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          更新于 {new Date(r.updated_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setFormOpen(true); }}>
                          <Edit3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-red-500"
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}

      <RuleFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} />

      <AlertDialog open={deleting != null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除规则？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.title}（{deleting?.module}）」将被删除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- 页面 ---------- */
const TABS = [
  { key: "sop", label: "操作 SOP" },
  { key: "metrics", label: "指标字典" },
  { key: "team", label: "团队补充" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function RulesPage() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "sop";

  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(sp);
    next.set("tab", k);
    setSp(next, { replace: true });
  };

  const metricCount = METRIC_GROUPS.reduce((s, g) => s + g.metrics.length, 0);

  const jumpTo = (key: string) => {
    document.getElementById(`sop-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-[1180px]">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">规则与口径</h1>
              <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                按模块列操作步骤，按指标列计算公式。
              </p>
            </div>

            {/* 标签页 */}
            <div className="mt-5 flex items-center gap-0.5 border-b">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
                    tab === t.key
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                  {t.key === "metrics" && (
                    <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{metricCount}</span>
                  )}
                  {t.key === "sop" && (
                    <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {SOP_MODULES.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-6">
              {tab === "sop" && (
                <div className="space-y-4">
                  {/* 总流程：一个项目从 0 到能看，按什么顺序录 */}
                  <Card>
                    <CardContent className="p-4">
                      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h2 className="text-[13.5px] font-semibold">数据录入顺序</h2>
                        <span className="text-[11.5px] text-muted-foreground">
                          没前一步，后面一步就没有数据可算
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                        {SOP_PIPELINE.map((n, i) => (
                          <Fragment key={n.no}>
                            {i > 0 && (
                              <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" strokeWidth={2} />
                            )}
                            <Link
                              to={n.to}
                              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 transition-colors hover:border-primary/40 hover:bg-accent"
                            >
                              <span className="grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full bg-blue-600 text-[10px] font-bold tabular-nums text-white">
                                {n.no}
                              </span>
                              <span className="text-[12.5px] font-medium">{n.label}</span>
                              <span className="text-[10.5px] text-muted-foreground">{n.module}</span>
                            </Link>
                          </Fragment>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="mr-1 text-[11.5px] text-muted-foreground">跳到</span>
                    {SOP_MODULES.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => jumpTo(m.key)}
                        className="rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>

                  {SOP_MODULES.map((m) => (
                    <div key={m.key} id={`sop-${m.key}`} className="scroll-mt-20">
                      <SopCard mod={m} />
                    </div>
                  ))}
                </div>
              )}

              {tab === "metrics" && <MetricDict groups={METRIC_GROUPS} />}

              {tab === "team" && <TeamRules />}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
