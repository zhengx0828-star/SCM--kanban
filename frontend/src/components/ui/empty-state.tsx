import { cn } from "@/lib/utils";

/**
 * 通用空状态。
 *
 * 设计：虚框包住 + 居中 + 图标 + 主标题 + 副说明 + 可选 action。
 * 用于取代散落的 "暂无数据" 占位文字，让全站空态视觉风格一致。
 */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** sm ≈ 100px 高，md ≈ 160px 高，lg ≈ 220px 高 */
  size?: "sm" | "md" | "lg";
  /** 视觉变体：default 用 bg-muted/20，plain 透明不画框 */
  variant?: "default" | "plain";
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = "md",
  variant = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md text-center",
        variant === "default" && "border border-dashed bg-muted/20",
        size === "sm" && "px-4 py-6",
        size === "md" && "px-6 py-12",
        size === "lg" && "px-8 py-16",
        className
      )}
    >
      {icon && (
        <div
          className={cn(
            "text-muted-foreground/60",
            "[&_svg]:h-7 [&_svg]:w-7"
          )}
        >
          {icon}
        </div>
      )}
      <p
        className={cn(
          "font-medium text-foreground",
          size === "sm" ? "text-xs" : "text-sm"
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "max-w-md text-muted-foreground",
            size === "sm" ? "text-[11px]" : "text-xs"
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
