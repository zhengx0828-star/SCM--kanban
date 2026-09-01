import { useEffect, useMemo, useState } from "react";
import { Edit3, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useCreateRule, useDeleteRule, useRules, useUpdateRule } from "@/hooks/use-rules";
import { getApiErrorMessage } from "@/lib/utils";
import { MODULE_PRESETS, type Rule } from "@/types/rule";

/* ---------- 新增/编辑规则弹窗 ---------- */
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
          <DialogDescription>
            录入各模块的 SOP、Excel 导入规则、注意事项等；按模块分组展示。
          </DialogDescription>
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

/* ---------- 规则列表页 ---------- */
export default function RulesPage() {
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

  // 按模块分组
  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const r of items) {
      if (!map.has(r.module)) map.set(r.module, []);
      map.get(r.module)!.push(r);
    }
    return Array.from(map.entries()).map(([mod, rules]) => ({ module: mod, rules }));
  }, [items]);

  // 顶部下拉：现有模块 + "全部"
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
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight">规则</h1>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  各模块的 SOP、Excel 导入规则、注意事项等；后续按你不同模块的需求慢慢补充。
                </p>
              </div>
              <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="mr-1.5 h-4 w-4" />
                新增规则
              </Button>
            </div>

            {/* 搜索 + 模块筛选 */}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
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
            </div>

            {/* 列表 */}
            <div className="mt-6 space-y-6">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
              ) : grouped.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    {keyword || moduleFilter !== "__all__" ? "未找到匹配的规则" : "暂无规则，点击右上角「新增规则」开始录入"}
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
                                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-500" onClick={() => setDeleting(r)}>
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
            </div>
          </div>
        </main>
      </div>

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
