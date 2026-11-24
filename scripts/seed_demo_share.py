"""补份额演示数据（2026-11 当前月）。

背景：share_records 只有项目1物料123的 09/10 月有值，11 月是 rollover 空档
（share_current=None），项目2 无份额 → 份额页四象限/风险排行/预警概览全空。

本脚本补 2026-11 当月份额：
- 填满项目1物料123的 3 条空档；
- 给项目1物料345/346/347 补独供（1 家 100%）；
- 给项目2物料123/345 补份额。
制造出四类风险：独供 / 波动（rel2 +79%）/ 偏差（rel1 |60-30|=30pt）/ 错配（346 独供但加权分 0.36<0.5）。
幂等：UNIQUE(project_id, supply_relation_id, month) 查重。
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app import models as m  # noqa: E402

MONTH = "2026-11"
WQ, WD, WC = 0.7, 0.1, 0.2  # quality 方案


def weighted(q, d, c):
    return round(q * WQ + d * WD + c * WC, 2)


def main():
    db = SessionLocal()
    try:
        proj = {x.code: x.id for x in db.query(m.Project).all()}
        # supply_relation_id -> 物料pn（用于分组判定独供）
        rel_pn = {}
        for rel in db.query(m.SupplyRelation).all():
            mat = db.get(m.Material, rel.material_id)
            rel_pn[rel.id] = mat.pn if mat else ""

        # (project_code, supply_relation_id, share, q, d, c, is_sole)
        rows = [
            # 项目1 物料123（侧板）3 家，填满空档
            ("ABC", 1, 60.0, 0.7, 1.0, 1.0, False),
            ("ABC", 2, 25.0, 1.0, 1.0, 0.7, False),
            ("ABC", 3, 15.0, 0.7, 0.7, 0.7, False),
            # 项目1 物料345/346/347 独供（1 家 100%）
            ("ABC", 4, 100.0, 0.7, 0.7, 1.0, True),
            ("ABC", 5, 100.0, 0.3, 0.5, 0.5, True),  # 错配：独供但加权分 0.36 < 0.5
            ("ABC", 6, 100.0, 0.7, 0.5, 0.7, True),
            # 项目2 物料123（侧板）3 家；rel1 份额 70 但评分 0.36<0.5 → 错配
            ("BBC", 1, 70.0, 0.3, 0.5, 0.5, False),
            ("BBC", 2, 20.0, 1.0, 1.0, 0.7, False),
            ("BBC", 3, 10.0, 0.7, 0.7, 0.7, False),
            # 项目2 物料345 独供
            ("BBC", 4, 100.0, 0.7, 0.7, 1.0, True),
        ]

        added = 0
        updated = 0
        for pcode, rel_id, share, q, d, c, sole in rows:
            pid = proj.get(pcode)
            if not pid:
                continue
            rec = (
                db.query(m.ShareRecord)
                .filter(
                    m.ShareRecord.project_id == pid,
                    m.ShareRecord.supply_relation_id == rel_id,
                    m.ShareRecord.month == MONTH,
                )
                .first()
            )
            if rec:
                rec.share_current = share
                rec.q_score = q
                rec.d_score = d
                rec.c_score = c
                rec.weighted_score = weighted(q, d, c)
                rec.weight_scheme = "quality"
                rec.is_sole = sole
                updated += 1
            else:
                db.add(
                    m.ShareRecord(
                        project_id=pid,
                        supply_relation_id=rel_id,
                        month=MONTH,
                        share_current=share,
                        q_score=q,
                        d_score=d,
                        c_score=c,
                        weighted_score=weighted(q, d, c),
                        weight_scheme="quality",
                        is_sole=sole,
                    )
                )
                added += 1
        db.commit()
        print(f"份额新增 {added} 条，更新 {updated} 条")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
