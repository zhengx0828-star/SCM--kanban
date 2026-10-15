import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Boxes,
  FileSpreadsheet,
  Loader2,
  Package,
  Plus,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { CHART_PALETTE } from "@/lib/chart-palette";
import { MaterialDetailDialog } from "@/components/projects/MaterialDetailDialog";
import { QuickAddRelationDialog } from "@/components/projects/QuickAddRelationDialog";
import { DemandExcelImportDialog } from "@/components/projects/DemandExcelImportDialog";
import { SupplierDetailDialog } from "@/components/suppliers/SupplierDetailDialog";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import {
  useProjectRelations,
  useProjects,
  useUpdateProjectDemand,
} from "@/hooks/use-projects";
import { useSuppliers } from "@/hooks/use-suppliers";
import { getApiErrorMessage } from "@/lib/utils";
import type { Supplier } from "@/types/supplier";

/**
 * 供需管理 · 项目详情页。
 *
 * - 顶部卡：项目级客户需求（1-12 月 · 录入 + 保存）
 * - 物料列表：每物料一行（点击整行弹 MaterialDetailDialog 看 BOM、物料需求、各供应商产能）
 *   顶部搜索框按 PN / 物料名过滤
 * - 行内供应商名（点击）→ 弹 SupplierDetailDialog
 *
 * 设计目的：物料列表里的「点击下拉展开」改为弹出窗口（用户偏好的交互模式），避免大表"一直都在"。
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function sumOf(arr: number[] | null | undefined) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0);
}

export default function ProjectSupplyDetailPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr);
  const navigate = useNavigate();
  const isValid = Number.isFinite(projectId) && projectId > 0;

  const { data: projectList } = useProjects({ page: 1, page_size: 100 });
  const project = useMemo(
    () => projectList?.items.find((p) => p.id === projectId),
    [projectList, projectId]
  );

  const { data: relations = [], isLoading: relationsLoading } = useProjectRelations(
    isValid ? projectId : null
  );

  /* ---- 草稿态 ---- */
  const [demandDraft, setDemandDraft] = useState<number[] | null>(null);

  useEffect(() => {
    const first = relations[0]?.demand;
    setDemandDraft(first && first.length === 12 ? [...first] : Array(12).fill(0));
  }, [relations]);

  /* ---- Mutations ---- */
  const updateDemand = useUpdateProjectDemand(isValid ? projectId : null);

  const handleSaveDemand = () => {
    if (!demandDraft) return;
    updateDemand.mutate(
      { demand: demandDraft },
      {
        onSuccess: () => toast.success("已保存客户需求"),
        onError: (err) => toast.error(getApiErrorMessage(err)),
      }
    );
  };

  /* ---- 派生：按物料聚合；物料需求 = demand × bom ---- */
  const projectDemand = relations[0]?.demand ?? null;
  const materialsByKey = useMemo(() => {
    const m = new Map<
      string,
      { pn: string; name: string; bom: number | null; rows: typeof relations; demand: number[] | null }
    >();
    for (const r of relations) {
      if (!m.has(r.pn))
        m.set(r.pn, { pn: r.pn, name: r.material_name, bom: r.bom_factor, rows: [], demand: projectDemand });
      m.get(r.pn)!.rows.push(r);
    }
    return Array.from(m.values());
  }, [relations, projectDemand]);

  /* ---- 概览：未设 BOM 的物料数（保留原来列表行的关键信息） ---- */
  const noBomCount = useMemo(() => materialsByKey.filter((m) => m.bom == null).length, [materialsByKey]);

  /* ---- 弹窗：物料 dialog / 供应商 dialog ---- */
  const [openMaterialPn, setOpenMaterialPn] = useState<string | null>(null);
  const openMaterial = useMemo(
    () => (openMaterialPn ? materialsByKey.find((m) => m.pn === openMaterialPn) ?? null : null),
    [openMaterialPn, materialsByKey]
  );

  /* 用供应商列表构建 code → Supplier 索引，供点击供应商名时跳 dialog */
  const { data: suppliers = [] } = useSuppliers();
  const supplierByCode = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.code, s);
    return m;
  }, [suppliers]);
  const [openSupplier, setOpenSupplier] = useState<Supplier | null>(null);

  /* ---- 弹窗：快速新增物料-供应商 / 导入供需 Excel ---- */
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState<{ pn: string; name: string }>({ pn: "", name: "" });

  if (!isValid) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto flex w-full max-w-[1400px]">
          <SiteSidebar />
          <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
            <p className="text-muted-foreground">无效的项目链接</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/supply-demand">返回项目列表</Link>
            </Button>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-6xl">
            {/* 顶部：返回 + 项目标题 */}
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate("/supply-demand")}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                返回项目列表
              </Button>
            </div>
            <section className="mt-2">
              {project ? (
                <>
                  <p className="font-mono text-sm text-muted-foreground">{project.code}</p>
                  <h1 className="mt-1 text-3xl font-semibold tracking-tight">{project.name}</h1>
                  {project.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
                  )}
                </>
              ) : (
                <Skeleton className="mt-2 h-9 w-80" />
              )}
            </section>

            <div className="mt-6 space-y-4">
              {/* 卡 1：客户需求（项目级 1-12 月） */}
              <Card>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Package className="h-4 w-4" />
                    客户需求（项目级 · 1-12 月）
                  </div>
                  {demandDraft ? (
                    <div className="grid gap-1.5 grid-cols-6 sm:grid-cols-12">
                      {MONTHS.map((m, i) => (
                        <div key={m} className="space-y-0.5">
                          <span className="text-[10px] text-muted-foreground">{m}</span>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={Number.isFinite(demandDraft[i] ?? 0) ? demandDraft[i] : 0}
                            onChange={(e) => {
                              const next = [...demandDraft];
                              const n = Number(e.target.value);
                              next[i] =
                                e.target.value === "" ? 0 : Number.isFinite(n) ? n : 0;
                              setDemandDraft(next);
                            }}
                            className="h-8 px-1.5 text-xs tabular-nums"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Skeleton className="h-20" />
                  )}
                  <div className="flex items-center justify-between border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      年合计：
                      <span className="ml-1 font-semibold tabular-nums text-foreground">
                        {sumOf(demandDraft).toLocaleString()}
                      </span>
                      <span className="ml-2 text-[11px]">
                        （录一次自动同步到该项目下所有供应明细行）
                      </span>
                    </p>
                    <Button size="sm" onClick={handleSaveDemand} disabled={updateDemand.isPending}>
                      {updateDemand.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-1.5 h-4 w-4" />
                      )}
                      保存客户需求
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* 物料列表（默认折叠；有搜索关键词时自动展开） */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <p className="text-xs text-muted-foreground">
                    物料列表（点击物料行，弹出窗口查看 BOM 系数、物料需求、各供应商产能）
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" onClick={() => { setQuickAddPrefill({ pn: "", name: "" }); setQuickAddOpen(true); }}>
                      <Plus className="mr-1.5 h-4 w-4" />
                      新增物料-供应商
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                      <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                      导入供需 Excel
                    </Button>
                  </div>
                </div>

                {relationsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : materialsByKey.length === 0 ? (
                  <Card>
                    <CardContent className="flex h-24 flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                      <p>该项目下暂无物料</p>
                      <p className="text-[10px]">点击上方「新增物料-供应商」挂载，或用「导入供需 Excel」批量录入</p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <MultiSelectDropdown
                      label="物料"
                      mode="single"
                      icon={<Boxes className="h-3.5 w-3.5 text-muted-foreground" />}
                      options={materialsByKey.map((m, i) => ({
                        value: m.pn,
                        label: m.name,
                        sublabel: m.pn,
                        color: CHART_PALETTE[i % CHART_PALETTE.length],
                        badge: (
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {m.rows.length} 家
                            </span>
                            {m.bom == null && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                                未设 BOM
                              </span>
                            )}
                          </span>
                        ),
                      }))}
                      selected={openMaterialPn ? new Set([openMaterialPn]) : new Set<string>()}
                      onChange={(next) => {
                        const pn = Array.from(next)[0];
                        if (pn) setOpenMaterialPn(pn);
                      }}
                      placeholder="选择物料查看详情"
                      searchPlaceholder="搜索物料 PN 或名称…"
                    />
                    <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                      共 {materialsByKey.length} 个物料
                      {noBomCount > 0 && ` · ${noBomCount} 个未设 BOM`}
                      ，选中后弹出 BOM / 需求 / 产能详情
                    </p>
                  </>
                )}
              </div>

              <p className="pt-2 text-center text-xs text-muted-foreground">
                修改 BOM / 供应商产能后点对应「保存」按钮提交；切换页面或返回项目列表未保存的编辑会丢失。
              </p>
            </div>
          </div>
        </main>
      </div>

      {/* 物料详情对话框 */}
      <MaterialDetailDialog
        open={!!openMaterialPn}
        material={openMaterial}
        projectId={projectId}
        onClose={() => setOpenMaterialPn(null)}
        onSupplierClick={({ code }) => {
          const s = supplierByCode.get(code);
          if (s) setOpenSupplier(s);
          else toast.warning(`未找到供应商：${code}（请先在供应商列表维护）`);
        }}
        onAddSupplier={({ pn, name }) => {
          setOpenMaterialPn(null);
          setQuickAddPrefill({ pn, name });
          setQuickAddOpen(true);
        }}
      />

      {/* 供应商详情对话框 */}
      <SupplierDetailDialog supplier={openSupplier} onClose={() => setOpenSupplier(null)} />

      {/* 快速新增物料-供应商 */}
      <QuickAddRelationDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        projectId={projectId}
        initialPn={quickAddPrefill.pn}
        initialMaterialName={quickAddPrefill.name}
      />

      {/* 导入供需 Excel（需求 + BOM + 产能） */}
      {project && (
        <DemandExcelImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          projectId={projectId}
          projectCode={project.code}
          projectName={project.name}
        />
      )}
    </div>
  );
}
