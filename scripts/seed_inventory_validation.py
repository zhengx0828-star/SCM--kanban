# -*- coding: utf-8 -*-
"""库存信号塔：验证数据种子（幂等，可重跑）。

用法：
    runtime/python/python.exe scripts/seed_inventory_validation.py            # upsert 8 行验证数据（不清除已存在的）
    runtime/python/python.exe scripts/seed_inventory_validation.py --clear   # 先清空 inventory 全部再导入

数据说明（真实项目 + 真实物料 PN + 真实城市名作基地占位；数字为验证各预警形态而设，
供页面截图复核与公式核对；正式使用请以 Excel 导入替换真实数据）：
  1. LFP3·结构胶A   常州   断货（第 10 天期末=0，红链）
  2. LFP3·模组侧板  常州   不可逆断货（LT15 > 覆盖天数）
  3. EP1·模组端板   重庆   过剩积压（30 天消耗不完 → 蓝）
  4. EP1·结构胶B    重庆   正常稳健（DOH≈25）
  5. EP1·环氧板     宁波   高波动（历史 COV ≥ 0.8）
  6. LFP3·发泡胶支架 苏州   黄灯带（DOH 7.5 ∈ [7, 8.75)）
  7. PW1·发泡胶支架 东莞   数据不足（历史仅 1 个月 → COV NA）
  8. PW1·自冲铆钉   青岛   短提前期快速断货（不可逆）
"""

import os
import sys
import tempfile
from datetime import date, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import openpyxl  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import InventoryDay, InventoryPlan  # noqa: E402
from app.routers.inventory import import_inventory  # noqa: E402

CLEAR = "--clear" in sys.argv

# 历史需求：今天往前推 6 个月的月份 key；未来预测：本月 + 下月（摊日均，必须覆盖 30 天窗口）
today = date.today()
hist_months = []
d = today.replace(day=1)
for _ in range(6):
    hist_months.append(f"{d.year:04d}-{d.month:02d}")
    d = (d - timedelta(days=1)).replace(day=1)
hist_months.reverse()
fcast_months = []
d = today.replace(day=1)
for _ in range(2):
    fcast_months.append(f"{d.year:04d}-{d.month:02d}")
    d = (d + timedelta(days=32)).replace(day=1)

# hist 值按目标 COV 分档设计；未来预测日均 ≈100/天（09 月 3000，10 月 3100）
H = lambda *qs: list(zip(hist_months, qs))  # noqa: E731
F = lambda m9, m10: [(fcast_months[0], m9), (fcast_months[1], m10)]  # noqa: E731

ROWS = [
    # project, base, pn, lt, on_hand, hist6, fcast  (pn 需真实存在)
    ("SSD222", "常州", "150200-00137", 7, 900, H(1500, 1550, 1480, 1520, 1500, 1560), F(3000, 3100)),     # 1 断货 day10
    ("SSD222", "常州", "510404-00220", 15, 400, H(1500, 1550, 1480, 1520, 1500, 1560), F(3000, 3100)),    # 2 不可逆断货
    ("DVSF132", "重庆", "510302-00537", 7, 5000, H(1500, 1550, 1480, 1520, 1500, 1560), F(2400, 2480)),   # 3 过剩（日均≈80）
    ("DVSF132", "重庆", "150200-00138", 7, 2600, H(1500, 1550, 1480, 1520, 1500, 1560), F(3000, 3100)),   # 4 正常（DOH≈25）
    ("DVSF132", "宁波", "581601-00046", 10, 800, H(100, 900, 50, 1200, 80, 1100), F(3000, 3100)),         # 5 高波动
    ("SSD222", "苏州", "570954-00071", 7, 850, H(1200, 2500, 900, 2800, 800, 2600), F(3000, 3100)),       # 6 黄灯带（中波动）
    ("SOCK124", "东莞", "570954-00092", 7, 1000, [(hist_months[-1], 1500)], F(3000, 3100)),                 # 7 数据不足（1 个月）
    ("SOCK124", "青岛", "270200-00031", 3, 300, H(1500, 1550, 1480, 1520, 1500, 1560), F(3600, 3720)),    # 8 快速断货（日均≈120）
]


def build_xlsx(path: str) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    header = ["项目代码", "基地", "物料PN", "采购LeadTime(天)", "初始现有库存"]
    header += [f"历史需求_{m}" for m in hist_months]
    header += [f"未来预测_{m}" for m in fcast_months]
    ws.append(header)
    for project, base, pn, lt, on_hand, hist, fcast in ROWS:
        hist_map = dict(hist)
        fcast_map = dict(fcast)
        row = [project, base, pn, lt, on_hand]
        row += [hist_map.get(m) for m in hist_months]     # 缺月留空（如仅 1 个历史月）
        row += [fcast_map.get(m) for m in fcast_months]
        ws.append(row)
    wb.save(path)


def main() -> None:
    db = SessionLocal()
    if CLEAR:
        for x in db.query(InventoryDay).all():
            db.delete(x)
        for x in db.query(InventoryPlan).all():
            db.delete(x)
        db.commit()
        print("已清空 inventory_plans / inventory_days")

    tmp = os.path.join(tempfile.gettempdir(), "inv_seed.xlsx")
    build_xlsx(tmp)
    res = import_inventory(file_path=tmp, db=db)
    db.close()
    print(f"导入完成：新增 {res.imported}，更新 {res.updated}，错误 {len(res.errors)}")
    for e in res.errors:
        print("  !", e)
    print("验证形态：1 断货 / 2 不可逆断货 / 3 过剩蓝 / 4 正常 / 5 高波动 / 6 黄灯 / 7 数据不足 / 8 快速断货")
    print("（正式使用请以真实 Excel 重新导入覆盖；--clear 可一键清空）")


if __name__ == "__main__":
    main()
