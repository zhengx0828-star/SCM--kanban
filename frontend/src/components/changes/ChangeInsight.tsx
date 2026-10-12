import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 「一句话结论」行 —— 每张图标题下必备。
 *
 * 这是首页"老板一眼抓住重点"的关键零件：老板**不需要读图**，读这一行字就够了。
 * 图只负责"让人信服"，结论由这一行负责"传达信息"。
 *
 * ★ 纪律：文字必须**由数据算出**（在调用方 useMemo 里拼），
 *   不允许写成固定话术 —— 数据没变结论却不变，那就是装饰，不是结论。
 *   没数据时调用方应传「暂无数据」，不要编一句。
 */

type Tone = "default" | "info" | "good" | "warn" | "bad";

const TONE: Record<Tone, { bar: string; text: string }> = {
  default: { bar: "bg-muted-foreground/40", text: "text-muted-foreground" },
  info: { bar: "bg-blue-500", text: "text-blue-700 dark:text-blue-300" },
  good: { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  warn: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  bad: { bar: "bg-red-500", text: "text-red-700 dark:text-red-300" },
};

interface Props {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

export function ChangeInsight({ children, tone = "default", className }: Props) {
  const t = TONE[tone] ?? TONE.default;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs leading-relaxed", t.text, className)}>
      <span className={cn("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", t.bar)} aria-hidden />
      <span>{children}</span>
    </p>
  );
}
