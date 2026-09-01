import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectApi } from "../lib/api";
import type {
  ProjectBomUpdateInput,
  ProjectCreateInput,
  ProjectDemandUpdateInput,
  ProjectListParams,
  ProjectSupplyRelationCreateInput,
  ProjectSupplyRelationQuickCreateInput,
  ProjectSupplyRelationUpdateInput,
  ProjectUpdateInput,
} from "../types/project";

export const projectKeys = {
  all: ["projects"] as const,
  list: (params: ProjectListParams) => ["projects", "list", params] as const,
  relations: (projectId: number) => ["projects", "relations", projectId] as const,
  suppliers: (projectId: number) => ["projects", "suppliers", projectId] as const,
};

/** 分页查询项目 */
export function useProjects(params: ProjectListParams) {
  return useQuery({
    queryKey: projectKeys.list(params),
    queryFn: () => projectApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** 新增项目 */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectCreateInput) => projectApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

/** 更新项目 */
export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProjectUpdateInput }) => projectApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

/** 删除项目 */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => projectApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

/** 项目下的供应明细 */
export function useProjectRelations(projectId: number | null) {
  return useQuery({
    queryKey: projectKeys.relations(projectId ?? -1),
    queryFn: () => projectApi.relations(projectId!),
    enabled: projectId != null,
  });
}

/** 项目下关联的供应商（去重，含地图点位字段，Dashboard 地图切片用）
 *
 * 失效键为 ["projects"] / ["suppliers"] 前缀，与供应商列表页增删改联动刷新。
 */
export function useProjectSuppliers(projectId: number | null) {
  return useQuery({
    queryKey: projectKeys.suppliers(projectId ?? -1),
    queryFn: () => projectApi.suppliers(projectId!),
    enabled: projectId != null,
  });
}

/** 项目下关联的物料（按 PN 去重，供需管理等模块的物料选择器用） */
export function useProjectMaterials(projectId: number | null) {
  return useQuery({
    queryKey: ["projects", "materials", projectId ?? -1],
    queryFn: () => projectApi.materials(projectId!),
    enabled: projectId != null,
  });
}

/** 挂载供应关系到项目 */
export function useLinkProjectRelation(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectSupplyRelationCreateInput) => projectApi.link(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.relations(projectId ?? -1) });
      queryClient.invalidateQueries({ queryKey: ["supply-relations"] });
    },
  });
}

/** 更新项目供应明细 */
export function useUpdateProjectRelation(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, data }: { linkId: number; data: ProjectSupplyRelationUpdateInput }) =>
      projectApi.updateRelation(projectId!, linkId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.relations(projectId ?? -1) });
    },
  });
}

/** 批量维护某物料的客户需求（1-12月，同步到该项目下该物料所有供应明细） */
export function useUpdateProjectDemand(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectDemandUpdateInput) => projectApi.updateDemand(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.relations(projectId ?? -1) });
    },
  });
}

/** 批量维护某物料的 BOM 用量系数（项目×物料，同步到该项目下该物料所有供应明细） */
export function useUpdateProjectBom(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectBomUpdateInput) => projectApi.updateBom(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.relations(projectId ?? -1) });
    },
  });
}

/** 解除项目-供应关系 */
export function useUnlinkProjectRelation(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) => projectApi.unlink(projectId!, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.relations(projectId ?? -1) });
      queryClient.invalidateQueries({ queryKey: ["supply-relations"] });
    },
  });
}

/** 快速录入项目明细（四元组一行式，自动建主数据并挂载） */
export function useQuickAddProjectRelation(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectSupplyRelationQuickCreateInput) => projectApi.quickAdd(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.relations(projectId ?? -1) });
      queryClient.invalidateQueries({ queryKey: ["supply-relations"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}
