"""供应商细分打分口径验证（免起服务、免碰正式库）。

用法：
    python scripts/verify_segments.py

只做纯函数与区间判定断言，不写任何表、不改 products.db ——
所有断言失败会以非 0 退出码返回，方便挂到提交前检查。
"""

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.models import SupplierCard  # noqa: E402  (导入不建连接，安全)
from app.routers.segments import _overlaps, _period_bounds  # noqa: E402
from app.scoring import (  # noqa: E402
    SEGMENT_WEIGHTS,
    TIERS,
    equal_weights,
    quadrant_of,
    score,
    weights_sum_ok,
)

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}" + (f"  -> {detail}" if detail else ""))


def tiers(**kwargs) -> dict:
    """构造 12 项档位字典，未给的键为 None（= 未评）。"""
    keys = ("a1", "a2", "a3", "a4", "a5", "a6", "w1", "w2", "w3", "w4", "w5", "w6")
    return {key: kwargs.get(key) for key in keys}


ALL_CAP = dict(a1=1, a2=1, a3=1, a4=1, a5=1, a6=1)
ALL_WILL = dict(w1=1, w2=1, w3=1, w4=1, w5=1, w6=1)


def main() -> int:
    print("供应商细分打分口径验证")

    # 1 满分与零分
    r = score({**ALL_CAP, **ALL_WILL})
    check("六项全 1.0 → 能力 100", r.cap == 100.0, f"cap={r.cap}")
    r0 = score(tiers(**{**{k: 0 for k in ALL_CAP}, **{k: 0 for k in ALL_WILL}}))
    check("六项全 0 → 能力 0", r0.cap == 0.0, f"cap={r0.cap}")

    # 2 全中性落 exit（严格大于）——六项全 0.5 正好 50 分
    neutral = score(tiers(**{**{k: 0.5 for k in ALL_CAP}, **{k: 0.5 for k in ALL_WILL}}))
    check("六项全 0.5 → 50 分", neutral.cap == 50.0 and neutral.will == 50.0, f"{neutral.cap}/{neutral.will}")
    check("全中性不算过关 → exit", neutral.quadrant == "exit", neutral.quadrant)

    # 3 单项 0 不翻盘：a1 打 0、其余满分 → 75 分（业务权重 a1=25%）
    one_zero = score(tiers(a1=0, a2=1, a3=1, a4=1, a5=1, a6=1, **ALL_WILL))
    check("a1=0 其余满分 → 能力 75.0", one_zero.cap == 75.0, f"cap={one_zero.cap}")
    check("单项 0 无牌时仍进 partner", one_zero.quadrant == "partner", one_zero.quadrant)

    # 4 红牌归零但不改传入档位
    payload = tiers(a1=0, a2=1, a3=1, a4=1, a5=1, a6=1, **ALL_WILL)
    snapshot = dict(payload)
    red = score(payload, card="red")
    check("红牌 → 能力 0", red.cap == 0.0, f"cap={red.cap}")
    check("红牌 → 意愿 0", red.will == 0.0, f"will={red.will}")
    check("红牌 → exit", red.quadrant == "exit", red.quadrant)
    check("红牌不改传入档位（可恢复的前提）", payload == snapshot, f"{payload}")
    check("红牌期间 filled 仍按实际填写数", red.cap_filled == 6, f"filled={red.cap_filled}")

    # 5 黄牌同样归零，只是牌色不同
    yellow = score(payload, card="yellow")
    check("黄牌同样 0/0/exit", (yellow.cap, yellow.will, yellow.quadrant) == (0.0, 0.0, "exit"))
    check("黄牌 card 字段为 yellow", yellow.card == "yellow", str(yellow.card))

    # 6 解牌后按原档位重算即恢复
    restored = score(payload, card=None)
    check("解牌后回到 75.0 / partner", restored.cap == 75.0 and restored.quadrant == "partner", f"{restored.cap}/{restored.quadrant}")

    # 7 缺 2 项：分母随已填权重收缩，不等于把缺失当 0 分
    partial = tiers(a1=1, a2=1, a3=1, a4=1, **ALL_WILL)  # a5 / a6 未评
    p = score(partial)
    check("缺 2 项 → 仍算满分（分母收缩）", p.cap == 100.0, f"cap={p.cap}")
    check("缺 2 项 ≠ 当 0 分算（85.0）", p.cap != 85.0, f"cap={p.cap}")
    check("缺 2 项 filled 记 4", p.cap_filled == 4, f"filled={p.cap_filled}")

    # 8 有效项 ≤3 → incomplete；有牌时牌优先
    too_few = score(tiers(a1=1, a2=1, a3=1, **ALL_WILL))
    check("只填 3 项 → 该维无分", too_few.cap is None, str(too_few.cap))
    check("只填 3 项 → incomplete", too_few.quadrant == "incomplete", too_few.quadrant)
    carded = score(tiers(a1=1, a2=1, a3=1, **ALL_WILL), card="red")
    check("牌优先于 incomplete → exit", carded.quadrant == "exit", carded.quadrant)

    # 9 边界：严格大于 —— 50.0 不过关，50.1 才过关
    check("cap=50.0 → exit（正好卡线不算过关）", quadrant_of(50.0, 40.0) == "exit", quadrant_of(50.0, 40.0))
    check("cap=50.1 → dependent（过线）", quadrant_of(50.1, 40.0) == "dependent", quadrant_of(50.1, 40.0))
    check("cap=50 意愿 60 → nurture（只有一维过关）", quadrant_of(50.0, 60.0) == "nurture", quadrant_of(50.0, 60.0))
    check("两维均 50 → exit", quadrant_of(50.0, 50.0) == "exit")
    check("任一维无分 → incomplete", quadrant_of(None, 60.0) == "incomplete")

    # 10 非法档位直接报错，不静默四舍五入
    for bad in (0.8, 2.5, 0.45):
        try:
            score(tiers(a1=bad, a2=1, a3=1, a4=1, a5=1, a6=1, **ALL_WILL))
            check(f"非法档位 {bad} 应报错", False)
        except ValueError:
            check(f"非法档位 {bad} 报错", True)
    check("合法档位集合为 1/0.7/0.5/0.3/0", TIERS == (0.0, 0.3, 0.5, 0.7, 1.0), str(TIERS))

    # 11 牌与月份的区间判定（不看今天，看是否重叠）
    check("月份边界：2026-02 是 28 天", _period_bounds("2026-02")[1] == date(2026, 2, 28))
    check("闰年：2026-02 非闰，2024-02 是 29 天", _period_bounds("2024-02")[1] == date(2024, 2, 29))

    card = SupplierCard(supplier_id=1, card="red", reason="质量事故", effective_from=date(2026, 10, 1), effective_to=date(2026, 11, 15))
    check("10 月的牌命中 2026-10", _overlaps(card, "2026-10"))
    check("10 月的牌命中 2026-11（解除在月中）", _overlaps(card, "2026-11"))
    check("10 月的牌不命中 2026-12", not _overlaps(card, "2026-12"))
    check("10 月的牌不命中 2026-09", not _overlaps(card, "2026-09"))

    open_card = SupplierCard(supplier_id=1, card="yellow", reason="警告", effective_from=date(2026, 10, 20), effective_to=None)
    check("未解的牌一直有效（2027-06 仍命中）", _overlaps(open_card, "2027-06"))
    check("未解的牌不影响生效前月份", not _overlaps(open_card, "2026-09"))

    # 12 权重校验
    check("业务权重两组各 100", weights_sum_ok(SEGMENT_WEIGHTS))
    check("等权两组各 100", weights_sum_ok(equal_weights()))
    broken = {"cap": {"a1": 99}, "will": dict(SEGMENT_WEIGHTS["will"])}
    check("合计 99 → 拒绝", not weights_sum_ok(broken))

    print(f"\n{PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
