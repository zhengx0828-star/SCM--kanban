import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DemandVersion } from "@/types/project";

/**
 * 客户需求版本选择器（折叠下拉）。
 *
 * 口径见 `docs/demand-versioning/01-方案定稿.md` §6.3：
 *   - 收起态只占一行：`需求版本 V2.0 [当前] 版本说明 ▾`
 *   - 展开后**只有版本**（不再展示来源 / 生效日期 / 录入人等元信息）
 *   - 每行右侧给「该版相对上一版的年合计变化」：**直接写 +xx.x% / -xx.x%，不写上涨 / 下跌文字**
 *   - 首版无对比对象时显示「初始版」
 *   - 底部两条动作：新建版本（复制当前版）；查看历史版时额外出现「设为当前版」
 *
 * ⚠️ **放进带 `overflow-hidden` 的容器里必须显式加 `overflow-visible`**：
 * 面板是 `absolute` + `top-full`（向下超出触发器），项目的 `Card` 基础类自带 `overflow-hidden`，
 * 会把面板连同命中测试一起裁掉（表现是"点开什么都没有"）。详见 AGENT.md「坑 22」。
 *
 * ⚠️ 关闭面板用 `mousedown` 而不是 `click`：点击后本组件可能立即重渲染，
 * `click` 冒泡到 document 时目标节点已脱离 DOM，`contains()` 判定为「点在外部」，
 * 会把刚展开的面板又关掉（表现为"点了没反应"）。
 */

interface DemandVersionBarProps {
  /** 版本链（不要求有序，组件内部按 seq 排序） */
  versions: DemandVersion[];
  /** 正在查看的版本 seq；null = 跟随当前版 */
  viewingSeq: number | null;
  onViewingSeqChange: (seq: number) => void;
  onSetCurrent: (version: DemandVersion) => void;
  onCreate: () => void;
  /** 打开版本对比弹窗（< 2 个版本时自动禁用） */
  onCompare?: () => void;
  /** 请求进行中：禁用两个动作按钮 */
  busy?: boolean;
  className?: string;
}

function yearTotalOf(v: DemandVersion): number {
  return v.year_total ?? (v.demand ?? []).reduce((a, b) => a + b, 0);
}

/** 该版相对上一版（seq 小一号的最新一版）的年合计变化；无上一版返回 null */
function deltaOf(v: DemandVersion, all: DemandVersion[]): { pct: number; delta: number } | null {
  let prev: DemandVersion | null = null;
  for (const x of all) {
    if (x.seq < v.seq && (!prev || x.seq > prev.seq)) prev = x;
  }
  if (!prev) return null;
  const base = yearTotalOf(prev);
  if (!base) return null;
  const delta = yearTotalOf(v) - base;
  return { delta, pct: (delta / base) * 100 };
}

const fmtSigned = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("zh-CN")}`;
const fmtPct = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;

export function DemandVersionBar({
  versions,
  viewingSeq,
  onViewingSeqChange,
  onSetCurrent,
  onCreate,
  onCompare,
  busy = false,
  className,
}: DemandVersionBarProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /** 新版在前 */
  const ordered = useMemo(() => [...versions].sort((a, b) => b.seq - a.seq), [versions]);
  const current = useMemo(() => ordered.find((v) => v.is_current) ?? null, [ordered]);
  const viewing = useMemo(
    () => ordered.find((v) => v.seq === viewingSeq) ?? current,
    [ordered, viewingSeq, current]
  );

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

  /* 无版本：录入需求后由服务端自动生成首个版本 */
  if (ordered.length === 0) {
    return (
      <div
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground",
          className
        )}
      >
        <span>需求版本</span>
        <span className="font-medium text-foreground">尚无版本</span>
        <span>录入并保存后自动生成 V1.0</span>
      </div>
    );
  }

  const isViewingCurrent = !!viewing?.is_current;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-8 max-w-[360px] gap-2 font-normal"
      >
        <span className="shrink-0 text-xs text-muted-foreground">需求版本</span>
        <span className="shrink-0 font-medium tabular-nums">V{viewing?.version_no}</span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
            isViewingCurrent
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {isViewingCurrent ? "当前" : "只读"}
        </span>
        {viewing?.label && (
          <span className="truncate text-xs text-muted-foreground">{viewing.label}</span>
        )}
        <ChevronDown
          className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </Button>

      {open && (
        /* 右对齐（right-0）：触发器本来就靠卡片右缘，左对齐会让 380px 的面板越出卡片外 */
        <div className="absolute right-0 top-full z-30 mt-1.5 w-[380px] rounded-lg border bg-popover p-1 shadow-md">
          <div className="max-h-[280px] overflow-y-auto">
            {ordered.map((v) => {
              const d = deltaOf(v, ordered);
              const selected = v.seq === viewing?.seq;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onViewingSeqChange(v.seq);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                    selected && "bg-muted"
                  )}
                >
                  <span className="shrink-0 font-medium tabular-nums">V{v.version_no}</span>
                  {v.is_current && (
                    <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                      当前
                    </span>
                  )}
                  {v.label && <span className="truncate text-muted-foreground">{v.label}</span>}
                  <span
                    className={cn(
                      "ml-auto shrink-0 tabular-nums",
                      d == null
                        ? "text-muted-foreground"
                        : d.pct > 0
                          ? "text-red-600 dark:text-red-400"
                          : d.pct < 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-muted-foreground"
                    )}
                    title={d ? `年合计 ${fmtSigned(d.delta)}` : "首版，无可比对象"}
                  >
                    {d == null ? "初始版" : fmtPct(d.pct)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-1 border-t pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || ordered.length < 2 || !onCompare}
              onClick={() => {
                setOpen(false);
                onCompare?.();
              }}
              className="h-8 w-full justify-start font-normal"
            >
              {ordered.length < 2 ? "版本对比（需 ≥ 2 个版本）" : "版本对比…"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="h-8 w-full justify-start font-normal"
            >
              新建版本（复制当前版）
            </Button>
            {!isViewingCurrent && viewing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onSetCurrent(viewing);
                }}
                className="h-8 w-full justify-start font-normal"
              >
                设为当前版
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
