# SCM 供应链看板（供应链控制台）

一个前后端分离的供应链管理 Web 应用：**项目供需管理**（客户需求 / BOM / 供应商产能 / 供需平衡分析）、**份额管理**（份额 × 评分 × 风险四象限）、**供应商与物料主数据**、**全国供应商分布地图**、**SOP 规则手册**。中文界面，本地一键启动，开箱即用。

> 本 README 同时承担**迁移指南**职责：要把本项目搬到另一台电脑/环境，直接按 [「四、迁移指南」](#四迁移指南) 操作即可。

---

## 一、功能模块

| 模块 | 页面 | 说明 |
| --- | --- | --- |
| Dashboard | `/dashboard` | 汇总概览（纯 summary，只展示真实录入数据，联动份额波动 / 重点独供统计） |
| 供需管理 | `/supply-demand` | 项目级客户需求（1-12 月）、供应商产能、BOM 用量系数、供需平衡分析 |
| 项目供需明细 | `/supply-demand/projects/:projectId` | 项目下的供应明细、关联物料/供应商，录入需求 / 产能 / BOM 系数 |
| 份额管理 | `/share` | 项目维度份额概览：KPI 卡 + 风险排行 + 份额×评分四象限 + 月末结转 |
| 份额明细 | `/share/records` | 份额记录明细：手动录入 + Excel 导入 + 行内编辑 |
| 主数据 | `/materials` | 供应商 / 物料 / 供应关系 / 项目 统一管理页（含地图点位、风险等级） |
| 规则手册 | `/rules` | 项目 SOP 手册：业务规则与数据口径，按 module 分组 |

---

## 二、技术栈

**后端**（`backend/`）
- Python FastAPI（自动生成 Swagger 文档）+ uvicorn
- SQLAlchemy 2.0 ORM（`Mapped` / `mapped_column` 声明式）
- Pydantic v2（`ConfigDict(from_attributes=True)`）
- SQLite（数据库固定为 `backend/products.db`，路径基于代码文件定位，不依赖启动目录）
- openpyxl（份额管理 Excel 导入）

**前端**（`frontend/`）
- React 18 + TypeScript + Vite 5 + Tailwind CSS v4
- shadcn/ui 风格组件（radix-ui 基底）+ lucide-react 图标
- TanStack Query v5 + axios + React Router v6
- React Hook Form + Zod 表单校验
- ECharts 6（图表 + 中国地图）、next-themes（明暗主题）、sonner（toast）

**数据库模型（三层六表，核心业务模型）**
- L1 主数据：`projects` / `materials`（PN 唯一）/ `suppliers`（含 `risk_level` 地图风险等级，红/黄/绿/NULL=未评估）
- L2 供应关系：`supply_relations`（material × supplier 唯一，四元组）
- L3 项目明细：`project_supply_relations`（UNIQUE(project, supply_relation)，模块扩展字段）
- L3 份额管理：`share_records`（UNIQUE(project, supply_relation, month)，按月快照）

> 另有 `products`（历史遗留的通用 CRUD）与 `rules`（SOP 规则手册）两张辅助表。

---

## 三、环境要求

> 本项目采用**自包含运行时（portable runtime）**：Python / Node / pnpm 全部内置在项目 `runtime/` 目录，后端依赖直接装入 `runtime\python\Lib\site-packages`，**无虚拟环境、零绝对路径**，整目录拷贝即可运行，内网可用。

| 依赖 | 实际版本 | 项目内位置 |
| --- | --- | --- |
| Python | 3.13.12 | `runtime\python\`（自带 uv 0.12.8，命令 `python -m uv`） |
| 后端依赖 | — | 已装入 `runtime\python\Lib\site-packages\`（随解释器一起走） |
| Node.js | 22.20.0 | `runtime\node\`（自带 npm / npx） |
| pnpm | 11.24.0 | `runtime\node\pnpm.cmd`（**不要混用 npm**，会忽略 `pnpm-lock.yaml`） |
| 前端依赖 | — | `frontend\node_modules\` |

> 若 `runtime/` 缺失，启动脚本自动回退到系统 / `.workbuddy` 托管的 Python 与 Node（外网场景可自动重建，见 4.5）。

---

## 四、迁移指南

目标：把项目完整搬到新环境，照下面步骤操作即可。

### 4.1 复制清单（必带）

```
scm-kanban/
├── .gitignore                  # 忽略规则（runtime/ 已排除，git 方式需单独拷贝）
├── README.md                   # 本文件
├── start-all.bat               # Windows 一键启动（全相对路径，搬移后无需修改）
├── start-all.sh                # macOS / Linux 一键启动（同上）
├── runtime/                    # ★★ 内置运行时（内网必带！）
│   ├── python/                 #   Python 3.13.12 + uv + 后端依赖（site-packages）
│   └── node/                   #   Node 22.20.0 + npm + pnpm 11.24.0
├── backend/
│   ├── app/                    # ★ 全部源码（main / database / models / schemas / routers / seed）
│   ├── scripts/smoke_test.py   # API 冒烟测试
│   ├── requirements.txt        # 后端依赖清单（依赖本体在 runtime\python）
│   └── products.db             # ★ 业务数据（见 4.3 数据迁移说明）
├── frontend/
│   ├── src/                    # ★ 全部源码
│   ├── public/
│   ├── index.html
│   ├── package.json
│   ├── pnpm-lock.yaml          # 依赖锁定，保证版本一致
│   ├── pnpm-workspace.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── components.json         # shadcn 配置
│   ├── .env*（如有）
│   └── node_modules/           # ★ 前端依赖（内网必带）
├── scripts/                    # 前后端单独启动脚本 + 文档生成工具
└── docs/                       # 截图与复现提示词（可选）
```

**两种复制方式任选其一：**
- **方式 A（推荐）**：整体压缩 `scm-kanban/` 目录 → 拷贝到新环境解压。**内网场景不要排除任何目录**（尤其 `runtime/`、`node_modules/`）。
- **方式 B（git）**：`git clone` 仓库后，需**单独手动拷贝**以下内容（均已被 `.gitignore` 排除，git 不会带它们）：
  - `runtime/`（内置运行时，体积较大，建议整体压缩拷贝）
  - `backend/products.db`（业务数据，见 4.3）
  - `frontend/node_modules/`（内网依赖；外网可在新环境重建）

### 4.2 排除清单（区分外网 / 内网）

**外网环境（有网络）**：以下目录无需复制，到新环境可自动重建

| 路径 | 原因 |
| --- | --- |
| `runtime/` | 内置运行时，可按 4.5 的「国内镜像源」重新下载 |
| `frontend/node_modules/` | 前端依赖，可用 `pnpm install` 重建 |
| `frontend/dist/` | 构建产物，可随时 `pnpm build` 重建 |
| `frontend/_tmp_*` / `*.timestamp-*.mjs` | 编辑器/工具临时文件 |
| `frontend/tsconfig.tsbuildinfo` | TypeScript 增量缓存 |
| `size_report.txt` | 临时报告 |

**内网环境（无网络）**：★★★ **必须带上 `runtime/` + `node_modules/`**

内网无法下载任何东西，两者缺一不可：

```
# 正确做法（内网）：整体压缩，不要排除任何目录
scm-kanban/              ← 整目录压缩
├── runtime/             ← ★ 必须带！解释器 + 后端依赖（site-packages 内置）
├── frontend/node_modules/ ← ★ 必须带！前端依赖
└── ...其余文件
```

> 详见 `AGENT.md` 第二节「内网迁移核心注意事项」。

### 4.3 数据迁移说明（products.db）

- **保留数据**：把 `backend/products.db` 一起复制即可，业务数据（供应商/物料/项目/供应关系/份额记录/规则）原样带过去。
- **全新开始**：不复制 `products.db`，后端启动时会自动 `create_all` 重建**空表**（项目当前**不写种子数据**，留空白底表由人工录入）。
- 数据库路径写死在代码里（`backend/products.db`），与启动目录无关，放对位置即可。

### 4.4 迁移后启动

```bash
# 方式一：一键启动（推荐，零配置）
#   Windows：双击 start-all.bat
#   macOS/Linux：
./start-all.sh
# 脚本自动完成：定位 runtime → 拉起前后端 → 打开浏览器。
# 依赖已存在时自动跳过安装，内网无网也能直接启动。

# 方式二：手动分步启动（另开终端，需 runtime/ 或系统环境）
# 后端（依赖已装入 runtime\python，无需虚拟环境）
cd backend
..\runtime\python\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端
cd frontend
..\runtime\node\pnpm.cmd install
..\runtime\node\pnpm.cmd run dev --host 127.0.0.1
```

> 说明：内置 `runtime/` 缺失时，脚本/手动命令会回退系统 Python 与 Node（外网可用 4.5 重建 runtime，或用系统 `python`/`pnpm` 命令替代）。

| 地址 | 说明 |
| --- | --- |
| http://localhost:5173 | 前端页面 |
| http://localhost:8000/docs | Swagger API 文档 |
| http://localhost:8000/api/health | 健康检查 |

### 4.5 重建运行时（仅外网需要；国内镜像源）

`runtime/` 丢失时按需重建（内网不需要、也无法执行）：

| 组件 | 国内镜像下载地址 | 解压 / 安装到 |
| --- | --- | --- |
| Python 3.13.12 | `https://registry.npmmirror.com/-/binary/python/3.13.12/` | `runtime\python\` |
| Node 22.20.0 | `https://registry.npmmirror.com/-/binary/node/v22.20.0/node-v22.20.0-win-x64.zip` | `runtime\node\` |
| pnpm 11.24.0 | 用上面的 node 执行：`node.exe node_modules\npm\bin\npm-cli.js install -g pnpm@11.24.0 --registry=https://registry.npmmirror.com` | 装入 `runtime\node\` |

> npm / pip 包镜像源：npm 用 `https://registry.npmmirror.com`；pip / uv 用 `https://pypi.tuna.tsinghua.edu.cn/simple`。

### 4.6 迁移后验证

1. 浏览器打开 `http://localhost:5173`，页面正常渲染、无报错。
2. 打开 `http://localhost:8000/docs`，Swagger 可正常加载。
3. 访问 `http://localhost:8000/api/health`，返回 `{"status":"ok",...}`。
4. （可选）跑后端冒烟测试：
   ```bash
   cd backend
   ..\runtime\python\python.exe scripts\smoke_test.py
   ```

---

## 五、目录结构

```
scm-kanban/
├── start-all.bat / start-all.sh   # 一键启动器（Win / mac·Linux）
├── runtime/                       # 内置运行时（Python 3.13.12 + 后端依赖 / Node 22.20.0 + pnpm）
├── backend/                       # FastAPI 服务
│   ├── app/
│   │   ├── main.py                # 入口 + CORS + 自动建表
│   │   ├── database.py            # SQLAlchemy 引擎与会话（DB 路径固定）
│   │   ├── models.py              # 三层六表 ORM 模型（含 share_records）
│   │   ├── schemas.py             # Pydantic v2 模式
│   │   ├── routers/               # products / suppliers / materials /
│   │   │                          #   supply_relations / projects / rules / share
│   │   └── seed.py                # 演示数据（当前未启用）
│   ├── scripts/smoke_test.py      # API 冒烟测试
│   ├── requirements.txt
│   └── products.db                # SQLite 数据库（业务数据）
├── frontend/                      # React 应用
│   ├── src/
│   │   ├── pages/                 # Dashboard / SupplyDemand / ProjectSupplyDetail /
│   │   │                          #   Share / ShareRecords / SupplierMaster / Products / Rules
│   │   ├── components/            # 通用组件（MaterialDrawerFilter、EmptyState 等）
│   │   │                          #   + share/（四象限、导入、录入弹窗）
│   │   ├── hooks/                 # TanStack Query 数据层（含 use-share）
│   │   ├── lib/                   # api 封装、工具函数
│   │   └── types/                 # 类型定义（含 share）
│   └── package.json / vite.config.ts / tsconfig.json / components.json
├── scripts/                       # 前后端单独启动脚本、gen_source_docx.py
├── docs/                          # 截图、opencode-reproduce-prompt.md（AI 复现提示词）
└── README.md
```

---

## 六、API 概览（前缀 `/api`）

**供应商 suppliers**
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/suppliers` | 全部供应商（地图点位 + 主数据 + 风险等级） |
| POST | `/api/suppliers` | 新增供应商 |
| PATCH | `/api/suppliers/{id}` | 更新（补全地图字段 / 风险等级） |
| DELETE | `/api/suppliers/{id}` | 删除 |

**物料 materials**
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/materials` | 分页列表 |
| POST | `/api/materials` | 新增（PN 唯一） |
| DELETE | `/api/materials/{id}` | 删除 |

**供应关系 supply-relations**
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/supply-relations` | 分页列表 |
| GET | `/api/supply-relations/options` | 全量（下拉消费） |
| POST | `/api/supply-relations` | 新增 |
| DELETE | `/api/supply-relations/{id}` | 删除 |
| GET | `/api/supply-relations/{id}/projects` | 引用该关系的项目 |

**项目 projects**
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 分页列表 |
| POST | `/api/projects` | 新增 |
| PATCH / DELETE | `/api/projects/{id}` | 更新 / 删除 |
| GET | `/api/projects/{id}/relations` | 项目供应明细 |
| GET | `/api/projects/{id}/materials` | 关联物料（去重） |
| GET | `/api/projects/{id}/suppliers` | 关联供应商（地图切片，含点位） |
| POST | `/api/projects/{id}/relations` | 挂供应关系到项目（带项目专属字段） |
| POST | `/api/projects/{id}/relations/quick-add` | 四元组快速录入（自动建主数据并挂载） |
| PATCH | `/api/projects/{id}/relations/{link_id}` | 明细行更新（含 demand / capacity / bom_factor 等扩展字段） |
| PUT | `/api/projects/{id}/demand` | 批量维护客户需求（项目级，同步全项目明细） |
| PUT | `/api/projects/{id}/bom` | 批量维护某物料 BOM 系数（项目×物料，同步该物料各行） |
| DELETE | `/api/projects/{id}/relations/{link_id}` | 解除项目-供应关系 |

**份额管理 share**
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/share/projects` | 全部项目 + 有份额数据的月份列表 |
| GET | `/api/share/dashboard-stats` | Dashboard 联动统计（波动 / 独供，跨项目最新月） |
| GET | `/api/share/summary` | KPI 汇总（项目 × 月） |
| GET | `/api/share/risks` | 风险排行（独供 > 波动 > 偏差 > 错配） |
| GET | `/api/share/quadrant` | 份额 × 评分四象限散点 |
| GET | `/api/share/records` | 份额明细列表（支持 keyword 搜索） |
| POST | `/api/share/records` | 手动新增份额记录 |
| PUT | `/api/share/records/{id}` | 手动修改（自动重算，标记手改） |
| POST | `/api/share/import` | Excel 导入份额数据（openpyxl） |
| POST | `/api/share/rollover` | 月末结转：本月 → 下月空档 |

**规则 rules**
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rules` | 规则列表（按 module 分组、sort_order 升序） |
| POST / PATCH / DELETE | `/api/rules...` | 规则增删改 |

**产品 products**（历史遗留的通用 CRUD，保留兼容）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/products` | 分页列表（keyword/status 过滤） |
| GET | `/api/products/{id}` | 按 ID 查询 |
| POST | `/api/products` | 新增（SKU 冲突 409） |
| PUT / PATCH | `/api/products/{id}` | 全量 / 部分更新 |
| DELETE | `/api/products/{id}` | 软删除 |

---

## 七、常见问题

| 问题 | 处理 |
| --- | --- |
| 启动脚本报「未找到 npm/pnpm」 | 将 `runtime\node` 放回项目目录后重试；或安装 Node.js LTS 并加入 PATH |
| 端口 8000 / 5173 被占用 | 一键脚本会自动检测并跳过已占用服务；手动启动时换端口需同步改 vite 代理 |
| 前端请求 `/api` 失败 | 确认后端已启动；前端通过 Vite 代理访问后端，无需额外配 CORS |
| 后端报 `No module named 'fastapi'` | `runtime\python\Lib\site-packages` 缺失，用 4.5 重建 runtime 并安装依赖 |
| 数据库想重置 | 删除 `backend/products.db` 后重启，自动重建空表 |
| 系统的 `python` 命令无法使用 | 这是 Windows 应用商店占位符，请使用项目内置 `runtime\python\python.exe`。详见 `AGENT.md` |
| 内网迁移后启动失败 | 确认 `runtime/` 和 `node_modules/` 已完整拷贝。内网无法下载依赖，必须带上！详见 `AGENT.md` |
| 想用 AI 从零复现项目 | 参考 `docs/opencode-reproduce-prompt.md`，粘贴给 AI 编程助手即可 |

---

## 八、内网迁移速查

搬到内网前，确认以下清单：

- [ ] 整个 `scm-kanban/` 目录已压缩（**包含 `runtime/` 和 `node_modules/`**）
- [ ] `AGENT.md` 已一并拷贝（给内网 AI 的避坑指南）
- [ ] 内网机器无需安装任何运行时（Python / Node / pnpm 全在 `runtime/` 里）
- [ ] 无需修改 `start-all.bat` / `start-all.sh`（全相对路径）
- [ ] 解压后直接双击 `start-all.bat`（Windows）或运行 `./start-all.sh`

> 最底线保障：只要 `runtime/` 和 `node_modules/` 完整，即使内网没有任何开发工具，项目也能直接运行。
