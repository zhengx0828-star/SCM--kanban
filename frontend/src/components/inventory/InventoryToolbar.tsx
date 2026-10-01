import { Download, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/ui/multi-select-filter";
import { cn } from "@/lib/utils";

/**
 * L1 工具栏：全局搜索 + 级联多选筛选 + 导出。
 *
 * 「服务水平 Z / 过剩天数 / 列表密度」已移入「视图设置」弹层（建议 C）——
 * 它们不是每天改的参数，却长期占用横向空间。
 */

interface Props {
  keyword: string;
  onKeyword: (v: string) => void;

  pnOptions: MultiSelectOption[];
  pnSel: Set<string>;
  onPnSel: (s: Set<string>) => void;

  supOptions: MultiSelectOption[];
  supSel: Set<string>;
  onSupSel: (s: Set<string>) => void;

  baseOptions: MultiSelectOption[];
  baseSel: Set<string>;
  onBaseSel: (s: Set<string>) => void;

  onExport: () => void;
  exporting: boolean;
  canExport: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  onClearFilters: () => void;
  hasFilters: boolean;
}

function FilterBlock({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <MultiSelectFilter label={label} options={options} selected={selected} onChange={onChange} chipThreshold={4} />
    </div>
  );
}

export function InventoryToolbar({
  keyword,
  onKeyword,
  pnOptions,
  pnSel,
  onPnSel,
  supOptions,
  supSel,
  onSupSel,
  baseOptions,
  baseSel,
  onBaseSel,
  onExport,
  exporting,
  canExport,
  onRefresh,
  refreshing,
  onClearFilters,
  hasFilters,
}: Props) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* 全局搜索（建议 A） */}
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 pr-8 text-xs"
            placeholder="搜索物料名 / PN / 供应商（当前已选项目内）"
            value={keyword}
            onChange={(e) => onKeyword(e.target.value)}
          />
          {keyword && (
            <button
              type="button"
              onClick={() => onKeyword("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <FilterBlock label="物料 PN" options={pnOptions} selected={pnSel} onChange={onPnSel} />
        <FilterBlock label="供应商" options={supOptions} selected={supSel} onChange={onSupSel} />
        <FilterBlock label="基地" options={baseOptions} selected={baseSel} onChange={onBaseSel} />

        <div className="flex items-center gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-xs">
              清除筛选
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} title="重新拉取数据">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
            刷新
          </Button>
          <Button size="sm" onClick={onExport} disabled={!canExport || exporting} title="导出当前筛选结果为 Excel">
            {exporting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            导出
          </Button>
        </div>
      </div>
    </div>
  );
}
