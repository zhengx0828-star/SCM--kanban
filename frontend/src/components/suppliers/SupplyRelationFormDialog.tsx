import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
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
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { useCreateSupplyRelation } from "@/hooks/use-supply-relations";
import { useMaterials } from "@/hooks/use-materials";
import { useSuppliers } from "@/hooks/use-suppliers";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 新增供应关系弹窗（L2 四元组主数据）。
 * 选择「物料」+「供应商」建立全局唯一的供应关系，不含项目信息；
 * 挂载到项目在「项目」页完成。
 */
export function SupplyRelationFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createMutation = useCreateSupplyRelation();
  const { data: materialList, isLoading: materialsLoading } = useMaterials({ page: 1, page_size: 100 });
  const { data: suppliers = [], isLoading: suppliersLoading } = useSuppliers();

  const [materialId, setMaterialId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = createMutation.isPending;

  const materials = materialList?.items ?? [];

  useEffect(() => {
    if (open) {
      setMaterialId("");
      setSupplierId("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!materialId) return setError("请选择物料");
    if (!supplierId) return setError("请选择供应商");
    setError(null);
    createMutation.mutate(
      { material_id: Number(materialId), supplier_id: Number(supplierId) },
      {
        onSuccess: () => {
          toast.success("供应关系已建立（四元组）");
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
          <DialogTitle>新增供应关系</DialogTitle>
          <DialogDescription>
            选择物料 + 供应商建立全局唯一的四元组（物料PN · 物料名称 · 供应商名称 · 供应商代码），
            不含项目信息；之后在「项目」页挂载到具体项目。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>
              物料 <span className="text-red-500">*</span>
            </Label>
            {materialsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={materialId || undefined} onValueChange={setMaterialId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={materials.length ? "选择物料（PN / 名称）" : "暂无物料，请先新增物料"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.pn} · {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>
              供应商 <span className="text-red-500">*</span>
            </Label>
            {suppliersLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={suppliers.length ? "选择供应商（名称 / 代码）" : "暂无供应商，请先录入供应商"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}（{s.code}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {error && (
            <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            建立供应关系
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
