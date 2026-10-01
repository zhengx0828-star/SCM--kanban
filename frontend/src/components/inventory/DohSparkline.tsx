import type { InventoryPlan } from "@/types/inventory";

/**
 * 30 天 DOH 迷你走势图（纯 SVG，无第三方依赖）。
 *
 * 为什么值得做：列表按 DOH 升序只能告诉你「现在多危险」，
 * 但看不出「是在恶化还是在好转」。一条 30 点折线就能一眼区分
 * 「DOH 稳定 10 天」与「DOH 从 20 天掉到 3 天」——后者的紧急度完全不同。
 *
 * 编码：
 * - 空心方块 = 今日 DOH 起点
 * - 灰色虚线 = 安全天数参考线（DOH 跌到它下方即入「紧急」档）
 * - 折线颜色跟随今日所在档位（与四卡同色，色觉之外由形状辅助）
 * - capped（30 天内未耗尽）按窗口长度 30 处理，避免折线冲出画布
 */

const W = 76;
const H = 26;
const PAD = 2;

interface Props {
  plan: InventoryPlan;
  /** 折线颜色（CSS 类名，由父级按档位传入） */
  strokeCls?: string;
}

export function DohSparkline({ plan, strokeCls = "text-muted-foreground" }: Props) {
  const days = plan.days ?? [];
  if (days.length < 2) {
    return <span className="text-[10px] text-muted-foreground/50">—</span>;
  }

  const values = days.map((d) => (d.doh_capped ? 30 : d.doh));
  const safeDays = plan.safe_days ?? 0;

  // Y 轴上界：DOH 最大值、安全天数、至少 1，避免全 0 时除零
  const yMax = Math.max(Math.max(...values), safeDays, 1);

  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (Math.max(0, Math.min(v, yMax)) / yMax) * (H - PAD * 2);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  // 面积填充：折线 + 底边闭合
  const area = `${points} ${x(values.length - 1).toFixed(1)},${H - PAD} ${x(0).toFixed(1)},${H - PAD}`;
  const safeY = y(safeDays);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`30 天 DOH 走势，今日 ${values[0].toFixed(1)} 天，安全天数 ${safeDays}`}
      className={strokeCls}
    >
      {/* 安全天数参考线（在数据范围内才画） */}
      {safeDays > 0 && safeDays <= yMax && (
        <line
          x1={PAD}
          y1={safeY}
          x2={W - PAD}
          y2={safeY}
          stroke="currentColor"
          strokeWidth="0.6"
          strokeDasharray="2 2"
          opacity="0.35"
        />
      )}
      <polygon points={area} fill="currentColor" opacity="0.12" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 今日起点：空心方块（形状编码，不依赖颜色） */}
      <rect
        x={x(0) - 1.8}
        y={y(values[0]) - 1.8}
        width="3.6"
        height="3.6"
        fill="var(--color-background-primary, #fff)"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}
