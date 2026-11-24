import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage, cn } from "@/lib/utils";

/**
 * 接口失败时的显式错误块。
 *
 * ★ 为什么不能退回空态：空态说「暂无数据」，接口失败说「数据可能有一堆但没取到」，
 *   两者对使用者的含义完全相反。看板把 0 当结论用的时候，静默降级就是在制造错误判断。
 */
export interface QueryErrorProps {
  /** 哪块数据没取到，如「预警数据」 */
  label?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function QueryError({ label = "数据", error, onRetry, className }: QueryErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}加载失败</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{getApiErrorMessage(error)}</p>
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}
