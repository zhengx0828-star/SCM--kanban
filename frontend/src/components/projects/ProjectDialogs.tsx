import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { Skeleton } from "../ui/skeleton";
import {
  useCreateProject,
  useLinkProjectRelation,
  useUpdateProject,
  useUpdateProjectRelation,
} from "@/hooks/use-projects";
import { useSupplyRelationOptions } from "@/hooks/use-supply-relations";
import { getApiErrorMessage } from "@/lib/utils";
import { ROLE_OPTIONS, type Project, type ProjectSupplyRelation } from "@/types/project";

/* ---------- 新增/编辑项目弹窗 ---------- */
export function ProjectFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Project | null;
}) {
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (open) {
      setCode(editing?.code ?? "");
      setName(editing?.name ?? "");
      setStatus(editing?.status ?? "active");
      setOwner(editing?.owner ?? "");
      setDescription(editing?.description ?? "");
      setError(null);
    }
  }, [open, editing]);

  const handleSubmit = () => {
    if (!code.trim()) return setError("请输入项目代码");
    if (!name.trim()) return setError("请输入项目名称");
    setError(null);
    const payload = {
      code: code.trim(),
      name: name.trim(),
      status: status as Project["status"],
      owner: owner.trim() || null,
      description: description.trim() || null,
    };
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success("项目已更新");
            onOpenChange(false);
          },
          onError: (err) => setError(getApiErrorMessage(err)),
        }
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          toast.success("项目已创建");
          onOpenChange(false);
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑项目" : "新增项目"}</DialogTitle>
          <DialogDescription>项目是 L3 维度的一等公民，每个项目维护自己的供应明细信息。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>项目代码 <span className="text-red-500">*</span></Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如：PRJ-A" disabled={!!editing} />
            </div>
            <div className="space-y-1.5">
              <Label>项目名称 <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：项目A" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">进行中</SelectItem>
                  <SelectItem value="planning">规划中</SelectItem>
                  <SelectItem value="closed">已关闭</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>负责人</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="例如：张三" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>项目描述</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="选填" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "保存修改" : "创建项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 挂载供应关系弹窗（四元组 + 项目专属字段） ---------- */
export function LinkRelationDialog({
  open,
  onOpenChange,
  projectId,
  excludedIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  excludedIds: number[];
}) {
  const { data: options = [], isLoading } = useSupplyRelationOptions();
  const linkMutation = useLinkProjectRelation(projectId);

  const [relationId, setRelationId] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [unitPrice, setUnitPrice] = useState("");
  const [quota, setQuota] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRelationId(""); setRole(""); setIsPrimary(false); setUnitPrice(""); setQuota(""); setLeadTime(""); setError(null);
    }
  }, [open]);

  const candidates = options.filter((o) => !excludedIds.includes(o.id));

  const handleSubmit = () => {
    if (!relationId) return setError("请选择供应关系");
    setError(null);
    linkMutation.mutate(
      {
        supply_relation_id: Number(relationId),
        role: role || null,
        is_primary: isPrimary,
        unit_price: unitPrice === "" ? null : Number(unitPrice),
        quota: quota.trim() || null,
        lead_time: leadTime.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("已挂载到项目");
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
          <DialogTitle>挂载供应关系</DialogTitle>
          <DialogDescription>
            从全局四元组（物料PN · 物料名称 · 供应商名称 · 供应商代码）中选择，并填写该项目下的专属字段。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>供应关系 <span className="text-red-500">*</span></Label>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={relationId || undefined} onValueChange={setRelationId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={candidates.length ? "选择四元组（PN · 物料 · 供应商）" : "所有供应关系均已挂载"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {candidates.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.pn} · {o.material_name} ← {o.supplier_name}（{o.supplier_code}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {candidates.length === 0 && !isLoading && (
              <p className="text-xs text-muted-foreground">可在「供应关系」Tab 新增四元组。</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>角色</Label>
              <Select value={role || undefined} onValueChange={setRole}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isPrimary} onCheckedChange={(v) => setIsPrimary(!!v)} />
                主供
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>单价（元）</Label>
              <Input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="例如：3.20" />
            </div>
            <div className="space-y-1.5">
              <Label>配额</Label>
              <Input value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="例如：60%" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>交期</Label>
            <Input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="例如：14 天" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={linkMutation.isPending}>取消</Button>
          <Button onClick={handleSubmit} disabled={linkMutation.isPending || !relationId}>
            {linkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            确认挂载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 编辑项目明细弹窗（维护项目专属字段） ---------- */
export function EditRelationDialog({
  open,
  onOpenChange,
  projectId,
  item,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  item: ProjectSupplyRelation | null;
}) {
  const updateMutation = useUpdateProjectRelation(projectId);
  const [role, setRole] = useState<string>("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [unitPrice, setUnitPrice] = useState("");
  const [quota, setQuota] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (open && item) {
      setRole(item.role ?? "");
      setIsPrimary(item.is_primary);
      setUnitPrice(item.unit_price == null ? "" : String(item.unit_price));
      setQuota(item.quota ?? "");
      setLeadTime(item.lead_time ?? "");
      setValidFrom(item.valid_from ?? "");
      setValidTo(item.valid_to ?? "");
      setRemark(item.remark ?? "");
    }
  }, [open, item]);

  const handleSubmit = () => {
    if (!item || !projectId) return;
    updateMutation.mutate(
      {
        linkId: item.id,
        data: {
          role: role || null,
          is_primary: isPrimary,
          unit_price: unitPrice === "" ? null : Number(unitPrice),
          quota: quota.trim() || null,
          lead_time: leadTime.trim() || null,
          valid_from: validFrom || null,
          valid_to: validTo || null,
          remark: remark.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("项目明细已更新");
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
          <DialogTitle>编辑项目明细</DialogTitle>
          <DialogDescription>
            {item ? `${item.pn} · ${item.material_name} ← ${item.supplier_name}（${item.supplier_code}）` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>角色</Label>
              <Select value={role || undefined} onValueChange={setRole}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isPrimary} onCheckedChange={(v) => setIsPrimary(!!v)} />
                主供
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>单价（元）</Label>
              <Input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>配额</Label>
              <Input value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="例如：60%" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>交期</Label>
            <Input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="例如：14 天" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>有效期起</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>有效期止</Label>
              <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>取消</Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
