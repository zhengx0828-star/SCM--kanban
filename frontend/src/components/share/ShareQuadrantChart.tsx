import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShareQuadrantPoint } from "@/types/share";

/**
 * 份额 × 评分四象限散点图（纯 SVG，无第三方依赖）。
 *
 * 象限语义（规则页 SOP）：
 *   左上（份额高 + 评分低）= 红色警报：最差的供应商拿最多活
 *   右上（份额高 + 评分高）= 健康主力
 *   左下（份额低 + 评分低）= 备选观察
 *   右下（份额低 + 评分高）= 潜力提升
 * 点大小 = 基地拉线数量；红点 = 独供。
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

  // 背景四象限着色
  const quadrants = [
    { fill: "#FCEBEB", label: "红色警报", color: "#A32D2D", x: PAD.l, y: PAD.t, w: xMid - PAD.l, h: yMid - PAD.t, show: true },
    { fill: "#EAF3DE", label: "健康主力", color: "#3B6D11", x: xMid, y: PAD.t, w: W - PAD.r - xMid, h: yMid - PAD.t, show: true },
    { fill: "#E1F5EE", label: "备选观察", color: "#0F6E56", x: PAD.l, y: yMid, w: xMid - PAD.l, h: H - PAD.b - yMid, show: true },
    { fill: "#E6F1FB", label: "潜力提升", color: "#185FA5", x: xMid, y: yMid, w: W - PAD.r - xMid, h: H - PAD.b - yMid, show: true },
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
            <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={q.fill} rx={0} />
            <text
              x={q.x + q.w / 2}
              y={q.y + 18}
              textAnchor="middle"
              fontSize={11}
              fill={q.color}
              opacity={0.85}
            >
              {q.label}
            </text>
          </g>
        ))}

        {/* 中线 */}
        <line x1={xMid} y1={PAD.t} x2={xMid} y2={H - PAD.b} stroke="#888780" strokeWidth={0.5} strokeDasharray="4 3" />
        <line x1={PAD.l} y1={yMid} x2={W - PAD.r} y2={yMid} stroke="#888780" strokeWidth={0.5} strokeDasharray="4 3" />

        {/* X 轴刻度 */}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={scale.x(t)} y1={H - PAD.b} x2={scale.x(t)} y2={H - PAD.b + 4} stroke="#B4B2A9" strokeWidth={0.5} />
            <text x={scale.x(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill="#5F5E5A">
              {t}
            </text>
          </g>
        ))}
        {/* Y 轴刻度 */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l - 4} y1={scale.y(t)} x2={PAD.l} y2={scale.y(t)} stroke="#B4B2A9" strokeWidth={0.5} />
            <text x={PAD.l - 8} y={scale.y(t) + 3} textAnchor="end" fontSize={11} fill="#5F5E5A">
              {t.toFixed(2)}
            </text>
          </g>
        ))}

        {/* 坐标轴标题 */}
        <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#5F5E5A">
          份额（%）
        </text>
        <text x={14} y={PAD.t + (H - PAD.t - PAD.b) / 2} textAnchor="middle" fontSize={11} fill="#5F5E5A" transform={`rotate(-90 14 ${PAD.t + (H - PAD.t - PAD.b) / 2})`}>
          加权评分
        </text>

        {/* 散点 */}
        {points.map((p, i) => {
          const r = radiusOf(p.lines);
          const isSole = p.is_sole;
          const fill = isSole ? "#A32D2D" : "#185FA5";
          const opacity = hover && hover !== p ? 0.35 : 1;
          return (
            <circle
              key={`${p.pn}-${p.supplier_name}-${i}`}
              cx={scale.x(p.share)}
              cy={scale.y(p.score)}
              r={r}
              fill={fill}
              opacity={opacity}
              stroke={isSole ? "#501313" : "#042C53"}
              strokeWidth={0.5}
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
          className="pointer-events-none absolute z-10 rounded-md border bg-white px-3 py-2 text-xs shadow-sm"
          style={{ left: 8, top: 8 }}
        >
          <div className="font-medium">
            {hover.material_name} <span className="text-muted-foreground">({hover.pn})</span>
          </div>
          <div className="text-muted-foreground">{hover.supplier_name}</div>
          <div className="mt-1 text-muted-foreground">
            份额 {hover.share.toFixed(0)}% ｜ 评分 {hover.score.toFixed(2)}
            {hover.lines > 0 && <span> ｜ 拉线 {hover.lines}</span>}
            {hover.is_sole && <span className="text-red-600"> ｜ 独供</span>}
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#185FA5]" /> 正常供应
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#A32D2D]" /> 独供
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-dashed border-[#888780]" /> 点大小 = 基地拉线数量
        </span>
      </div>
    </div>
  );
}
