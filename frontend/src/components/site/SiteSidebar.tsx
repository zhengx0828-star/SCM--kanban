import { NavLink } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * 左侧控制栏（移植 shadcn/ui 官网文档侧边栏风格）：
 * 供应链控制台导航；已建页面高亮跳转，未建模块点击提示建设中。
 */

interface NavItem {
  label: string;
  to?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "供需管理", to: "/supply-demand" },
  { label: "份额管理", to: "/share" },
  { label: "库存管理" },
  { label: "变更管理" },
  { label: "供应商列表", to: "/materials" },
  { label: "规则", to: "/rules" },
];

export function SiteSidebar() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r px-3 py-6 lg:block">
      <nav>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              {item.to ? (
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span>{item.label}</span>
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isActive ? "bg-primary" : "bg-transparent"
                        )}
                      />
                    </>
                  )}
                </NavLink>
              ) : (
                <button
                  type="button"
                  onClick={() => toast.info(`「${item.label}」模块建设中，敬请期待`)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <span>{item.label}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
