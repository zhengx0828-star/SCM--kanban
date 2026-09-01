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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useCreateSupplier } from "@/hooks/use-suppliers";
import { getApiErrorMessage } from "@/lib/utils";

/**
 * 底表供应商录入弹窗（供应商列表页专用）。
 * 底表 = 所有供应商主数据，仅承载身份信息：供应商名称 + 供应商代码。
 * 地图相关字段（城市/经纬度/联系人等）不属于底表，在地图录入时补全。
 */
export function SupplierMasterFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createMutation = useCreateSupplier();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = createMutation.isPending;

  useEffect(() => {
    if (open) {
      setName("");
      setCode("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim()) return setError("请输入供应商名称");
    if (!code.trim()) return setError("请输入供应商代码");
    setError(null);
    createMutation.mutate(
      {
        code: code.trim(),
        name: name.trim(),
      },
      {
        onSuccess: () => {
          toast.success("供应商已录入底表");
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
          <DialogTitle>录入供应商</DialogTitle>
          <DialogDescription>
            录入供应商主数据（底表）。仅需名称与代码；地图相关字段（城市、经纬度等）在「Dashboard 录入」中补全。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="master-supplier-name">
              供应商名称 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="master-supplier-name"
              placeholder="例如：深圳市华芯电子有限公司"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="master-supplier-code">
              供应商代码 <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-muted-foreground">唯一，例如 SUP-001</span>
            </Label>
            <Input
              id="master-supplier-code"
              placeholder="SUP-001"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
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
            保存到底表
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
