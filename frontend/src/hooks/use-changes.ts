import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changeApi, changeTaskApi, changeTypeApi } from "../lib/api";
import type {
  ChangeCreateInput,
  ChangeListParams,
  ChangeTaskCreateInput,
  ChangeTaskUpdateInput,
  ChangeTypeCreateInput,
  ChangeTypeUpdateInput,
  ChangeUpdateInput,
} from "../types/change";

export const changeKeys = {
  all: ["changes"] as const,
  list: (params: ChangeListParams) => ["changes", "list", params] as const,
  detail: (id: number) => ["changes", "detail", id] as const,
  summary: ["changes", "summary"] as const,
  overview: (includeArchived: boolean) => ["changes", "overview", includeArchived] as const,
  alerts: (projectId?: number, level?: string) => ["changes", "alerts", projectId ?? 0, level ?? ""] as const,
  burndown: (changeId?: number, projectId?: number, includeArchived?: boolean) =>
    ["changes", "burndown", changeId ?? 0, projectId ?? 0, includeArchived ? 1 : 0] as const,
  owners: ["changes", "owners"] as const,
  archives: (projectId?: number) => ["changes", "archives", projectId ?? 0] as const,
  types: ["change", "types"] as const,
};

/* --------------------------------------------------------------- 查询 hooks */

/** 变更类型字典（全局共用） */
export function useChangeTypes(includeInactive = true) {
  return useQuery({
    queryKey: [...changeKeys.types, includeInactive],
    queryFn: () => changeTypeApi.list(includeInactive),
  });
}

/** 变更单分页列表 */
export function useChanges(params: ChangeListParams, enabled = true) {
  return useQuery({
    queryKey: changeKeys.list(params),
    queryFn: () => changeApi.list(params),
    enabled,
  });
}

/** 变更单详情（含任务树） */
export function useChangeDetail(id: number | null) {
  return useQuery({
    queryKey: changeKeys.detail(id ?? 0),
    queryFn: () => changeApi.get(id!),
    enabled: id != null,
  });
}

/** 全局统计 —— Dashboard 卡 5 与变更页页头同源 */
export function useChangeSummary() {
  return useQuery({
    queryKey: changeKeys.summary,
    queryFn: () => changeApi.summary(),
  });
}

/** 项目卡片墙（老板视角） */
export function useChangeProjectOverview(includeArchived = false) {
  return useQuery({
    queryKey: changeKeys.overview(includeArchived),
    queryFn: () => changeApi.projectOverview(includeArchived),
  });
}

/** 预警明细（按严重度排序，必带责任人） */
export function useChangeAlerts(projectId?: number, level?: string) {
  return useQuery({
    queryKey: changeKeys.alerts(projectId, level),
    queryFn: () => changeApi.alerts({ project_id: projectId, level }),
  });
}

/** 燃尽数据。
 *
 * ★ 三个参数都不传 = **全局口径**（首页整体燃尽图），后端已放开该限制。
 *   所以这里**不再**按「必须传参」来 disable，只由调用方的 `enabled` 决定。
 *   归档口径默认排除（后端处理），显式传 change_id 时会按该单原样统计。
 */
export function useChangeBurndown(
  params: { change_id?: number; project_id?: number; include_archived?: boolean } = {},
  enabled = true
) {
  return useQuery({
    queryKey: changeKeys.burndown(params.change_id, params.project_id, params.include_archived),
    queryFn: () => changeApi.burndown(params),
    enabled,
  });
}

/** 责任人候选（自由文本的"最近用过"软提示） */
export function useChangeOwners() {
  return useQuery({
    queryKey: changeKeys.owners,
    queryFn: () => changeApi.owners(),
    staleTime: 60_000,
  });
}

/** 已归档列表 */
export function useChangeArchives(projectId?: number) {
  return useQuery({
    queryKey: changeKeys.archives(projectId),
    queryFn: () => changeApi.archives(projectId),
  });
}

/** Excel 双 sheet 导入（服务器本地路径 —— 前后端同机） */
export function useImportChanges() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (file: File) => changeApi.import(file),
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------- 变更单操作 */

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: changeKeys.all });
    qc.invalidateQueries({ queryKey: changeKeys.types });
  };
}

export function useCreateChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (data: ChangeCreateInput) => changeApi.create(data),
    onSuccess: invalidate,
  });
}

export function useUpdateChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ChangeUpdateInput }) => changeApi.update(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, hard = false }: { id: number; hard?: boolean }) => changeApi.remove(id, hard),
    onSuccess: invalidate,
  });
}

/** 作废（变更中途停止执行；与"删除"是两件事） */
export function useVoidChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => changeApi.void(id),
    onSuccess: invalidate,
  });
}

export function useRestoreChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => changeApi.restore(id),
    onSuccess: invalidate,
  });
}

export function useArchiveChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, remark }: { id: number; remark?: string }) => changeApi.archive(id, remark),
    onSuccess: invalidate,
  });
}

export function useUnarchiveChange() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => changeApi.unarchive(id),
    onSuccess: invalidate,
  });
}

export function useArchiveProject() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ projectId, remark }: { projectId: number; remark?: string }) =>
      changeApi.archiveProject(projectId, remark),
    onSuccess: invalidate,
  });
}

export function useUnarchiveProject() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (projectId: number) => changeApi.unarchiveProject(projectId),
    onSuccess: invalidate,
  });
}

/* --------------------------------------------------------------- 类型维护 */

export function useCreateChangeType() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (data: ChangeTypeCreateInput) => changeTypeApi.create(data),
    onSuccess: invalidate,
  });
}

export function useUpdateChangeType() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ChangeTypeUpdateInput }) => changeTypeApi.update(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteChangeType() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => changeTypeApi.remove(id),
    onSuccess: invalidate,
  });
}

/* --------------------------------------------------------------- 任务操作 */

export function useCreateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ changeId, data }: { changeId: number; data: ChangeTaskCreateInput }) =>
      changeTaskApi.create(changeId, data),
    onSuccess: invalidate,
  });
}

export function useBatchCreateTasks() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      changeId,
      text,
      parentId,
      owner,
    }: {
      changeId: number;
      text: string;
      parentId?: number | null;
      owner?: string | null;
    }) => changeTaskApi.batch(changeId, { text, parent_id: parentId ?? null, owner: owner ?? null }),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: ChangeTaskUpdateInput }) =>
      changeTaskApi.update(taskId, data),
    onSuccess: invalidate,
  });
}

/** 勾选 / 取消勾选 —— 后端在勾选瞬间自动记 done_at（用户零录入） */
export function useToggleTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ taskId, isDone }: { taskId: number; isDone: boolean }) =>
      changeTaskApi.toggle(taskId, isDone),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (taskId: number) => changeTaskApi.remove(taskId),
    onSuccess: invalidate,
  });
}
