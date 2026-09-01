"""后端 API 冒烟测试：验证完整 CRUD 流程（本地开发自检用，非 pytest）。

运行方式（在 backend/ 目录下）：
    python scripts/smoke_test.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

# 每次运行使用唯一 SKU，保证测试幂等（软删除后历史数据不会与新数据冲突）
TEST_SKU = f"TEST-SKU-{int(time.time())}"

PASSED: list[str] = []


def check(name: str, condition: bool, extra: str = "") -> None:
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name} {extra}")
    if condition:
        PASSED.append(name)
    else:
        raise SystemExit(f"SMOKE TEST FAILED at: {name}")


def main() -> None:
    with TestClient(app) as client:
        # 1. Swagger 文档
        check("GET /docs 返回 Swagger 页面", client.get("/docs").status_code == 200)

        # 2. 健康检查
        r = client.get("/api/health")
        check("GET /api/health", r.status_code == 200 and r.json()["status"] == "ok")

        # 3. 分页列表（项目不写种子数据，验证结构正确性即可）
        r = client.get("/api/products", params={"page": 1, "page_size": 10})
        body = r.json()
        expect_pages = max(1, -(-body["total"] // 10)) if body["total"] > 0 else 0
        check(
            "GET /api/products 分页结构正确",
            r.status_code == 200
            and len(body["items"]) <= body["page_size"]
            and body["total_pages"] == expect_pages
            and (body["total"] == 0 or body["total"] >= len(body["items"])),
            f"total={body['total']}",
        )

        # 4. 关键字搜索（命中项名称必含关键字；空库时仅验证接口可用）
        r = client.get("/api/products", params={"keyword": "测试产品"})
        names = [item["name"] for item in r.json()["items"]]
        check(
            "GET /api/products?keyword= 命中模糊搜索",
            r.status_code == 200 and all("测试产品" in n for n in names),
            f"命中 {len(names)} 条",
        )

        # 5. 状态过滤（空库时 items 为空也视为通过，非空时逐项校验）
        r = client.get("/api/products", params={"status": "archived"})
        items = r.json()["items"]
        check(
            "GET /api/products?status=archived 过滤生效",
            r.status_code == 200 and all(item["status"] == "archived" for item in items),
            f"{len(items)} 条",
        )

        # 6. 新增
        r = client.post("/api/products", json={"name": "测试产品 A", "sku": TEST_SKU, "price": 99.5, "stock": 7})
        check(
            "POST /api/products 创建成功(201)",
            r.status_code == 201 and r.json()["sku"] == TEST_SKU,
            f"id={r.json()['id']}",
        )
        created_id = r.json()["id"]

        # 7. SKU 唯一性冲突
        r = client.post("/api/products", json={"name": "重复 SKU", "sku": TEST_SKU, "price": 1.0})
        check("POST 重复 SKU 返回 409", r.status_code == 409)

        # 8. 按 ID 查询
        r = client.get(f"/api/products/{created_id}")
        check("GET /api/products/{id}", r.status_code == 200 and r.json()["name"] == "测试产品 A")

        # 9. 查询不存在的 ID
        check("GET 不存在的 ID 返回 404", client.get("/api/products/999999").status_code == 404)

        # 10. 部分更新（PATCH）
        r = client.patch(f"/api/products/{created_id}", json={"price": 129.0, "status": "inactive"})
        check(
            "PATCH /api/products/{id} 部分更新",
            r.status_code == 200 and r.json()["price"] == 129.0 and r.json()["status"] == "inactive",
        )

        # 11. 全量更新（PUT）
        r = client.put(
            f"/api/products/{created_id}",
            json={"name": "测试产品 A-改", "sku": TEST_SKU, "price": 199.0, "stock": 15, "status": "active"},
        )
        check(
            "PUT /api/products/{id} 全量更新",
            r.status_code == 200 and r.json()["name"] == "测试产品 A-改" and r.json()["stock"] == 15,
        )

        # 12. 软删除
        r = client.delete(f"/api/products/{created_id}")
        check("DELETE /api/products/{id} 返回 204", r.status_code == 204)

        # 13. 删除后列表不可见
        r = client.get("/api/products", params={"keyword": TEST_SKU})
        check("软删除后列表不返回该记录", r.json()["total"] == 0)

        # 14. 删除后按 ID 查询 404
        check("软删除后按 ID 查询返回 404", client.get(f"/api/products/{created_id}").status_code == 404)

        # 15. 软删除后 SKU 可复用（部分唯一索引，仅对未删除记录生效）
        r = client.post("/api/products", json={"name": "SKU 复用测试", "sku": TEST_SKU, "price": 10.0, "stock": 1})
        check("软删除后同 SKU 可重新创建(201)", r.status_code == 201, f"id={r.json().get('id')}")
        if r.status_code == 201:
            client.delete(f"/api/products/{r.json()['id']}")

        # 16. 分页越界处理（超出的页码返回空 items 但不报错）
        r = client.get("/api/products", params={"page": 999, "page_size": 10})
        check("超大页码返回空列表且 200", r.status_code == 200 and r.json()["items"] == [])

        # 17. 请求体校验（Pydantic v2 422）
        r = client.post("/api/products", json={"name": "x", "sku": "S1", "price": -5})
        check("非法请求体返回 422", r.status_code == 422)

        # 18. CORS 响应头
        r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        check("CORS 允许 5173 端口", r.headers.get("access-control-allow-origin") == "http://localhost:5173")

    print(f"\n全部 {len(PASSED)} 项检查通过 ✅")


if __name__ == "__main__":
    main()
