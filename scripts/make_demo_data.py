"""造演示数据脚本 —— 只作用于 demo 库（backend/products-demo.db），真实库不碰。

用法（在项目根目录）：
    .workbuddy/binaries/python/envs/scmkanban/Scripts/python.exe scripts/make_demo_data.py

数据目标：
  1. 补齐现有 6 个供应商的 城市/经纬度/风险等级（地图点位）；
  2. 追加 8 个有真实感名字的供应商（含经纬度 + 风险等级）；
  3. 追加 4 个物料 + 供应关系（含 12 个月产能）；
  4. 追加项目挂载 + 需求/产能/bom，让 BBC/EP1 项目也有供需数据。
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEMO_DB = os.path.join(ROOT, "backend", "products-demo.db")

# ★ 必须在 import database 之前设置，database.py 在 import 时读 SCM_DB_PATH
os.environ["SCM_DB_PATH"] = DEMO_DB
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app import models as m  # noqa: E402

# 城市经纬度（WGS84，近似省/市中心）
CITY = {
    "宁波": (121.55, 29.88), "苏州": (120.58, 31.30), "东莞": (113.75, 23.02),
    "西安": (108.94, 34.34), "武汉": (114.30, 30.59), "长沙": (112.94, 28.23),
    "重庆": (106.55, 29.56), "南京": (118.80, 32.06), "成都": (104.07, 30.57),
    "上海": (121.47, 31.23), "青岛": (120.38, 36.07), "郑州": (113.63, 34.75),
    "天津": (117.20, 39.08), "深圳": (114.06, 22.55),
}

# 现有供应商 id -> (城市, 风险等级)（红=高风险 / 黄=中风险 / 绿=正常 / None=未评估）
EXISTING = {
    1: ("宁波", "red"),
    2: ("苏州", "green"),
    3: ("东莞", "green"),
    4: ("西安", "yellow"),
    5: ("武汉", "red"),
    6: ("长沙", None),
}

# 追加供应商 (code, name, city, risk)
NEW_SUPPLIERS = [
    ("S007", "重庆渝美精密", "重庆", "yellow"),
    ("S008", "江宁徽中电子", "南京", "red"),
    ("S009", "成都天工智造", "成都", "green"),
    ("S010", "上海芯联科技", "上海", "green"),
    ("S011", "青岛海德精密", "青岛", None),
    ("S012", "郑州中原电子", "郑州", "green"),
    ("S013", "天津北方精工", "天津", "yellow"),
    ("S014", "深圳赛格电子", "深圳", "red"),
]

# 追加物料 (pn, name, segment, category)
NEW_MATERIALS = [
    ("DB-01", "端板", "模组", "结构件"),
    ("E-01", "电芯", "电芯", "电芯"),
    ("BMS-01", "BMS主控板", "模组", "电子件"),
    ("JG-02", "下箱体", "模组", "结构件"),
]

# 追加供应关系：pn -> [供应商 code]，配 12 个月产能（供应商级总盘子）
NEW_RELATIONS = {
    "DB-01": [("S007", [41000, 39000, 42000, 40000, 38000, 37000, 40000, 42000, 41000, 43000, 42000, 44000]),
              ("S008", [20000, 18000, 21000, 19000, 20000, 22000, 21000, 20000, 19000, 21000, 20000, 22000])],
    "E-01": [("S009", [220000, 210000, 215000, 225000, 230000, 220000, 210000, 205000, 225000, 230000, 220000, 225000]),
             ("S010", [180000, 175000, 185000, 190000, 185000, 180000, 175000, 170000, 185000, 190000, 185000, 190000])],
    "BMS-01": [("S012", [38000, 36000, 37000, 39000, 38000, 37000, 39000, 40000, 38000, 39000, 40000, 39000]),
               ("S014", [26000, 24000, 25000, 27000, 26000, 25000, 26000, 27000, 26000, 27000, 28000, 27000])],
    "JG-02": [("S011", [34000, 32000, 33000, 35000, 34000, 33000, 34000, 35000, 34000, 35000, 36000, 35000]),
              ("S013", [21000, 20000, 20500, 22000, 21000, 20500, 21000, 22000, 21000, 22000, 22500, 22000])],
}

# 两个项目的 12 个月客户需求（LFP3 沿用已有；EP1 造一份不同节奏的）
DEMAND_LFP3 = [50012, 30123, 47123, 53001, 51023, 52141, 62135, 66932, 61241, 56891, 61823, 59141]
DEMAND_EP1 = [42000, 41000, 45000, 48000, 52000, 55000, 58000, 61000, 59000, 56000, 54000, 52000]

# 物料 BOM 系数（1 台产品需多少个该物料）
BOM = {
    "123": 1.0, "345": 1.0, "346": 1.0, "347": 1.0,
    "DB-01": 2.0, "E-01": 108.0, "BMS-01": 1.0, "JG-02": 1.0,
}


def dumps12(vals):
    return json.dumps([float(x) for x in vals])


def main():
    db = SessionLocal()
    try:
        # ---- 1. 补齐现有供应商的 城市/经纬度/风险 ----
        for sid, (city, risk) in EXISTING.items():
            s = db.get(m.Supplier, sid)
            if not s:
                continue
            lng, lat = CITY[city]
            s.city = city
            s.longitude = lng
            s.latitude = lat
            s.risk_level = risk
        print(f"[1] 补齐现有供应商 {len(EXISTING)} 个")

        # ---- 2. 追加新供应商 ----
        added_suppliers = 0
        for code, name, city, risk in NEW_SUPPLIERS:
            if db.query(m.Supplier).filter(m.Supplier.code == code).first():
                continue
            lng, lat = CITY[city]
            db.add(m.Supplier(code=code, name=name, city=city,
                              longitude=lng, latitude=lat, risk_level=risk))
            added_suppliers += 1
        print(f"[2] 追加供应商 {added_suppliers} 个")

        # ---- 3. 追加新物料 ----
        added_materials = 0
        for pn, name, segment, category in NEW_MATERIALS:
            if db.query(m.Material).filter(m.Material.pn == pn).first():
                continue
            db.add(m.Material(pn=pn, name=name, segment=segment, category=category))
            added_materials += 1
        print(f"[3] 追加物料 {added_materials} 个")
        db.flush()  # 拿到新 id

        # ---- 4. 追加供应关系 + 产能 ----
        added_relations = 0
        for pn, rows in NEW_RELATIONS.items():
            mat = db.query(m.Material).filter(m.Material.pn == pn).first()
            for code, cap in rows:
                sup = db.query(m.Supplier).filter(m.Supplier.code == code).first()
                if not mat or not sup:
                    continue
                exist = db.query(m.SupplyRelation).filter(
                    m.SupplyRelation.material_id == mat.id,
                    m.SupplyRelation.supplier_id == sup.id,
                ).first()
                if exist:
                    if exist.capacity is None:
                        exist.capacity = dumps12(cap)
                    continue
                db.add(m.SupplyRelation(material_id=mat.id, supplier_id=sup.id,
                                        capacity=dumps12(cap)))
                added_relations += 1
        print(f"[4] 追加供应关系 {added_relations} 条")

        # ---- 5. 给两个项目挂载所有物料的供应关系 + 需求/产能/bom ----
        # 需求 = 客户需求 × bom；产能 = 该供应商分给项目的额度（这里直接复用总盘子打折扣）
        projects = db.query(m.Project).order_by(m.Project.id).all()
        all_materials = db.query(m.Material).order_by(m.Material.id).all()
        added_links = 0
        for proj in projects:
            demand_src = DEMAND_LFP3 if proj.code == "ABC" else DEMAND_EP1
            for mat in all_materials:
                bom = BOM.get(mat.pn, 1.0)
                rels = db.query(m.SupplyRelation).filter(
                    m.SupplyRelation.material_id == mat.id).all()
                for rel in rels:
                    exist = db.query(m.ProjectSupplyRelation).filter(
                        m.ProjectSupplyRelation.project_id == proj.id,
                        m.ProjectSupplyRelation.supply_relation_id == rel.id,
                    ).first()
                    if exist:
                        continue
                    # 供应商分给该项目的额度 = 总盘子 × (0.6~0.9)
                    factor = 0.6 + (rel.id % 4) * 0.1
                    cap_json = rel.capacity
                    if cap_json:
                        cap_vals = [round(x * factor, 0) for x in json.loads(cap_json)]
                    else:
                        cap_vals = [30000] * 12
                    db.add(m.ProjectSupplyRelation(
                        project_id=proj.id, supply_relation_id=rel.id,
                        demand=dumps12([round(x * bom, 0) for x in demand_src]),
                        capacity=dumps12(cap_vals),
                        bom_factor=bom,
                    ))
                    added_links += 1
        print(f"[5] 追加项目挂载 {added_links} 条")

        # ---- 6. 给 BBC/EP1 补需求版本 V1.0（当前版） ----
        ep1 = db.query(m.Project).filter(m.Project.code == "BBC").first()
        if ep1:
            has_ver = db.query(m.ProjectDemandVersion).filter(
                m.ProjectDemandVersion.project_id == ep1.id).first()
            if not has_ver:
                db.add(m.ProjectDemandVersion(
                    project_id=ep1.id, seq=1, version_no="1.0",
                    label="演示 · 手工录入", demand=dumps12(DEMAND_EP1),
                    source="manual", is_current=True,
                ))
                print("[6] 给 EP1 补需求版本 V1.0")
            else:
                print("[6] EP1 已有需求版本，跳过")

        db.commit()
        print("完成，demo 库已就绪")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
