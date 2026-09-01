import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemandProjectSeries } from "@/components/charts/DemandLineChart";

/**
 * 项目切片器（chip 多选）。
 * - 每个项目一个 chip：项目代码 + 名称 + 颜色指示
 * - 点击切换显隐（visible ⇄ hidden）
 * - 状态：
 *   · 选中（visible）：彩色圆点 + 实心 chip + 眼睛图标
 *   · 未选中：灰色描边 + 眼睛划线
 *   · 未录入需求（demand=null）：灰色禁用，悬浮提示"未录入"
 * - 头部工具栏：
 *   · 「全部显示 / 全部隐藏」快捷操作
 *   · 当前已选 N 项 / 共 M 项
 */

interface ProjectDemandSlicerProps {
  /** 项目系列（含可见状态与颜色） */
  series: DemandProjectSeries[];
  /** 切换显隐 */
  onToggle: (projectId: number) => void;
  /** 全部显示 */
  onShowAll: () => void;
  /** 全部隐藏 */
  onHideAll: () => void;
}

export function ProjectDemandSlicer({ series, onToggle, onShowAll, onHideAll }: ProjectDemandSlicerProps) {
  const selectedCount = series.filter((s) => s.visible).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 左侧工具栏 */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="mr-1">项目筛选</span>
        <SlicerAction onClick={onShowAll} icon={<Eye className="h-3.5 w-3.5" />} label="全显" />
        <SlicerAction onClick={onHideAll} icon={<EyeOff className="h-3.5 w-3.5" />} label="全隐" />
        <span className="ml-2 tabular-nums">
          <span className="font-medium text-foreground">{selectedCount}</span>
          <span className="mx-0.5">/</span>
          <span>{series.length}</span>
          <span className="ml-1">项目</span>
        </span>
      </div>

      {/* 项目 chips */}
      <div className="ml-2 flex flex-wrap items-center gap-1.5">
        {series.map((s) => {
          const hasData = !!s.demand;
          const checked = s.visible && hasData;
          return (
            <button
              key={s.projectId}
              type="button"
              disabled={!hasData}
              title={!hasData ? "该项目未录入客户需求" : checked ? "点击隐藏该线" : "点击显示该线"}
              onClick={() => hasData && onToggle(s.projectId)}
              className={cn(
                "group inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                !hasData && "cursor-not-allowed border-dashed opacity-50",
                hasData && checked
                  ? "border-transparent text-white shadow-sm"
                  : hasData
                    ? "border-border bg-background text-foreground hover:border-primary/40"
                    : ""
              )}
              style={
                hasData && checked
                  ? { backgroundColor: s.color, borderColor: s.color }
                  : !checked && hasData
                    ? { borderLeftColor: s.color, borderLeftWidth: 3 }
                    : undefined
              }
            >
              {/* 圆点指示器 */}
              <span className="relative inline-flex h-3 w-3 items-center justify-center">
                {hasData ? (
                  checked ? (
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  ) : (
                    <Circle className="h-2.5 w-2.5" style={{ color: s.color }} fill="currentColor" />
                  )
                ) : (
                  <Circle className="h-2.5 w-2.5 text-muted-foreground/50" />
                )}
              </span>
              <span className="font-mono text-[10px] opacity-80">{s.code}</span>
              <span className="max-w-[120px] truncate font-medium">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlicerAction({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
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
