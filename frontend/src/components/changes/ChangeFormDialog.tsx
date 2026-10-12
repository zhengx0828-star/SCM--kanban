import { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useChangeOwners, useChangeTypes, useCreateChange } from "@/hooks/use-changes";
import { useMaterials } from "@/hooks/use-materials";
import { useProjects } from "@/hooks/use-projects";
import { getApiErrorMessage } from "@/lib/utils";
import { ChangeTypeDialog } from "./ChangeTypeDialog";

/**
 * 新建变更单。
 *
 * 规则：**一张单 = 一个物料**；同物料同项目可以有多张单（先设计变更、再供应商切换）。
 * 计划起止不在这里填 —— 那是任务的属性，由叶子任务自动汇总（用户确认）。
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 从项目视图进来时预选项目 */
  presetProjectId?: number | null;
  onCreated?: (id: number) => void;
}

export function ChangeFormDialog({ open, onOpenChange, presetProjectId, onCreated }: Props) {
  const { data: projectList } = useProjects({ page: 1, page_size: 100 });
  const { data: materialList } = useMaterials({ page: 1, page_size: 100 });
  const { data: types = [] } = useChangeTypes(false);
  const { data: owners = [] } = useChangeOwners();
  const createChange = useCreateChange();

  const [projectId, setProjectId] = useState<string>("");
  const [materialId, setMaterialId] = useState<string>("");
  const [typeId, setTypeId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProjectId(presetProjectId ? String(presetProjectId) : "");
    setMaterialId("");
    setTypeId(types[0] ? String(types[0].id) : "");
    setTitle("");
    setOwner("");
    setDescription("");
    setMaterialKeyword("");
  }, [open, presetProjectId, types]);

  const materials = useMemo(() => {
    const items = materialList?.items ?? [];
    const kw = materialKeyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((m) => `${m.pn} ${m.name}`.toLowerCase().includes(kw));
  }, [materialList, materialKeyword]);

  const onSubmit = async () => {
    if (!projectId) return toast.error("请选择项目");
    if (!materialId) return toast.error("请选择物料");
    if (!typeId) return toast.error("请选择变更类型（没有的话点右边的「类型」先加一个）");
    if (!title.trim()) return toast.error("请填变更标题");
    try {
      const created = await createChange.mutateAsync({
        project_id: Number(projectId),
        material_id: Number(materialId),
        change_type_id: Number(typeId),
        title: title.trim(),
        owner: owner.trim() || null,
        description: description.trim() || null,
      });
      toast.success(`已新建变更单 #${created.id}`);
      onCreated?.(created.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>新建变更单</DialogTitle>
            <DialogDescription>一张单只对应一个物料；建好后进去加待办项和计划时间。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">项目</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {(projectList?.items ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                      {p.code} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">物料（可搜索）</Label>
              <Input
                className="h-8 text-xs"
                placeholder="输入 PN 或物料名过滤"
                value={materialKeyword}
                onChange={(e) => setMaterialKeyword(e.target.value)}
              />
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择物料" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)} className="text-xs">
                      {m.pn} · {m.name}
                    </SelectItem>
                  ))}
                  {materials.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">没有匹配的物料</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">变更类型</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-muted-foreground"
                  onClick={() => setTypeDialogOpen(true)}
                >
                  <Settings2 className="mr-1 h-3 w-3" />
                  管理类型
                </Button>
              </div>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择类型（可先点右上角新建）" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                  {types.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      还没有类型，点右上角「管理类型」加一个
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">变更标题</Label>
              <Input
                className="h-8 text-xs"
                placeholder="例如：MCU 供应商切换"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">总责任人</Label>
              <Input
                className="h-8 text-xs"
                placeholder="自由填写"
                list="change-owner-options-form"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
              <datalist id="change-owner-options-form">
                {owners.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">变更内容</Label>
              <Textarea
                className="min-h-[72px] text-xs"
                placeholder="说明这次变更要做什么、为什么做"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={createChange.isPending}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangeTypeDialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen} />
    </>
  );
}
