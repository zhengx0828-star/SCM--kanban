import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit3,
  FileSpreadsheet,
  FolderKanban,
  Link2,
  Link2Off,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { SupplierMasterFormDialog } from "@/components/suppliers/SupplierMasterFormDialog";
import { SupplyRelationFormDialog } from "@/components/suppliers/SupplyRelationFormDialog";
import { EditRelationDialog, LinkRelationDialog, ProjectFormDialog } from "@/components/projects/ProjectDialogs";
import { ExcelImportDialog } from "@/components/projects/ExcelImportDialog";
import {
  useCreateSupplyRelation,
  useDeleteSupplyRelation,
  useSupplyRelationOptions,
  useSupplyRelationProjects,
  useSupplyRelations,
} from "@/hooks/use-supply-relations";
import { useMaterials, useCreateMaterial, useDeleteMaterial } from "@/hooks/use-materials";
import { useSuppliers, useCreateSupplier, useDeleteSupplier } from "@/hooks/use-suppliers";
import {
  useCreateProject,
  useDeleteProject,
  useProjectRelations,
  useProjects,
  useQuickAddProjectRelation,
  useUnlinkProjectRelation,
} from "@/hooks/use-projects";
import { cn, getApiErrorMessage } from "@/lib/utils";
import type { Material } from "@/types/material";
import type { SupplyRelation } from "@/types/supplyRelation";
import { PROJECT_STATUS_META, type Project, type ProjectSupplyRelation } from "@/types/project";

const MAT_PAGE_SIZE = 8;
const REL_PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 10;

