import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { useDeleteProduct } from "@/hooks/use-products";
import { getApiErrorMessage } from "@/lib/utils";
import type { Product } from "@/types/product";

interface DeleteProductDialogProps {
  /** 待删除的产品，null 时弹窗关闭 */
  product: Product | null;
  onClose: () => void;
}

export function DeleteProductDialog({ product, onClose }: DeleteProductDialogProps) {
  const deleteMutation = useDeleteProduct();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!product) return;
    setError(null);
    deleteMutation.mutate(product.id, {
      onSuccess: () => {
        toast.success(`产品「${product.name}」已删除`);
        onClose();
      },
      onError: (err) => setError(getApiErrorMessage(err)),
    });
  };

  return (
    <AlertDialog
      open={product !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            确认删除该产品？
          </AlertDialogTitle>
          <AlertDialogDescription>
            即将删除产品「{product?.name}」（SKU: {product?.sku}）。删除为软删除，该记录将从列表隐藏，
            但数据仍保留在数据库中。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
          >
            {deleteMutation.isPending && <Loader2 className="animate-spin" />}
            {deleteMutation.isPending ? "删除中..." : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
