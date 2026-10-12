import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { alertLevelMeta, type ChangeAlertItem } from "@/types/change";

/**
 * 预警明细表。两种看法，用户确认都要：
 *
 *   mode="group"（默认）—— 三级分组：项目 → 变更单 → 待办项
 *     回答的是「哪些项目、哪些变更单、有哪些东西要延期了」。
 *     旧版是纯按级别平铺，同一张单的几个待办项被打散在表格各处，
 *     读不出「这摊事整体什么状况」。
 *
 *   mode="flat" —— 按严重度平铺（旧行为，保留）
 *     救火视角：「全库最严重的 N 条」仍然是最有用的。
 *
 * 三条老纪律不变：
 *   1. 按严重度排序（超期天数降序 → 临期剩余天数升序 → 迟交降序）
 *   2. **必带责任人** —— 预警不指名道姓就没有意义
 *   3. 无责任人的行单独标灰「未指派」
 *
 * ★ 分组模式下截断**不切断分组**：宁可多显示一行，也不要把一个项目劈成两半。
 */

type Mode = "group" | "flat";

interface Props {
  items: ChangeAlertItem[];
  isLoading: boolean;
  /** L0 全局视图需要显示项目列（仅 flat 模式生效，group 模式下项目是组头） */
  showProject?: boolean;
  onRowClick?: (item: ChangeAlertItem) => void;
  emptyText?: string;
  mode?: Mode;
  /** group 模式下最多展示多少条待办项（按整组保留）。不传 = 不限 */
  limit?: number;
  /** 折叠状态的 localStorage key —— 换项目/换筛选时各记各的 */
  storageKey?: string;
}

const LEVEL_RANK: Record<string, number> = { overdue: 0, near: 1, late: 2 };

/** 排序键：级别优先，再按「严重方向」排（超期/迟交越大越前，临期越小越前） */
function sortKey(it: ChangeAlertItem): [number, number] {
  const rank = LEVEL_RANK[it.level] ?? 9;
  return [rank, it.level === "near" ? it.days : -it.days];
}

function compare(a: ChangeAlertItem, b: ChangeAlertItem): number {
  const [ra, va] = sortKey(a);
  const [rb, vb] = sortKey(b);
  return ra - rb || va - vb || a.change_id - b.change_id;
}

function useCollapsed(storageKey: string | undefined, initial: number[] = []) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(initial));

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as number[];
      if (Array.isArray(parsed)) setCollapsed(new Set(parsed.filter((n) => typeof n === "number")));
    } catch {
      // localStorage 不可用 / 内容损坏 → 用默认展开，不报错
    }
    // 仅在 key 变化时重新读取，避免把用户刚点的折叠覆盖掉
  }, [storageKey]);

  const toggle = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // 写不进去就只在内存里生效，不影响使用
        }
      }
      return next;
    });
  };

  return { collapsed, toggle, setCollapsed };
}

/* --------------------------------------------------------------- 行 */

function AlertLevelChip({ level }: { level: string }) {
  const meta = alertLevelMeta(level);
  return <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", meta.chipCls)}>{meta.label}</span>;
}

function DaysText({ item }: { item: ChangeAlertItem }) {
  const label =
    item.level === "overdue" ? `超期 ${item.days} 天` : item.level === "near" ? `剩 ${item.days} 天` : `迟交 ${item.days} 天`;
  return (
    <span
      data-role="task-days"
      className={cn(
        "text-[11px] font-medium tabular-nums",
        item.level === "overdue"
          ? "text-red-600 dark:text-red-400"
          : item.level === "near"
            ? "text-amber-600 dark:text-amber-400"
            : "text-orange-600 dark:text-orange-400"
      )}
    >
      {label}
    </span>
  );
}

function OwnerText({ owner }: { owner: string | null }) {
  if (owner) return <span className="text-xs">{owner}</span>;
  return <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">未指派</span>;
}

/* --------------------------------------------------------------- 组件 */

