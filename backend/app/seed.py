"""启动时写入演示数据（仅当对应表为空时执行，便于克隆后直接体验）。

数据覆盖核心业务场景：
- 同一物料多家供应商（MCU-001 华芯 + 芯联）
- 同一供应商供多种物料（华芯供 MCU-001 / MEM-001）
- 同一供应关系用于多个项目、角色不同（MEM-001×北方精仪 在项目A为备选、项目B为备选）

注意：风险等级属于业务评估结果，不在 L1 供应商主数据层；后续由项目维度等模块联动写入 project_supply_relations。
"""

from datetime import date

from .database import SessionLocal
from .models import (
    Material,
    Product,
    Project,
    ProjectSupplyRelation,
    Supplier,
    SupplyRelation,
)


def _sample_products() -> list[dict]:
    catalog = [
        ("无线蓝牙降噪耳机", "数码配件", 299.0, 120, "active"),
        ("机械键盘 87 键", "办公用品", 459.0, 80, "active"),
        ("27 寸 4K 显示器", "数码配件", 1899.0, 35, "active"),
        ("人体工学办公椅", "办公用品", 1299.0, 22, "inactive"),
        ("便携式咖啡机", "家居生活", 599.0, 60, "active"),
        ("智能手表 Pro", "数码配件", 1499.0, 45, "active"),
        ("瑜伽垫加厚款", "运动户外", 129.0, 200, "active"),
        ("露营折叠桌椅套装", "运动户外", 899.0, 18, "active"),
        ("经典文学全集", "图书音像", 268.0, 90, "active"),
        ("降噪头戴式耳机", "数码配件", 999.0, 40, "archived"),
        ("无线充电底座", "数码配件", 169.0, 150, "active"),
        ("智能空气净化器", "家居生活", 2199.0, 25, "active"),
        ("保温杯 500ml", "家居生活", 99.0, 300, "active"),
        ("蓝牙音箱 Mini", "数码配件", 199.0, 130, "active"),
        ("便携投影仪", "数码配件", 2599.0, 15, "active"),
        ("双肩电脑包", "办公用品", 329.0, 75, "active"),
        ("桌面收纳盒套装", "办公用品", 79.0, 260, "active"),
        ("跑步机家用款", "运动户外", 3299.0, 10, "inactive"),
        ("智能体重秤", "运动户外", 129.0, 180, "active"),
        ("降噪耳塞", "家居生活", 49.0, 500, "active"),
        ("专业绘图数位板", "办公用品", 899.0, 30, "active"),
        ("机械键盘 RGB 版", "数码配件", 599.0, 55, "active"),
        ("便携移动电源 20000mAh", "数码配件", 189.0, 210, "active"),
        ("高清网络摄像头", "办公用品", 249.0, 88, "active"),
    ]
    return [
        {
            "name": name,
            "sku": f"SKU-{1000 + idx:04d}",
            "price": price,
            "stock": stock,
            "category": category,
            "status": status_value,
            "description": f"{name}（示例数据，仅用于本地开发演示）",
        }
        for idx, (name, category, price, stock, status_value) in enumerate(catalog, start=1)
    ]


def seed_products() -> None:
    db = SessionLocal()
    try:
        if db.query(Product.id).limit(1).first() is not None:
            return
        for data in _sample_products():
            db.add(Product(**data))
        db.commit()
    finally:
        db.close()


