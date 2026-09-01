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