/* ---------- 新增物料弹窗（仅 PN + 物料名称） ---------- */
function MaterialFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createMaterial = useCreateMaterial();
  const [pn, setPn] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPn(""); setName(""); setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!pn.trim()) return setError("请输入物料 PN");
    if (!name.trim()) return setError("请输入物料名称");
    setError(null);
    createMaterial.mutate(
      { pn: pn.trim(), name: name.trim() },
      {
        onSuccess: () => {
          toast.success("物料已新增");
          onOpenChange(false);
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增物料</DialogTitle>
          <DialogDescription>物料先建（PN + 名称），随后可为其添加供应商。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>物料 PN <span className="text-red-500">*</span></Label>
            <Input value={pn} onChange={(e) => setPn(e.target.value)} placeholder="例如：MCU-001" />
          </div>
          <div className="space-y-1.5">
            <Label>物料名称 <span className="text-red-500">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：主控芯片" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={createMaterial.isPending}>
            {createMaterial.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存物料
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 引用项目弹窗（某四元组被哪些项目使用） ---------- */
function RelationProjectsDialog({
  relation,
  onOpenChange,
}: {
  relation: SupplyRelation | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: projects = [], isLoading } = useSupplyRelationProjects(relation?.id ?? null);
  return (
    <Dialog open={relation != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>使用此供应关系的项目</DialogTitle>
          <DialogDescription>
            {relation
              ? `${relation.pn} · ${relation.material_name} ← ${relation.supplier_name}（${relation.supplier_code}）`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : projects.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">尚未挂载到任何项目，可在「项目」Tab 挂载</p>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="outline" className="shrink-0 font-mono text-[11px] font-normal">
                    {relation?.pn ?? "-"}
                  </Badge>
                  <span className="truncate text-xs text-muted-foreground">{relation?.material_name ?? "-"}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
                  </div>
                  {p.role && <Badge variant="secondary" className="shrink-0 font-normal">{p.role}</Badge>}
                </div>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 给物料添加供应商（选已有 / 新建，然后建立供应关系） ---------- */
function AddSupplierToMaterialDialog({
  open,
  onOpenChange,
  materialId,
  materialPn,
  materialName,
  excludedSupplierIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  materialId: number | null;
  materialPn: string;
  materialName: string;
  excludedSupplierIds: number[];
}) {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const createSupplierMutation = useCreateSupplier();
  const createRelationMutation = useCreateSupplyRelation();

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [supplierId, setSupplierId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createSupplierMutation.isPending || createRelationMutation.isPending;
  const candidates = suppliers.filter((s) => !excludedSupplierIds.includes(s.id));

  useEffect(() => {
    if (open) {
      setMode("existing"); setSupplierId(""); setNewName(""); setNewCode(""); setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!materialId) return;
    setError(null);
    // 场景 A：选择已有供应商 → 直接建立供应关系
    if (mode === "existing") {
      if (!supplierId) return setError("请选择供应商");
      createRelationMutation.mutate(
        { material_id: materialId, supplier_id: Number(supplierId) },
        {
          onSuccess: () => {
            toast.success("供应商已添加到物料");
            onOpenChange(false);
          },
          onError: (err) => setError(getApiErrorMessage(err)),
        }
      );
      return;
    }
    // 场景 B：新建供应商（名称 + 代码）→ 先创建供应商再建立供应关系
    if (!newName.trim()) return setError("请输入供应商名称");
    if (!newCode.trim()) return setError("请输入供应商代码");
    createSupplierMutation.mutate(
      { code: newCode.trim(), name: newName.trim() },
      {
        onSuccess: (created) => {
          createRelationMutation.mutate(
            { material_id: materialId, supplier_id: created.id },
            {
              onSuccess: () => {
                toast.success("供应商已新建并添加到物料");
                onOpenChange(false);
              },
              onError: (err) => setError(getApiErrorMessage(err)),
            }
          );
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加供应商到物料</DialogTitle>
          <DialogDescription>
            {materialPn} · {materialName} —— 选择已有供应商或新建（供应商名称 + 代码），建立供应关系后即可在项目中使用。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* 模式切换 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                mode === "existing" ? "border-primary bg-primary/5 font-medium text-primary" : "text-muted-foreground hover:bg-accent"
              )}
            >
              选择已有供应商
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                mode === "new" ? "border-primary bg-primary/5 font-medium text-primary" : "text-muted-foreground hover:bg-accent"
              )}
            >
              新建供应商
            </button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-1.5">
              <Label>供应商 <span className="text-red-500">*</span></Label>
              {isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={candidates.length ? "选择供应商（名称 / 代码）" : "暂无可用供应商，可切换到「新建供应商」"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {candidates.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}（{s.code}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>供应商名称 <span className="text-red-500">*</span></Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：深圳市华芯电子有限公司" />
              <Label className="mt-2 block">供应商代码 <span className="text-red-500">*</span></Label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="例如：SUP-011" />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "existing" ? "添加到物料" : "新建并添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 项目详情视图（Tab 内二级：明细搜索 + 分页） ---------- */
function ProjectDetailView({
  project,
  relations,
  isLoading,
  onBack,
  onEdit,
  onDelete,
  onLink,
  onEditItem,
  onUnlink,
}: {
  project: Project | null;
  relations: ProjectSupplyRelation[];
  isLoading: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLink: () => void;
  onEditItem: (item: ProjectSupplyRelation) => void;
  onUnlink: (item: ProjectSupplyRelation) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  // 快速录入（四元组一行式：仅四个必填字段）
  const quickAddMutation = useQuickAddProjectRelation(project?.id ?? null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  // Excel 批量导入
  const [excelOpen, setExcelOpen] = useState(false);
  const [q, setQ] = useState({
    pn: "",
    materialName: "",
    supplierName: "",
    supplierCode: "",
  });
  const setQField = (key: keyof typeof q, value: string) =>
    setQ((prev) => ({ ...prev, [key]: value }));

  const handleQuickAdd = () => {
    if (!project) return;
    if (!q.pn.trim()) return setQuickError("请输入物料 PN");
    if (!q.materialName.trim()) return setQuickError("请输入物料名称");
    if (!q.supplierName.trim()) return setQuickError("请输入供应商名称");
    if (!q.supplierCode.trim()) return setQuickError("请输入供应商代码");
    setQuickError(null);
    quickAddMutation.mutate(
      {
        pn: q.pn.trim(),
        material_name: q.materialName.trim(),
        supplier_name: q.supplierName.trim(),
        supplier_code: q.supplierCode.trim(),
      },
      {
        onSuccess: () => {
          toast.success("明细已添加（主数据自动创建/复用）");
          setQuickOpen(false);
          setQ({ pn: "", materialName: "", supplierName: "", supplierCode: "" });
        },
        onError: (err) => setQuickError(getApiErrorMessage(err)),
      }
    );
  };

  useEffect(() => {
    setPage(1);
  }, [keyword]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return relations;
    return relations.filter(
      (r) =>
        r.pn.toLowerCase().includes(kw) ||
        r.material_name.toLowerCase().includes(kw) ||
        r.supplier_name.toLowerCase().includes(kw) ||
        r.supplier_code.toLowerCase().includes(kw)
    );
  }, [relations, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DETAIL_PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * DETAIL_PAGE_SIZE, page * DETAIL_PAGE_SIZE);

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回项目列表
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{project?.name ?? "项目"}</h3>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px]", PROJECT_STATUS_META[project?.status ?? "active"].className)}>
                {PROJECT_STATUS_META[project?.status ?? "active"].label}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {project?.code}
              {project?.owner ? ` · 负责人：${project.owner}` : ""}
            </p>
            {project?.description && <p className="mt-1 text-xs text-muted-foreground">{project.description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Edit3 className="mr-1.5 h-4 w-4" />
              编辑项目
            </Button>
            <Button size="sm" variant="outline" className="text-muted-foreground hover:text-red-500" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              删除
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">供应明细（共 {relations.length} 条）</p>
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => { setQuickOpen((v) => !v); setQuickError(null); }}>
              <Plus className="mr-1.5 h-4 w-4" />
              快速新增
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExcelOpen(true)}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              导入 Excel
            </Button>
            <Button size="sm" variant="outline" onClick={onLink}>
              <Link2 className="mr-1.5 h-4 w-4" />
              挂载供应关系
            </Button>
          </div>
        </div>

        {/* 快速录入表单（四元组一行式） */}
        {quickOpen && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="mb-2 text-xs font-medium text-primary">
              快速新增：填写四项即可，系统自动创建/复用主数据并挂载到本项目
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">物料 PN <span className="text-red-500">*</span></Label>
                <Input value={q.pn} onChange={(e) => setQField("pn", e.target.value)} placeholder="例如：MCU-001" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">物料名称 <span className="text-red-500">*</span></Label>
                <Input value={q.materialName} onChange={(e) => setQField("materialName", e.target.value)} placeholder="例如：主控芯片" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">供应商名称 <span className="text-red-500">*</span></Label>
                <Input value={q.supplierName} onChange={(e) => setQField("supplierName", e.target.value)} placeholder="例如：华芯电子" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">供应商代码 <span className="text-red-500">*</span></Label>
                <Input value={q.supplierCode} onChange={(e) => setQField("supplierCode", e.target.value)} placeholder="例如：SUP-001" className="h-9" />
              </div>
            </div>
            {quickError && <p className="mt-2 text-xs text-red-500">{quickError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setQuickOpen(false); setQuickError(null); }} disabled={quickAddMutation.isPending}>
                取消
              </Button>
              <Button size="sm" onClick={handleQuickAdd} disabled={quickAddMutation.isPending}>
                {quickAddMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                保存明细
              </Button>
            </div>
          </div>
        )}

        <form className="relative mt-3" onSubmit={(e) => e.preventDefault()}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索 物料PN / 物料名称 / 供应商名称 / 供应商代码…"
            className="pl-9"
          />
        </form>

        <div className="mt-3 overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : relations.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              该项目暂无供应明细，点击「快速新增」直接录入 PN · 物料名称 · 供应商名称 · 供应商代码
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">没有匹配「{keyword}」的明细</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-center text-xs text-muted-foreground">
                  <th className="py-2 px-2 font-normal">物料PN</th>
                  <th className="py-2 px-2 font-normal">物料名称</th>
                  <th className="py-2 px-2 font-normal">供应商名称</th>
                  <th className="py-2 px-2 font-normal">供应商代码</th>
                  <th className="py-2 px-2 text-right font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-2 py-2.5 text-center font-mono text-xs">{r.pn}</td>
                    <td className="px-2 py-2.5 text-center">{r.material_name}</td>
                    <td className="px-2 py-2.5 text-center font-medium">{r.supplier_name}</td>
                    <td className="px-2 py-2.5 text-center font-mono text-xs">{r.supplier_code}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onEditItem(r)}>
                          <Edit3 className="mr-1 h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-red-500"
                          onClick={() => onUnlink(r)}
                        >
                          <Link2Off className="mr-1 h-3.5 w-3.5" />
                          解除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filtered.length > 0 && totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </Button>
            <span>共 {filtered.length} 条 · {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              下一页
            </Button>
          </div>
        )}
      </CardContent>

      <ExcelImportDialog
        open={excelOpen}
        onOpenChange={setExcelOpen}
        projectId={project?.id ?? null}
        projectName={project?.name ?? ""}
      />
    </Card>
  );
}

/* ---------- 供应商列表页（项目 / 物料 / 供应商 / 供应关系） ---------- */
export default function SupplierMasterPage() {
  const [tab, setTab] = useState<"projects" | "materials" | "suppliers" | "relations">("projects");

  // 物料 Tab（主从）状态
  const [matPage, setMatPage] = useState(1);
  const [matKeyword, setMatKeyword] = useState("");
  const [matSearchInput, setMatSearchInput] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [materialFormOpen, setMaterialFormOpen] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [deleteMaterial, setDeleteMaterial] = useState<Material | null>(null);

  // 供应商 Tab 状态
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [deleteSupplier, setDeleteSupplier] = useState<{ id: number; name: string; code: string } | null>(null);

  // 供应关系 Tab 状态
  const [relKeyword, setRelKeyword] = useState("");
  const [relSearchInput, setRelSearchInput] = useState("");
  const [relPage, setRelPage] = useState(1);
  const [projectsRelation, setProjectsRelation] = useState<SupplyRelation | null>(null);
  const [relationFormOpen, setRelationFormOpen] = useState(false);
  const [deleteRelation, setDeleteRelation] = useState<SupplyRelation | null>(null);

  // 项目 Tab 状态
  const [projKeyword, setProjKeyword] = useState("");
  const [projSearchInput, setProjSearchInput] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [linkProjectId, setLinkProjectId] = useState<number | null>(null);
  const [editItem, setEditItem] = useState<ProjectSupplyRelation | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null);
  const [unlinkItem, setUnlinkItem] = useState<ProjectSupplyRelation | null>(null);

  // 数据
  const { data: matList, isLoading: matLoading } = useMaterials({ page: matPage, page_size: MAT_PAGE_SIZE, keyword: matKeyword || undefined });
  const { data: allSuppliers = [], isLoading: allSuppliersLoading } = useSuppliers();
  const { data: allRelations = [], isLoading: relOptionsLoading } = useSupplyRelationOptions();
  const { data: relList, isLoading: relLoading } = useSupplyRelations({ page: relPage, page_size: REL_PAGE_SIZE, keyword: relKeyword || undefined });
  const { data: projectList, isLoading: projectsLoading } = useProjects({ page: 1, page_size: 100 });
  const { data: detailRelations = [], isLoading: detailLoading } = useProjectRelations(selectedProjectId);

  const deleteRelationMutation = useDeleteSupplyRelation();
  const queryClient = useQueryClient();
  const deleteSupplierMutation = useDeleteSupplier();
  const deleteMaterialMutation = useDeleteMaterial();
  const deleteProjectMutation = useDeleteProject();
  const unlinkMutation = useUnlinkProjectRelation(selectedProjectId);

  const materials = matList?.items ?? [];
  const matTotalPages = matList?.total_pages ?? 1;

  const selectedMaterial = materials.find((m) => m.id === selectedMaterialId) ?? null;
  /** 该物料的供应商（来自供应关系，四元组） */
  const materialSuppliers = useMemo(
    () =>
      selectedMaterialId == null
        ? []
        : allRelations.filter((r) => r.material_id === selectedMaterialId),
    [allRelations, selectedMaterialId]
  );

  const allProjects = useMemo(() => {
    const kw = projKeyword.trim().toLowerCase();
    const items = projectList?.items ?? [];
    if (!kw) return items;
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.code.toLowerCase().includes(kw) ||
        (p.owner ?? "").toLowerCase().includes(kw)
    );
  }, [projectList, projKeyword]);

  const selectedProject = allProjects.find((p) => p.id === selectedProjectId) ?? null;

  const handleMatSearch = (e: ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMatKeyword(matSearchInput.trim());
    setMatPage(1);
  };

  const handleRelSearch = (e: ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    setRelKeyword(relSearchInput.trim());
    setRelPage(1);
  };

  const handleDeleteMaterial = () => {
    if (!deleteMaterial) return;
    deleteMaterialMutation.mutate(deleteMaterial.id, {
      onSuccess: () => {
        toast.success("物料已删除");
        if (selectedMaterialId === deleteMaterial.id) setSelectedMaterialId(null);
        setDeleteMaterial(null);
      },
      onError: (err) => toast.error(getApiErrorMessage(err)),
    });
  };

  const handleDeleteSupplier = () => {
    if (!deleteSupplier) return;
    deleteSupplierMutation.mutate(deleteSupplier.id, {
      onSuccess: () => {
        toast.success("供应商已删除");
        setDeleteSupplier(null);
      },
      onError: (err) => toast.error(getApiErrorMessage(err)),
    });
  };

  const handleDeleteRelation = () => {
    if (!deleteRelation) return;
    deleteRelationMutation.mutate(deleteRelation.id, {
      onSuccess: () => {
        toast.success("供应关系已删除（项目引用一并移除）");
        setDeleteRelation(null);
      },
      onError: (err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          toast.error("该供应关系已不存在，已自动刷新列表");
        } else {
          toast.error(getApiErrorMessage(err));
        }
        // 关闭对话框并强制刷新所有相关缓存
        setDeleteRelation(null);
        queryClient.invalidateQueries({ queryKey: ["supply-relations"] });
        queryClient.invalidateQueries({ queryKey: ["materials"] });
        queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
      },
    });
  };

  const handleDeleteProject = () => {
    if (!deleteProjectTarget) return;
    deleteProjectMutation.mutate(deleteProjectTarget.id, {
      onSuccess: () => {
        toast.success("项目已删除");
        if (selectedProjectId === deleteProjectTarget.id) setSelectedProjectId(null);
        setDeleteProjectTarget(null);
      },
      onError: (err) => toast.error(getApiErrorMessage(err)),
    });
  };

  const handleUnlink = () => {
    if (!unlinkItem) return;
    unlinkMutation.mutate(unlinkItem.id, {
      onSuccess: () => {
        toast.success("已解除挂载");
        setUnlinkItem(null);
      },
      onError: (err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          toast.error("该明细已不存在，已自动刷新列表");
        } else {
          toast.error(getApiErrorMessage(err));
        }
        setUnlinkItem(null);
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["supply-relations"] });
      },
    });
  };

  const headerAction = (
    <>
      {tab === "materials" && (
        <Button onClick={() => setMaterialFormOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          新增物料
        </Button>
      )}
      {tab === "suppliers" && (
        <Button variant="outline" onClick={() => setSupplierFormOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          录入供应商
        </Button>
      )}
      {tab === "relations" && (
        <Button onClick={() => setRelationFormOpen(true)}>
          <Link2 className="mr-1.5 h-4 w-4" />
          新增供应关系
        </Button>
      )}
      {tab === "projects" && (
        <Button onClick={() => { setEditingProject(null); setProjectFormOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" />
          新增项目
        </Button>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight">供应商列表</h1>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  先有项目，再有物料（PN + 名称），再为物料添加供应商（名称 + 代码），
                  形成四元组供其他模块调用。
                </p>
              </div>
              <div className="flex items-center gap-2">{headerAction}</div>
            </div>

            {/* Tab 切换 */}
            <div className="mt-8 flex items-center gap-1 border-b">
              {(
                [
                  { key: "projects", label: "项目", icon: <FolderKanban className="h-4 w-4" /> },
                  { key: "materials", label: "物料", icon: <Package className="h-4 w-4" /> },
                  { key: "suppliers", label: `供应商（${allSuppliers.length}）`, icon: <UserPlus className="h-4 w-4" /> },
                  { key: "relations", label: "供应关系", icon: <Link2 className="h-4 w-4" /> },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm transition-colors",
                    tab === t.key
                      ? "border-b-2 border-primary font-medium text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {/* Tab 1：物料（主从：左物料列表 → 右该物料供应商） */}
              {tab === "materials" && (
                <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
                  {/* 左：物料列表 */}
                  <Card className="h-fit">
                    <CardContent className="p-4">
                      <form onSubmit={handleMatSearch} className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={matSearchInput}
                          onChange={(e) => setMatSearchInput(e.target.value)}
                          placeholder="搜索 物料 PN / 名称…"
                          className="pl-9"
                        />
                      </form>

                      <div className="mt-3 space-y-1">
                        {matLoading ? (
                          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
                        ) : materials.length === 0 ? (
                          <p className="py-8 text-center text-sm text-muted-foreground">暂无物料，点击右上角「新增物料」</p>
                        ) : (
                          materials.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setSelectedMaterialId(m.id)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
                                selectedMaterialId === m.id
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-transparent hover:bg-accent"
                              )}
                            >
                              <div className="min-w-0">
                                <p className="font-mono text-sm font-medium">{m.pn}</p>
                                <p className="truncate text-xs text-muted-foreground">{m.name}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Badge variant="secondary" className="font-normal">{m.supplier_count} 家</Badge>
                                <button
                                  type="button"
                                  aria-label="删除物料"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteMaterial(m);
                                  }}
                                  className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </button>
                          ))
                        )}
                      </div>

                      {matTotalPages > 1 && (
                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <Button variant="outline" size="sm" disabled={matPage <= 1} onClick={() => setMatPage((p) => p - 1)}>
                            上一页
                          </Button>
                          <span>{matPage} / {matTotalPages}</span>
                          <Button variant="outline" size="sm" disabled={matPage >= matTotalPages} onClick={() => setMatPage((p) => p + 1)}>
                            下一页
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* 右：该物料的供应商 */}
                  <Card className="h-fit">
                    <CardContent className="p-4">
                      {selectedMaterialId == null ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                          <Package className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-sm font-medium text-muted-foreground">请选择左侧物料</p>
                          <p className="text-xs text-muted-foreground/70">先有物料，再为它添加供应商</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="font-mono text-sm font-semibold">{selectedMaterial?.pn ?? "物料"}</h3>
                              <p className="truncate text-xs text-muted-foreground">{selectedMaterial?.name}</p>
                            </div>
                            <Button size="sm" onClick={() => setAddSupplierOpen(true)}>
                              <UserPlus className="mr-1.5 h-4 w-4" />
                              添加供应商
                            </Button>
                          </div>

                          <div className="mt-4 overflow-x-auto">
                            {relOptionsLoading ? (
                              <div className="space-y-2">
                                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                              </div>
                            ) : materialSuppliers.length === 0 ? (
                              <p className="py-10 text-center text-sm text-muted-foreground">
                                该物料暂无供应商，点击「添加供应商」
                              </p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b text-left text-xs text-muted-foreground">
                                    <th className="py-2 pr-3 font-normal">供应商名称</th>
                                    <th className="py-2 pr-3 font-normal">供应商代码</th>
                                    <th className="py-2 pr-3 font-normal">使用项目</th>
                                    <th className="py-2 text-right font-normal">操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {materialSuppliers.map((r) => (
                                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                      <td className="py-2.5 pr-3 font-medium">{r.supplier_name}</td>
                                      <td className="py-2.5 pr-3 font-mono text-xs">{r.supplier_code}</td>
                                      <td className="py-2.5 pr-3">
                                        <button
                                          type="button"
                                          onClick={() => setProjectsRelation(r)}
                                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent"
                                          title="点击查看引用的项目"
                                        >
                                          <FolderKanban className="h-3 w-3" />
                                          {r.project_count} 个项目
                                        </button>
                                      </td>
                                      <td className="py-2.5 text-right">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-muted-foreground hover:text-red-500"
                                          disabled={deleteRelationMutation.isPending}
                                          onClick={() => setDeleteRelation(r)}
                                        >
                                          <Link2Off className="mr-1 h-3.5 w-3.5" />
                                          解除
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Tab 2：供应商（仅名称 + 代码） */}
              {tab === "suppliers" && (
                <Card>
                  <CardContent className="p-4">
                    <p className="mb-3 text-xs text-muted-foreground">
                      供应商主数据：仅供应商名称 + 供应商代码；与物料的组合关系见「供应关系」Tab。
                    </p>
                    {allSuppliersLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                      </div>
                    ) : allSuppliers.length === 0 ? (
                      <p className="py-12 text-center text-sm text-muted-foreground">暂无供应商，点击右上角「录入供应商」</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-normal">供应商名称</th>
                            <th className="py-2 pr-3 font-normal">供应商代码</th>
                            <th className="py-2 text-right font-normal">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allSuppliers.map((s) => (
                            <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                              <td className="py-2.5 pr-3 font-medium">{s.name}</td>
                              <td className="py-2.5 pr-3 font-mono text-xs">{s.code}</td>
                              <td className="py-2.5 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-red-500"
                                  onClick={() => setDeleteSupplier({ id: s.id, name: s.name, code: s.code })}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  删除
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Tab 3：供应关系（四元组主数据） */}
              {tab === "relations" && (
                <Card>
                  <CardContent className="p-4">
                    <form onSubmit={handleRelSearch} className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={relSearchInput}
                        onChange={(e) => setRelSearchInput(e.target.value)}
                        placeholder="搜索 物料PN / 物料名称 / 供应商名称 / 供应商代码…"
                        className="pl-9"
                      />
                    </form>

                    <div className="mt-4 overflow-x-auto">
                      {relLoading ? (
                        <div className="space-y-2">
                          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                        </div>
                      ) : (relList?.items ?? []).length === 0 ? (
                        <p className="py-12 text-center text-sm text-muted-foreground">
                          暂无供应关系，点击右上角「新增供应关系」
                        </p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="py-2 pr-3 font-normal">供应商名称</th>
                              <th className="py-2 pr-3 font-normal">供应商代码</th>
                              <th className="py-2 pr-3 font-normal">使用项目</th>
                              <th className="py-2 text-right font-normal">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(relList?.items ?? []).map((r) => (
                              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="py-2.5 pr-3 font-medium">{r.supplier_name}</td>
                                <td className="py-2.5 pr-3 font-mono text-xs">{r.supplier_code}</td>
                                <td className="py-2.5 pr-3">
                                  <button
                                    type="button"
                                    onClick={() => setProjectsRelation(r)}
                                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent"
                                    title="点击查看引用的项目"
                                  >
                                    <FolderKanban className="h-3 w-3" />
                                    {r.project_count} 个项目
                                  </button>
                                </td>
                                <td className="py-2.5 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-red-500"
                                    disabled={deleteRelationMutation.isPending}
                                    onClick={() => setDeleteRelation(r)}
                                  >
                                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                                    删除
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {relList && relList.total_pages > 1 && (
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <Button variant="outline" size="sm" disabled={relPage <= 1} onClick={() => setRelPage((p) => p - 1)}>
                          上一页
                        </Button>
                        <span>共 {relList.total} 条 · {relPage} / {relList.total_pages}</span>
                        <Button variant="outline" size="sm" disabled={relPage >= relList.total_pages} onClick={() => setRelPage((p) => p + 1)}>
                          下一页
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Tab 4：项目（列表 → 详情） */}
              {tab === "projects" && (
                selectedProject != null ? (
                  <ProjectDetailView
                    project={selectedProject}
                    relations={detailRelations}
                    isLoading={detailLoading}
                    onBack={() => setSelectedProjectId(null)}
                    onEdit={() => { setEditingProject(selectedProject); setProjectFormOpen(true); }}
                    onDelete={() => setDeleteProjectTarget(selectedProject)}
                    onLink={() => setLinkProjectId(selectedProject.id)}
                    onEditItem={setEditItem}
                    onUnlink={setUnlinkItem}
                  />
                ) : (
                  <Card>
                    <CardContent className="p-4">
                      <form
                        onSubmit={(e) => { e.preventDefault(); setProjKeyword(projSearchInput.trim()); }}
                        className="relative"
                      >
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={projSearchInput}
                          onChange={(e) => setProjSearchInput(e.target.value)}
                          placeholder="搜索 项目名称 / 代码 / 负责人…"
                          className="pl-9"
                        />
                      </form>

                      <div className="mt-4 space-y-2">
                        {projectsLoading ? (
                          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
                        ) : allProjects.length === 0 ? (
                          <p className="py-12 text-center text-sm text-muted-foreground">
                            暂无项目，点击右上角「新增项目」
                          </p>
                        ) : (
                          allProjects.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setSelectedProjectId(p.id)}
                              className="flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-accent/60"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium">{p.name}</span>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", PROJECT_STATUS_META[p.status].className)}>
                                      {PROJECT_STATUS_META[p.status].label}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                    {p.code}
                                    {p.owner ? ` · 负责人：${p.owner}` : ""}
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Badge variant="secondary" className="font-normal">{p.relation_count} 条明细</Badge>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground"
                                  onClick={() => { setEditingProject(p); setProjectFormOpen(true); }}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-red-500"
                                  onClick={() => setDeleteProjectTarget(p)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              )}
            </div>
          </div>
        </main>
      </div>

      {/* 弹窗 */}
      <MaterialFormDialog open={materialFormOpen} onOpenChange={setMaterialFormOpen} />
      <AddSupplierToMaterialDialog
        open={addSupplierOpen}
        onOpenChange={setAddSupplierOpen}
        materialId={selectedMaterialId}
        materialPn={selectedMaterial?.pn ?? ""}
        materialName={selectedMaterial?.name ?? ""}
        excludedSupplierIds={materialSuppliers.map((r) => r.supplier_id)}
      />
      <SupplierMasterFormDialog open={supplierFormOpen} onOpenChange={setSupplierFormOpen} />
      <SupplyRelationFormDialog open={relationFormOpen} onOpenChange={setRelationFormOpen} />
      <ProjectFormDialog open={projectFormOpen} onOpenChange={setProjectFormOpen} editing={editingProject} />
      <LinkRelationDialog open={linkProjectId != null} onOpenChange={(v) => !v && setLinkProjectId(null)} projectId={linkProjectId} excludedIds={detailRelations.map((r) => r.supply_relation_id)} />
      <EditRelationDialog open={editItem != null} onOpenChange={(v) => !v && setEditItem(null)} projectId={selectedProjectId} item={editItem} />
      <RelationProjectsDialog relation={projectsRelation} onOpenChange={(v) => !v && setProjectsRelation(null)} />

      {/* 删除物料确认 */}
      <AlertDialog open={deleteMaterial != null} onOpenChange={(v) => !v && setDeleteMaterial(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除物料？</AlertDialogTitle>
            <AlertDialogDescription>
              物料「{deleteMaterial?.pn} {deleteMaterial?.name}」及其所有供应关系、项目引用将被删除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMaterialMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMaterialMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteMaterial();
              }}
            >
              {deleteMaterialMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除供应商确认 */}
      <AlertDialog open={deleteSupplier != null} onOpenChange={(v) => !v && setDeleteSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除供应商？</AlertDialogTitle>
            <AlertDialogDescription>
              供应商「{deleteSupplier?.name}（{deleteSupplier?.code}）」将被删除，其所有供应关系与项目引用一并移除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSupplierMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteSupplierMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteSupplier();
              }}
            >
              {deleteSupplierMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除供应关系确认 */}
      <AlertDialog open={deleteRelation != null} onOpenChange={(v) => !v && setDeleteRelation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除供应关系？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteRelation?.pn} · {deleteRelation?.material_name} ← {deleteRelation?.supplier_name}（{deleteRelation?.supplier_code}）」
              将被删除，所有项目中的引用一并移除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRelationMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteRelationMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteRelation();
              }}
            >
              {deleteRelationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除项目确认 */}
      <AlertDialog open={deleteProjectTarget != null} onOpenChange={(v) => !v && setDeleteProjectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              项目「{deleteProjectTarget?.name}（{deleteProjectTarget?.code}）」将被删除，其下所有供应明细一并移除（全局四元组不受影响），此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteProjectMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteProject();
              }}
            >
              {deleteProjectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 解除挂载确认 */}
      <AlertDialog open={unlinkItem != null} onOpenChange={(v) => !v && setUnlinkItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认解除挂载？</AlertDialogTitle>
            <AlertDialogDescription>
              解除「{unlinkItem?.pn} · {unlinkItem?.material_name} ← {unlinkItem?.supplier_name}」在本项目下的挂载，全局四元组及其它项目不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinkMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={unlinkMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleUnlink();
              }}
            >
              {unlinkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认解除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
