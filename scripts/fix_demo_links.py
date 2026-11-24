"""补全新物料（DB-01/E-01/BMS-01/JG-02）的项目挂载。

背景：make_demo_data.py 第 5 步只把原有 4 个物料（123/345/346/347）挂到了项目上，
新加 4 个物料只建了供应关系（产能）没有项目需求，导致供需分析组合图选它们时
totalDemand=0 被过滤成「暂无物料需求数据」。

本脚本幂等补挂：给两个项目 × 4 个新物料 × 各自供应商，建 ProjectSupplyRelation。

用量级自洽的 BOM：E-01（电芯）物理用量大但产能未对齐量级，演示按 1.0 展开，
避免出现「540 万需求 vs 40 万产能」的离谱缺口。
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app import models as m  # noqa: E402

DEMAND_LFP3 = [50012, 30123, 47123, 53001, 51023, 52141, 62135, 66932, 61241, 56891, 61823, 59141]
DEMAND_EP1 = [42000, 41000, 45000, 48000, 52000, 55000, 58000, 61000, 59000, 56000, 54000, 52000]

# 演示 BOM（E-01 电芯按 1.0 展开，量级自洽）
BOM = {"DB-01": 2.0, "E-01": 1.0, "BMS-01": 1.0, "JG-02": 1.0}


def dumps12(vals):
    return json.dumps([round(float(x), 0) for x in vals])


def main():
    db = SessionLocal()
    try:
        projects = db.query(m.Project).order_by(m.Project.id).all()
        new_materials = (
            db.query(m.Material)
            .filter(m.Material.pn.in_(list(BOM.keys())))
            .order_by(m.Material.id)
            .all()
        )
        added = 0
        skipped = 0
        for proj in projects:
            demand_src = DEMAND_LFP3 if proj.code == "ABC" else DEMAND_EP1
            for mat in new_materials:
                bom = BOM[mat.pn]
                rels = (
                    db.query(m.SupplyRelation)
                    .filter(m.SupplyRelation.material_id == mat.id)
                    .all()
                )
                for rel in rels:
                    exist = (
                        db.query(m.ProjectSupplyRelation)
                        .filter(
                            m.ProjectSupplyRelation.project_id == proj.id,
                            m.ProjectSupplyRelation.supply_relation_id == rel.id,
                        )
                        .first()
                    )
                    if exist:
                        skipped += 1
                        continue
                    factor = 0.6 + (rel.id % 4) * 0.1
                    cap_vals = (
                        [round(x * factor, 0) for x in json.loads(rel.capacity)]
                        if rel.capacity
                        else [30000] * 12
                    )
                    db.add(
                        m.ProjectSupplyRelation(
                            project_id=proj.id,
                            supply_relation_id=rel.id,
                            demand=dumps12([x * bom for x in demand_src]),
                            capacity=dumps12(cap_vals),
                            bom_factor=bom,
                        )
                    )
                    added += 1
        db.commit()
        print(f"补挂载 {added} 条，已存在跳过 {skipped} 条")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
