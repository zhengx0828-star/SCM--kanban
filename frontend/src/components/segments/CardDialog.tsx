import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/utils";
import { useCreateCard, useReleaseCard } from "@/hooks/use-segments";
import { CARD_META, type CardColor, type Segment, type SupplierCard } from "@/types/segment";

/**
 * 打牌 / 解牌。
 *
 * ★ 打牌不是「给这条评价扣分」，而是给**供应商**挂牌：
 *   一张牌会同时影响该供应商全部在供物料的评价，因为一次质量事故
 *   是整家公司的事，不会只影响一个 PN。
 * ★ 生效日可回填到过去的月份（补录事故），牌只影响区间内的月份。
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "release";
  segment: Segment | null;
  /** 解除时必须给：当前生效的那张牌 */
  activeCard: SupplierCard | null;
  /** 从抽屉上「标红牌 / 标黄牌」进来时，预选那一色 */
  initialCard?: CardColor;
  onSaved: () => void;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CardDialog({ open, onOpenChange, mode, segment, activeCard, initialCard = "red", onSaved }: Props) {
  const create = useCreateCard();
  const release = useReleaseCard();

  const [card, setCard] = useState<CardColor>(initialCard);
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [createdBy, setCreatedBy] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [effectiveTo, setEffectiveTo] = useState(today());
  const [releasedBy, setReleasedBy] = useState("");

  useEffect(() => {
    if (!open) return;
    setCard(initialCard);
    setReason("");
    setEffectiveFrom(today());
    setCreatedBy("");
    setReleaseReason("");
    setEffectiveTo(today());
    setReleasedBy("");
  }, [open, mode, initialCard]);

  const submitting = create.isPending || release.isPending;

  async function handleCreate() {
    if (!segment) return;
    if (reason.trim().length < 5) {
      toast.error("标注原因至少 5 个字，写清是哪次事故");
      return;
    }
    try {
      await create.mutateAsync({
        supplier_id: segment.supplier_id,
        card,
        reason: reason.trim(),
        effective_from: effectiveFrom || undefined,
        created_by: createdBy || undefined,
      });
      toast.success(`已给 ${segment.supplier_name} 挂${CARD_META[card].label}`);
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(`标红黄牌失败：${getApiErrorMessage(error)}`);
    }
  }

  async function handleRelease() {
    if (!activeCard) return;
    if (releaseReason.trim().length < 2) {
      toast.error("解除原因必填");
      return;
    }
    try {
      await release.mutateAsync({
        id: activeCard.id,
        data: {
          release_reason: releaseReason.trim(),
          effective_to: effectiveTo || undefined,
          released_by: releasedBy || undefined,
        },
      });
      toast.success(`已解除${activeCard ? CARD_META[activeCard.card].label : "红黄牌"}，分数按原档位恢复`);
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(`解除失败：${getApiErrorMessage(error)}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? `标${CARD_META[card].label}` : `解除${activeCard ? CARD_META[activeCard.card].label : "红黄牌"}`}
          </DialogTitle>
          <DialogDescription>
            {segment ? `${segment.supplier_name}（${segment.supplier_code}）` : ""}
            {mode === "create"
              ? " · 红黄牌生效期间该供应商所有物料的能力与意愿均记 0 分，档位原值保留。"
              : " · 解除后按原档位重算；区间内的历史月份仍保留 0 分。"}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>标哪种</Label>
              <div className="flex gap-2">
                {(["red", "yellow"] as CardColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setCard(color)}
                    className="flex-1 rounded-md border px-3 py-2 text-sm transition-colors"
                    style={
                      card === color
                        ? { borderColor: CARD_META[color].color, backgroundColor: `${CARD_META[color].color}12`, color: CARD_META[color].color }
                        : undefined
                    }
                  >
                    <span className="font-medium">{CARD_META[color].label}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{CARD_META[color].action}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="card-reason">标注原因</Label>
              <Textarea
                id="card-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：10 月批次外观不良率超标，整改未闭环"
                rows={3}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="card-from">生效日</Label>
                <Input id="card-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="card-by">操作人</Label>
                <Input id="card-by" value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="选填" />
              </div>
            </div>

            <p className="text-[11px] leading-4 text-muted-foreground">
              同一供应商同时只能挂一张红黄牌。已有牌时再标，旧牌在生效日前一天终止（改判，不是叠加）。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeCard && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <p className="font-medium" style={{ color: CARD_META[activeCard.card].color }}>
                  {CARD_META[activeCard.card].label} · {activeCard.effective_from} 起
                </p>
                <p className="mt-1 text-muted-foreground">{activeCard.reason}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="release-reason">解除原因</Label>
              <Textarea
                id="release-reason"
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                placeholder="例如：整改报告已验收，连续两个月无异常"
                rows={3}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="release-to">解除日</Label>
                <Input id="release-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="release-by">解除人</Label>
                <Input id="release-by" value={releasedBy} onChange={(e) => setReleasedBy(e.target.value)} placeholder="选填" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={mode === "create" ? handleCreate : handleRelease} disabled={submitting}>
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? `确认标${CARD_META[card].label}` : "确认解除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
