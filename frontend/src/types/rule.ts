/** 规则条目（各模块 SOP、Excel 导入规则等） */

export interface Rule {
  id: number;
  module: string;
  title: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RuleCreateInput {
  module: string;
  title: string;
  content: string;
  sort_order?: number;
}

export type RuleUpdateInput = Partial<RuleCreateInput>;

export interface RuleListResponse {
  items: Rule[];
  total: number;
}

/** 常用模块预设（可手动输入新模块）；顺序 = 页面分组顺序，先放已有规则在用的模块 */
export const MODULE_PRESETS = [
  "通用",
  "Dashboard",
  "供需管理",
  "份额管理",
  "库存管理",
  "变更管理",
  "项目",
  "物料",
  "供应商",
  "供应关系",
  "Excel 导入",
];