def _sample_suppliers() -> list[dict]:
    """演示供应商（覆盖主要工业城市，供地图点位展示）。
    注意：风险等级红/黄/绿判定规则未定，此处仅为演示效果赋值，正式录入不带颜色（None=未评估）。"""
    catalog = [
        # (代码, 名称, 城市, 经度, 纬度, 联系人, 电话, 供应物料, 风险等级, 备注)
        ("SUP-001", "深圳市华芯电子有限公司", "深圳", 114.06, 22.55, "张伟", "138-0000-0001", "MCU 主控芯片", "red", "重点物料独供，供应风险高"),
        ("SUP-002", "苏州精工制造有限公司", "苏州", 120.58, 31.30, "李娜", "138-0000-0002", "精密结构件", "yellow", "备选供应商有限，需关注"),
        ("SUP-003", "上海芯联半导体", "上海", 121.47, 31.23, "王强", "138-0000-0003", "电源管理芯片", "red", "关键物料，排产紧张"),
        ("SUP-004", "成都天府电子", "成都", 104.07, 30.57, "刘洋", "138-0000-0004", "PCB 线路板", "green", "正常供应，多源竞争"),
        ("SUP-005", "武汉光谷光电", "武汉", 114.30, 30.59, "陈静", "138-0000-0005", "光模块", "yellow", "扩产中，交付周期变长"),
        ("SUP-006", "北京北方精仪", "北京", 116.40, 39.90, "赵磊", "138-0000-0006", "传感器", "green", "正常供应"),
        ("SUP-007", "重庆汽配先锋", "重庆", 106.55, 29.56, "孙悦", "138-0000-0007", "汽车连接器", "green", "正常供应"),
        ("SUP-008", "西安西电新能源", "西安", 108.94, 34.34, "周涛", "138-0000-0008", "储能电芯", "yellow", "新导入供应商，正在认证"),
        ("SUP-009", "青岛海工装备", "青岛", 120.38, 36.07, "吴敏", "138-0000-0009", "减速机", "red", "独家供货，需备库存"),
        ("SUP-010", "杭州云帆科技", "杭州", 120.15, 30.28, "郑凯", "138-0000-0010", "工业网关", "green", "正常供应"),
    ]
    return [
        {
            "code": code,
            "name": name,
            "city": city,
            "longitude": lng,
            "latitude": lat,
            "contact_person": contact,
            "phone": phone,
            "supply_material": material,
            "risk_level": risk,
            "remark": remark,
        }
        for code, name, city, lng, lat, contact, phone, material, risk, remark in catalog
    ]


def seed_suppliers() -> None:
    db = SessionLocal()
    try:
        if db.query(Supplier.id).limit(1).first() is not None:
            return
        for data in _sample_suppliers():
            db.add(Supplier(**data))
        db.commit()
    finally:
        db.close()


def _sample_materials() -> list[dict]:
    """演示物料主档（物料 PN 唯一）。"""
    catalog = [
        # (PN, 名称, 分类, 规格, 备注)
        ("MCU-001", "主控芯片", "电子元器件", "LQFP64 / 32位", "整机核心物料"),
        ("PWR-IC-002", "电源管理芯片", "电子元器件", "QFN32 / 5A", "关键物料，排产紧张"),
        ("PCB-001", "四层线路板", "印制板", "FR4 1.6mm", "常规采购"),
        ("SNS-001", "压力传感器", "传感器", "MEMS 数字输出", "认证周期长"),
        ("OPT-001", "光模块", "光电器件", "10G SFP+", "扩产中，交付周期变长"),
        ("CONN-001", "汽车连接器", "连接器", "HV 高压 2pin", "车规认证"),
        ("BAT-001", "储能电芯", "能源部件", "磷酸铁锂 280Ah", "新导入供应商，认证中"),
        ("MTR-001", "行星减速机", "机械部件", "减速比 1:20", "独家供货，需备库存"),
        ("GW-001", "工业网关", "通信设备", "双网口 4G", "多源采购"),
        ("MEM-001", "工业存储芯片", "电子元器件", "eMMC 32GB", "季度议价"),
    ]
    return [
        {"pn": pn, "name": name, "category": category, "spec": spec, "remark": remark}
        for pn, name, category, spec, remark in catalog
    ]


def seed_materials() -> None:
    db = SessionLocal()
    try:
        if db.query(Material.id).limit(1).first() is not None:
            return
        for data in _sample_materials():
            db.add(Material(**data))
        db.commit()
    finally:
        db.close()


