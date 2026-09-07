import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Boxes, Check, ChevronsUpDown, Loader2, MapPin, Search, User, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { useCreateSupplier, useSuppliers, useUpdateSupplier } from "@/hooks/use-suppliers";
import { useProjectSuppliers } from "@/hooks/use-projects";
import { CITIES } from "@/lib/cities";
import { cn, getApiErrorMessage } from "@/lib/utils";
import type { Project } from "@/types/project";

/** 供应商录入校验规则（与后端 Pydantic 约束一致） */
const supplierFormSchema = z.object({
  name: z.string().min(1, "请输入供应商名称").max(200, "名称不能超过 200 个字符"),
  code: z.string().min(1, "请输入供应商代码").max(50, "代码不能超过 50 个字符"),
  city: z.string().min(1, "请选择或输入所在城市").max(100, "城市不能超过 100 个字符"),
  longitude: z.coerce
    .number({ invalid_type_error: "请输入有效的经度" })
    .min(73, "经度需在 73~135 之间")
    .max(135, "经度需在 73~135 之间"),
  latitude: z.coerce
    .number({ invalid_type_error: "请输入有效的纬度" })
    .min(3, "纬度需在 3~54 之间")
    .max(54, "纬度需在 3~54 之间"),
  contact_person: z.string().max(100, "联系人不能超过 100 个字符").optional().or(z.literal("")),
  phone: z.string().max(50, "电话不能超过 50 个字符").optional().or(z.literal("")),
  remark: z.string().max(2000, "备注不能超过 2000 个字符").optional().or(z.literal("")),
});

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

const DEFAULT_VALUES: SupplierFormValues = {
  name: "",
  code: "",
  city: "",
  longitude: 0,
  latitude: 0,
  contact_person: "",
  phone: "",
  remark: "",
};

