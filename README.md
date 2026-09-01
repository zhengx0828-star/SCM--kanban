# SCM 供应链看板（供应链控制台）

一个前后端分离的供应链管理 Web 应用：**项目供需管理**（客户需求 / BOM / 供应商产能 / 供需平衡分析）、**份额管理**（份额 × 评分 × 风险四象限）、**供应商与物料主数据**、**全国供应商分布地图**、**SOP 规则手册**。中文界面，本地一键启动，开箱即用。

> 本项目采用**自包含运行时（portable runtime）**：Python / Node / pnpm / 后端依赖全部内置在项目 `runtime/` 目录，**无虚拟环境、零绝对路径**，整目录拷贝即可运行（含内网）。
>
> 本 README 同时承担**迁移指南 + 内网开发指南**职责：要把项目搬到内网、或在内网持续开发，直接按 [「六、迁移指南」](#六迁移指南)、[「八、网络源访问指南」](#八网络源访问指南)、[「九、双向开发与 GitHub 增量迭代」](#九双向开发与-github-增量迭代) 操作。

---

## 一、功能模块

| 模块 | 页面 | 说明 |
| --- | --- | --- |
| Dashboard | `/dashboard` | 汇总概览（纯 summary，只展示真实录入数据，联动份额波动 / 重点独供统计） |
| 供需管理 | `/supply-demand` | 项目级客户需求（1-12 月）、供应商产能、BOM 用量系数、供需平衡分析 |
| 项目供需明细 | `/supply-demand/projects/:projectId` | 项目下的供应明细、关联物料/供应商，录入需求 / 产能 / BOM 系数 |
| 份额管理 | `/share` | 项目维度份额概览：KPI 卡 + 风险排行 + 份额×评分四象限 + 月末结转 |
| 份额明细 | `/share/records` | 份额记录明细：手动录入 + Excel 导入（含基地配额列）+ 行内编辑 + 基地拉线配置（动态基地列） |
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

**数据库模型（三层七表，核心业务模型）**
- L1 主数据：`projects` / `materials`（PN 唯一）/ `suppliers`（含 `risk_level` 地图风险等级，红/黄/绿/NULL=未评估）
- L2 供应关系：`supply_relations`（material × supplier 唯一，四元组）
- L3 项目明细：`project_supply_relations`（UNIQUE(project, supply_relation)，模块扩展字段）
- L3 份额管理：`share_records`（UNIQUE(project, supply_relation, month)，按月快照）+ `share_base_configs`（项目 × 月 基地拉线配置，UNIQUE(project, month)）

> 另有 `products`（历史遗留的通用 CRUD）与 `rules`（SOP 规则手册）两张辅助表。

---

## 三、当前项目状态盘点（★ 双向开发前必读）

> 本项目已被 AI 大幅改造，以下为**当前真实状态**，与早期版本/README 快照不一致，请以此为准。**内网外网同时开发时，两端必须基于同一 commit 工作。**

### 3.1 运行时架构（已定型，勿回退到 venv）

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| Python 3.13.12 | `runtime\python\` | 完整便携解释器，自带 uv 0.12.8（`python -m uv`） |
| 后端依赖 | `runtime\python\Lib\site-packages\` | fastapi / uvicorn / sqlalchemy / pydantic / openpyxl 等已装入解释器 |
| Node 22.20.0 | `runtime\node\` | 便携版，自带 npm / npx / pnpm 11.24.0 |
| 前端依赖 | `frontend\node_modules\` | 已装好，随项目拷贝 |
| 数据库 | `backend\products.db` | 业务数据，**不进 git**，需单独拷贝 |

**已移除**：`backend\.venv`（历史遗留）。Windows 下 venv 的 `pyvenv.cfg` 用相对路径定位解释器时依赖当前工作目录，从 `backend` 目录启动会失败，故彻底放弃 venv，后端直接用 `runtime\python\python.exe`。

### 3.2 启动方式

| 文件 | 用途 | 说明 |
| --- | --- | --- |
| `start-all.bat` / `start-all.sh` | 一键启动前后端 | 全相对路径，runtime 优先，依赖已装则跳过安装 |
| `scripts\start-backend.bat/.sh` | 只启动后端 (8000) | 同上 |
| `scripts\start-frontend.bat/.sh` | 只启动前端 (5173) | 同上 |

### 3.3 版本锁定（不要擅自升级）

| 组件 | 版本 | 原因 |
| --- | --- | --- |
| Python | 3.13.12 | 与 runtime 中已装依赖兼容 |
| uv | 0.12.8 | 虚拟环境/安装格式敏感 |
| Node.js | 22.20.0 | 与 node_modules 中 native 模块兼容 |
| pnpm | 11.24.0 | 与 pnpm-lock.yaml 格式兼容 |
| FastAPI | 0.141.1 | 代码基于该版本编写 |
| SQLAlchemy | 2.0.52 | ORM 语法版本敏感 |
| React | 18.3.1 | 前端代码基于该版本编写 |

### 3.4 Git 状态

- 仓库已初始化（master 分支，初始提交 `2fddd53`）。
- `runtime/`、`node_modules/`、`backend/products.db`、`.workbuddy/`、`.codebuddy/`、`*.db.bak-*`、`size_report.txt` 均已在 `.gitignore` 排除，**不进 git**。
- 待上 GitHub 后走增量迭代（见第九节）。

---

## 四、环境要求

> 本项目采用**自包含运行时**：**不需要**在目标机器上安装 Python / Node / pnpm。

| 依赖 | 实际版本 | 项目内位置 |
| --- | --- | --- |
| Python | 3.13.12 | `runtime\python\`（自带 uv 0.12.8，命令 `python -m uv`） |
| 后端依赖 | — | 已装入 `runtime\python\Lib\site-packages\`（随解释器一起走） |
| Node.js | 22.20.0 | `runtime\node\`（自带 npm / npx） |
| pnpm | 11.24.0 | `runtime\node\pnpm.cmd`（**不要混用 npm**，会忽略 `pnpm-lock.yaml`） |
| 前端依赖 | — | `frontend\node_modules\` |

> 若 `runtime/` 缺失，启动脚本自动回退到系统 / `.workbuddy` 托管的 Python 与 Node（外网场景可按 8.2 重建）。

---

## 五、内网网络说明（重要）

> 你的内网是**访问受限**而非完全断网：常见站点（如 GitHub）一般可访问，但**规则不透明**，某些域名/协议可能被放行或阻断，需要**自己试探**。本项目的设计原则是：**默认离线可跑，需要联网时按「第八节」逐级尝试**。

- **拷贝进内网后，无需任何网络即可启动 Demo**（`runtime/` + `node_modules/` 自带）。
- 只有当你要**拉取新依赖 / clone GitHub 仓库**时才需要网络。
- 探测 + 多镜像回退的策略见「八、网络源访问指南」。

---

## 六、迁移指南

目标：把项目完整搬到内网，先跑 Demo，再上 GitHub 增量迭代。

### 6.1 复制清单（必带）

```
scm-kanban/
├── .gitignore                  # 忽略规则（runtime/ 已排除，git 方式需单独拷贝）
├── README.md                   # 本文件（含内网开发指南）
├── AGENT.md                    # 给内网 AI 的避坑/命令速查（★ 必须带）
├── start-all.bat / start-all.sh  # 一键启动（全相对路径，搬移后无需修改）
├── runtime/                    # ★★ 内置运行时（内网必带！）
│   ├── python/                 #   Python 3.13.12 + uv + 后端依赖（site-packages）
│   └── node/                   #   Node 22.20.0 + npm + pnpm 11.24.0
├── backend/
│   ├── app/                    # ★ 全部源码
│   ├── scripts/smoke_test.py   # API 冒烟测试
│   ├── requirements.txt        # 后端依赖清单
│   └── products.db             # ★ 业务数据（见 6.3）
├── frontend/
│   ├── src/                    # ★ 全部源码
│   ├── public/
│   ├── index.html / package.json / pnpm-lock.yaml / vite.config.ts / tsconfig.json / components.json
│   └── node_modules/           # ★ 前端依赖（内网必带）
├── scripts/                    # 分步启动脚本 + 文档工具
└── docs/                       # 截图与复现提示词
```

**两种复制方式任选其一：**
- **方式 A（推荐）**：整体压缩 `scm-kanban/` 目录（**不要排除任何目录**）→ 拷贝到内网解压。
- **方式 B（git）**：`git clone` 仓库后，需**单独手动拷贝**（均被 `.gitignore` 排除）：
  - `runtime/`（体积较大，建议整体压缩拷贝）
  - `backend/products.db`（业务数据）
  - `frontend/node_modules/`（内网依赖）

### 6.2 排除清单（区分外网 / 内网）

**外网环境（有网络）**：以下目录无需复制，到新环境可自动重建

| 路径 | 原因 |
| --- | --- |
| `runtime/` | 内置运行时，可按 8.2 的「国内镜像源」重新下载 |
| `frontend/node_modules/` | 前端依赖，可用 `pnpm install` 重建 |
| `frontend/dist/` | 构建产物，可随时 `pnpm build` 重建 |
| `frontend/_tmp_*` / `*.timestamp-*.mjs` | 编辑器/工具临时文件 |
| `frontend/tsconfig.tsbuildinfo` | TypeScript 增量缓存 |
| `size_report.txt` | 临时报告 |

**内网环境（无网络）**：★★★ **必须带上 `runtime/` + `node_modules/`**

```
# 正确做法（内网）：整体压缩，不要排除任何目录
scm-kanban/              ← 整目录压缩
├── runtime/             ← ★ 必须带！解释器 + 后端依赖（site-packages 内置）
├── frontend/node_modules/ ← ★ 必须带！前端依赖
└── ...其余文件
```

### 6.3 数据迁移说明（products.db）

- **保留数据**：把 `backend/products.db` 一起复制即可，业务数据（供应商/物料/项目/供应关系/份额记录/规则）原样带过去。
- **全新开始**：不复制 `products.db`，后端启动时会自动 `create_all` 重建**空表**（项目当前**不写种子数据**，留空白底表由人工录入）。
- 数据库路径由代码基于文件位置定位（`backend/products.db`），放对位置即可，与启动目录无关。

### 6.4 迁移后启动

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

| 地址 | 说明 |
| --- | --- |
| http://localhost:5173 | 前端页面 |
| http://localhost:8000/docs | Swagger API 文档 |
| http://localhost:8000/api/health | 健康检查 |

### 6.5 迁移后验证（跑 Demo 检查单）

1. 浏览器打开 `http://localhost:5173`，页面正常渲染、无报错。
2. 打开 `http://localhost:8000/docs`，Swagger 可正常加载。
3. 访问 `http://localhost:8000/api/health`，返回 `{"status":"ok",...}`。
4. （可选）跑后端冒烟测试：
   ```bash
   cd backend
   ..\runtime\python\python.exe scripts\smoke_test.py
   ```

---

## 七、首次进入内网的推荐流程（Demo → GitHub → 增量迭代）

1. **第 1 步（离线）**：把 `scm-kanban/` 整目录拷贝进内网（含 `runtime/`、`node_modules/`、`products.db`）。
2. **第 2 步（离线）**：双击 `start-all.bat` 跑起前后端，按 6.5 验证 Demo 正常。
3. **第 3 步（联网试探）**：确认内网能否访问 GitHub / npm / PyPI（见第八节探测方法）。
4. **第 4 步（GitHub）**：在外网把仓库推到 GitHub（见 9.1）；在内网 `git clone` 或补全 `runtime/` 等被忽略文件后 `git pull`（见 9.2）。
5. **第 5 步（增量迭代）**：此后内网外网都基于 GitHub 增量同步（见第九节）。

---

## 八、网络源访问指南（内网受限网络）

> 通用原则：**先试官方源 → 失败换国内镜像 → 再失败换另一镜像**；每步用「探测命令」快速判断，不要盲等。

### 8.1 探测命令（PowerShell）

```powershell
# 看某 URL 能否访问（返回 200/301 等状态码即通）
curl.exe -I -L --max-time 8 https://registry.npmmirror.com

# 看域名能否解析 + 连通
Test-NetConnection github.com -Port 443 | Select-Object TcpTestSucceeded

# git 仓库探测（能列出版本即可）
git ls-remote https://github.com/xxx/xxx.git
```

### 8.2 常见源清单（按优先级排列）

**npm / pnpm 包**
| 优先级 | 源 | 命令写法 |
| --- | --- | --- |
| 1 | 官方 | `pnpm install`（默认） |
| 2 | 淘宝 npmmirror | `pnpm install --registry=https://registry.npmmirror.com` |
| 3 | 华为云 | `https://mirrors.huaweicloud.com/repository/npm/` |
| 4 | 腾讯云 | `https://mirrors.cloud.tencent.com/npm/` |

**PyPI（pip / uv）**
| 优先级 | 源 | 命令写法 |
| --- | --- | --- |
| 1 | 官方 | `python -m uv pip install -r requirements.txt`（默认） |
| 2 | 清华 | `--index-url https://pypi.tuna.tsinghua.edu.cn/simple` |
| 3 | 阿里 | `https://mirrors.aliyun.com/pypi/simple` |
| 4 | 腾讯 | `https://mirrors.cloud.tencent.com/pypi/simple` |
| 5 | 华为 | `https://mirrors.huaweicloud.com/repository/pypi/simple` |

**Node 二进制（node.exe zip）**
| 优先级 | 源 | URL |
| --- | --- | --- |
| 1 | 官方 | `https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x64.zip` |
| 2 | npmmirror | `https://registry.npmmirror.com/-/binary/node/v22.20.0/node-v22.20.0-win-x64.zip` |
| 3 | 华为 | `https://mirrors.huaweicloud.com/nodejs/v22.20.0/node-v22.20.0-win-x64.zip` |
| 4 | 腾讯 | `https://mirrors.cloud.tencent.com/nodejs-release/v22.20.0/node-v22.20.0-win-x64.zip` |
| 5 | 阿里 | `https://mirrors.aliyun.com/nodejs-release/v22.20.0/node-v22.20.0-win-x64.zip` |

**Python 二进制**
| 优先级 | 源 | URL |
| --- | --- | --- |
| 1 | 官方 | `https://www.python.org/ftp/python/3.13.12/python-3.13.12-amd64.exe` |
| 2 | npmmirror | `https://registry.npmmirror.com/-/binary/python/3.13.12/python-3.13.12-amd64.exe` |
| 3 | 华为 | `https://mirrors.huaweicloud.com/python/3.13.12/python-3.13.12-amd64.exe` |

**GitHub**
| 优先级 | 源 | 说明 |
| --- | --- | --- |
| 1 | 官方 | `https://github.com/...`（clone/push） |
| 2 | 源码 zip | `https://github.com/{user}/{repo}/archive/refs/heads/main.zip` |
| 3 | 加速代理（试错用） | `https://ghproxy.com/{github_url}`、`https://mirror.ghproxy.com/{github_url}`、`https://gh-proxy.com/{github_url}` |
| 4 | 加速下载 | `https://ghfast.top/{github_url}`（类似代理，可用性需自己试） |

> **注意**：GitHub 加速代理（ghproxy 等）是第三方服务，时好时坏，**仅作尝试项**，不要作为主依赖。

### 8.3 尝试策略（给内网 AI 的明示指令）

1. **先跑起来再说**：只要能启动 Demo，就不需要任何源。只有遇到「下载/安装/拉包」时才查源。
2. **逐级回退**：按上面优先级依次尝试，每次先用探测命令（8.1）验证通不通，通了再执行。
3. **超时控制**：所有网络命令都加 `--max-time` / 超时参数，避免长时间卡死。
4. **离线兜底**：装不上的依赖，优先考虑「能否不装」——本项目 `runtime/` 和 `node_modules/` 已含全部依赖；确需新增时，考虑在外网下载好包/源码，用 U 盘/文件共享带进内网。
5. **记录结论**：哪个源通、哪个源不通，记录在 `AGENT.md` 末尾的「内网实测记录」里，方便后续复用。

---

## 九、双向开发与 GitHub 增量迭代

> 双向开发 = 外网/内网都改代码，靠 GitHub 同步。**核心纪律：两端都从同一个 commit 出发；改代码前先 `git pull`；push 前先 `git status` 确认改动范围。**

### 9.1 外网首次推送到 GitHub

```powershell
cd scm-kanban
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

> 提醒：仓库根已初始化并提交（`2fddd53`）。`runtime/`、`node_modules/`、`products.db` 等不进 git，首次 clone 到内网后需**手动补拷**这 3 项（见 6.1 方式 B）。

### 9.2 内网同步

```powershell
# 首次：clone + 补拷贝被忽略的目录
git clone https://github.com/<你的用户名>/<仓库名>.git
# （把 runtime/、node_modules/、products.db 拷贝进 clone 出来的目录）

# 日常：拉取
cd scm-kanban
git pull
```

### 9.3 日常提交（两端通用，Windows 命令）

```powershell
cd scm-kanban
git status                # 先看改了哪些文件
git add -A
git commit -m "描述本次改动"
git push                  # 外网推送到 GitHub
```

### 9.4 双向开发注意事项

- **业务数据（`products.db`）不进 git**：两端各自维护自己的数据库。需要同步数据时，直接拷贝 `backend/products.db` 文件（U 盘 / 内网共享），**不要期待 git 帮你同步**。
- **运行时/依赖不进 git**：`runtime/` 与 `node_modules/` 不跟随 git。新增前端依赖后，外网 `pnpm install` 会更新 `pnpm-lock.yaml`（进 git），内网 `git pull` 后需在能联网的一侧重新 `pnpm install`（或用离线包同步）。后端同理：改了 `requirements.txt` 后，需联网一侧重新 `uv pip install` 并在内网同步 `runtime\python\Lib\site-packages` 或整个 `runtime\python`。
- **改代码前先 pull**：内网外网都可能改动，先 `git pull` 再动手，冲突面最小。
- **AGENT.md 同步更新**：内网 AI 的认知全部来自 `AGENT.md` 和 `README.md`，任何环境/命令变化请同步更新这两份文档再提交。

---

## 十、目录结构

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
│   └── products.db                # SQLite 数据库（业务数据，不进 git）
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
├── scripts/                       # start-{backend,frontend}.{bat,sh}、gen_source_docx.py
├── docs/                          # 截图、opencode-reproduce-prompt.md（AI 复现提示词）
└── README.md / AGENT.md
```

---

## 十一、API 概览（前缀 `/api`）

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
| GET | `/api/share/base-config` | 项目 × 月 基地拉线配置 |
| PUT | `/api/share/base-config` | 保存基地配置（自动重算未手改份额 = Σ(配额×拉线数)÷Σ拉线数） |
| POST | `/api/share/import` | Excel 导入份额数据（openpyxl，支持基地配额列） |
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

## 十二、常见问题

| 问题 | 处理 |
| --- | --- |
| 启动脚本报「未找到 npm/pnpm」 | 将 `runtime\node` 放回项目目录后重试；或安装 Node.js LTS 并加入 PATH |
| 端口 8000 / 5173 被占用 | 一键脚本会自动检测并跳过已占用服务；手动启动时换端口需同步改 vite 代理 |
| 前端请求 `/api` 失败 | 确认后端已启动；前端通过 Vite 代理访问后端，无需额外配 CORS |
| 后端报 `No module named 'fastapi'` | `runtime\python\Lib\site-packages` 缺失，用 8.2 重建 runtime 并安装依赖 |
| 数据库想重置 | 删除 `backend/products.db` 后重启，自动重建空表 |
| 系统的 `python` 命令无法使用 | Windows 应用商店占位符，请用项目内置 `runtime\python\python.exe`。详见 `AGENT.md` |
| 内网迁移后启动失败 | 确认 `runtime/` 和 `node_modules/` 已完整拷贝。详见 `AGENT.md` |
| 内网某个源访问不了 | 换同类型另一镜像源（见 8.2 优先级），先用 8.1 探测 |
| 内网外网改动冲突 | 双向开发纪律：先 `git pull` 再改；push 前看 `git status`。详见 9.4 |
| 想用 AI 从零复现项目 | 参考 `docs/opencode-reproduce-prompt.md`，粘贴给 AI 编程助手即可 |

---

## 十三、内网迁移速查

搬到内网前，确认以下清单：

- [ ] 整个 `scm-kanban/` 目录已压缩（**包含 `runtime/` 和 `node_modules/`**，含 `backend/products.db`）
- [ ] `AGENT.md` 已一并拷贝（给内网 AI 的避坑指南 + 命令速查）
- [ ] 内网机器无需安装任何运行时（Python / Node / pnpm 全在 `runtime/` 里）
- [ ] 无需修改 `start-all.bat` / `start-all.sh`（全相对路径）
- [ ] 解压后直接双击 `start-all.bat`（Windows）或运行 `./start-all.sh`
- [ ] 按 6.5 验证 Demo 通过后，再按第九节接 GitHub 增量迭代

> 最底线保障：只要 `runtime/` 和 `node_modules/` 完整，即使内网没有任何开发工具、任何网络源都不可用，项目也能直接运行 Demo。