export function ChangeAlertTable({
  items,
  isLoading,
  showProject = false,
  onRowClick,
  emptyText,
  mode = "group",
  limit,
  storageKey,
}: Props) {
  const { collapsed, toggle } = useCollapsed(storageKey);

  const groups = useMemo(() => {
    const byProject = new Map<
      number,
      { projectId: number; projectName: string; worst: ChangeAlertItem; changes: Map<number, ChangeAlertItem[]> }
    >();
    for (const it of items) {
      let g = byProject.get(it.project_id);
      if (!g) {
        g = { projectId: it.project_id, projectName: it.project_name, worst: it, changes: new Map() };
        byProject.set(it.project_id, g);
      }
      if (compare(it, g.worst) < 0) g.worst = it;
      const arr = g.changes.get(it.change_id) ?? [];
      arr.push(it);
      g.changes.set(it.change_id, arr);
    }
    const list = [...byProject.values()];
    // 项目组间也按最严重程度排 —— 有超期的项目自动浮到最上面
    list.sort((a, b) => compare(a.worst, b.worst) || a.projectId - b.projectId);
    for (const g of list) {
      for (const arr of g.changes.values()) arr.sort(compare);
    }
    return list;
  }, [items]);

  /** 截断按整组保留：不把一个项目劈成两半 */
  const visibleGroups = useMemo(() => {
    if (!limit || limit <= 0) return groups;
    const out: typeof groups = [];
    let n = 0;
    for (const g of groups) {
      const size = [...g.changes.values()].reduce((s, arr) => s + arr.length, 0);
      if (n > 0 && n + size > limit) break;
      out.push(g);
      n += size;
    }
    return out;
  }, [groups, limit]);

  const totalItems = items.length;
  const shownItems = useMemo(
    () => visibleGroups.reduce((s, g) => s + [...g.changes.values()].reduce((x, arr) => x + arr.length, 0), 0),
    [visibleGroups]
  );
  const [forceAll, setForceAll] = useState(false);
  const truncated = Boolean(limit) && shownItems < totalItems && !forceAll;
  const groupsToRender = truncated ? visibleGroups : groups;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card py-8 text-center text-xs text-muted-foreground">
        {emptyText ?? "没有超期或临期的任务，一切正常"}
      </div>
    );
  }

  /* ------------------------------------------------------- 平铺模式（旧行为） */

  if (mode === "flat") {
    const flat = [...items].sort(compare);
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[80px]">级别</TableHead>
              <TableHead className="min-w-[160px]">任务</TableHead>
              <TableHead className="min-w-[150px]">变更单</TableHead>
              {showProject && <TableHead className="w-[140px]">项目</TableHead>}
              <TableHead className="w-[130px]">物料</TableHead>
              <TableHead className="w-[90px]">责任人</TableHead>
              <TableHead className="w-[96px]">计划完成</TableHead>
              <TableHead className="w-[92px]">天数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flat.map((it) => (
              <TableRow
                key={it.task_id}
                className={cn(onRowClick && "cursor-pointer", it.is_unassigned && "opacity-60")}
                onClick={() => onRowClick?.(it)}
              >
                <TableCell>
                  <AlertLevelChip level={it.level} />
                </TableCell>
                <TableCell>
                  <p className="truncate text-xs" title={it.task_name}>
                    {it.task_level > 1 && <span className="mr-1 text-muted-foreground/50">└</span>}
                    {it.task_name}
                  </p>
                </TableCell>
                <TableCell>
                  <p className="truncate text-xs text-muted-foreground" title={it.change_title}>
                    <span className="font-mono">#{it.change_id}</span> {it.change_title}
                  </p>
                </TableCell>
                {showProject && (
                  <TableCell className="truncate text-xs text-muted-foreground" title={it.project_name}>
                    {it.project_name}
                  </TableCell>
                )}
                <TableCell>
                  <p className="truncate text-[11px] text-muted-foreground">
                    <span className="font-mono">{it.material_pn}</span>
                  </p>
                </TableCell>
                <TableCell>
                  <OwnerText owner={it.owner} />
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">{it.plan_end ?? "—"}</TableCell>
                <TableCell>
                  <DaysText item={it} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  /* ------------------------------------------------------- 三级分组模式 */

  return (
    <div>
      <div className="space-y-2">
        {groupsToRender.map((g) => {
          const size = [...g.changes.values()].reduce((s, arr) => s + arr.length, 0);
          const isCollapsed = collapsed.has(g.projectId);
          const wMeta = alertLevelMeta(g.worst.level);
          return (
            <div key={g.projectId} className="overflow-hidden rounded-lg border bg-card">
              {/* 项目组头 */}
              <button
                type="button"
                onClick={() => toggle(g.projectId)}
                className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={g.projectName}>
                  {g.projectName}
                </span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", wMeta.chipCls)}>
                  最严重 {wMeta.label}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{size} 项待处理</span>
              </button>

              {!isCollapsed && (
                <div className="divide-y">
                  {[...g.changes.entries()]
                    .map(([changeId, arr]) => ({ changeId, arr }))
                    .sort((a, b) => compare(a.arr[0]!, b.arr[0]!))
                    .map(({ changeId, arr }) => {
                      const first = arr[0]!;
                      return (
                        <div key={changeId} className="px-3 py-2">
                          {/* 变更单小标题 */}
                          <button
                            type="button"
                            onClick={() => onRowClick?.(first)}
                            className={cn(
                              "flex w-full items-center gap-2 text-left",
                              onRowClick && "cursor-pointer"
                            )}
                            title={`#${changeId} ${first.change_title}`}
                          >
                            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                              <span className="font-mono">#{changeId}</span> {first.change_title}
                              <span className="mx-1.5 text-muted-foreground/40">·</span>
                              <span className="font-mono">{first.material_pn}</span>
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                              {arr.length} 项
                            </span>
                          </button>

                          {/* 待办项行 */}
                          <div className="mt-1.5 space-y-1">
                            {arr.map((it) => (
                              <button
                                key={it.task_id}
                                type="button"
                                onClick={() => onRowClick?.(it)}
                                className={cn(
                                  // ★ 手机宽度下不能用固定 4 列网格：两个 auto 列（责任人+日期、超期天数）
                                  //   会把中间「任务名」压到 55px（约 5 个字），且不报错、不溢出 —— 静默变废。
                                  //   改为「窄屏两行 / 宽屏一行」：窄屏第一行 = 级别 + 任务名（占满），
                                  //   第二行 = 责任人 · 计划完成 · 剩余天数；sm 起恢复原来的单行四列。
                                  "flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors",
                                  onRowClick && "hover:bg-accent/50",
                                  it.is_unassigned && "opacity-60"
                                )}
                              >
                                <AlertLevelChip level={it.level} />
                                <div className="flex min-w-0 flex-1 flex-col gap-y-0.5 sm:flex-row sm:items-center sm:gap-x-2">
                                  {/* data-role 供 scripts/verify_mobile.mjs 量化「任务名可见宽度」——
                                      曾被固定 4 列网格挤到 55px（约 5 个字），靠肉眼看不出来。 */}
                                  <span className="min-w-0 flex-1 truncate text-xs" title={it.task_name} data-role="task-name">
                                    {it.task_level > 1 && <span className="mr-1 text-muted-foreground/50">└</span>}
                                    {it.task_name}
                                  </span>
                                  <div className="flex shrink-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                                    <OwnerText owner={it.owner} />
                                    <span className="tabular-nums">{it.plan_end ?? "—"}</span>
                                    <DaysText item={it} />
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {truncated && (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
          <p className="text-[11px] text-muted-foreground">
            共 {totalItems} 项待处理，已显示 {shownItems} 项（按整组保留，不切断分组）
          </p>
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setForceAll(true)}>
            展开全部
          </Button>
        </div>
      )}
    </div>
  );
}
