import { useMemo, useState } from "react";
import { AlertTriangle, LayoutGrid, ListPlus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { dohBucketMeta, INV_DOH_BUCKET_ORDER, type InventoryProjectOverview } from "@/types/inventory";
import { cn } from "@/lib/utils";

/**
 * L0 项目卡片墙。
 *
 * 这是「未选项目不展示物料」的落地：进入库存管理先看到项目列表，
 * 勾选项目后才加载该项目的推算单元明细。物料再多、项目再多，
 * 这一层永远只是卡片网格，不会堆成一张大表。
 *
 * 每张卡自带 DOH 四档角标 + 最紧急物料 —— 不点进去也能判断哪个项目最危险。
 */

interface Props {
  projects: InventoryProjectOverview[];
  selected: Set<string>;
  onToggle: (projectId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  isLoading: boolean;
  onBulkCreate: () => void;
  onImport: () => void;
}

export function ProjectCardWall({
  projects,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  isLoading,
  onBulkCreate,
  onImport,
}: Props) {
  const [keyword, setKeyword] = useState("");

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter((p) =>
      [p.project_name, p.project_code].join(" ").toLowerCase().includes(kw)
    );
  }, [projects, keyword]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[168px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState
            icon={<ListPlus className="h-7 w-7" />}
            title="尚无库存推算单元"
            description="先从底表批量建档（选「项目 × 物料 × 供应商」并指定基地），系统会自动按底表的客户需求 × BOM 系数开始 30 天日度推算"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={onBulkCreate}>
                  <ListPlus className="mr-1.5 h-4 w-4" />
                  从底表建档
                </Button>
                <Button variant="outline" onClick={onImport}>
                  从 Excel 导入
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">选择项目</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            可多选；选定后才会加载对应的物料推算明细（共 {projects.length} 个项目）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 w-[200px] pl-7 text-xs"
              placeholder="搜索项目名 / 代码"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          {selected.size > 0 ? (
            <>
              <Button variant="outline" size="sm" onClick={onSelectAll}>
                全选
              </Button>
              <Button variant="outline" size="sm" onClick={onClearAll}>
                清空
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onSelectAll}>
              全选项目
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => {
          const isChecked = selected.has(String(p.project_id));
          const b = p.doh_buckets;
          const urgentTotal = b.stockout + b.urgent;
          const mu = p.most_urgent;
          const muMeta = mu ? dohBucketMeta(mu.bucket) : null;

          return (
            <Card
              key={p.project_id}
              role="button"
              tabIndex={0}
              aria-pressed={isChecked}
              onClick={() => onToggle(String(p.project_id))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(String(p.project_id));
                }
              }}
              className={cn(
                "cursor-pointer p-4 transition-all hover:shadow-sm",
                isChecked ? "border-primary ring-1 ring-primary" : "hover:border-border-secondary"
              )}
            >
              {/* 标题行 */}
              <div className="flex items-start gap-2.5">
                <Checkbox
                  checked={isChecked}
                  className="mt-0.5 shrink-0"
                  onCheckedChange={() => onToggle(String(p.project_id))}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`选择 ${p.project_name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={p.project_name}>
                    {p.project_name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{p.project_code}</p>
                </div>
                {urgentTotal > 0 && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 bg-red-500/10 text-[10px] font-medium text-red-700 dark:text-red-400"
                  >
                    <AlertTriangle className="mr-0.5 h-3 w-3" />
                    {urgentTotal}
                  </Badge>
                )}
              </div>

              {/* 规模 */}
              <p className="mt-2.5 text-[11px] text-muted-foreground">
                {p.plan_count} 个推算单元 · {p.material_count} 个物料
              </p>

              {/* DOH 四档角标 */}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {INV_DOH_BUCKET_ORDER.map((bucket) => {
                  const count = b[bucket] ?? 0;
                  if (count === 0) return null;
                  const meta = dohBucketMeta(bucket);
                  return (
                    <span
                      key={bucket}
                      className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums", meta.chipCls)}
                      title={`${meta.label}（${meta.desc}）：${count} 行`}
                    >
                      {meta.label} {count}
                    </span>
                  );
                })}
                {p.plan_count === 0 && (
                  <span className="text-[10px] text-muted-foreground">该基地暂无推算单元</span>
                )}
              </div>

              {/* 最紧急物料 */}
              <div className="mt-2.5 border-t pt-2">
                {mu && muMeta ? (
                  <p className="truncate text-[11px] text-muted-foreground" title={`${mu.material_name} ${mu.pn} · ${mu.base_name}`}>
                    <span className="text-muted-foreground/70">最紧急　</span>
                    <span className="font-medium text-foreground">{mu.material_name}</span>
                    <span className="ml-1 font-mono text-[10px]">{mu.pn}</span>
                    <span className={cn("ml-1.5 rounded px-1 py-px text-[10px] tabular-nums", muMeta.chipCls)}>
                      DOH {mu.doh}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                    <AlertTriangle className="h-3 w-3" />
                    全部行需求数据不可用，无法评估
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {rows.length === 0 && keyword.trim() !== "" && (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<LayoutGrid className="h-7 w-7" />}
              title="没有匹配的项目"
              description={`没有项目名或代码包含「${keyword}」`}
              action={
                <Button variant="outline" size="sm" onClick={() => setKeyword("")}>
                  清空搜索
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
