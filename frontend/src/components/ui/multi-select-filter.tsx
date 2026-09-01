import { useEffect, useMemo, useState } from "react";
import { Check, Search, SlidersHorizontal, X } from "lucide-react";
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
 * 通用多选器（MultiSelectFilter）。
 *
 * 智能切换（按选项数量自动决定形态，无需配置）：
 *   · options.length <= chipThreshold（默认 12）→ Chip 视图（平铺点选）
 *   · options.length >  chipThreshold           → 弹层（Button + Dialog 居中）
 *
 * 注：原计划用 Popover，但 radix-ui 1.1.x + floating-ui 2 在 dev 下有 `position: static` 渲染 bug，
 *     弹层跑到视口外不可见。这里改用 Dialog（viewport 居中），体验更稳。
 *
 * 弹层能力：
 *   - 搜索框实时过滤（PN / 名称）
 *   - 全选 / 全清 / 反选 快捷操作
 *   - 可滚动复选列表（max-h-72 内部滚动，100+ 选项也不怕）
 *   - 底部「取消 / 确定 (N)」：弹层内先改临时态，确定后才生效
 *
 * 该组件为「受控组件」：selected / onChange 由父组件维护。
 * 父组件自行决定"至少保留一个"等业务约束（组件不越权）。
 */

export interface MultiSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  color?: string;
  badge?: React.ReactNode;
}

interface MultiSelectFilterProps {
  label: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  chipThreshold?: number;
  placeholder?: string;
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  chipThreshold = 12,
  placeholder = "搜索…",
}: MultiSelectFilterProps) {
  const useChips = options.length <= chipThreshold;

  if (useChips) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((o) => {
          const checked = selected.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                const next = new Set(selected);
                if (next.has(o.value)) next.delete(o.value);
                else next.add(o.value);
                onChange(next);
              }}
              title={checked ? `点击隐藏：${o.label}` : `点击显示：${o.label}`}
              className={cn(
                "group inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                checked
                  ? "border-transparent text-white shadow-sm"
                  : "border-border bg-background text-foreground hover:border-primary/40"
              )}
              style={
                checked
                  ? { backgroundColor: o.color ?? "#3b82f6", borderColor: o.color ?? "#3b82f6" }
                  : { borderLeftColor: o.color ?? "#64748b", borderLeftWidth: 3 }
              }
            >
              <span className="inline-flex h-3 w-3 items-center justify-center">
                {checked ? (
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                ) : (
                  <span
                    className="block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: o.color ?? "#64748b" }}
                  />
                )}
              </span>
              <span className="max-w-[180px] truncate">{o.label}</span>
            </button>
          );
        })}
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">
          已选 {selected.size}/{options.length}
        </span>
      </div>
    );
  }

  return <DropdownFilter {...{ label, options, selected, onChange, placeholder }} />;
}

/* -------------------------------------------------------------------------- */
/*  弹层形态（Dialog 居中）                                                    */
/* -------------------------------------------------------------------------- */

function DropdownFilter({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: Required<Pick<MultiSelectFilterProps, "label" | "options" | "selected" | "onChange" | "placeholder">>) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));

  /* 打开时同步 draft = 当前已选 */
  useEffect(() => {
    if (open) setDraft(new Set(selected));
  }, [open, selected]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q)
    );
  }, [options, keyword]);

  const toggle = (value: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const selectAll = () => setDraft(new Set(options.map((o) => o.value)));
  const clearAll = () => setDraft(new Set());
  const invert = () =>
    setDraft(new Set(options.filter((o) => !draft.has(o.value)).map((o) => o.value)));

  const confirm = () => {
    onChange(new Set(draft));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-2 text-xs font-normal"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
          {selected.size}/{options.length}
        </span>
      </Button>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">{label}</DialogTitle>
          <DialogDescription className="text-xs">
            勾选要显示的项；确定后生效。
          </DialogDescription>
        </DialogHeader>

        {/* 搜索 + 工具栏 */}
        <div className="space-y-2 border-b px-4 py-2">
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
          <div className="flex items-center gap-1 text-xs">
            <QuickBtn onClick={selectAll}>全选</QuickBtn>
            <QuickBtn onClick={clearAll}>全清</QuickBtn>
            <QuickBtn onClick={invert}>反选</QuickBtn>
            <span className="ml-auto tabular-nums text-muted-foreground">
              已选 <span className="font-semibold text-foreground">{draft.size}</span>/{options.length}
            </span>
          </div>
        </div>

        {/* 复选列表 */}
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              没有匹配的选项
            </p>
          ) : (
            <ul className="py-1">
              {filtered.map((o) => {
                const checked = draft.has(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                        checked && "bg-primary/5"
                      )}
                    >
                      {/* 勾选框 */}
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked ? "border-transparent text-white" : "border-border"
                        )}
                        style={{ backgroundColor: checked ? o.color ?? "#3b82f6" : undefined }}
                      >
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      {/* 色点 */}
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: o.color ?? "#64748b" }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.sublabel && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {o.sublabel}
                          </span>
                        )}
                      </span>
                      {o.badge}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">确定后生效</span>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={confirm}>
              确定{draft.size > 0 ? ` (${draft.size})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuickBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
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