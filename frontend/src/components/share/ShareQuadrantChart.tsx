import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShareQuadrantPoint } from "@/types/share";

/**
 * 份额 × 评分四象限散点图（纯 SVG，无第三方依赖）。
 *
 * 象限语义（规则页 SOP「份额×评分四象限怎么看」）：
 *   左上（份额低 + 评分高）= 潜力提升：评分不错但份额低，值得加量
 *   右上（份额高 + 评分高）= 健康主力
 *   左下（份额低 + 评分低）= 备选观察
 *   右下（份额高 + 评分低）= 红色警报：最差的供应商拿最多活
 * 点大小 = 基地拉线数量；红点 = 独供。
 * 颜色全部走 Tailwind 语义类，自动适配亮 / 暗主题。
 */

interface Props {
  points: ShareQuadrantPoint[];
  loading?: boolean;
}

/** 中线位置：份额 50%，评分 0.5 */
const X_MID = 50;
const Y_MID = 0.5;

export function ShareQuadrantChart({ points, loading }: Props) {
  const [hover, setHover] = useState<ShareQuadrantPoint | null>(null);

  const { W, H, PAD, scale } = useMemo(() => {
    return {
      W: 660,
      H: 380,
      PAD: { l: 46, r: 16, t: 16, b: 40 },
      scale: {
        // 份额 0-100 → x
        x: (v: number) => PAD.l + (Math.min(100, Math.max(0, v)) / 100) * (W - PAD.l - PAD.r),
        // 评分 0-1 → y（y 轴向下，评分高在上）
        y: (v: number) => PAD.t + (1 - Math.min(1, Math.max(0, v))) * (H - PAD.t - PAD.b),
      },
    };
  }, []);

  if (loading) {
    return <Skeleton style={{ height: H }} className="w-full" />;
  }

  const xMid = scale.x(X_MID);
  const yMid = scale.y(Y_MID);

  // 四象限背景（按坐标：左上=份额低+评分高 …右下=份额高+评分低）
  const quadrants = [
    { label: "潜力提升", cls: "fill-sky-500/10", textCls: "fill-sky-600 dark:fill-sky-400", desc: "份额低·评分高", x: PAD.l, y: PAD.t, w: xMid - PAD.l, h: yMid - PAD.t },
    { label: "健康主力", cls: "fill-emerald-500/10", textCls: "fill-emerald-600 dark:fill-emerald-400", desc: "份额高·评分高", x: xMid, y: PAD.t, w: W - PAD.r - xMid, h: yMid - PAD.t },
    { label: "备选观察", cls: "fill-teal-500/10", textCls: "fill-teal-600 dark:fill-teal-400", desc: "份额低·评分低", x: PAD.l, y: yMid, w: xMid - PAD.l, h: H - PAD.b - yMid },
    { label: "红色警报", cls: "fill-red-500/10", textCls: "fill-red-600 dark:fill-red-400", desc: "份额高·评分低", x: xMid, y: yMid, w: W - PAD.r - xMid, h: H - PAD.b - yMid },
  ];

  // 坐标轴刻度
  const xTicks = [0, 25, 50, 75, 100];
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // 点大小：拉线数量 1-20 → r 4-14
  const radiusOf = (lines: number) => Math.min(14, 4 + lines * 0.5);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="份额×评分四象限散点图">
        <title>份额 × 评分四象限散点图</title>
        <desc>横轴为份额百分比，纵轴为加权评分，点大小代表基地拉线数量</desc>

        {/* 四象限背景 */}
        {quadrants.map((q) => (
          <g key={q.label}>
            <rect x={q.x} y={q.y} width={q.w} height={q.h} className={q.cls} rx={0} />
            <text
              x={q.x + q.w / 2}
              y={q.y + 17}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              className={q.textCls}
            >
              {q.label}
            </text>
            <text
              x={q.x + q.w / 2}
              y={q.y + 29}
              textAnchor="middle"
              fontSize={9.5}
              className="fill-muted-foreground/70"
            >
              {q.desc}
            </text>
          </g>
        ))}

        {/* 中线 */}
        <line x1={xMid} y1={PAD.t} x2={xMid} y2={H - PAD.b} className="stroke-border" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={PAD.l} y1={yMid} x2={W - PAD.r} y2={yMid} className="stroke-border" strokeWidth={1} strokeDasharray="4 3" />

        {/* X 轴刻度 */}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={scale.x(t)} y1={H - PAD.b} x2={scale.x(t)} y2={H - PAD.b + 4} className="stroke-muted-foreground/40" strokeWidth={1} />
            <text x={scale.x(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
              {t}
            </text>
          </g>
        ))}
        {/* Y 轴刻度 */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l - 4} y1={scale.y(t)} x2={PAD.l} y2={scale.y(t)} className="stroke-muted-foreground/40" strokeWidth={1} />
            <text x={PAD.l - 8} y={scale.y(t) + 3} textAnchor="end" fontSize={11} className="fill-muted-foreground">
              {t.toFixed(2)}
            </text>
          </g>
        ))}

        {/* 坐标轴标题 */}
        <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
          份额（%）
        </text>
        <text x={14} y={PAD.t + (H - PAD.t - PAD.b) / 2} textAnchor="middle" fontSize={11} className="fill-muted-foreground" transform={`rotate(-90 14 ${PAD.t + (H - PAD.t - PAD.b) / 2})`}>
          加权评分
        </text>

        {/* 散点 */}
        {points.map((p, i) => {
          const r = radiusOf(p.lines);
          const isSole = p.is_sole;
          const fill = isSole ? "#f87171" : "#60a5fa"; // red-400 / blue-400，暗色下也醒目
          const stroke = isSole ? "#b91c1c" : "#2563eb"; // red-700 / blue-600
          const opacity = hover && hover !== p ? 0.35 : 1;
          return (
            <circle
              key={`${p.pn}-${p.supplier_name}-${i}`}
              cx={scale.x(p.share)}
              cy={scale.y(p.score)}
              r={r}
              fill={fill}
              opacity={opacity}
              stroke={stroke}
              strokeWidth={isSole ? 1.5 : 0.75}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            />
          );
        })}
      </svg>

      {/* hover 提示 */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur"
          style={{ left: 8, top: 8 }}
        >
          <div className="font-medium">
            {hover.material_name} <span className="text-muted-foreground">({hover.pn})</span>
          </div>
          <div className="text-muted-foreground">{hover.supplier_name}</div>
          <div className="mt-1 text-muted-foreground">
            份额 {hover.share.toFixed(0)}% ｜ 评分 {hover.score.toFixed(2)}
            {hover.lines > 0 && <span> ｜ 拉线 {hover.lines}</span>}
            {hover.is_sole && <span className="text-red-500"> ｜ 独供</span>}
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> 正常供应
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" /> 独供
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-dashed border-muted-foreground/60" /> 点大小 = 基地拉线数量
        </span>
      </div>
    </div>
  );
}
