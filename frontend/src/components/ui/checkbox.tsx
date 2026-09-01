import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 轻量 Checkbox（API 兼容 shadcn/ui Checkbox）。
 * 使用原生 input[type=checkbox] + 样式化，避免额外依赖。
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
    <span className="relative inline-flex items-center">
      <input
        ref={ref}
        type="checkbox"
        className="peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-input bg-background transition-colors checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      <svg
        className="pointer-events-none absolute left-0.5 top-0.5 hidden h-3 w-3 text-primary-foreground peer-checked:block"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
