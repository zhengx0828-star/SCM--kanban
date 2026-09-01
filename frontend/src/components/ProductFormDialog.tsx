import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { useCreateProduct, useUpdateProduct } from "@/hooks/use-products";
import { getApiErrorMessage } from "@/lib/utils";
import type { Product, ProductStatus } from "@/types/product";

/** 前端校验规则（Zod），与后端 Pydantic 约束保持一致 */
const productFormSchema = z.object({
  name: z
    .string()
    .min(1, "请输入产品名称")
    .max(200, "名称不能超过 200 个字符"),
  sku: z
    .string()
    .min(1, "请输入 SKU")
    .max(64, "SKU 不能超过 64 个字符"),
  category: z.string().max(100, "分类不能超过 100 个字符").optional().or(z.literal("")),
  price: z.coerce
    .number({ invalid_type_error: "请输入有效的价格" })
    .min(0, "价格不能小于 0")
    .max(1_000_000_000, "价格超出允许范围"),
  stock: z.coerce
    .number({ invalid_type_error: "请输入有效的库存" })
    .int("库存必须为整数")
    .min(0, "库存不能小于 0"),
  status: z.enum(["active", "inactive", "archived"]),
  description: z.string().max(2000, "描述不能超过 2000 个字符").optional().or(z.literal("")),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

const STATUS_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: "active", label: "上架" },
  { value: "inactive", label: "下架" },
  { value: "archived", label: "归档" },
];

const DEFAULT_VALUES: ProductFormValues = {
  name: "",
  sku: "",
  category: "",
  price: 0,
  stock: 0,
  status: "active",
  description: "",
};

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入产品则为编辑模式，否则为新增模式 */
  product: Product | null;
}

export function ProductFormDialog({ open, onOpenChange, product }: ProductFormDialogProps) {
  const isEdit = product !== null;
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  /* 弹窗打开时根据模式重置表单 */
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    reset(
      product
        ? {
            name: product.name,
            sku: product.sku,
            category: product.category ?? "",
            price: product.price,
            stock: product.stock,
            status: product.status,
            description: product.description ?? "",
          }
        : DEFAULT_VALUES
    );
  }, [open, product, reset]);

  const handleSuccess = () => {
    toast.success(isEdit ? "产品已更新" : "产品已创建");
    onOpenChange(false);
    reset(DEFAULT_VALUES);
  };

  const handleSubmitValues = (values: ProductFormValues) => {
    setSubmitError(null);
    const payload = {
      name: values.name,
      sku: values.sku,
      price: values.price,
      stock: values.stock,
      status: values.status,
      category: values.category || undefined,
      description: values.description || undefined,
    };
    if (isEdit && product) {
      updateMutation.mutate(
        { id: product.id, data: payload },
        { onSuccess: handleSuccess, onError: (err) => setSubmitError(getApiErrorMessage(err)) }
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: handleSuccess,
        onError: (err) => setSubmitError(getApiErrorMessage(err)),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑产品 #${product?.id}` : "新增产品"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "修改产品信息，保存后列表将自动刷新。"
              : "填写产品基本信息，标 * 为必填项。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleSubmitValues)} className="space-y-4" noValidate>
          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">
                产品名称 <span className="text-destructive">*</span>
              </Label>
              <Input id="name" placeholder="如：无线蓝牙降噪耳机" {...register("name")} />
              {errors.name && <p className="text-xs font-medium text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sku">
                SKU <span className="text-destructive">*</span>
              </Label>
              <Input id="sku" placeholder="如：SKU-1001" {...register("sku")} />
              {errors.sku && <p className="text-xs font-medium text-destructive">{errors.sku.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">分类</Label>
              <Input id="category" placeholder="如：数码配件" {...register("category")} />
              {errors.category && (
                <p className="text-xs font-medium text-destructive">{errors.category.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">状态</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">
                价格（¥） <span className="text-destructive">*</span>
              </Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...register("price")}
              />
              {errors.price && (
                <p className="text-xs font-medium text-destructive">{errors.price.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock">
                库存 <span className="text-destructive">*</span>
              </Label>
              <Input id="stock" type="number" step="1" min="0" placeholder="0" {...register("stock")} />
              {errors.stock && (
                <p className="text-xs font-medium text-destructive">{errors.stock.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">产品描述</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="选填，简要描述产品特点"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs font-medium text-destructive">{errors.description.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {isSubmitting ? "保存中..." : isEdit ? "保存修改" : "创建产品"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
