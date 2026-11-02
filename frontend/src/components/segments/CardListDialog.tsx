import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CARD_META, QUADRANT_MAP, type CardColor, type Segment } from "@/types/segment";
import { cn } from "@/lib/utils";

interface Props {
  color: CardColor | null;
  rows: Segment[];
  onOpenChange: (open: boolean) => void;
  onPick: (row: Segment) => void;
}

/**
 * 点原点那个牌气泡弹出来的清单。
 *
 * 之前点气泡只给明细表加了个筛选，表在页面下半屏，点了等于没反应 ——
 * 图上写着「点击查看清单」，就得真把清单拿出来。
 */
export function CardListDialog({ color, rows, onOpenChange, onPick }: Props) {
  const meta = color ? CARD_META[color] : null;
  const suppliers = new Set(rows.map((r) => r.supplier_id)).size;

  return (
    <Dialog open={Boolean(color)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {meta && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />}
            {meta?.label}清单
          </DialogTitle>
          <DialogDescription>
            {rows.length} 条评价 · {suppliers} 家供应商
            {meta ? ` · ${meta.action}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
          {rows.map((row) => {
            const q = QUADRANT_MAP[row.quadrant] ?? QUADRANT_MAP.incomplete;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onPick(row)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left",
                  "transition-colors hover:bg-muted/60"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.supplier_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.supplier_code} · {row.pn} {row.material_name}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    能力 {row.cap_score ?? "—"} / 意愿 {row.will_score ?? "—"}
                  </span>
                  <span className="block text-[11px]" style={{ color: q.color }}>
                    {q.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
