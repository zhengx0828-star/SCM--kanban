import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useCreateDemandVersion } from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";
import type { DemandVersion } from "@/types/project";

/**
 * 另存为新版本（需求版本化的唯一写入入口）。
 *
 * 口径见 `docs/demand-versioning/01-方案定稿.md`：
 *   - **只增不改**：保存即生成新版本，历史版本永久只读，没有「覆盖保存」这条路；
 *   - 项目首版自动成为当前版；后续保存默认也置为当前版（全站供需计算随即切换）；
 *   - 版本号只作展示，服务端另有自增 `seq` 负责排序与「取上一版」，手填错也不会乱序。
 */

interface CreateDemandVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** 本次要落库的需求（页面上正在编辑的草稿） */
  demand: number[];
  /** 现有版本链，用于预填建议版本号 */
  versions: DemandVersion[];
  /** 保存成功后的回调（一般是把视图切到新版本） */
  onCreated?: (created: DemandVersion) => void;
}

/** 按上一版 +0.1 建议版本号（与服务端同规则，仅作预填） */
function suggestVersionNo(versions: DemandVersion[]): string {
  if (versions.length === 0) return "1.0";
  const top = [...versions].sort((a, b) => b.seq - a.seq)[0];
  const base = Number(top.version_no);
  if (!Number.isFinite(base)) return `${top.seq + 1}.0`;
  return (Math.round((base + 0.1) * 10) / 10).toFixed(1);
}

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function CreateDemandVersionDialog({
  open,
  onOpenChange,
  projectId,
  demand,
  versions,
  onCreated,
}: CreateDemandVersionDialogProps) {
  const createVersion = useCreateDemandVersion(projectId);
  const [versionNo, setVersionNo] = useState("");
  const [label, setLabel] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today());

  /* 每次打开重置表单（版本号按当前链自动建议） */
  useEffect(() => {
    if (!open) return;
    setVersionNo(suggestVersionNo(versions));
    setLabel("");
    setEffectiveDate(today());
  }, [open, versions]);

  const total = demand.reduce((a, b) => a + b, 0);
  const isFirst = versions.length === 0;

  const handleSubmit = () => {
    createVersion.mutate(
      {
        demand,
        version_no: versionNo.trim() || null,
        label: label.trim() || null,
        effective_date: effectiveDate || null,
        source: "manual",
        set_current: true,
      },
      {
        onSuccess: (created) => {
          toast.success(`已保存为 V${created.version_no}，并设为当前版`);
          onCreated?.(created);
          onOpenChange(false);
        },
        onError: (err) => toast.error(getApiErrorMessage(err)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isFirst ? "保存客户需求" : "另存为新版本"}</DialogTitle>
          <DialogDescription>
            年合计 <span className="font-medium tabular-nums text-foreground">{total.toLocaleString("zh-CN")}</span>
            。
            {isFirst
              ? "这是本项目的第一个需求版本，保存后自动成为当前版。"
              : "保存后生成一个新版本并置为当前版，历史版本永久只读，不能被覆盖。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="demand-version-no">版本号</Label>
            <Input
              id="demand-version-no"
              value={versionNo}
              onChange={(e) => setVersionNo(e.target.value)}
              placeholder="如 2.0"
            />
            <p className="text-[11px] text-muted-foreground">
              {isFirst
                ? "默认 1.0，后续版本可按「上一版 +0.1」自动建议，也可改成 2.0 这类正式版本号。"
                : "按「上一版 +0.1」自动建议，可改成 2.0 这类正式版本号。"}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="demand-version-label">版本说明</Label>
            <Input
              id="demand-version-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如 客户 10 月调产（Q4 上量）"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="demand-version-eff">生效日期</Label>
            <Input
              id="demand-version-eff"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={createVersion.isPending}>
            {createVersion.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            创建并设为当前版
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
