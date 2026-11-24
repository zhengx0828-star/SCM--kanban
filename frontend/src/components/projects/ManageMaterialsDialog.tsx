import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRemoveProjectMaterials } from "@/hooks/use-projects";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { materialDotColor, type MaterialRisk } from "@/lib/supply-risk";
import type { ProjectSupplyRelation } from "@/types/project";

/**
 * 管理物料（项目维度）：勾选若干物料，批量从项目里移除。
 *
 * 语义：移除 = 删掉**该项目该 PN 下的全部供应明细**（每家供应商一行，含 12 月产能与 BOM）。
 * 不动 `materials` / `supply_relations` 主数据，也不碰份额、库存、变更 ——
 * 那些都不挂项目，按物料独立存在。删完可用「新增物料-供应商」原样挂回，但产能要重录。
 *
 * 为什么点删除**不弹第二个弹窗**：本组件本身是 Dialog，再叠一层 AlertDialog 会把
 * 父 Dialog 的 outside-interaction 当成点到了外面，父层直接关掉（radix 老坑）。
 * 所以确认态做成弹窗内的第二段，不新增层级。
 */

export interface ManageMaterialItem {
  pn: string;
  name: string;
  bom: number | null;
  /** 该项目该物料的全部供应明细（一家供应商一行） */
  rows: ProjectSupplyRelation[];
}

interface ManageMaterialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectName: string;
  materials: ManageMaterialItem[];
  /** PN → 风险行（与物料下拉的圆点同源，别在这里另算） */
  riskByPn: Map<string, MaterialRisk>;
  /** 移除成功后回调（父页用来关掉可能正在展示的物料详情） */
  onRemoved?: (pns: string[]) => void;
}

export function ManageMaterialsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  materials,
  riskByPn,
  onRemoved,
}: ManageMaterialsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const removeMutation = useRemoveProjectMaterials(projectId);

  /* 每次打开都从干净状态开始，避免上次勾选残留 */
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setKeyword("");
      setConfirming(false);
    }
  }, [open]);

  /* 物料被移除后（或外部刷新）勾选里可能留下已不存在的 PN → 剔除 */
  useEffect(() => {
    const alive = new Set(materials.map((m) => m.pn));
    setSelected((prev) => {
      const next = new Set([...prev].filter((pn) => alive.has(pn)));
      return next.size === prev.size ? prev : next;
    });
  }, [materials]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter(
      (m) => m.name.toLowerCase().includes(q) || m.pn.toLowerCase().includes(q)
    );
  }, [materials, keyword]);

  const selectedItems = useMemo(
    () => materials.filter((m) => selected.has(m.pn)),
    [materials, selected]
  );
  const selectedLinks = selectedItems.reduce((s, m) => s + m.rows.length, 0);
  const selectedSuppliers = new Set(
    selectedItems.flatMap((m) => m.rows.map((r) => r.supplier_code))
  ).size;

  const toggle = (pn: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pn)) next.delete(pn);
      else next.add(pn);
      return next;
    });
    setConfirming(false);
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.pn));

  const handleRemove = () => {
    const pns = [...selected];
    removeMutation.mutate(pns, {
      onSuccess: (res) => {
        toast.success(
          `已从项目移除 ${res.removed_materials} 个物料（${res.removed_links} 条供应明细）`
        );
        setSelected(new Set());
        setConfirming(false);
        onRemoved?.(res.pns);
      },
      onError: (err) => toast.error(getApiErrorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent 基础类自带 sm:max-w-sm（384px），max-w-2xl 必须同带 sm: 前缀才盖得住 */}
      <DialogContent className="flex max-h-[84vh] max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">管理物料</DialogTitle>
          <DialogDescription className="text-xs">
            勾选后从项目移除。只删当前项目的供应明细，物料主数据与其他项目不受影响。
          </DialogDescription>
        </DialogHeader>

        {/* 搜索 + 全选 */}
        <div className="flex items-center gap-2 border-b px-5 py-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索物料 PN 或名称…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={() =>
              setSelected(
                allFilteredSelected
                  ? new Set()
                  : new Set(filtered.map((m) => m.pn))
              )
            }
            disabled={filtered.length === 0}
          >
            {allFilteredSelected ? "取消全选" : "全选"}
          </Button>
        </div>

        {/* 物料清单 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              {materials.length === 0 ? "该项目下暂无物料" : "没有匹配的物料"}
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((m) => {
                const checked = selected.has(m.pn);
                const risk = riskByPn.get(m.pn);
                const shortageMonths =
                  risk?.monthly.filter((x) => x.status === "shortage").length ?? 0;
                const dot = materialDotColor(risk, m.bom);
                return (
                  <li key={m.pn}>
                    <label
                      htmlFor={`manage-mat-${m.pn}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40",
                        checked && "bg-primary/5"
                      )}
                    >
                      <Checkbox
                        id={`manage-mat-${m.pn}`}
                        checked={checked}
                        onCheckedChange={() => toggle(m.pn)}
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: dot }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          <span className="font-mono text-muted-foreground">{m.pn}</span>
                          <span className="mx-1.5 text-muted-foreground/60">·</span>
                          {m.name}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          <span>{m.rows.length} 家供应商</span>
                          <span>BOM {m.bom ?? "未设"}</span>
                          {shortageMonths > 0 ? (
                            <span className="font-medium text-red-600 dark:text-red-400">
                              缺 {shortageMonths} 个月
                            </span>
                          ) : risk && risk.totalDemand > 0 ? (
                            <span className="text-green-600 dark:text-green-400">全年够用</span>
                          ) : (
                            <span>无法判定</span>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 确认态：不新开弹窗，就地展开 */}
        {confirming && (
          <div className="border-t bg-red-50/70 px-5 py-3 text-xs dark:bg-red-950/30">
            <p className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              从「{projectName}」移除 {selectedItems.length} 个物料？
            </p>
            <p className="mt-1 leading-relaxed text-red-700/90 dark:text-red-300/90">
              将删除 {selectedLinks} 条供应明细（{selectedSuppliers} 家供应商的 12 个月产能与 BOM
              系数），删除后不可恢复。物料主数据、其他项目、份额、库存、变更单不受影响；
              之后可用「新增物料-供应商」挂回，但产能与 BOM 需重新录入。
            </p>
          </div>
        )}

        {/* 底栏 */}
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {confirming ? (
              "此操作不可撤销"
            ) : (
              <>
                已选 <span className="font-semibold text-foreground">{selectedItems.length}</span>
                {" "}个物料 · {selectedLinks} 条明细
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            {confirming ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={removeMutation.isPending}
                >
                  返回
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={removeMutation.isPending}
                >
                  {removeMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-4 w-4" />
                  )}
                  确认移除
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                  关闭
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  onClick={() => setConfirming(true)}
                  disabled={selectedItems.length === 0}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  移除选中
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
