import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Search, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useBases, useBulkCreateInventoryPlans, useInventoryCandidates } from "@/hooks/use-inventory";
import { getApiErrorMessage } from "@/lib/utils";
import type { InventoryCandidate } from "@/types/inventory";

/**
 * 从底表批量选取建档。
 *
 * 底表里已有「项目 × 物料 × 供应商」的供应关系，但并不是每个组合都要做库存推算，
 * 所以这里列出候选组合，由业务勾选真正需要建档案的，再统一指定基地与默认参数。
 * 建好的档案与底表联动（物料需求 = 客户需求 × BOM 系数），底表一改库存推算自动跟随。
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const keyOf = (c: InventoryCandidate) => `${c.project_id}-${c.material_id}-${c.supplier_id}`;

export function InventoryBulkCreateDialog({ open, onOpenChange }: Props) {
  const { data: bases } = useBases();
  const { data: candidates, isLoading } = useInventoryCandidates("", open);
  const bulkCreate = useBulkCreateInventoryPlans();

  const [baseId, setBaseId] = useState<string>("");
  const [leadTime, setLeadTime] = useState("7");
  const [onHand, setOnHand] = useState("0");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** 该组合在当前所选基地下是否已建档 */
  const isBuilt = (c: InventoryCandidate) => baseId !== "" && c.planned_base_ids.includes(Number(baseId));

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = candidates ?? [];
    if (!kw) return list;
    return list.filter((c) =>
      [c.project_code, c.project_name, c.pn, c.material_name, c.supplier_name, c.supplier_code]
        .join(" ")
        .toLowerCase()
        .includes(kw)
    );
  }, [candidates, keyword]);

  const selectableRows = rows.filter((c) => !isBuilt(c));
  const allSelected = selectableRows.length > 0 && selectableRows.every((c) => selected.has(keyOf(c)));

  const toggle = (c: InventoryCandidate) => {
    const k = keyOf(c);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      selectableRows.forEach((c) => next.add(keyOf(c)));
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setKeyword("");
    setError(null);
  };

  const submit = () => {
    if (!baseId) {
      setError("请先选择要建到哪个基地");
      return;
    }
    const lt = Number(leadTime);
    const oh = Number(onHand);
    if (!Number.isFinite(lt) || lt <= 0) {
      setError("采购提前期必须大于 0");
      return;
    }
    if (!Number.isFinite(oh) || oh < 0) {
      setError("初始现有库存不能为负");
      return;
    }
    const picked = rows.filter((c) => selected.has(keyOf(c)));
    if (picked.length === 0) {
      setError("请至少勾选一条组合");
      return;
    }
    setError(null);
    bulkCreate.mutate(
      picked.map((c) => ({
        project_id: c.project_id,
        material_id: c.material_id,
        supplier_id: c.supplier_id,
        base_id: Number(baseId),
        lead_time_days: lt,
        on_hand: oh,
      })),
      {
        onSuccess: (res) => {
          if (res.skipped > 0) {
            toast.warning(`新建 ${res.created} 条，跳过 ${res.skipped} 条：${res.errors.slice(0, 2).join("；")}`);
          } else {
            toast.success(`已新建 ${res.created} 条库存档案`);
          }
          reset();
          onOpenChange(false);
        },
        onError: (e) => setError(getApiErrorMessage(e)),
      }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>从底表批量选取建档</DialogTitle>
          <DialogDescription>
            列出底表中已有的「项目 × 物料 × 供应商」组合，勾选需要做库存推算的，统一指定基地与默认参数。
            建档后与底表联动：物料需求 = 客户需求 × BOM 系数。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 建到哪个基地 + 默认参数 */}
          <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1">
              <Label className="text-xs">建到基地 *</Label>
              <Select value={baseId} onValueChange={setBaseId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择基地" />
                </SelectTrigger>
                <SelectContent>
                  {(bases ?? []).map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">默认采购提前期（天）</Label>
              <Input className="h-8 text-xs" type="number" min={1} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">默认初始现有库存</Label>
              <Input className="h-8 text-xs" type="number" min={0} value={onHand} onChange={(e) => setOnHand(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="搜索项目 / 物料 / 供应商"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={toggleAll} disabled={selectableRows.length === 0}>
              {allSelected ? "取消全选" : `全选可建（${selectableRows.length}）`}
            </Button>
            <span className="text-xs text-muted-foreground">已选 {selected.size} 条</span>
          </div>

          <div className="max-h-[340px] overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 text-left font-medium">项目</th>
                  <th className="px-2 py-2 text-left font-medium">物料</th>
                  <th className="px-2 py-2 text-left font-medium">供应商</th>
                  <th className="px-2 py-2 text-left font-medium">数据就绪度</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      <Table2 className="mx-auto mb-1.5 h-5 w-5 opacity-50" />
                      底表暂无供应关系组合
                    </td>
                  </tr>
                ) : (
                  rows.map((c) => {
                    const built = isBuilt(c);
                    const noDemand = c.demand_months === 0;
                    const noBom = c.bom_factor === null;
                    return (
                      <tr
                        key={keyOf(c)}
                        className={`border-t ${built ? "opacity-50" : "cursor-pointer hover:bg-accent/30"}`}
                        onClick={() => !built && toggle(c)}
                      >
                        <td className="px-2 py-2">
                          <Checkbox
                            checked={selected.has(keyOf(c))}
                            disabled={built}
                            onCheckedChange={() => !built && toggle(c)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium">{c.project_code}</div>
                          <div className="text-[10px] text-muted-foreground">{c.project_name}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-mono text-[11px]">{c.pn}</div>
                          <div className="text-[10px] text-muted-foreground">{c.material_name}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div>{c.supplier_name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{c.supplier_code}</div>
                        </td>
                        <td className="px-2 py-2">
                          {built ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">该基地已建档</span>
                          ) : noDemand || noBom ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                              <AlertTriangle className="h-3 w-3" />
                              {noDemand && noBom
                                ? "缺客户需求与 BOM"
                                : noDemand
                                ? "缺客户需求"
                                : "缺 BOM 系数"}
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
                              需求 {c.demand_months} 个月
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulkCreate.isPending}>
            取消
          </Button>
          <Button onClick={submit} disabled={bulkCreate.isPending || selected.size === 0}>
            {bulkCreate.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            建立 {selected.size} 条档案
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
