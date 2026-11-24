import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * 全局 / 路由级错误边界。
 *
 * ★ 为什么必须有：React 18 里任何一个组件在渲染期抛错（空值断言、图表 option 拼装、
 *   数据形状与后端不一致），整棵树会被卸载，用户看到的是**纯白页**——没有导航、
 *   没有提示、连「返回」按钮都没有，只能手动刷新。
 *   加边界后至少能告诉用户「这页出错了」并给出两条退路。
 *
 * 用法：
 *   - `main.tsx` 里包住整个 App（兜住路由之外的崩溃）
 *   - `App.tsx` 里给每个 Route 各包一层（切页自动复位，坏页不影响其他页）
 */
interface Props {
  children: ReactNode;
  /** 出问题时显示的位置说明，便于反馈时定位是哪一页 */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留控制台堆栈：内网没有前端监控，浏览器控制台是唯一现场
    console.error(`[render-error]${this.props.label ? ` ${this.props.label}` : ""}`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">这个页面出错了</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {this.props.label ? `${this.props.label} · ` : ""}
                页面渲染时发生异常，数据没有改动。
              </p>
              <p className="mt-2 break-words rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {error.message || error.name}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              重新加载
            </button>
            <a
              href="/dashboard"
              className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              回到 Dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
