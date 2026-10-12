import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GANTT_SUMMARY_COLOR, taskStateMeta, type TaskState } from "@/types/change";

/**
 * 甘特图（自绘，零新依赖）。
 *
 * 为什么不用第三方库：项目在内网跑，加依赖是成本最高的一件事；而且
 * 「任意层级折叠 + 子项缩进 + 五色叶子条」用绝对定位的 div 反而更自由。
 *
 * ★ 配色纪律（用户口径）：
 *   甘特图负责**结构** —— 父条 / 汇总条一律中性灰；
 *   报警交给**卡片、角标、色点**。所以这里只有叶子条是彩色的。
 *
 * ★ 两个可视化重点：
 *   - 超期未完成：红条 + 红色虚线从条尾**延伸到今日线**（欠着的部分看得见）
 *   - 迟交完成：橙条 + 细虚线拉到实际完成日 + 右端小竖标（复盘用）
 */

const DAY = 86_400_000;
const COL_W = 260;
const ROW_H = 32;
const PAD_DAYS = 3;

export interface GanttTask {
  id: number;
  name: string;
  owner?: string | null;
  level: number;
  state: TaskState;
  is_done: boolean;
  plan_start: string | null;
  plan_end: string | null;
  done_at: string | null;
  overdue_days: number;
  late_days: number;
  leaf_total: number;
  leaf_done: number;
  children: GanttTask[];
  /**
   * 强制按「汇总条」渲染（中性灰 + 粗条），即使它没有子项。
   * L1 合并甘特图用它把「变更单块」画成灰色块头 —— 空任务的变更单
   * 也不会被误当成叶子条染成蓝色。
   */
  summary?: boolean;
}

interface Props {
  tasks: GanttTask[];
  /** 折叠状态的持久化 key（合并图与单张图各用各的） */
  storageKey: string;
  /** 点击任务条 */
  onTaskClick?: (taskId: number) => void;
  /** 空态文案 */
  emptyText?: string;
}

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

function fmtMD(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 子树里是否存在超期 / 临期（用于"智能展开"：只展开有问题的分支） */
function subtreeIssue(n: GanttTask): boolean {
  if (n.children.length === 0) return n.state === "overdue" || n.state === "soon";
  return n.children.some(subtreeIssue);
}

function subtreeCount(n: GanttTask): { overdue: number; soon: number } {
  if (n.children.length === 0) {
    return { overdue: n.state === "overdue" ? 1 : 0, soon: n.state === "soon" ? 1 : 0 };
  }
  return n.children.reduce(
    (acc, c) => {
      const r = subtreeCount(c);
      acc.overdue += r.overdue;
      acc.soon += r.soon;
      return acc;
    },
    { overdue: 0, soon: 0 }
  );
}

/** 节点的时间跨度：叶子取自身；父节点取子项并集（用户确认：父子全自动） */
function nodeRange(n: GanttTask): { s: Date | null; e: Date | null } {
  if (n.children.length === 0) return { s: toDate(n.plan_start), e: toDate(n.plan_end) };
  let s: Date | null = null;
  let e: Date | null = null;
  for (const c of n.children) {
    const r = nodeRange(c);
    if (r.s && (!s || r.s < s)) s = r.s;
    if (r.e && (!e || r.e > e)) e = r.e;
  }
  return { s: s ?? toDate(n.plan_start), e: e ?? toDate(n.plan_end) };
}

function loadCollapsed(key: string): Set<number> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set<number>(arr.filter((x) => typeof x === "number")) : null;
  } catch {
    return null;
  }
}

