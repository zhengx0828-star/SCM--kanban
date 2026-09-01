import { useEffect, useState } from "react";

/**
 * 主题管理（浅色/深色）：
 * - 以 document 的 .dark class 为唯一事实源
 * - localStorage 持久化，自定义事件通知所有订阅组件（顶栏、Toaster 等）同步
 */

export type Theme = "light" | "dark";

const THEME_EVENT = "wb:theme-change";
const STORAGE_KEY = "theme";

export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function toggleTheme() {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
}

/** 订阅主题变化（组件内使用） */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light"
  );

  /* 首次挂载时保证 class 与存储一致（避免刷新后样式闪变） */
  useEffect(() => {
    applyTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onChange = () => setTheme(getTheme());
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  return { theme, dark: theme === "dark", toggle: toggleTheme };
}
