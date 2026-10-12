import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import axios from "axios";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 人民币价格格式化 */
export function formatPrice(value: number): string {
  return `¥${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 日期时间格式化 */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

/** 从 Axios 错误中提取可读的错误信息（兼容 FastAPI 的 detail 字段） */
export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          typeof item === "string" ? item : ((item as { msg?: string })?.msg ?? "")
        )
        .filter(Boolean)
        .join("；");
    }
    if (typeof detail === "string") return detail;
    return error.message;
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

/**
 * 百分比分配（最大余数法 / 哈密顿法）—— 保证各项四舍五入后**合计正好 100%**。
 *
 * ★ 为什么不能直接 `Math.round(v / total * 100)`：
 *   3/7、2/7、2/7 → 43、29、29 加起来是 **101%**；
 *   33 项里的 11/4/6/1/11 → 33、12、18、3、33 加起来是 **99%**。
 *   饼图和堆叠条上的百分比加起来不是 100，看的人第一反应是"数据错了吧" ——
 *   白白消耗信任，而且这种错很难被当面指出。
 *
 * 规则：先取整数部分（向下取整），把剩下的额度按小数部分从大到小依次补给各项。
 * 全 0 输入时返回全 0，不抛错。
 */
export function percentageSplit(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0 || values.length === 0) return values.map(() => 0);

  const exact = values.map((v) => (Math.max(0, v) * 100) / total);
  const out = exact.map((e) => Math.floor(e));
  let remain = 100 - out.reduce((s, v) => s + v, 0);

  const byFrac = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; k < byFrac.length && remain > 0; k++) {
    out[byFrac[k]!.i] = (out[byFrac[k]!.i] ?? 0) + 1;
    remain -= 1;
  }
  return out;
}
