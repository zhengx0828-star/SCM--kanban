import type { AlertItem, AlertSource } from "@/types/alert";

/**
 * 预警条目 → 目标板块的深链（**唯一**的路由映射入口）。
 *
 * 后端只返回结构化 `ref`，不返回 URL —— 后端一旦拼路由就耦合了前端路由表，
 * 改一个 query 参数名要动 Python。所有映射集中在这个函数里。
 *
 * 各板块已支持的参数（改名前先核对）：
 *   /supply-demand  project, pn
 *   /inventory      project, bucket, pn, sup, base, sort, q, plan
 *   /changes        project, risk(overdue/near/late/done), q, page
 *   /share          project_id, month, risk(sole/fluctuation/deviation/mismatch)
 */
export function buildAlertLink(it: AlertItem): string {
  const pid = it.ref.project_id;
  const pn = it.ref.pn ? encodeURIComponent(it.ref.pn) : "";

  switch (it.source) {
    case "supply":
      // 供需页没有 bucket 概念，落到「该项目 + 该物料」已选中的明细视图
      return `/supply-demand?project=${pid}${pn ? `&pn=${pn}` : ""}`;

    case "inventory": {
      if (it.kind === "cap_short") {
        return `/inventory?project=${pid}${pn ? `&pn=${pn}` : ""}`;
      }
      // 「已断货 + 紧急」两档一起带 —— 与 Dashboard 卡片的口径一致，否则落地行数对不上
      const bucket = it.kind === "low" ? "low" : "stockout,urgent";
      return `/inventory?project=${pid}&bucket=${bucket}${pn ? `&pn=${pn}` : ""}`;
    }

    case "change":
      return `/changes?project=${pid}&risk=${it.kind}`;

    case "share": {
      const month = it.ref.month ?? "";
      return `/share?project_id=${pid}${month ? `&month=${month}` : ""}&risk=${it.kind}`;
    }

    case "data":
    default:
      // 数据缺口（缺 BOM / 缺需求）要到供需页补录
      return `/supply-demand?project=${pid}${pn ? `&pn=${pn}` : ""}`;
  }
}

/**
 * 行尾「位置标签」：告诉老板这条归哪个板块管。
 *
 * 刻意写成**板块名**而不是动词（原来的「去处理」是命令语气，首页只给老板看，
 * 不指挥他干活）。标签与 buildAlertLink 必须同源，否则会出现
 * 「写着库存管理、点进去是供需页」的错位。
 */
export const ALERT_TARGET_LABEL: Record<AlertSource, string> = {
  supply: "供需管理",
  inventory: "库存管理",
  change: "变更管理",
  share: "份额管理",
  data: "供需管理",
};

/**
 * 热点矩阵格子 → 板块深链：按「项目 × 维度」直接落到对应页面。
 *
 * 首页没有明细列表了（2026-10-20 用户取消），所以矩阵格是唯一的「看具体内容」
 * 入口，必须带项目过滤，否则落地页会回到项目墙。
 */
export function buildProjectDimLink(projectId: number, source: AlertSource, baseMonth: string): string {
  switch (source) {
    case "inventory":
      return `/inventory?project=${projectId}`;
    case "change":
      return `/changes?project=${projectId}`;
    case "share":
      return `/share?project_id=${projectId}${baseMonth ? `&month=${baseMonth}` : ""}`;
    case "supply":
    case "data":
    default:
      return `/supply-demand?project=${projectId}`;
  }
}
