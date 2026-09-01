import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteSidebar } from "@/components/site/SiteSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DeleteProductDialog } from "@/components/DeleteProductDialog";
import { Pagination } from "@/components/Pagination";
import { ProductFormDialog } from "@/components/ProductFormDialog";
import { ProductTable } from "@/components/ProductTable";
import { useProducts } from "@/hooks/use-products";
import type { Product } from "@/types/product";

const PAGE_SIZE = 10;

/**
 * 产品管理页（布局移植自 shadcn/ui 官网文档站风格）：
 * 顶栏 + 左侧分组导航 + 文档式页头 / Callout / 卡片表格。
 */
export default function ProductsPage() {
  /* 查询状态 */
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchText, setSearchText] = useState("");
  const [status, setStatus] = useState("");

  /* 弹窗状态 */
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  const params = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      keyword: keyword || undefined,
      status: status || undefined,
    }),
    [page, keyword, status]
  );

  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } =
    useProducts(params);

  /* 删除或筛选后若当前页超出总页数，自动回退到最后一页 */
  useEffect(() => {
    if (data && data.total_pages > 0 && page > data.total_pages) {
      setPage(data.total_pages);
    }
  }, [data, page]);

  const handleSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setKeyword(searchText.trim());
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatus(value === "all" ? "" : value);
    setPage(1);
  };

  const openCreate = () => {
    setEditingProduct(null);
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setFormOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto flex w-full max-w-[1400px]">
        <SiteSidebar />

        <main className="min-w-0 flex-1 px-6 py-10 sm:px-8">
          <div className="mx-auto max-w-5xl">
            {/* 页头（文档站风格） */}
            <section id="overview" className="scroll-mt-20">
              <h1 className="text-4xl font-semibold tracking-tight">产品管理</h1>
              <p className="mt-2 text-muted-foreground">
                管理产品列表、价格与库存信息，支持关键字搜索、状态筛选、分页与增删改。
              </p>
            </section>

            {/* Callout（移植官网推荐提示条） */}
            <div className="my-6 rounded-lg border border-emerald-600 bg-emerald-100 px-4 py-3 text-sm leading-relaxed text-emerald-900 dark:border-emerald-400 dark:bg-emerald-900 dark:text-emerald-100">
              <strong>提示：</strong> 页面 UI 移植自 shadcn/ui 官网风格。数据存储在本地 SQLite（
              <code className="font-mono">backend/products.db</code>
              ），删除该文件后重启即可重置演示数据。
            </div>

            {/* 产品列表区块 */}
            <section id="products" className="scroll-mt-20">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">产品列表</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    共 {data?.total ?? 0} 条记录，每页 {PAGE_SIZE} 条。
                  </p>
                </div>
                <Button onClick={openCreate}>
                  <Plus />
                  新增产品
                </Button>
              </div>

              {/* 工具栏：搜索 / 状态筛选 / 刷新 */}
              <div className="mt-4 mb-4 flex flex-wrap items-center gap-3">
                <form onSubmit={handleSearch} className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="搜索名称 / SKU / 分类"
                      className="w-64 pl-8"
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    搜索
                  </Button>
                </form>

                <Select
                  value={status === "" ? "all" : status}
                  onValueChange={handleStatusChange}
                >
                  <SelectTrigger className="w-32" aria-label="按状态筛选">
                    <SelectValue placeholder="全部状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="active">上架</SelectItem>
                    <SelectItem value="inactive">下架</SelectItem>
                    <SelectItem value="archived">归档</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="icon"
                  title="刷新"
                  onClick={() => refetch()}
                  disabled={isFetching && !isLoading}
                >
                  <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                </Button>
              </div>

              {/* 表格卡片（官网 Card 风格：圆角 + 细描边） */}
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <ProductTable
                  data={data}
                  isLoading={isLoading}
                  isPlaceholderData={isPlaceholderData}
                  isError={isError}
                  error={error}
                  onRetry={() => refetch()}
                  onEdit={openEdit}
                  onDelete={setDeletingProduct}
                />
                <Pagination
                  page={page}
                  totalPages={data?.total_pages ?? 1}
                  total={data?.total ?? 0}
                  onPageChange={setPage}
                />
              </div>
            </section>
          </div>
        </main>
      </div>

      {/* 新增 / 编辑弹窗 */}
      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editingProduct}
      />

      {/* 删除二次确认弹窗 */}
      <DeleteProductDialog product={deletingProduct} onClose={() => setDeletingProduct(null)} />
    </div>
  );
}
