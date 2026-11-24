# MySQL / OceanBase 存储切换

应用默认用 SQLite（`backend/products.db`）。配了 MySQL 连接信息就整库切过去，**不需要改代码**：
`backend/app/database.py` 读环境变量决定 DSN，模型按后端自动选「部分唯一索引」还是「生成列」。

## 一、需要提供的信息

| 项 | 示例（你给的那台） | 说明 |
| --- | --- | --- |
| 主机 | `<ob-host>` | JDBC 里 `//` 到 `:` 之间 |
| 端口 | `2883` | OceanBase 走 obproxy，不是 3306 |
| 库名 | `mtm-online` | JDBC 里端口后那段（去掉 `?` 参数） |
| 用户名 | `<user>`？ | 见下方★ |
| 密码 | `<password>`？ | 见下方★ |
| 权限 | `CREATE / INSERT / UPDATE / DELETE / INDEX / REFERENCES` | 建表 + 外键需要 |
| 表落在哪个库 | `mtm-online` 还是新建 `scm_kanban` | 19 张表，无前缀 |

★ JDBC 串 / 凭据中心给出的往往是 `命名空间:应用:字段` 这种**路径**，真正要填的只有最后一段。
若登录报 `Access denied`，按下面三种写法依次试：

```
<user>                      # 裸用户名
<user>@<tenant>             # 带租户（OB Cloud 常见）
<user>@<tenant>#<cluster>   # 带租户 + 集群（自建 obproxy）
```

## 二、建表（19 张表 + 54 个索引）

两种方式，任选一种，**不要都跑**（第二种见已有表会跳过，安全）：

```bash
# 方式 A：包内脚本（容器里没有 mysql 客户端也能用）
python backend/init_mysql.py --host <ob-host> --port 2883 \
    --user <user> --password '***' --database mtm-online --schema-only

# 方式 B：有 mysql 客户端时直接灌 SQL
mysql -h <ob-host> -P 2883 -u <user> -p \
      --default-character-set=utf8mb4 -D 'mtm-online' < sql/schema-mysql.sql
```

`schema-mysql.sql` 由 `scripts/gen_mysql_schema.py` 从 ORM 模型生成，改模型后重跑，别手改。

## 三、搬现有数据（可选）

```bash
python backend/init_mysql.py --host ... --user ... --database mtm-online \
    --sqlite backend/products.db
```

- 目标表非空时**跳过该表**并打印原因，不覆盖；
- 要清空重来加 `--reset --yes`（按外键倒序 DELETE 这 19 张表，不动库里其他表）；
- 按外键顺序插入，主数据在前。

## 四、让应用跑在 MySQL 上

```bash
# 整体 DSN
export SCM_DB_URL='mysql+pymysql://<user>:<password>@<ob-host>:2883/mtm-online?charset=utf8mb4'

# 或拆开写（密码里的 @ # / ? 会被自动编码）
export SCM_MYSQL_HOST=<ob-host>
export SCM_MYSQL_PORT=2883
export SCM_MYSQL_USER=<user>
export SCM_MYSQL_PASSWORD='<password>'
export SCM_MYSQL_DB=mtm-online

sh start.sh     # [3/4] 会打印「数据库：MySQL/OceanBase ...」
```

## 五、与 SQLite 版的差异（已处理，不用管）

| 差异 | SQLite | MySQL / OceanBase | 处理 |
| --- | --- | --- | --- |
| 部分唯一索引 | `WHERE is_deleted=0` | 不支持条件索引 | 生成列 `sku_active` + 唯一键 |
| 同上（需求版本） | `WHERE is_current=1` | 同上 | 生成列 `current_project_id` + 唯一键 |
| 时间默认值 | `CURRENT_TIMESTAMP` | 不认 `DEFAULT (now())` | 统一 `CURRENT_TIMESTAMP` |
| 浮点 | `FLOAT` | 尾数会抖 | 统一 `DOUBLE` |
| 迁移脚本 | `PRAGMA` / `sqlite_master` | 语法不兼容 | `run_migrations()` 非 sqlite 直接返回空 |
| 外键强制 | 需 `PRAGMA foreign_keys=ON` | InnoDB 自带 | 已分支 |

## 六、注意

1. 表名不带前缀，直接落在指定库里；`mtm-online` 若与现有大屏表共存，建议单独建
   `scm_kanban` 库，避免 `rules`、`changes` 这类通用表名撞车。
2. `utf8mb4_general_ci`：`LIKE` 大小写不敏感（与 SQLite 一致），但 `=` 也不敏感 ——
   物料 PN / 供应商代码若存在仅大小写不同的两条，会被判重。
3. 连接池已开 `pool_pre_ping` + `pool_recycle=1800`，OB 掐空闲连接不会报
   `MySQL server has gone away`。
