import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  PanelRightOpen,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 物料多选 · 右侧抽屉版
 *
 * 解决 20+ 物料时 chip 堆砌占满主页面的问题：
 *   1. 主页只露「触发按钮 + 已选物料前 N 个 chip + 折叠」一行
 *   2. 整张物料列表收到右侧抽屉里，点击触发器才浮出
 *   3. 抽屉内搜索 / 全选 / 反选 / 全清 / 勾选均**即时生效**
 *
 * 触发入口：
 *   - 主区右侧的「⚙ 物料筛选 [N/M]」按钮
 *   - 已选 chip 行尾部的「…+N 展开」按钮
 *
 * Props 与原 MultiSelectFilter 兼容（label / options / selected / onChange / placeholder），
 * 调用方传 options 时建议把 PN 作为 sublabel、名称作为 label，渲染更清晰。
 */

export interface MaterialDrawerOption {
  value: string;
  label: string;
  /** 可选：PN 等副标签，会在 chip 与抽屉里以 mono 字体显示 */
  sublabel?: string;
  color?: string;
}

interface MaterialDrawerFilterProps {
  label: string;
  options: MaterialDrawerOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** 默认折叠展示的已选 chip 数量（默认 3） */
  previewCount?: number;
  placeholder?: string;
}

const DEFAULT_PREVIEW = 3;

export function MaterialDrawerFilter({
  label,
  options,
  selected,
  onChange,
  previewCount = DEFAULT_PREVIEW,
  placeholder = "搜索物料 PN 或名称…",
}: MaterialDrawerFilterProps) {
  // 主区 chip 展开态
  const [chipExpanded, setChipExpanded] = useState(false);
  // 抽屉开关
  const [open, setOpen] = useState(false);
  // 抽屉内搜索
  const [keyword, setKeyword] = useState("");

  /* 已选物料的 option（按 options 原始顺序展示，保持稳定） */
  const selectedList = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected]
  );

  /* 主区 chip 显示 */
  const showAllChips = chipExpanded || selectedList.length <= previewCount;
  const visibleChips = showAllChips
    ? selectedList
    : selectedList.slice(0, previewCount);
  const hiddenChipsCount = selectedList.length - visibleChips.length;

  /* 主区 chip 点 ✕ = 立即移除 */
  const handleChipRemove = (value: string) => {
    const next = new Set(selected);
    next.delete(value);
    onChange(next);
  };

  /* 抽屉内列表过滤 */
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel ?? "").toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q)
    );
  }, [options, keyword]);

  /* 抽屉内操作（全部即时生效） */
  const toggleInDrawer = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };
  const selectAllInDrawer = () => onChange(new Set(options.map((o) => o.value)));
  const clearAllInDrawer = () => onChange(new Set());
  const invertInDrawer = () =>
    onChange(
      new Set(options.filter((o) => !selected.has(o.value)).map((o) => o.value))
    );

  return (
    <div className="space-y-2">
      {/* 第 1 行：触发按钮 + 标签 */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-xs font-normal"
          onClick={() => setOpen(true)}
          aria-expanded={open}
        >
          <PanelRightOpen className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
            {selected.size}/{options.length}
          </span>
        </Button>
        {selectedList.length === 0 && (
          <span className="text-xs text-muted-foreground">
            暂未选择物料（点击「{label}」打开抽屉）
          </span>
        )}
      </div>

      {/* 第 2 行：已选 chip（折叠展示，✕ 移除） */}
      {selectedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleChips.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => handleChipRemove(o.value)}
              title={`移除：${o.label}`}
              className={cn(
                "group inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                "border-transparent text-white shadow-sm transition-opacity hover:opacity-85",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              )}
              style={{
                backgroundColor: o.color ?? "#3b82f6",
                borderColor: o.color ?? "#3b82f6",
              }}
            >
              <span className="max-w-[110px] truncate font-medium">
                {o.sublabel ? (
                  <>
                    <span className="font-mono opacity-90">{o.sublabel}</span>
                    <span className="mx-1 opacity-60">·</span>
                    <span className="opacity-95">{o.label}</span>
                  </>
                ) : (
                  o.label
                )}
              </span>
              <X className="h-3 w-3 opacity-70 transition-opacity group-hover:opacity-100" />
            </button>
          ))}

          {/* 折叠 / 展开 */}
          {hiddenChipsCount > 0 && (
            <button
              type="button"
              onClick={() => setChipExpanded((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {showAllChips ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  收起
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  …+{hiddenChipsCount}（点击展开）
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* 右侧抽屉 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            // 覆盖 DialogContent 默认居中：钉到右侧，高度撑满
            "fixed inset-y-0 right-0 left-auto top-0 max-w-none w-[360px] translate-x-0 translate-y-0",
            "rounded-l-xl rounded-r-none border-l gap-0 p-0",
            // 入场动画：右侧滑入
            "data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right duration-200"
          )}
          showCloseButton={false}
        >
          <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <DialogTitle className="text-sm">{label}</DialogTitle>
              <DialogDescription className="text-xs">
                勾选即时生效；可搜索 / 全选 / 反选 / 全清
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 shrink-0"
              onClick={() => setOpen(false)}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>

          {/* 搜索框 */}
          <div className="border-b px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={placeholder}
                className="h-8 pl-8 pr-8 text-xs"
                autoFocus
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

          {/* 工具栏 */}
          <div className="flex items-center gap-1 border-b px-3 py-2 text-xs">
            <ToolbarBtn onClick={selectAllInDrawer}>全选</ToolbarBtn>
            <ToolbarBtn onClick={invertInDrawer}>反选</ToolbarBtn>
            <ToolbarBtn onClick={clearAllInDrawer}>全清</ToolbarBtn>
            <span className="ml-auto tabular-nums text-muted-foreground">
              已选{" "}
              <span className="font-semibold text-foreground">{selected.size}</span>
              /{options.length}
            </span>
          </div>

          {/* 物料复选列表 */}
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: "calc(100vh - 190px)" }}>
            {filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                没有匹配的物料
                {keyword && (
                  <>
                    （关键词：<span className="font-mono">{keyword}</span>）
                  </>
                )}
              </p>
            ) : (
              <ul className="py-1">
                {filtered.map((o) => {
                  const checked = selected.has(o.value);
                  return (
                    <li key={o.value}>
                      <button
                        type="button"
                        onClick={() => toggleInDrawer(o.value)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                          checked && "bg-primary/5"
                        )}
                      >
                        {/* 复选框：与物料同色 */}
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                            checked
                              ? "border-transparent text-white"
                              : "border-border"
                          )}
                          style={{
                            backgroundColor: checked
                              ? o.color ?? "#3b82f6"
                              : undefined,
                          }}
                        >
                          {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        {/* 色点 */}
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: o.color ?? "#64748b" }}
                        />
                        {/* 主信息 */}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{o.label}</span>
                          {(o.sublabel ?? o.value) && (
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {o.sublabel ?? o.value}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 底部状态条 */}
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              勾选即时生效，无需保存
            </span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              完成
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {children}
    </button>
  );
}
