import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateShareRecord } from "@/hooks/use-share";
import { useProjectRelations } from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";
import { QDC_SCORES } from "@/types/share";

/**
 * 手动新增份额记录：选择供应关系（物料 × 供应商）+ 份额 + QDC 五档。
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number | null;
  month: string;
}

const SCORE_OPTIONS = QDC_SCORES.map((s) => String(s));

export function ShareRecordCreateDialog({ open, onOpenChange, projectId, month }: Props) {
  const createMutation = useCreateShareRecord();
  // 供应关系只取「当前项目已挂载」的，不带出全量
  const { data: projectRelations, isLoading: relationsLoading } = useProjectRelations(projectId);

  const [relationId, setRelationId] = useState<string>("");
  const [share, setShare] = useState("");
  const [q, setQ] = useState("");
  const [d, setD] = useState("");
  const [c, setC] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRelationId("");
      setShare("");
      setQ("");
      setD("");
      setC("");
      setRemark("");
      setError(null);
    }
  }, [open]);

  // 供应关系选项：仅当前项目挂载的（project_supply_relations → supply_relation_id）
  const relOptions = useMemo(() => {
    return (projectRelations ?? [])
      .filter((r) => r.supply_relation_id != null)
      .sort((a, b) => a.pn.localeCompare(b.pn))
      .map((r) => ({
        id: String(r.supply_relation_id),
        label: `${r.pn} ${r.material_name} × ${r.supplier_name}`,
      }));
  }, [projectRelations]);

  const handleSave = () => {
    if (!projectId) return setError("请先选择项目");
    if (!relationId) return setError("请选择供应关系（物料 × 供应商）");
    if (share !== "" && (Number.isNaN(Number(share)) || Number(share) < 0 || Number(share) > 100)) {
      return setError("份额应为 0-100 之间的数字");
    }
    setError(null);
    const payload: {
      project_id: number;
      supply_relation_id: number;
      month: string;
      share_current?: number;
      q_score?: number;
      d_score?: number;
      c_score?: number;
      remark?: string;
    } = {
      project_id: projectId,
      supply_relation_id: Number(relationId),
      month,
    };
    if (share !== "") payload.share_current = Number(share);
    if (q !== "") payload.q_score = Number(q);
    if (d !== "") payload.d_score = Number(d);
    if (c !== "") payload.c_score = Number(c);
    if (remark !== "") payload.remark = remark;

    createMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("份额记录已新增，加权分与建议配额已自动计算");
        onOpenChange(false);
      },
      onError: (err) => setError(getApiErrorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>手动录入份额（{month}）</DialogTitle>
          <DialogDescription>
            选择物料 × 供应商，填写份额与 Q/D/C 评分（五档下拉），保存后自动计算加权分与建议配额。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>供应关系 <span className="text-red-500">*</span></Label>
            <Select value={relationId || undefined} onValueChange={setRelationId}>
              <SelectTrigger>
                <SelectValue placeholder="选择物料 × 供应商" />
              </SelectTrigger>
              <SelectContent>
                {relationsLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">加载中…</div>
                ) : relOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">该项目暂无挂载的供应关系</div>
                ) : (
                  relOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>本月系统份额（%）</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={share}
              onChange={(e) => setShare(e.target.value)}
              placeholder="0-100"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Q 质量</Label>
              <Select value={q || undefined} onValueChange={setQ}>
                <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {SCORE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>D 交付</Label>
              <Select value={d || undefined} onValueChange={setD}>
                <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {SCORE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>C 成本</Label>
              <Select value={c || undefined} onValueChange={setC}>
                <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {SCORE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
