import { AlertTriangle, PackageOpen, Pencil, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { cn, formatDateTime, formatPrice, getApiErrorMessage } from "@/lib/utils";
import type { Product, ProductListResponse, ProductStatus } from "@/types/product";

const STATUS_META: Record<ProductStatus, { label: string; variant: "success" | "muted" | "warning" }> = {
  active: { label: "上架", variant: "success" },
  inactive: { label: "下架", variant: "muted" },
  archived: { label: "归档", variant: "warning" },
};

interface ProductTableProps {
  data: ProductListResponse | undefined;
  isLoading: boolean;
  isPlaceholderData: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

export function ProductTable({
  data,
  isLoading,
  isPlaceholderData,
  isError,
  error,
  onRetry,
  onEdit,
  onDelete,
}: ProductTableProps) {
  /* 加载失败：错误提示 + 重试 */
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <div>
          <p className="font-medium">列表加载失败</p>
          <p className="mt-1 text-sm text-muted-foreground">{getApiErrorMessage(error)}</p>
        </div>
        <Button variant="outline" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  /* 首次加载：骨架屏 */
  if (isLoading && !data) {
    return (
      <div className="p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b py-3 last:border-0">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <Table className={cn(isPlaceholderData && "opacity-60")}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">ID</TableHead>
          <TableHead>产品名称</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>分类</TableHead>
          <TableHead className="text-right">价格</TableHead>
          <TableHead className="text-right">库存</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>更新时间</TableHead>
          <TableHead className="w-28 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9} className="py-16 text-center">
              <PackageOpen className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">暂无产品数据，点击右上角「新增产品」开始创建</p>
            </TableCell>
          </TableRow>
        ) : (
          items.map((product) => (
            <TableRow key={product.id}>
              <TableCell className="font-mono text-xs text-muted-foreground">{product.id}</TableCell>
              <TableCell>
                <div className="font-medium">{product.name}</div>
                {product.description && (
                  <div className="mt-0.5 max-w-[280px] truncate text-xs text-muted-foreground">
                    {product.description}
                  </div>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">{product.sku}</TableCell>
              <TableCell>{product.category || "-"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatPrice(product.price)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  product.stock < 10 && "font-medium text-amber-600"
                )}
              >
                {product.stock}
                {product.stock < 10 && <span className="ml-1 text-xs text-amber-600">低</span>}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_META[product.status].variant}>
                  {STATUS_META[product.status].label}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(product.updated_at)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(product)}>
                    <Pencil />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(product)}
                  >
                    <Trash2 />
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
