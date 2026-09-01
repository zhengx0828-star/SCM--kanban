import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 物料切片器（搜索 + chip 多选）。
 * - 顶部搜索框：按 PN / 名称实时过滤（不区分大小写）
 * - chip 多选：彩色实心 = 已选；灰描边 = 未选；每个 chip 显示 PN 和颜色块
 * - **chip 折叠**：默认展示前 `PREVIEW_COUNT` 个 chip，超过时显示「展开剩余 N 个物料」按钮
 *   · 100 个物料不再堆成几行
 *   · 搜索态时强制展开（搜索结果需要被看到）
 * - 工具栏：全显 / 全隐快捷 + 「N/M 已选」计数
 */

export interface MaterialChoice {
  pn: string;
  name: string;
  color: string;
}

/** 默认只展示的 chip 数量；超过则折叠 */
const PREVIEW_COUNT = 8;

interface MaterialSupplySlicerProps {
  /** 候选物料（含颜色） */
  materials: MaterialChoice[];
  /** 已选 PN 集合 */
  selected: Set<string>;
  onToggle: (pn: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

export function MaterialSupplySlicer({
  materials,
  selected,
  onToggle,
  onShowAll,
  onHideAll,
}: MaterialSupplySlicerProps) {
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter(
      (m) => m.pn.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [materials, keyword]);

  // 搜索时强制展开；否则按 expanded 状态 + 数量阈值
  const showAll = keyword.trim().length > 0 || expanded || materials.length <= PREVIEW_COUNT;
  const displayed = showAll ? visible : visible.slice(0, PREVIEW_COUNT);
  const hiddenCount = visible.length - displayed.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* 左侧工具栏 */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="mr-1">物料筛选</span>
          <ActionBtn onClick={onShowAll} icon={<Eye className="h-3.5 w-3.5" />} label="全显" />
          <ActionBtn onClick={onHideAll} icon={<EyeOff className="h-3.5 w-3.5" />} label="全隐" />
          <span className="ml-2 tabular-nums">
            <span className="font-medium text-foreground">{selected.size}</span>
            <span className="mx-0.5">/</span>
            <span>{materials.length}</span>
            <span className="ml-1">物料</span>
          </span>
        </div>

        {/* 搜索框 */}
        <div className="relative ml-2 w-72 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索物料 PN 或名称"
            className="h-7 pl-8 pr-8 text-xs"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="清除"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 物料 chips（折叠展示） */}
      <div className="flex flex-wrap gap-1.5">
        {displayed.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            没有匹配的物料
            {keyword && <>（关键词：{keyword}）</>}
          </span>
        ) : (
          displayed.map((m) => {
            const checked = selected.has(m.pn);
            return (
              <button
                key={m.pn}
                type="button"
                onClick={() => onToggle(m.pn)}
                title={checked ? `点击隐藏：${m.pn}` : `点击显示：${m.pn}`}
                className={cn(
                  "group inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  checked
                    ? "border-transparent text-white shadow-sm"
                    : "border-border bg-background text-foreground hover:border-primary/40"
                )}
                style={
                  checked
                    ? { backgroundColor: m.color, borderColor: m.color }
                    : { borderLeftColor: m.color, borderLeftWidth: 3 }
                }
              >
                <span className="inline-flex h-3 w-3 items-center justify-center">
                  {checked ? (
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  ) : (
                    <span
                      className="block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                  )}
                </span>
                <span className="font-mono text-[10px] opacity-90">{m.pn}</span>
                <span className="max-w-[140px] truncate">{m.name}</span>
              </button>
            );
          })
        )}

        {/* 展开/收起按钮 */}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                收起
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                展开剩余 {hiddenCount} 个物料
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-transparent px-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  );
}