export function GanttChart({ tasks, storageKey, onTaskClick, emptyText = "还没有任务" }: Props) {
  // null = 尚未确定（等数据到位再做"智能展开"）
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [ready, setReady] = useState(false);

  /**
   * 任务树的「内容指纹」。
   *
   * ★ 必须用它当 effect 依赖：父组件每次渲染都可能新建 `tasks` 数组，
   *   若直接依赖 `tasks`，下面的 effect 会每帧重跑 → `setCollapsed(new Set(...))`
   *   每次都是新引用 → 无限循环。用字符串指纹只在真正变化时才重跑。
   */
  const treeSig = useMemo(() => {
    const parts: string[] = [];
    const walk = (nodes: GanttTask[]) => {
      for (const n of nodes) {
        parts.push(`${n.id}.${n.state}.${n.leaf_done}/${n.leaf_total}.${n.children.length}`);
        walk(n.children);
      }
    };
    walk(tasks);
    return parts.join(",");
  }, [tasks]);

  /* 折叠状态：优先用记住的；没记住过 → 智能展开（只展开含超期/临期的分支） */
  useEffect(() => {
    if (!tasks.length) return;
    const saved = loadCollapsed(storageKey);
    if (saved) {
      setCollapsed(saved);
      setReady(true);
      return;
    }
    const auto = new Set<number>();
    const walk = (nodes: GanttTask[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          if (!subtreeIssue(n)) auto.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(tasks);
    setCollapsed(auto);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖内容指纹而非数组引用
  }, [storageKey, treeSig]);

  const persist = (next: Set<number>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* localStorage 不可用时静默降级 */
    }
  };

  const toggle = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persist(next);
  };

  const expandAll = () => persist(new Set());
  const collapseAll = () => {
    const all = new Set<number>();
    const walk = (nodes: GanttTask[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          all.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(tasks);
    persist(all);
  };

  /* 可见行（按折叠状态扁平化） */
  const rows = useMemo(() => {
    const out: { node: GanttTask; hasChildren: boolean; isCollapsed: boolean }[] = [];
    const walk = (nodes: GanttTask[]) => {
      for (const n of nodes) {
        const hasChildren = n.children.length > 0;
        const isCollapsed = hasChildren && collapsed.has(n.id);
        out.push({ node: n, hasChildren, isCollapsed });
        if (hasChildren && !isCollapsed) walk(n.children);
      }
    };
    walk(tasks);
    return out;
  }, [tasks, collapsed]);

  /* 时间轴范围：min(计划开始/实际完成) − 3 天 ~ max(计划完成/实际完成) + 3 天 */
  const range = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    const walk = (nodes: GanttTask[]) => {
      for (const n of nodes) {
        const s = toDate(n.plan_start) ?? toDate(n.plan_end);
        const e = toDate(n.plan_end) ?? toDate(n.plan_start);
        // ★ 实际完成日必须进范围：迟交任务要画一条「从计划完成拖到实际完成」的虚线，
        //   而 done_at 必然晚于自己的 plan_end，常常也晚于全局最大 plan_end。
        //   旧实现只算计划时间 → 这条线的百分比 >100% → 内容比容器宽出 200px：
        //   以前外侧是 overflow-hidden，被悄悄裁掉看不见；改成可横向滚动后
        //   就变成一条莫名其妙的滚动条。修范围 = 让图表装得下自己要画的东西。
        const dn = toDate(n.done_at);
        if (s && (!min || s < min)) min = s;
        if (e && (!max || e > max)) max = e;
        if (dn && (!min || dn < min)) min = dn;
        if (dn && (!max || dn > max)) max = dn;
        walk(n.children);
      }
    };
    walk(tasks);
    if (!min || !max) return null;
    return { start: addDays(min, -PAD_DAYS), end: addDays(max, PAD_DAYS) };
  }, [tasks]);

  const totalDays = range ? Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / DAY)) : 1;

  const pct = (d: Date) => {
    if (!range) return 0;
    return ((d.getTime() - range.start.getTime()) / DAY / totalDays) * 100;
  };

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayPct = range ? pct(today) : 0;
  const showToday = todayPct >= 0 && todayPct <= 100;

  /* 刻度：等分 6 段，避免依赖天数做复杂分支 */
  const ticks = useMemo(() => {
    if (!range) return [];
    const out: { pct: number; label: string }[] = [];
    for (let i = 0; i <= 6; i++) {
      const ratio = i / 6;
      const d = addDays(range.start, Math.round(totalDays * ratio));
      out.push({ pct: ratio * 100, label: fmtMD(d) });
    }
    return out;
  }, [range, totalDays]);

  if (!tasks.length) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  if (!range) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center text-xs text-muted-foreground">
        任务还没有填计划时间，填上「计划开始 / 计划完成」后这里会画出甘特图
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* ★ 甘特图天然是横向的，窄屏不能靠「压缩」适配：
          左侧标签列是固定 COL_W=260px，抽屉 / 手机下可用宽度只有 ~310px，
          右侧时间轴会被压到 ~50px —— 7 个刻度标签全部重叠成乱码（且不报错、不溢出，
          属于静默损坏）。改为给整图一个最小宽度 + 容器横向滚动：
          桌面（宽度已 ≥600px）像素完全不变，窄屏可左右拖动看完整时间轴。 */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* 表头 */}
          <div className="flex border-b bg-muted/30 text-[11px] text-muted-foreground">
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2" style={{ width: COL_W }}>
              <span>变更任务 / 责任人</span>
              <span className="flex items-center gap-1">
                <button type="button" className="hover:text-foreground" onClick={expandAll}>
                  展开
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button type="button" className="hover:text-foreground" onClick={collapseAll}>
                  收起
                </button>
              </span>
            </div>
            <div className="relative flex-1 py-2">
              {ticks.map((t) => (
                <span
                  key={t.label + t.pct}
                  // 首尾刻度不做居中位移：0% 居中会有一半被容器左边界切掉，100% 同理
                  className={cn(
                    "absolute tabular-nums",
                    t.pct === 0 ? "" : t.pct >= 100 ? "-translate-x-full" : "-translate-x-1/2"
                  )}
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {/* 主体 */}
          <div className="relative">
              {/* 网格与今日线（覆盖右侧时间轴区域） */}
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 top-0" aria-hidden>
                <div className="absolute bottom-0 top-0" style={{ left: COL_W, right: 0 }}>
                  {ticks.map((t) => (
                    <div
                      key={`g${t.pct}`}
                      className="absolute bottom-0 top-0 w-px bg-border/50"
                      style={{ left: `${t.pct}%` }}
                    />
                  ))}
                  {showToday && (
                    <>
                      <div
                        className="absolute bottom-0 top-0 w-px bg-red-500/70"
                        style={{ left: `${todayPct}%` }}
                      />
                      <span
                        className="absolute -top-0 -translate-x-1/2 rounded-b bg-red-500/10 px-1 text-[10px] text-red-600 dark:text-red-400"
                        style={{ left: `${todayPct}%` }}
                      >
                        今日
                      </span>
                    </>
                  )}
                </div>
              </div>

              {rows.map(({ node, hasChildren, isCollapsed }) => {
                // 汇总条 = 真有子项，或被显式标记为块头（两者都走中性灰）
                const isSummary = hasChildren || node.summary === true;
                const isLeaf = !isSummary;
                const meta = isLeaf ? taskStateMeta(node.state) : null;
                const colors = meta ?? GANTT_SUMMARY_COLOR;
                const { s, e } = nodeRange(node);
                const issues = hasChildren ? subtreeCount(node) : { overdue: 0, soon: 0 };
                const allDone = node.leaf_total > 0 && node.leaf_done === node.leaf_total;

                let left = 0;
                let width = 0;
                if (s && e) {
                  left = pct(s);
                  const endPct = pct(addDays(e, 1));
                  width = Math.max(0.6, endPct - left);
                }
                const hasBar = Boolean(s && e);

                return (
                  <div
                    key={node.id}
                    className={cn(
                      "flex border-b last:border-b-0 hover:bg-muted/30",
                      isSummary && "bg-muted/10"
                    )}
                    style={{ minHeight: ROW_H }}
                  >
                    {/* 左侧：任务树 + 责任人 + 状态角标 */}
                    <div
                      className="flex shrink-0 items-center gap-1 py-1.5 pr-2"
                      style={{ width: COL_W, paddingLeft: 8 + (node.level - 1) * 14 }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggle(node.id)}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={isCollapsed ? "展开" : "收起"}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-[18px] shrink-0" />
                      )}
                      <span
                        className={cn("min-w-0 flex-1 truncate text-xs", isSummary && "font-medium")}
                        title={node.name}
                      >
                        {node.name}
                      </span>
                      {node.owner ? (
                        <span className="shrink-0 truncate text-[10px] text-muted-foreground" style={{ maxWidth: 48 }}>
                          {node.owner}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">未指派</span>
                      )}

                      {hasChildren ? (
                        <>
                          {issues.overdue > 0 && (
                            <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-700 dark:text-red-400">
                              {issues.overdue} 项超期
                            </span>
                          )}
                          {issues.overdue === 0 && issues.soon > 0 && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              {issues.soon} 项临期
                            </span>
                          )}
                          {issues.overdue === 0 && issues.soon === 0 && allDone && (
                            <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              已完成
                            </span>
                          )}
                          {issues.overdue === 0 &&
                            issues.soon === 0 &&
                            !allDone &&
                            node.leaf_total > 0 && (
                              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                                {node.leaf_done}/{node.leaf_total}
                              </span>
                            )}
                        </>
                      ) : (
                        <>
                          {node.state === "overdue" && (
                            <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-700 dark:text-red-400">
                              超期{node.overdue_days}天
                            </span>
                          )}
                          {node.state === "soon" && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              临期
                            </span>
                          )}
                          {node.state === "late" && (
                            <span className="shrink-0 rounded bg-orange-500/15 px-1 text-[10px] font-medium text-orange-700 dark:text-orange-400">
                              迟交{node.late_days}天
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* 右侧：甘特条 */}
                    <div className="relative flex-1">
                      {hasBar ? (
                        <>
                          {/* 父条 / 汇总条：中性灰（不随最差子项变红） */}
                          <button
                            type="button"
                            onClick={() => onTaskClick?.(node.id)}
                            title={[
                              node.name,
                              node.owner ? `责任人 ${node.owner}` : "未指派",
                              node.plan_start ? `计划 ${node.plan_start} ~ ${node.plan_end ?? "?"}` : "未排期",
                              isLeaf && node.state === "overdue" ? `已超期 ${node.overdue_days} 天` : "",
                              isLeaf && node.state === "late" ? `迟交 ${node.late_days} 天` : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            className={cn(
                              "absolute rounded transition-[filter] hover:brightness-95",
                              isLeaf ? "cursor-pointer" : "cursor-default",
                              isSummary ? "h-2.5" : "h-2"
                            )}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              top: isSummary ? 11 : 10,
                              background: colors.fill,
                              outline: `0.5px solid ${colors.stroke}`,
                            }}
                          />
                          {/* 超期：红色虚线从条尾拖到今日线 */}
                          {isLeaf && node.state === "overdue" && node.plan_end && todayPct > pct(toDate(node.plan_end)!) && (
                            <div
                              className="absolute h-2 border-y border-dashed border-red-500/70 bg-red-500/10"
                              style={{
                                left: `${left + width}%`,
                                width: `${todayPct - (left + width)}%`,
                                top: 10,
                              }}
                            />
                          )}
                          {/* 迟交：细虚线拉到实际完成日 + 右端小竖标 */}
                          {isLeaf && node.state === "late" && node.done_at && (
                            <>
                              <div
                                className="absolute border-t border-dashed"
                                style={{
                                  left: `${left + width}%`,
                                  width: `${Math.max(0, pct(toDate(node.done_at)!) - (left + width))}%`,
                                  top: 14,
                                  borderColor: colors.stroke,
                                }}
                              />
                              <div
                                className="absolute w-0.5"
                                style={{
                                  left: `${pct(toDate(node.done_at)!)}%`,
                                  top: 9,
                                  height: 10,
                                  background: colors.stroke,
                                }}
                              />
                            </>
                          )}
                        </>
                      ) : (
                        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60">
                          未排期
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {!ready && null}
    </div>
  );
}