/** 通用内联可搜索下拉（点击外部关闭，支持"使用输入名称"） */
function InlineCombobox({
  placeholder,
  items,
  display,
  value,
  onSelect,
  onUseTyped,
  emptyHint,
  id,
}: {
  placeholder: string;
  items: { key: string; label: string; sub?: string }[];
  display: string;
  value: string;
  onSelect: (key: string) => void;
  onUseTyped: (typed: string) => void;
  emptyHint: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      // 用 closest 而非 querySelector：弹窗内可能有多个 InlineCombobox 共存，
      // querySelector 只取第一个，会误把"点击另一个的下拉项"判为外部点击 → 误关下拉 → click 事件丢失
      const target = e.target as Element | null;
      if (target && !target.closest("[data-inline-cb]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items;
    return items.filter((it) => it.label.includes(q) || (it.sub ?? "").includes(q));
  }, [query, items]);

  return (
    <div className="relative" data-inline-cb>
      <Button
        id={id}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full justify-between font-normal"
      >
        <span className={cn("truncate", !display && "text-muted-foreground")}>
          {display || placeholder}
        </span>
        <span className="ml-2 flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="清除"
              className="rounded p-0.5 hover:bg-muted"
              onClick={(e) => {
                e.stopPropagation();
                onSelect("");
                setQuery("");
                setOpen(false);
              }}
            >
              <X className="h-3.5 w-3.5 opacity-60" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </span>
      </Button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 opacity-50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "Enter" && filtered.length === 0 && query.trim()) {
                  e.preventDefault();
                  onUseTyped(query.trim());
                  setQuery("");
                  setOpen(false);
                }
              }}
              placeholder={placeholder}
              className="placeholder:text-muted-foreground flex h-8 w-full rounded-md bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              query.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    onUseTyped(query.trim());
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="font-medium">使用「{query.trim()}」</span>
                  <span className="text-xs text-muted-foreground">{emptyHint}</span>
                </button>
              ) : null
            ) : (
              filtered.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => {
                    onSelect(it.key);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    value === it.key && "bg-accent/50"
                  )}
                >
                  <Check className={cn("h-4 w-4 shrink-0", value === it.key ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.sub && <span className="shrink-0 text-xs text-muted-foreground">{it.sub}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 若传入项目，弹窗「搜索供应商」候选列表只显示该项目下已挂载的供应商（不显示全部底表） */
  project?: Pick<Project, "id" | "code" | "name"> | null;
  /** 地图取点预填：省份 + 坐标（每次打开弹窗时应用，覆盖默认空值） */
  preset?: { city: string; longitude: number; latitude: number } | null;
}

/** 供应商地图录入弹窗：录入/补全供应商主数据 + 地图字段，点位自动刷新。物料-供应商关联在「供应关系」维护。 */
export function SupplierFormDialog({ open, onOpenChange, project = null, preset = null }: SupplierFormDialogProps) {
  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();
  const { data: allSuppliers = [] } = useSuppliers();
  // 若传入了项目（Dashboard 切片场景），候选供应商限定为该项目下已挂载的
  const { data: projectSuppliers = [] } = useProjectSuppliers(project?.id ?? null);
  const candidateSuppliers = project ? projectSuppliers : allSuppliers;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // 选择"已有供应商"时记录其 id（非空表示补全而非新建）
  const [existingSupplierId, setExistingSupplierId] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const city = watch("city");
  const name = watch("name");

  /* 弹窗打开时重置（项目上下文/取点预填变化时也重置，避免跨项目串数据） */
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setExistingSupplierId(null);
    reset({
      ...DEFAULT_VALUES,
      city: preset?.city ?? "",
      longitude: preset?.longitude ?? 0,
      latitude: preset?.latitude ?? 0,
    });
  }, [open, project?.id, preset, reset]);

  const supplierItems = useMemo(
    () =>
      candidateSuppliers.map((s) => ({
        key: String(s.id),
        label: s.name,
        sub: s.code,
      })),
    [candidateSuppliers]
  );

  /** 选择已有供应商：自动带出其信息（底表供应商无坐标则留空待补全） */
  const handleSupplierPick = (key: string) => {
    if (!key) {
      setExistingSupplierId(null);
      return;
    }
    const s = candidateSuppliers.find((x) => x.id === Number(key));
    if (!s) return;
    setExistingSupplierId(s.id);
    setValue("name", s.name);
    setValue("code", s.code);
    setValue("city", s.city ?? "");
    setValue("longitude", s.longitude ?? 0);
    setValue("latitude", s.latitude ?? 0);
    setValue("contact_person", s.contact_person ?? "");
    setValue("phone", s.phone ?? "");
  };

  /** 手动输入新供应商名称 */
  const handleSupplierTyped = (typed: string) => {
    setExistingSupplierId(null);
    setValue("name", typed);
    // 自动生成代码建议（可改）—— 用全量底表的最大编号避免与已有冲突（不仅看项目内）
    const maxCode = allSuppliers.reduce((acc, s) => {
      const n = Number(s.code.replace(/\D/g, ""));
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 0);
    setValue("code", `SUP-${String(maxCode + 1).padStart(3, "0")}`);
  };

  /** 选择城市：自动带出经纬度 */
  const handleCityPick = (cname: string) => {
    setValue("city", cname, { shouldValidate: true });
    const c = CITIES.find((x) => x.name === cname);
    if (c) {
      setValue("longitude", c.longitude);
      setValue("latitude", c.latitude);
    }
  };

  const handleSuccess = (msg: string) => {
    toast.success(msg);
    onOpenChange(false);
    reset(DEFAULT_VALUES);
    setExistingSupplierId(null);
  };

  const handleSubmitValues = (values: SupplierFormValues) => {
    setSubmitError(null);
    // 场景 A：选择已有供应商 → 补全地图字段（PATCH）
    if (existingSupplierId != null) {
      updateMutation.mutate(
        {
          id: existingSupplierId,
          data: {
            city: values.city,
            longitude: values.longitude,
            latitude: values.latitude,
            contact_person: values.contact_person || undefined,
            phone: values.phone || undefined,
            remark: values.remark || undefined,
          },
        },
        {
          onSuccess: () => handleSuccess("已补全地图字段，点位已更新"),
          onError: (err) => setSubmitError(getApiErrorMessage(err)),
        }
      );
      return;
    }
    // 场景 B：新建供应商主数据（地图字段一并录入）
    createMutation.mutate(
      {
        code: values.code,
        name: values.name,
        city: values.city,
        longitude: values.longitude,
        latitude: values.latitude,
        contact_person: values.contact_person || undefined,
        phone: values.phone || undefined,
        remark: values.remark || undefined,
      },
      {
        onSuccess: () => handleSuccess("供应商已录入主数据，点位已显示"),
        onError: (err) => setSubmitError(getApiErrorMessage(err)),
      }
    );
  };

  const cityKnown = useMemo(() => CITIES.some((c) => c.name === city), [city]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>录入供应商</DialogTitle>
          <DialogDescription>
            {project
              ? `已限定为「${project.code} · ${project.name}」项目下供应商；新建的供应商需在「供应商列表」为该项目挂上供应关系后才会出现在地图上。`
              : "录入/补全供应商主数据与地图点位；物料-供应商关联在「供应商列表 · 供应关系」中维护。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleSubmitValues)} className="space-y-4">
          {/* 供应商名称 + 代码 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-2">
              <Label>
                供应商 <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {existingSupplierId != null
                    ? "已从列表摘取（仅补全）"
                    : project
                      ? `从项目「${project.code}」下供应商中摘取或输入新名称`
                      : "搜索摘取或输入新名称"}
                </span>
              </Label>
              <InlineCombobox
                id="supplier-name"
                placeholder={
                  project
                    ? `搜索项目「${project.code}」下供应商…`
                    : "搜索供应商名称 / 代码…"
                }
                items={supplierItems}
                display={name}
                value={existingSupplierId != null ? String(existingSupplierId) : ""}
                onSelect={handleSupplierPick}
                onUseTyped={handleSupplierTyped}
                emptyHint={project ? "项目内未找到，将作为新供应商录入（需在「供应商列表」挂到该项目）" : "将作为新供应商录入（需填写代码）"}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-code">
                供应商代码 <span className="text-red-500">*</span>
              </Label>
              <Input id="supplier-code" placeholder="SUP-001" {...register("code")} />
              {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
            </div>
          </div>

          {existingSupplierId != null && (
            <>
              <p className="flex items-center gap-1.5 rounded-md bg-accent/60 px-3 py-2 text-xs text-accent-foreground">
                <User className="h-3.5 w-3.5 shrink-0" />
                该供应商已在主数据底表中：提交后仅补全地图字段（城市/经纬度等），点位将显示在地图上。
              </p>
              {/* 已关联物料（PN · 名称）—— 从 L2 供应关系带出，弹窗只展示，不在此维护 */}
              {(() => {
                const existing = candidateSuppliers.find((x) => x.id === existingSupplierId);
                const mats = existing?.materials ?? [];
                if (mats.length === 0) {
                  return (
                    <p className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                      <Boxes className="h-3.5 w-3.5 shrink-0" />
                      该供应商当前未关联任何物料（去「供应商列表」供应关系 Tab 挂载）
                    </p>
                  );
                }
                return (
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Boxes className="h-3.5 w-3.5 shrink-0" />
                      已关联物料（PN · 名称），共 {mats.length} 种
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {mats.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center rounded-md border bg-background px-2 py-0.5 text-xs"
                        >
                          <span className="font-mono text-[11px]">{m.pn}</span>
                          <span className="mx-1 text-muted-foreground">·</span>
                          <span>{m.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* 所在省份：可搜索下拉（全国 34 个省级行政区）+ 手动输入 */}
          <div className="space-y-2">
            <Label htmlFor="supplier-city">
              所在省份 <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-muted-foreground">选择后自动带出省会/中心坐标</span>
            </Label>
            <InlineCombobox
              id="supplier-city"
              placeholder="输入省份名搜索或选择…"
              items={CITIES.map((c) => ({ key: c.name, label: c.name, sub: `${c.longitude}, ${c.latitude}` }))}
              display={city}
              value={city}
              onSelect={handleCityPick}
              onUseTyped={(v) => setValue("city", v, { shouldValidate: true })}
              emptyHint="不在预设列表，需手动填写下方经纬度"
            />
            {errors.city && <p className="text-xs text-red-500">{errors.city.message}</p>}
            {city && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                {preset?.longitude != null && preset?.latitude != null
                  ? "已由地图取点定位，坐标已填好（可在下方微调）"
                  : cityKnown
                    ? "已自动带出坐标（可手动微调）"
                    : `「${city}」不在预设列表，请手动填写经纬度`}
              </p>
            )}
          </div>

          {/* 经纬度 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="supplier-lng">经度</Label>
              <Input id="supplier-lng" type="number" step="0.0001" placeholder="73~135" {...register("longitude")} />
              {errors.longitude && <p className="text-xs text-red-500">{errors.longitude.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-lat">纬度</Label>
              <Input id="supplier-lat" type="number" step="0.0001" placeholder="3~54" {...register("latitude")} />
              {errors.latitude && <p className="text-xs text-red-500">{errors.latitude.message}</p>}
            </div>
          </div>

          {/* 联系人 */}
          <div className="space-y-2">
            <Label htmlFor="supplier-contact">联系人</Label>
            <Input id="supplier-contact" placeholder="选填" {...register("contact_person")} />
          </div>

          {/* 电话 / 备注 */}
          <div className="space-y-2">
            <Label htmlFor="supplier-phone">联系电话</Label>
            <Input id="supplier-phone" placeholder="选填" {...register("phone")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-remark">备注</Label>
            <Textarea id="supplier-remark" rows={2} placeholder="选填，如独供说明、认证状态等" {...register("remark")} />
          </div>

          {submitError && (
            <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existingSupplierId != null ? "确认补全" : "提交录入"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
