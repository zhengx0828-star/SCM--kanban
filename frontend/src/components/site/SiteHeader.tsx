import { Moon, Package, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

/**
 * 站点顶栏（移植 shadcn/ui 官网风格）：
 * logo + 标题、主题切换（浅色/深色，localStorage 持久化）。
 */

export function SiteHeader() {
  const { dark, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* 品牌 */}
        <a href="/dashboard" className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">供应链控制台</span>
        </a>

        {/* 右侧：仅主题切换 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={dark ? "切换到浅色主题" : "切换到深色主题"}
            title={dark ? "切换到浅色主题" : "切换到深色主题"}
            onClick={toggle}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
