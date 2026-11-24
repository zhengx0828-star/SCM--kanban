-- ============================================================================
-- SCM 供应链看板 · OceanBase(MySQL 模式) 建表脚本
--
-- 目标库：见文件末尾「执行方式」；表名前缀：无。
-- 字符集：utf8mb4（中文 + emoji 安全）；引擎：InnoDB（需要外键与事务）。
-- 由 scripts/gen_mysql_schema.py 从 backend/app/models.py 生成，改模型后重跑。
--
-- 与 SQLite 版的三处必要差异：
--   1. products.sku_active / project_demand_versions.current_project_id 是生成列，
--      用来替代 SQLite 的「部分唯一索引」（MySQL 不支持 WHERE 条件索引）。
--   2. 时间默认值统一 CURRENT_TIMESTAMP（OceanBase 不认 DEFAULT (now())）。
--   3. FLOAT → DOUBLE，避免份额 / 评分的尾数抖动。
-- ============================================================================

SET NAMES utf8mb4;


-- ---------------------------------------------------------------------------
-- base_sites  base_sites
-- ---------------------------------------------------------------------------
CREATE TABLE base_sites (
	id INT NOT NULL AUTO_INCREMENT, 
	code VARCHAR(32) NOT NULL COMMENT '基地编码（唯一）', 
	name VARCHAR(100) NOT NULL COMMENT '基地名称', 
	city VARCHAR(100) COMMENT '所在城市', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE UNIQUE INDEX ix_base_sites_code ON base_sites (code);
CREATE INDEX ix_base_sites_name ON base_sites (name);

-- ---------------------------------------------------------------------------
-- change_types  change_types
-- ---------------------------------------------------------------------------
CREATE TABLE change_types (
	id INT NOT NULL AUTO_INCREMENT, 
	name VARCHAR(100) NOT NULL COMMENT '类型名（如 供应商切换 / 设计变更 / 成本优化）', 
	sort_order INT NOT NULL COMMENT '排序（升序）', 
	is_active BOOL NOT NULL COMMENT '启用标记；停用而非删除', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_change_types_name ON change_types (name);

-- ---------------------------------------------------------------------------
-- materials  materials
-- ---------------------------------------------------------------------------
CREATE TABLE materials (
	id INT NOT NULL AUTO_INCREMENT, 
	pn VARCHAR(64) NOT NULL COMMENT '物料 PN（唯一）', 
	name VARCHAR(200) NOT NULL COMMENT '物料名称', 
	category VARCHAR(100) COMMENT '物料分类', 
	segment VARCHAR(32) COMMENT '工艺段（模组/电芯…，一个物料只属于一个段）', 
	spec VARCHAR(200) COMMENT '规格型号', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_materials_category ON materials (category);
CREATE INDEX ix_materials_name ON materials (name);
CREATE UNIQUE INDEX ix_materials_pn ON materials (pn);
CREATE INDEX ix_materials_segment ON materials (segment);

-- ---------------------------------------------------------------------------
-- products  products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
	id INT NOT NULL AUTO_INCREMENT, 
	name VARCHAR(200) NOT NULL COMMENT '产品名称', 
	sku VARCHAR(64) NOT NULL COMMENT 'SKU 编码（唯一性见部分索引）', 
	description TEXT COMMENT '产品描述', 
	price DOUBLE NOT NULL COMMENT '销售价格', 
	stock INT NOT NULL COMMENT '库存数量', 
	category VARCHAR(100) COMMENT '产品分类', 
	status VARCHAR(20) NOT NULL COMMENT '状态: active/inactive/archived', 
	is_deleted BOOL NOT NULL COMMENT '软删除标记', 
	sku_active VARCHAR(64) GENERATED ALWAYS AS (IF(is_deleted = 0, sku, NULL)) STORED COMMENT '生成列（MySQL 专用）：替代部分唯一索引', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_products_category ON products (category);
CREATE INDEX ix_products_is_deleted ON products (is_deleted);
CREATE INDEX ix_products_name ON products (name);
CREATE UNIQUE INDEX uq_products_sku_active ON products (sku_active);

-- ---------------------------------------------------------------------------
-- projects  projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
	id INT NOT NULL AUTO_INCREMENT, 
	code VARCHAR(50) NOT NULL COMMENT '项目代码（唯一）', 
	name VARCHAR(200) NOT NULL COMMENT '项目名称', 
	status VARCHAR(20) NOT NULL COMMENT '状态: active/planning/closed', 
	owner VARCHAR(100) COMMENT '项目负责人', 
	description TEXT COMMENT '项目描述', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	UNIQUE (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_projects_name ON projects (name);

-- ---------------------------------------------------------------------------
-- rules  rules
-- ---------------------------------------------------------------------------
CREATE TABLE rules (
	id INT NOT NULL AUTO_INCREMENT, 
	module VARCHAR(50) NOT NULL COMMENT '所属模块（项目/物料/供应商/供应关系/Excel导入/通用...）', 
	title VARCHAR(200) NOT NULL COMMENT '规则标题', 
	content TEXT NOT NULL COMMENT '规则正文（支持换行）', 
	sort_order INT NOT NULL COMMENT '排序（同 module 内升序）', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_rules_module ON rules (module);

-- ---------------------------------------------------------------------------
-- supplier_segment_configs  supplier_segment_configs
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_segment_configs (
	id INT NOT NULL AUTO_INCREMENT, 
	threshold DOUBLE NOT NULL COMMENT '象限十字线阈值（两维共用）', 
	weights TEXT COMMENT '权重 JSON：{cap:{a1:25,...}, will:{...}}', 
	preset VARCHAR(16) NOT NULL COMMENT 'business 业务权重 / equal 等权', 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- suppliers  suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
	id INT NOT NULL AUTO_INCREMENT, 
	code VARCHAR(50) NOT NULL COMMENT '供应商代码（主数据唯一标识）', 
	name VARCHAR(200) NOT NULL COMMENT '供应商名称', 
	city VARCHAR(100) COMMENT '所在城市', 
	longitude DOUBLE COMMENT '经度（WGS84）', 
	latitude DOUBLE COMMENT '纬度（WGS84）', 
	contact_person VARCHAR(100) COMMENT '联系人', 
	phone VARCHAR(50) COMMENT '联系电话', 
	supply_material VARCHAR(200) COMMENT '主要供应物料（冗余文本）', 
	risk_level VARCHAR(10) COMMENT '风险等级: red/yellow/green，NULL=未评估', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	UNIQUE (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_suppliers_city ON suppliers (city);
CREATE INDEX ix_suppliers_name ON suppliers (name);

-- ---------------------------------------------------------------------------
-- changes  changes
-- ---------------------------------------------------------------------------
CREATE TABLE changes (
	id INT NOT NULL AUTO_INCREMENT COMMENT '序号（不做 CHG-xxxx 单号）', 
	project_id INT NOT NULL, 
	material_id INT NOT NULL, 
	change_type_id INT NOT NULL, 
	supplier_id INT COMMENT '涉及的供应商（可选）', 
	title VARCHAR(200) NOT NULL COMMENT '变更标题', 
	description TEXT COMMENT '变更内容', 
	owner VARCHAR(100) COMMENT '总责任人（自由文本，任务未填时继承它）', 
	status VARCHAR(20) NOT NULL COMMENT 'active 进行中 / done 已完成 / voided 已作废', 
	plan_start DATE COMMENT '计划开始（由叶子任务汇总，冗余）', 
	plan_end DATE COMMENT '计划结束（由叶子任务汇总，冗余；预警依据）', 
	completed_at DATETIME COMMENT '实际完成时刻（自动写入，用于算整单迟交天数）', 
	archived_at DATETIME COMMENT '归档时刻（NULL = 未归档；归档后只读）', 
	is_removed BOOL NOT NULL COMMENT '软删除标记', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(material_id) REFERENCES materials (id) ON DELETE CASCADE, 
	FOREIGN KEY(change_type_id) REFERENCES change_types (id), 
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_changes_archived_at ON changes (archived_at);
CREATE INDEX ix_changes_change_type_id ON changes (change_type_id);
CREATE INDEX ix_changes_is_removed ON changes (is_removed);
CREATE INDEX ix_changes_material_id ON changes (material_id);
CREATE INDEX ix_changes_plan_end ON changes (plan_end);
CREATE INDEX ix_changes_project_id ON changes (project_id);
CREATE INDEX ix_changes_status ON changes (status);
CREATE INDEX ix_changes_supplier_id ON changes (supplier_id);

-- ---------------------------------------------------------------------------
-- inventory_plans  inventory_plans
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_plans (
	id INT NOT NULL AUTO_INCREMENT, 
	project_id INT NOT NULL, 
	material_id INT NOT NULL, 
	supplier_id INT NOT NULL, 
	base_id INT NOT NULL, 
	lead_time_days DOUBLE NOT NULL COMMENT '采购提前期（天），参与安全库存与不可逆断货判定', 
	on_hand DOUBLE NOT NULL COMMENT '初始现有库存（推算窗口 T0 期初）', 
	hist_json TEXT COMMENT '历史需求 JSON：[{m:''YYYY-MM'', q:数量}, ...]（算 COV；为空则改用底表客户需求）', 
	fcast_json TEXT COMMENT '未来预测需求 JSON：[{m:''YYYY-MM'', q:月度总量}, ...]（摊日均；为空则改用 客户需求×BOM 系数）', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_inventory_link UNIQUE (project_id, material_id, supplier_id, base_id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(material_id) REFERENCES materials (id) ON DELETE CASCADE, 
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE, 
	FOREIGN KEY(base_id) REFERENCES base_sites (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_inventory_plans_base_id ON inventory_plans (base_id);
CREATE INDEX ix_inventory_plans_material_id ON inventory_plans (material_id);
CREATE INDEX ix_inventory_plans_project_id ON inventory_plans (project_id);
CREATE INDEX ix_inventory_plans_supplier_id ON inventory_plans (supplier_id);

-- ---------------------------------------------------------------------------
-- project_demand_versions  project_demand_versions
-- ---------------------------------------------------------------------------
CREATE TABLE project_demand_versions (
	id INT NOT NULL AUTO_INCREMENT, 
	project_id INT NOT NULL, 
	seq INT NOT NULL COMMENT '项目内自增序号（排序 / 取上一版一律用它）', 
	version_no VARCHAR(32) NOT NULL COMMENT '展示用版本号，如 1.0 / 2.0（可人工改）', 
	label VARCHAR(200) COMMENT '版本说明，如「客户 10 月调产」', 
	demand TEXT COMMENT '客户需求快照（1-12月 JSON 数组）', 
	source VARCHAR(16) NOT NULL COMMENT '来源: manual/excel', 
	effective_date DATE COMMENT '生效日期', 
	is_current BOOL NOT NULL COMMENT '当前版标记（同项目至多一条为真）', 
	current_project_id INT GENERATED ALWAYS AS (IF(is_current = 1, project_id, NULL)) STORED COMMENT '生成列（MySQL 专用）：替代部分唯一索引', 
	note TEXT COMMENT '备注', 
	created_by VARCHAR(64) COMMENT '录入人（无登录体系，纯文本留痕）', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_demand_version_project_seq UNIQUE (project_id, seq), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_project_demand_versions_project_id ON project_demand_versions (project_id);
CREATE UNIQUE INDEX uq_demand_version_current ON project_demand_versions (current_project_id);

-- ---------------------------------------------------------------------------
-- supplier_cards  supplier_cards
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_cards (
	id INT NOT NULL AUTO_INCREMENT, 
	supplier_id INT NOT NULL, 
	card VARCHAR(10) NOT NULL COMMENT 'red / yellow', 
	reason TEXT NOT NULL COMMENT '打牌原因（必填）', 
	effective_from DATE NOT NULL COMMENT '生效日', 
	effective_to DATE COMMENT 'NULL = 仍在生效', 
	created_by VARCHAR(64) COMMENT '打牌人', 
	released_by VARCHAR(64) COMMENT '解牌人', 
	released_at DATETIME COMMENT '解牌时刻', 
	release_reason TEXT COMMENT '解牌原因', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_supplier_cards_active ON supplier_cards (supplier_id, effective_to);
CREATE INDEX ix_supplier_cards_effective_from ON supplier_cards (effective_from);
CREATE INDEX ix_supplier_cards_effective_to ON supplier_cards (effective_to);
CREATE INDEX ix_supplier_cards_supplier_id ON supplier_cards (supplier_id);

-- ---------------------------------------------------------------------------
-- supplier_segments  supplier_segments
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_segments (
	id INT NOT NULL AUTO_INCREMENT, 
	period VARCHAR(7) NOT NULL COMMENT '期间 YYYY-MM', 
	material_id INT NOT NULL, 
	supplier_id INT NOT NULL, 
	tier_a1 DOUBLE COMMENT 'PN 质量绩效档', 
	tier_a2 DOUBLE COMMENT '交付达成率档', 
	tier_a3 DOUBLE COMMENT '合格率档', 
	tier_a4 DOUBLE COMMENT '成本档', 
	tier_a5 DOUBLE COMMENT 'CFT 飞行稽查档', 
	tier_a6 DOUBLE COMMENT '供应商质量服务分档', 
	tier_w1 DOUBLE COMMENT '降价意愿档', 
	tier_w2 DOUBLE COMMENT '建库意愿档', 
	tier_w3 DOUBLE COMMENT '紧急交付意愿档', 
	tier_w4 DOUBLE COMMENT '沟通态度档', 
	tier_w5 DOUBLE COMMENT '回复及时率档', 
	tier_w6 DOUBLE COMMENT '产能弹性档', 
	cap_score DOUBLE COMMENT '能力分 0-100；维度未评时 NULL', 
	will_score DOUBLE COMMENT '意愿分 0-100；维度未评时 NULL', 
	quadrant VARCHAR(16) NOT NULL COMMENT 'partner/dependent/nurture/exit/incomplete', 
	card_snapshot VARCHAR(10) COMMENT '写入时生效的牌：red/yellow/NULL', 
	cap_filled INT NOT NULL COMMENT '能力项实际填写数（与牌无关）', 
	will_filled INT NOT NULL COMMENT '意愿项实际填写数（与牌无关）', 
	weight_snapshot TEXT COMMENT '写入时的权重 JSON', 
	formula_version VARCHAR(8) NOT NULL COMMENT '打分公式版本', 
	evaluator VARCHAR(64) COMMENT '打分人（无登录体系，纯文本留痕）', 
	evaluated_on DATE COMMENT '打分日期', 
	note TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_segment_period_material_supplier UNIQUE (period, material_id, supplier_id), 
	FOREIGN KEY(material_id) REFERENCES materials (id) ON DELETE CASCADE, 
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_supplier_segments_material_id ON supplier_segments (material_id);
CREATE INDEX ix_supplier_segments_period ON supplier_segments (period);
CREATE INDEX ix_supplier_segments_quadrant ON supplier_segments (quadrant);
CREATE INDEX ix_supplier_segments_supplier_id ON supplier_segments (supplier_id);

-- ---------------------------------------------------------------------------
-- supply_relations  supply_relations
-- ---------------------------------------------------------------------------
CREATE TABLE supply_relations (
	id INT NOT NULL AUTO_INCREMENT, 
	material_id INT NOT NULL, 
	supplier_id INT NOT NULL, 
	capacity TEXT COMMENT '供应商总产能（1-12月 JSON 数组；物料×供应商级，全项目共用总量）', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_supply_relation_material_supplier UNIQUE (material_id, supplier_id), 
	FOREIGN KEY(material_id) REFERENCES materials (id) ON DELETE CASCADE, 
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_supply_relations_material_id ON supply_relations (material_id);
CREATE INDEX ix_supply_relations_supplier_id ON supply_relations (supplier_id);

-- ---------------------------------------------------------------------------
-- change_archives  change_archives
-- ---------------------------------------------------------------------------
CREATE TABLE change_archives (
	id INT NOT NULL AUTO_INCREMENT, 
	scope VARCHAR(10) NOT NULL COMMENT 'project 整项目 / change 单张', 
	project_id INT NOT NULL, 
	change_id INT, 
	archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	remark TEXT COMMENT '归档说明', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(change_id) REFERENCES changes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_change_archives_change_id ON change_archives (change_id);
CREATE INDEX ix_change_archives_project_id ON change_archives (project_id);

-- ---------------------------------------------------------------------------
-- change_tasks  change_tasks
-- ---------------------------------------------------------------------------
CREATE TABLE change_tasks (
	id INT NOT NULL AUTO_INCREMENT, 
	change_id INT NOT NULL, 
	parent_id INT COMMENT 'NULL = 一级待办项', 
	level INT NOT NULL COMMENT '层级 1..5（后端按 parent.level+1 推导）', 
	seq INT NOT NULL COMMENT '同级排序（甘特图自上而下）', 
	name VARCHAR(200) NOT NULL COMMENT '任务名', 
	description TEXT COMMENT '说明', 
	owner VARCHAR(100) COMMENT '责任人（留空则继承变更单总责任人）', 
	plan_start DATE COMMENT '计划开始（叶子填真实值）', 
	plan_end DATE COMMENT '计划完成（预警依据）', 
	is_done BOOL NOT NULL COMMENT '是否完成', 
	done_at DATETIME COMMENT '完成时刻（勾选瞬间自动写；燃尽图实际线唯一来源）', 
	is_removed BOOL NOT NULL COMMENT '软删除标记', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	FOREIGN KEY(change_id) REFERENCES changes (id) ON DELETE CASCADE, 
	FOREIGN KEY(parent_id) REFERENCES change_tasks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_change_tasks_change_id ON change_tasks (change_id);
CREATE INDEX ix_change_tasks_is_done ON change_tasks (is_done);
CREATE INDEX ix_change_tasks_is_removed ON change_tasks (is_removed);
CREATE INDEX ix_change_tasks_parent_id ON change_tasks (parent_id);
CREATE INDEX ix_change_tasks_plan_end ON change_tasks (plan_end);

-- ---------------------------------------------------------------------------
-- inventory_days  inventory_days
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_days (
	id INT NOT NULL AUTO_INCREMENT, 
	plan_id INT NOT NULL, 
	date DATE NOT NULL COMMENT '自然日（窗口随今天滚动，手工修正按日钉住）', 
	demand_override DOUBLE COMMENT '系统预测需求覆盖值（改过系统预测格才落库）', 
	manual_demand DOUBLE NOT NULL COMMENT '手工修正需求', 
	manual_in DOUBLE NOT NULL COMMENT '手工修正入库', 
	ending_override DOUBLE COMMENT '期末库存覆盖（直接改过期末格才落库）', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_inventory_plan_date UNIQUE (plan_id, date), 
	FOREIGN KEY(plan_id) REFERENCES inventory_plans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_inventory_days_date ON inventory_days (date);
CREATE INDEX ix_inventory_days_plan_id ON inventory_days (plan_id);

-- ---------------------------------------------------------------------------
-- project_supply_relations  project_supply_relations
-- ---------------------------------------------------------------------------
CREATE TABLE project_supply_relations (
	id INT NOT NULL AUTO_INCREMENT, 
	project_id INT NOT NULL, 
	supply_relation_id INT NOT NULL, 
	`role` VARCHAR(50) COMMENT '该项目下的供应商角色（主供/备选/认证中/指定等）', 
	is_primary BOOL NOT NULL COMMENT '是否主供', 
	unit_price DOUBLE COMMENT '该项目下采购单价', 
	quota VARCHAR(50) COMMENT '分配配额（如 60%/40%）', 
	lead_time VARCHAR(50) COMMENT '标准交付周期', 
	valid_from DATE COMMENT '有效期起', 
	valid_to DATE COMMENT '有效期止', 
	demand TEXT COMMENT '客户需求（1-12月 JSON 数组；物料行冗余，同项目同物料各行一致）', 
	capacity TEXT COMMENT '供应商产能（1-12月 JSON 数组；供应商级）', 
	bom_factor DOUBLE COMMENT 'BOM 用量系数（1 台产品需多少个该物料；项目×物料，单一值全年通用）', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_project_supply_relation UNIQUE (project_id, supply_relation_id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(supply_relation_id) REFERENCES supply_relations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_project_supply_relations_project_id ON project_supply_relations (project_id);
CREATE INDEX ix_project_supply_relations_role ON project_supply_relations (`role`);
CREATE INDEX ix_project_supply_relations_supply_relation_id ON project_supply_relations (supply_relation_id);

-- ---------------------------------------------------------------------------
-- share_records  share_records
-- ---------------------------------------------------------------------------
CREATE TABLE share_records (
	id INT NOT NULL AUTO_INCREMENT, 
	project_id INT NOT NULL COMMENT '所属项目（份额为项目级数据）', 
	supply_relation_id INT NOT NULL, 
	month VARCHAR(7) NOT NULL COMMENT '月份快照（YYYY-MM）', 
	share_current DOUBLE COMMENT '本月系统份额（%）', 
	share_prev DOUBLE COMMENT '上期份额（%），rollover 带入', 
	quota_prev DOUBLE COMMENT '上月建议配额（%），用于建议偏差', 
	quota_suggested DOUBLE COMMENT '下月建议配额（%）= 计算配额四舍五入', 
	is_sole BOOL NOT NULL COMMENT '独供：同项目同物料仅 1 家供应商', 
	q_score DOUBLE COMMENT '质量评分（五档：1/0.7/0.5/0.3/0）', 
	d_score DOUBLE COMMENT '交付评分（五档）', 
	c_score DOUBLE COMMENT '成本评分（五档）', 
	weighted_score DOUBLE COMMENT '加权分 = Q·wQ + D·wD + C·wC', 
	weight_scheme VARCHAR(10) COMMENT '生效权重方案: cost/quality', 
	bases TEXT COMMENT '基地快照 JSON：[{base, share, lines}]（每条记录自含拉线数，1-4 个基地）', 
	edited_manually BOOL NOT NULL COMMENT '手动修改标记（导入保护）', 
	remark TEXT COMMENT '备注', 
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_share_project_relation_month UNIQUE (project_id, supply_relation_id, month), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(supply_relation_id) REFERENCES supply_relations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX ix_share_records_month ON share_records (month);
CREATE INDEX ix_share_records_project_id ON share_records (project_id);
CREATE INDEX ix_share_records_supply_relation_id ON share_records (supply_relation_id);

-- ============================================================================
-- 执行方式
--   mysql -h nd-test-dbcloud.catlbattery.com -P 2883 -u <用户> -p '<密码>' \
--         --default-character-set=utf8mb4 -D 'mtm-online' < schema.sql
-- 或一次性建库（若允许）：
--   CREATE DATABASE IF NOT EXISTS `scm_kanban` DEFAULT CHARSET utf8mb4;
--
-- 若 OceanBase 版本不支持 STORED 生成列（报 1064/1235）：
--   删掉两条生成列与对应 UNIQUE KEY，改由应用层保证（写版本时先清旧 current）。
-- ============================================================================

