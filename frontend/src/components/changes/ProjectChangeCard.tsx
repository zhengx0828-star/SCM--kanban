import { Archive, ArchiveRestore, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChangeProjectOverview } from "@/types/change";
import { projectCardClass } from "@/types/change";

/**
 * L0 项目卡片墙的一张卡 —— 老板视角的核心界面。
 *
 * 设计目标：**扫一眼就知道哪个项目出事了**。
 *   - 卡片墙默认按超期数降序（后端已排好），有问题的项目自然浮到最前面
 *   - 边框即信号：有超期红边、只有临期黄边、正常灰边
 *   - 两种完成率都给（按任务算 / 按变更单算），不替用户选口径
 *   - 最紧急一行直接写"哪张单、谁负责、超期几天"，不用点进去
 */

interface Props {
  data: ChangeProjectOverview;
  onOpen: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  archiving?: boolean;
}

export function ProjectChangeCard({ data: p, onOpen, onArchive, onUnarchive, archiving }: Props) {
  const hasProblem = p.overdue_changes > 0;

  // ★ 口径：total 只算**有效单**（不含作废、不含归档）→ 「作废/已归档」不属于上面这个加法的构成，
  //   必须用「另有」隔开。否则「乘用车 变更 1 张」会被误读成丢单（它其实还有 1 张作废单）。
  const extras = [
    p.voided > 0 ? `作废 ${p.voided}` : null,
    p.archived > 0 ? `已归档 ${p.archived}` : null,
  ].filter(Boolean);

  // 归档按钮的判定要含作废单：只有作废单的项目同样「有单可归档」（与旧 total 口径行为一致）
  const hasAnyChange = p.total + p.voided > 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "cursor-pointer p-4 transition-all hover:shadow-sm",
        projectCardClass(p)
      )}
    >
      {/* 标题行 */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={p.project_name}>
            {p.project_name}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{p.project_code}</p>
        </div>
        {hasProblem && (
          <Badge variant="destructive" className="shrink-0">
            <AlertTriangle className="mr-0.5 h-3 w-3" />
            {p.overdue_changes} 超期
          </Badge>
        )}
      </div>

      {/* 变更规模 —— 主句三个数必须闭合（total = active + done），作废/归档另起「另有」 */}
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        变更 <span className="font-medium text-foreground tabular-nums">{p.total}</span> 张
        <span className="mx-1 text-muted-foreground/40">·</span>
        进行中 <span className="tabular-nums">{p.active}</span>
        <span className="mx-1 text-muted-foreground/40">·</span>
        已完成 <span className="tabular-nums">{p.done}</span>
        {extras.length > 0 && (
          <>
            <span className="mx-1 text-muted-foreground/40">｜</span>
            另有 <span className="text-muted-foreground/80">{extras.join(" · ")}</span>
          </>
        )}
      </p>

      {/* 风险数字（红黄都在这一行） */}
      {(p.overdue_tasks > 0 || p.near_tasks > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {p.overdue_tasks > 0 && (
            <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-700 dark:text-red-400">
              超期 {p.overdue_changes} 单 · {p.overdue_tasks} 项
            </span>
          )}
          {p.near_tasks > 0 && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
              临期 {p.near_changes} 单 · {p.near_tasks} 项
            </span>
          )}
        </div>
      )}

      {/* 两种完成率 */}
      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          完成率 <span className="font-medium tabular-nums text-foreground">{p.task_done_rate}%</span>
          <span className="ml-1 text-[10px] text-muted-foreground/70">按任务</span>
        </span>
        <span>
          <span className="font-medium tabular-nums text-foreground">{p.change_done_rate}%</span>
          <span className="ml-1 text-[10px] text-muted-foreground/70">按单</span>
        </span>
      </div>

      {/* 类型拆分（不占大头，一行小标签） */}
      {p.type_counts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {p.type_counts.slice(0, 4).map((t) => (
            <span
              key={t.change_type_id}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={`${t.type_name}：${t.count} 张`}
            >
              {t.type_name} {t.count}
            </span>
          ))}
          {p.type_counts.length > 4 && (
            <span className="text-[10px] text-muted-foreground/70">+{p.type_counts.length - 4}</span>
          )}
        </div>
      )}

      {/* 最紧急一行 */}
      <div className="mt-2.5 border-t pt-2">
        {p.most_urgent ? (
          // ★ 不要整行 truncate：手机宽度下最先被吃掉的正是行尾的「超期 N 天」——
          //   那恰恰是这张卡最该看的信息。改成「只有标题+PN 允许截断，超期天数 shrink-0 钉住」。
          <div
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title={`${p.most_urgent.title} · ${p.most_urgent.owner ?? "未指派"}`}
          >
            <span className="shrink-0 text-muted-foreground/70">最紧急</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground">{p.most_urgent.title}</span>
              <span className="ml-1 font-mono text-[10px]">{p.most_urgent.material_pn}</span>
            </span>
            <span className="max-w-[5.5rem] shrink-0 truncate">{p.most_urgent.owner ?? "未指派"}</span>
            {p.most_urgent.overdue_days > 0 && (
              // data-role：这条「超期 N 天」是整张卡最重要的信息，必须永远完整可见
              <span className="shrink-0 font-medium text-red-600 dark:text-red-400" data-role="urgent-days">
                超期 {p.most_urgent.overdue_days} 天
              </span>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/60">暂时没有超期或临期的变更</p>
        )}
      </div>

      {/* 归档操作 */}
      <div className="mt-2 flex justify-end">
        {p.archived > 0 && !hasAnyChange ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            disabled={archiving}
            onClick={(e) => {
              e.stopPropagation();
              onUnarchive?.();
            }}
          >
            <ArchiveRestore className="mr-1 h-3 w-3" />
            取消归档
          </Button>
        ) : (
          hasAnyChange && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              disabled={archiving}
              onClick={(e) => {
                e.stopPropagation();
                onArchive?.();
              }}
            >
              <Archive className="mr-1 h-3 w-3" />
              归档此项目
            </Button>
          )
        )}
      </div>
    </Card>
  );
}
