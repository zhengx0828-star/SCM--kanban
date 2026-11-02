import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Loader2 } from "lucide-react";
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
import { segmentApi } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/utils";
import { useUpsertSegment, useUpdateSegment } from "@/hooks/use-segments";
import { useSupplyRelationOptions } from "@/hooks/use-supply-relations";
import {
  CAP_DIMS,
  SEGMENT_TIERS,
  WILL_DIMS,
  type Segment,
  type SegmentUpsertInput,
  type TierKey,
  type TierValues,
} from "@/types/segment";

/**
 * 新增 / 编辑一条评价。
 *
 * 12 项按 4 列排（不是 6 列）：档位是 5 个固定值，横排 6 列会把
 * 「维度 + 指标 + 档位」挤成一团，手机上更没法点。
 *
 * ★ 档位默认空（未评），不预设 0.5 —— 预设中值等于替人打分。
 */

const EMPTY_TIERS: TierValues = {
  tier_a1: null,
  tier_a2: null,
  tier_a3: null,
  tier_a4: null,
  tier_a5: null,
  tier_a6: null,
  tier_w1: null,
  tier_w2: null,
  tier_w3: null,
  tier_w4: null,
  tier_w5: null,
  tier_w6: null,
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑时传入；新增传 null */
  segment: Segment | null;
  defaultPeriod: string;
  onSaved: () => void;
}

export function SegmentFormDialog({ open, onOpenChange, segment, defaultPeriod, onSaved }: Props) {
  const isEdit = Boolean(segment);
  const { data: relations = [] } = useSupplyRelationOptions();
  const upsert = useUpsertSegment();
  const update = useUpdateSegment();

  const [period, setPeriod] = useState(defaultPeriod || currentMonth());
  const [relationKey, setRelationKey] = useState("");
  const [tiers, setTiers] = useState<TierValues>(EMPTY_TIERS);
  const [evaluator, setEvaluator] = useState("");
  const [evaluatedOn, setEvaluatedOn] = useState("");
  const [note, setNote] = useState("");
  const [prefilling, setPrefilling] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (segment) {
      setPeriod(segment.period);
      setRelationKey(`${segment.pn}__${segment.supplier_code}`);
      setTiers({
        tier_a1: segment.tier_a1,
        tier_a2: segment.tier_a2,
        tier_a3: segment.tier_a3,
        tier_a4: segment.tier_a4,
        tier_a5: segment.tier_a5,
        tier_a6: segment.tier_a6,
        tier_w1: segment.tier_w1,
        tier_w2: segment.tier_w2,
        tier_w3: segment.tier_w3,
        tier_w4: segment.tier_w4,
        tier_w5: segment.tier_w5,
        tier_w6: segment.tier_w6,
      });
      setEvaluator(segment.evaluator ?? "");
      setEvaluatedOn(segment.evaluated_on ?? "");
      setNote(segment.note ?? "");
    } else {
      setPeriod(defaultPeriod || currentMonth());
      setRelationKey("");
      setTiers(EMPTY_TIERS);
      setEvaluator("");
      setEvaluatedOn("");
      setNote("");
    }
  }, [open, segment, defaultPeriod]);

  const options = useMemo(
    () =>
      relations.map((rel) => ({
        key: `${rel.pn}__${rel.supplier_code}`,
        label: `${rel.pn} ${rel.material_name} · ${rel.supplier_name}（${rel.supplier_code}）`,
      })),
    [relations]
  );

  const filled = Object.values(tiers).filter((v) => v !== null).length;
  const submitting = upsert.isPending || update.isPending;

  function setTier(key: TierKey, raw: string) {
    setTiers((prev) => ({ ...prev, [key]: raw === "" ? null : Number(raw) }));
  }

  async function handlePrefill() {
    if (!relationKey) {
      toast.error("先选物料和供应商");
      return;
    }
    const [pn, code] = relationKey.split("__");
    setPrefilling(true);
    try {
      const res = await segmentApi.prefill(period, pn, code);
      if (!res.found) {
        toast.info("上期没有这条评价，无法取数");
        return;
      }
      setTiers((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next) as TierKey[]) {
          const value = res.tiers[key];
          next[key] = value === undefined ? null : value;
        }
        return next;
      });
      toast.success(`已取 ${res.period} 的档位`);
    } catch (error) {
      toast.error(`取上期失败：${getApiErrorMessage(error)}`);
    } finally {
      setPrefilling(false);
    }
  }

  async function handleSubmit() {
    if (filled === 0) {
      toast.error("12 项全空，没有可保存的内容");
      return;
    }
    try {
      if (segment) {
        await update.mutateAsync({ id: segment.id, data: { ...tiers, evaluator: evaluator || null, evaluated_on: evaluatedOn || null, note: note || null } });
        toast.success("已保存");
      } else {
        if (!relationKey) {
          toast.error("先选物料和供应商");
          return;
        }
        const [pn, code] = relationKey.split("__");
        const payload: SegmentUpsertInput = {
          period,
          material_code: pn,
          supplier_code: code,
          evaluator: evaluator || null,
          evaluated_on: evaluatedOn || null,
          note: note || null,
          ...tiers,
        };
        await upsert.mutateAsync(payload);
        toast.success("已保存");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(`保存失败：${getApiErrorMessage(error)}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑评价" : "新增评价"}</DialogTitle>
          <DialogDescription>
            12 项各打一个档位：1 优秀 / 0.7 良好 / 0.5 中性 / 0.3 差 / 0 不可接受。留空表示未评，不要用 0 代替「没评」。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="seg-period">期间</Label>
              <Input
                id="seg-period"
                type="month"
                value={period}
                disabled={isEdit}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="seg-relation">物料 · 供应商</Label>
              <select
                id="seg-relation"
                value={relationKey}
                disabled={isEdit}
                onChange={(e) => setRelationKey(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">选择物料与供应商</option>
                {options.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              已填 {filled} / 12 项（任一维不足 4 项会进「未评级」）
            </p>
            {!isEdit && (
              <Button type="button" variant="outline" size="sm" onClick={handlePrefill} disabled={prefilling || !relationKey}>
                {prefilling ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardCopy className="mr-1 h-3.5 w-3.5" />}
                取上期档位
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">能力 6 项（横轴）</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {CAP_DIMS.map((dim) => (
                  <div key={dim.key} className="space-y-1">
                    <Label className="text-xs font-normal text-muted-foreground">{dim.label}</Label>
                    <select
                      value={tiers[`tier_${dim.key}` as TierKey] ?? ""}
                      onChange={(e) => setTier(`tier_${dim.key}` as TierKey, e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">未评</option>
                      {SEGMENT_TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">意愿 6 项（纵轴）</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {WILL_DIMS.map((dim) => (
                  <div key={dim.key} className="space-y-1">
                    <Label className="text-xs font-normal text-muted-foreground">{dim.label}</Label>
                    <select
                      value={tiers[`tier_${dim.key}` as TierKey] ?? ""}
                      onChange={(e) => setTier(`tier_${dim.key}` as TierKey, e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">未评</option>
                      {SEGMENT_TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="seg-evaluator">打分人</Label>
              <Input id="seg-evaluator" value={evaluator} onChange={(e) => setEvaluator(e.target.value)} placeholder="选填" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seg-date">打分日期</Label>
              <Input id="seg-date" type="date" value={evaluatedOn} onChange={(e) => setEvaluatedOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seg-note">备注</Label>
              <Input id="seg-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
