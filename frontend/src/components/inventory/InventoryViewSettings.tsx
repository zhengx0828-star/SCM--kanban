import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICE_LEVEL_OPTIONS, type InventoryDensity } from "@/types/inventory";
import { cn } from "@/lib/utils";

/**
 * 视图设置（建议 C）：把「服务水平 Z / 过剩天数 / 列表密度」从主工具栏移入弹层。
 *
 * 理由：这三个参数不是每天改的东西，却长期占用宝贵的横向空间（数据量大后
 * 主工具栏要放搜索 + 四个多选筛选，横向早已吃紧）。
 *
 * 注：本项目 radix popover 在 dev 下有 `position: static` 渲染 bug（弹层跑到视口外），
 * 故沿用 Dialog。
 */

interface Props {
  serviceZ: number;
  excess: number;
  density: InventoryDensity;
  onChangeServiceZ: (z: number) => void;
  onChangeExcess: (v: number) => void;
  onChangeDensity: (d: InventoryDensity) => void;
}

export function InventoryViewSettings({
  serviceZ,
  excess,
  density,
  onChangeServiceZ,
  onChangeExcess,
  onChangeDensity,
}: Props) {
  const [open, setOpen] = useState(false);
  const [zDraft, setZDraft] = useState(String(serviceZ));
  const [excessDraft, setExcessDraft] = useState(String(excess));

  useEffect(() => setZDraft(String(serviceZ)), [serviceZ]);
  useEffect(() => setExcessDraft(String(excess)), [excess]);

  const matched = SERVICE_LEVEL_OPTIONS.find((o) => Math.abs(o.z - serviceZ) < 0.005);

  const commitZ = () => {
    const n = Number(zDraft);
    if (Number.isFinite(n) && n > 0) onChangeServiceZ(Number(n.toFixed(2)));
    else setZDraft(String(serviceZ));
  };
  const commitExcess = () => {
    const n = Number(excessDraft);
    if (Number.isFinite(n) && n > 0) onChangeExcess(Math.round(n));
    else setExcessDraft(String(excess));
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} title="服务水平 / 过剩天数 / 列表密度">
        <Settings2 className="mr-1.5 h-3.5 w-3.5" />
        视图设置
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>视图设置</DialogTitle>
            <DialogDescription>
              这些参数影响全部推算单元的安全天数与预警判定，改动后整页重算。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* 服务水平 Z */}
            <div className="space-y-2">
              <Label className="text-xs">服务水平 Z（安全天数 = Z × COV × √LT）</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={matched ? matched.percent : "custom"}
                  onValueChange={(v) => {
                    const opt = SERVICE_LEVEL_OPTIONS.find((o) => o.percent === v);
                    if (opt) onChangeServiceZ(opt.z);
                  }}
                >
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue>{matched ? `${matched.percent} · Z=${matched.z}` : "自定义"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_LEVEL_OPTIONS.map((o) => (
                      <SelectItem key={o.percent} value={o.percent} className="text-xs">
                        {o.percent} · Z={o.z}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom" disabled className="text-xs">
                      自定义（右侧填 Z）
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 w-20 text-xs tabular-nums"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={zDraft}
                  onChange={(e) => setZDraft(e.target.value)}
                  onBlur={commitZ}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                服务水平越高，安全库存越厚。95% 是常用默认值。
              </p>
            </div>

            {/* 过剩天数 */}
            <div className="space-y-2">
              <Label className="text-xs">过剩天数阈值</Label>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-20 text-xs tabular-nums"
                  type="number"
                  min={1}
                  value={excessDraft}
                  onChange={(e) => setExcessDraft(e.target.value)}
                  onBlur={commitExcess}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <span className="text-xs text-muted-foreground">天</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                DOH 超过该值视为积压（列表状态显示「过剩」）。
              </p>
            </div>

            {/* 列表密度 */}
            <div className="space-y-2">
              <Label className="text-xs">列表密度</Label>
              <div className="flex gap-2">
                {(
                  [
                    { key: "comfortable" as const, label: "舒适", hint: "行高较松，长时间阅读友好" },
                    { key: "compact" as const, label: "紧凑", hint: "一屏看更多行，适合行数多时" },
                  ]
                ).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => onChangeDensity(o.key)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-left transition-colors",
                      density === o.key ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                    )}
                  >
                    <span className="block text-xs font-medium">{o.label}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