def seed_projects() -> None:
    """供应关系（四元组）+ 项目 + 项目明细 演示数据。"""
    db = SessionLocal()
    try:
        if db.query(SupplyRelation.id).limit(1).first() is not None:
            return

        suppliers = {s.name: s for s in db.query(Supplier).all()}
        materials = {m.pn: m for m in db.query(Material).all()}

        # 供应关系（四元组）：pn -> [供应商名称, ...]，同一物料多家供应商自然展开
        relation_map: dict[str, list[str]] = {
            "MCU-001": ["深圳市华芯电子有限公司", "上海芯联半导体"],
            "PWR-IC-002": ["上海芯联半导体"],
            "PCB-001": ["成都天府电子", "苏州精工制造有限公司"],
            "SNS-001": ["北京北方精仪"],
            "OPT-001": ["武汉光谷光电"],
            "CONN-001": ["重庆汽配先锋", "苏州精工制造有限公司"],
            "BAT-001": ["西安西电新能源"],
            "MTR-001": ["青岛海工装备"],
            "GW-001": ["杭州云帆科技", "成都天府电子"],
            "MEM-001": ["深圳市华芯电子有限公司", "北京北方精仪"],
        }

        relation_by_key: dict[tuple[int, int], SupplyRelation] = {}
        for pn, supplier_names in relation_map.items():
            material = materials.get(pn)
            if material is None:
                continue
            for sname in supplier_names:
                supplier = suppliers.get(sname)
                if supplier is None:
                    continue
                rel = SupplyRelation(material_id=material.id, supplier_id=supplier.id)
                db.add(rel)
                db.flush()
                relation_by_key[(material.id, supplier.id)] = rel

        # 项目
        project_a = Project(code="PRJ-A", name="项目A", status="active", owner="张三", description="消费电子整机项目")
        project_b = Project(code="PRJ-B", name="项目B", status="active", owner="李四", description="工业设备项目")
        project_c = Project(code="PRJ-C", name="项目C", status="planning", owner="王五", description="储能新项目，规划中")
        db.add_all([project_a, project_b, project_c])
        db.flush()

        def rel_key(pn: str, sname: str) -> SupplyRelation:
            material = materials[pn]
            supplier = suppliers[sname]
            return relation_by_key[(material.id, supplier.id)]

        def add_link(project: Project, rel: SupplyRelation, **kwargs) -> None:
            db.add(
                ProjectSupplyRelation(
                    project_id=project.id,
                    supply_relation_id=rel.id,
                    role=kwargs.get("role"),
                    is_primary=kwargs.get("is_primary", False),
                    unit_price=kwargs.get("unit_price"),
                    quota=kwargs.get("quota"),
                    lead_time=kwargs.get("lead_time"),
                    valid_from=kwargs.get("valid_from"),
                    valid_to=kwargs.get("valid_to"),
                    remark=kwargs.get("remark"),
                )
            )

        # 项目A 明细（主供/备选/认证中混合，覆盖项目专属字段）
        add_link(project_a, rel_key("MCU-001", "深圳市华芯电子有限公司"), role="主供", is_primary=True, unit_price=3.2, quota="60%", lead_time="14 天", valid_from=date(2026, 1, 1), valid_to=date(2026, 12, 31))
        add_link(project_a, rel_key("PWR-IC-002", "上海芯联半导体"), role="主供", is_primary=True, unit_price=2.1, quota="100%", lead_time="21 天", valid_from=date(2026, 1, 1), valid_to=date(2026, 12, 31))
        add_link(project_a, rel_key("PCB-001", "成都天府电子"), role="主供", is_primary=True, unit_price=18.5, quota="70%", lead_time="10 天")
        add_link(project_a, rel_key("PCB-001", "苏州精工制造有限公司"), role="备选", unit_price=19.2, quota="30%", lead_time="12 天")
        add_link(project_a, rel_key("CONN-001", "苏州精工制造有限公司"), role="主供", is_primary=True, unit_price=1.8, lead_time="7 天")
        add_link(project_a, rel_key("BAT-001", "西安西电新能源"), role="认证中", unit_price=89.0, remark="样品测试中，未量产")
        add_link(project_a, rel_key("MEM-001", "深圳市华芯电子有限公司"), role="主供", is_primary=True, unit_price=45.0, quota="50%", lead_time="14 天")
        add_link(project_a, rel_key("MEM-001", "北京北方精仪"), role="备选", unit_price=43.5, quota="50%", lead_time="16 天")

        # 项目B 明细（MCU-001 在项目B由芯联主供 —— 展示不同项目角色不同）
        add_link(project_b, rel_key("MCU-001", "上海芯联半导体"), role="主供", is_primary=True, unit_price=3.05, quota="100%", lead_time="20 天")
        add_link(project_b, rel_key("OPT-001", "武汉光谷光电"), role="认证中", unit_price=320.0, lead_time="45 天", remark="扩产中，交付周期变长")
        add_link(project_b, rel_key("GW-001", "杭州云帆科技"), role="主供", is_primary=True, unit_price=1560.0, quota="100%", lead_time="30 天")
        add_link(project_b, rel_key("MEM-001", "北京北方精仪"), role="备选", unit_price=44.0, lead_time="16 天")

        # 项目C 明细（规划中；GW-001×天府 复用已有供应关系 —— 同一四元组用在不同项目）
        add_link(project_c, rel_key("GW-001", "成都天府电子"), role="备选", unit_price=1480.0, quota="30%", lead_time="25 天")

        db.commit()
    finally:
        db.close()
