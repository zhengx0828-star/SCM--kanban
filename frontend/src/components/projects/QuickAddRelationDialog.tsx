import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Plus } from "lucide-react";
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useQuickAddProjectRelation } from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 快速新增项目明细（四元组一行式）。
 *
 * 输入 PN · 物料名称 · 供应商名称 · 供应商代码，后端自动
 * 创建/复用 L1 主数据 + L2 供应关系，并挂载到本项目（L3）。
 * 与「供应商列表 · 项目详情 · 快速新增」同一逻辑，供供需管理项目详情页复用。
 */
export function QuickAddRelationDialog({
  open,
  onOpenChange,
  projectId,
  initialPn = "",
  initialMaterialName = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  /** 预填物料 PN（从物料详情弹窗「为该物料添加供应商」进入时用） */
  initialPn?: string;
  /** 预填物料名称 */
  initialMaterialName?: string;
}) {
  const quickAddMutation = useQuickAddProjectRelation(projectId);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState({ pn: "", materialName: "", supplierName: "", supplierCode: "" });
  const setQField = (key: keyof typeof q, value: string) => setQ((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (open) {
      setError(null);
      setQ({ pn: initialPn, materialName: initialMaterialName, supplierName: "", supplierCode: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = () => {
    if (!projectId) return;
    if (!q.pn.trim()) return setError("请输入物料 PN");
    if (!q.materialName.trim()) return setError("请输入物料名称");
    if (!q.supplierName.trim()) return setError("请输入供应商名称");
    if (!q.supplierCode.trim()) return setError("请输入供应商代码");
    setError(null);
    quickAddMutation.mutate(
      {
        pn: q.pn.trim(),
        material_name: q.materialName.trim(),
        supplier_name: q.supplierName.trim(),
        supplier_code: q.supplierCode.trim(),
        // ★ 手动录入：名称是用户当场亲手打的，属于明确意图 → 允许同步覆盖全局主数据名称。
        //   这也是目前**唯一**能改物料名称的入口（物料接口只有新建 / 删除，没有改名）。
        //   Excel 批量导入走的是 False，绝不改名（见 ExcelImportDialog）。
        sync_master_names: true,
      },
      {
        onSuccess: () => {
          toast.success("明细已添加（主数据自动创建/复用）");
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
          <DialogTitle>快速新增物料-供应商</DialogTitle>
          <DialogDescription>
            填写四项即可，系统自动创建/复用主数据并挂载到本项目。之后可在物料弹窗里录入 BOM 与产能。
            <br />
            注意：若物料 / 供应商<b>已存在</b>，名称会按你填写的<b>同步更新</b> —— 主数据为所有项目共用，
            这会同时改变其它项目里看到的名称。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                物料 PN <span className="text-red-500">*</span>
              </Label>
              <Input value={q.pn} onChange={(e) => setQField("pn", e.target.value)} placeholder="例如：581601-00035" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                物料名称 <span className="text-red-500">*</span>
              </Label>
              <Input value={q.materialName} onChange={(e) => setQField("materialName", e.target.value)} placeholder="例如：模组" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                供应商名称 <span className="text-red-500">*</span>
              </Label>
              <Input value={q.supplierName} onChange={(e) => setQField("supplierName", e.target.value)} placeholder="例如：华芯电子" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                供应商代码 <span className="text-red-500">*</span>
              </Label>
              <Input value={q.supplierCode} onChange={(e) => setQField("supplierCode", e.target.value)} placeholder="例如：SUP-001" className="h-9" />
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={quickAddMutation.isPending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={quickAddMutation.isPending}>
            {quickAddMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            保存明细
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
