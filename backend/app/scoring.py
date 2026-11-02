"""供应商细分打分（纯函数，不碰 DB、不 import ORM）。

放在独立模块而不是塞进 router，是为了 `scripts/verify_segments.py` 能直接 import
断言，不用起服务、不用连库。

口径（见 docs/supplier-segmentation/01-方案草案.md）：

  12 项统一五档：1 / 0.7 / 0.5 / 0.3 / 0，乘 100 即折算分。
  能力分 = Σ(权重 × 档位) ÷ Σ(权重)，只对已填项求和（分母随缺失收缩）。
  象限判定用**严格大于**：cap > 50 且 will > 50 才算过关 ——
    0.5 档正好折算 50 分，用 ≥ 会让「六项全中性」的供应商掉进「战略伙伴」。

  ★ 牌生效期间两维一律 0 分、quadrant = exit，**但不修改传入的档位**。
    档位是原始事实，牌是判定；混在一起就再也分不开，解牌也无法恢复。
"""

from dataclasses import dataclass
from typing import Mapping, Optional

# 唯一合法的档位值。入参不在这个集合里一律报错，不做四舍五入放过。
TIERS: tuple[float, ...] = (0.0, 0.3, 0.5, 0.7, 1.0)

CAP_KEYS: tuple[str, ...] = ("a1", "a2", "a3", "a4", "a5", "a6")
WILL_KEYS: tuple[str, ...] = ("w1", "w2", "w3", "w4", "w5", "w6")

# 能力 6 项的中文名（前端/规则页共用同一份，避免两处改漏）
DIM_LABELS: dict[str, str] = {
    "a1": "PN 质量绩效",
    "a2": "交付达成率",
    "a3": "合格率",
    "a4": "成本",
    "a5": "CFT 飞行稽查",
    "a6": "供应商质量服务分",
    "w1": "降价意愿",
    "w2": "建库意愿",
    "w3": "紧急交付意愿",
    "w4": "沟通态度",
    "w5": "回复及时率",
    "w6": "产能弹性",
}

# 组内业务权重，两组各自合计 100（2026-11-02 定）
SEGMENT_WEIGHTS: dict[str, dict[str, float]] = {
    "cap": {"a1": 25, "a2": 20, "a3": 20, "a4": 20, "a5": 5, "a6": 10},
    "will": {"w1": 20, "w2": 15, "w3": 30, "w4": 10, "w5": 10, "w6": 15},
}

SEGMENT_THRESHOLD = 50.0
# 任一维有效项 < 4（即 ≤3）→ 该维不出分，整条进「未评级」
MIN_FILLED = 4
FORMULA_VERSION = "v1"

CARD_RED = "red"
CARD_YELLOW = "yellow"
CARD_TYPES: tuple[str, ...] = (CARD_RED, CARD_YELLOW)

QUADRANTS: tuple[str, ...] = ("partner", "dependent", "nurture", "exit", "incomplete")


@dataclass(frozen=True)
class SegmentScore:
    """一次打分的完整结果。"""

    cap: Optional[float]
    will: Optional[float]
    quadrant: str
    card: Optional[str]
    cap_filled: int
    will_filled: int


def normalize_tier(value: float) -> float:
    """把 0.7000000001 这类浮点噪声收敛到合法档位；不合法直接抛错。

    不用 round 到最近档位：0.8 四舍五入成 0.7 会静默吃掉打分人的意思，
    应当报错让人改。
    """
    for tier in TIERS:
        if abs(float(value) - tier) < 1e-9:
            return tier
    raise ValueError(f"档位只能是 {' / '.join(str(t) for t in TIERS)}，收到 {value!r}")


def _weighted(tiers: Mapping[str, Optional[float]], weights: Mapping[str, float], keys: tuple[str, ...]) -> tuple[Optional[float], int]:
    """单维加权分（0-100）+ 有效项数。有效项不足 MIN_FILLED 时返回 (None, 有效项数)。"""
    acc = 0.0
    total_w = 0.0
    filled = 0
    for key in keys:
        raw = tiers.get(key)
        if raw is None:
            continue
        weight = float(weights.get(key, 0.0))
        if weight <= 0:
            continue
        acc += weight * normalize_tier(raw)
        total_w += weight
        filled += 1
    if filled < MIN_FILLED or total_w <= 0:
        return None, filled
    # 先取 1 位小数再比较：5 档加权容易算出 50.0000001，直接比大小会误判成「过关」
    return round(acc * 100.0 / total_w, 1), filled


def quadrant_of(cap: Optional[float], will: Optional[float], threshold: float = SEGMENT_THRESHOLD) -> str:
    """四象限判定。严格大于阈值才算「过关」。任一维无分 → incomplete。"""
    if cap is None or will is None:
        return "incomplete"
    cap_ok = cap > threshold
    will_ok = will > threshold
    if cap_ok and will_ok:
        return "partner"
    if cap_ok:
        return "dependent"
    if will_ok:
        return "nurture"
    return "exit"


def score(
    tiers: Mapping[str, Optional[float]],
    weights: Optional[Mapping[str, Mapping[str, float]]] = None,
    card: Optional[str] = None,
    threshold: float = SEGMENT_THRESHOLD,
) -> SegmentScore:
    """打分主入口。

    card 传 red / yellow 时两维归零（牌优先于档位与缺失判定），
    但 `cap_filled / will_filled` 仍按**实际填写数**返回 —— 复盘要看「他填了几项」。
    """
    scheme = weights or SEGMENT_WEIGHTS
    cap, cap_filled = _weighted(tiers, scheme["cap"], CAP_KEYS)
    will, will_filled = _weighted(tiers, scheme["will"], WILL_KEYS)

    if card in CARD_TYPES:
        return SegmentScore(
            cap=0.0,
            will=0.0,
            quadrant="exit",
            card=card,
            cap_filled=cap_filled,
            will_filled=will_filled,
        )

    return SegmentScore(
        cap=cap,
        will=will,
        quadrant=quadrant_of(cap, will, threshold),
        card=None,
        cap_filled=cap_filled,
        will_filled=will_filled,
    )


def equal_weights() -> dict[str, dict[str, float]]:
    """等权回退方案（preset=equal），用于对比业务权重把结论带偏了多少。"""
    return {group: {key: 100 / len(keys) for key in keys} for group, keys in (("cap", CAP_KEYS), ("will", WILL_KEYS))}


def weights_sum_ok(weights: Mapping[str, Mapping[str, float]], tolerance: float = 0.01) -> bool:
    """两组各自合计必须 100。配置接口据此拒绝非法方案。"""
    for group in ("cap", "will"):
        group_weights = weights.get(group) or {}
        if abs(sum(float(v) for v in group_weights.values()) - 100.0) > tolerance:
            return False
    return True
