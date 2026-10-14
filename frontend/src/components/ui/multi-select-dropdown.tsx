import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 通用下拉选择器（自研，绝对定位面板）。
 *
 * 为什么不用 radix Popover：项目里 `MultiSelectFilter` 的注释已记录 ——
 * radix-ui 1.1.x + floating-ui 2 在 dev 下弹层会以 `position: static` 渲染到视口外，
 * 所以这里沿用 `InlineCombobox` 那套**自研绝对定位面板**（零新依赖、行为可控）。
 *
 * 两种模式：
 *   - `multi`（默认）：复选列表 + 搜索 + 全选/反选/全清，**勾选即时生效**，面板不关闭
 *   - `single`：点选一项即生效并关闭面板（如"选一个物料查看详情"）
 *
 * 触发器只占一行：`标签：摘要 (已选 N/共 M) ▾`，避免 chip 平铺占满页面。
 *
 * ⚠️ **放进带 `overflow-hidden` 的容器里必须显式加 `overflow-visible`**：
 * 面板是 `absolute` + `top-full`（向下超出触发器），而项目的 `Card` 基础类自带 `overflow-hidden`，
 * 会把面板**连同命中测试一起裁掉** —— 表现是"点开只看到搜索框、选项列表整块不见"，
 * 且 tsc / build 全绿、截图不细看也容易漏。详见 AGENT.md「坑 22」。
 */

export interface DropdownOption {
  value: string;
  label: string;
  /** 副标签（如 PN），以 mono 字体展示 */
  sublabel?: string;
  color?: string;
  /** 右侧小徽标（如"未设 BOM"） */
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface MultiSelectDropdownProps {
  label: string;
  options: DropdownOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** 未选中时的占位文案 */
  placeholder?: string;
  /** multi（默认）| single */
  mode?: "multi" | "single";
  disabled?: boolean;
  /** 触发器左侧图标 */
  icon?: React.ReactNode;
  /** 搜索框占位 */
  searchPlaceholder?: string;
  /** 触发器下方一行辅助说明 */
  hint?: string;
  className?: string;
}

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder = "请选择",
  mode = "multi",
  disabled = false,
  icon,
  searchPlaceholder = "搜索…",
  hint,
  className,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  /* 点击面板外 / Esc 关闭。用 ref.contains 判定，多实例互不干扰 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && wrapRef.current && !wrapRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* 关闭时清空搜索词 */
  useEffect(() => {
    if (!open) setKeyword("");
  }, [open]);

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected]
  );

  /* 触发器摘要 */
  const summary = useMemo(() => {
    if (mode === "single") return selectedOptions[0]?.label ?? placeholder;
    if (selectedOptions.length === 0) return placeholder;
    if (options.length > 0 && selectedOptions.length === options.length) return "全部";
    const head = selectedOptions.slice(0, 2).map((o) => o.label);
    return selectedOptions.length > 2
      ? `${head.join("、")} 等 ${selectedOptions.length} 个`
      : head.join("、");
  }, [mode, selectedOptions, placeholder, options.length]);

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

  const pick = (value: string) => {
    if (mode === "single") {
      onChange(new Set([value]));
      setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const selectAll = () => onChange(new Set(options.filter((o) => !o.disabled).map((o) => o.value)));
  const clearAll = () => onChange(new Set());
  const invert = () =>
    onChange(new Set(options.filter((o) => !o.disabled && !selected.has(o.value)).map((o) => o.value)));

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="h-8 max-w-[300px] gap-2 font-normal"
        >
          {icon}
          <span className="shrink-0 text-muted-foreground">{label}：</span>
          <span className={cn("truncate", selectedOptions.length === 0 && "text-muted-foreground")}>
            {summary}
          </span>
          {mode === "multi" && options.length > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
              {selected.size}/{options.length}
            </span>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
        </Button>
        {mode === "multi" && selected.size > 0 && !disabled && (
          <button
            type="button"
            aria-label="清空"
            onClick={clearAll}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}

      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(360px,90vw)] rounded-lg border bg-popover text-popover-foreground shadow-md">
          {/* 搜索 */}
          <div className="border-b px-2.5 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          {/* 工具栏（多选） */}
          {mode === "multi" && (
            <div className="flex items-center gap-1 border-b px-2.5 py-1.5 text-xs">
              <ToolBtn onClick={selectAll}>全选</ToolBtn>
              <ToolBtn onClick={invert}>反选</ToolBtn>
              <ToolBtn onClick={clearAll}>全清</ToolBtn>
              <span className="ml-auto tabular-nums text-muted-foreground">
                已选 <span className="font-semibold text-foreground">{selected.size}</span>/{options.length}
              </span>
            </div>
          )}

          {/* 列表 */}
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                没有匹配项{keyword && <>（关键词：<span className="font-mono">{keyword}</span>）</>}
              </p>
            ) : (
              filtered.map((o) => {
                const checked = selected.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => pick(o.value)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                      o.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-accent hover:text-accent-foreground",
                      checked && "bg-accent/50"
                    )}
                  >
                    {mode === "multi" ? (
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked ? "border-transparent text-white" : "border-border"
                        )}
                        style={{ backgroundColor: checked ? o.color ?? "#3b82f6" : undefined }}
                      >
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                    ) : (
                      <Check className={cn("h-4 w-4 shrink-0", checked ? "opacity-100" : "opacity-0")} />
                    )}
                    {o.color && (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.sublabel && (
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {o.sublabel}
                        </span>
                      )}
                    </span>
                    {o.badge}
                  </button>
                );
              })
            )}
          </div>

          {/* 底部 */}
          <div className="flex items-center justify-between border-t px-3 py-2">
            <span className="text-[11px] text-muted-foreground">
              {mode === "multi" ? "勾选即时生效" : "点选即生效"}
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
              完成
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
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
