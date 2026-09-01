# AGENT.md —— 内网环境开发指南

> 本文件是给内网 AI 编程助手的**避坑说明书**。
>
> 本项目采用**自包含运行时（portable runtime）**：Python / Node / pnpm 全部内置在项目 `runtime/` 目录，后端依赖直接装入 `runtime\python\Lib\site-packages`（**无虚拟环境、无 pyvenv.cfg、零绝对路径**），整目录拷贝即可运行。
>
> **原则：先读本文，再动手。不要假设环境是"正常的"，更不要往任何文件里写死绝对路径。**

---

## 一、运行时结构（项目自包含）

```
scm-kanban/
├── runtime/                 # ★ 内置运行时（解释器 + 包管理器 + 后端依赖）
│   ├── python/              #   Python 3.13.12 + uv 0.12.8 模块
│   │   └── Lib/site-packages/   #   ★ 后端依赖（fastapi / uvicorn / sqlalchemy / openpyxl 等）
│   └── node/                #   Node 22.20.0 + npm + pnpm 11.24.0
├── backend/
│   ├── app/                 # 后端源码
│   ├── requirements.txt     # 依赖清单（依赖本体在 runtime\python）
│   └── products.db          # 业务数据
├── frontend/
│   └── node_modules/        # ★ 前端依赖
└── start-all.bat / start-all.sh   # 一键启动（全相对路径）
```

> ⚠️ 不要创建 `backend\.venv`：Windows 下 venv 的 `pyvenv.cfg` 若用相对路径定位解释器，**解析结果依赖当前工作目录**，从 `backend` 目录启动会报 `did not find executable at 'runtime\python\python.exe'`。本项目已放弃 venv，直接用 `runtime\python\python.exe`。

### 1.1 后端命令（全部相对路径，从项目根执行）

```powershell
# 启动后端（在 backend 目录下执行）
cd backend
..\runtime\python\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 冒烟测试
..\runtime\python\python.exe scripts\smoke_test.py

# 重建/安装后端依赖（仅外网需要）
..\runtime\python\python.exe -m uv pip install -r requirements.txt --python ..\runtime\python\python.exe
```

### 1.2 前端命令

```powershell
cd frontend
..\runtime\node\pnpm.cmd install        # 已装可跳过
..\runtime\node\pnpm.cmd run dev --host 127.0.0.1
```

---

## 二、内网迁移核心注意事项（★★★ 最重要）

### 2.1 必须带上的目录（缺一个都跑不起来）

| 目录 | 作用 | 缺少时的后果 |
|------|------|-------------|
| `runtime\` | 解释器 + 包管理器 + **后端依赖** | `No module named 'fastapi'` / `node 不是内部或外部命令` |
| `frontend\node_modules\` | 前端依赖 | 内网无网，无法 `pnpm install` |
| `backend\products.db` | 业务数据 | 只能得到空表（可选，见 README 4.3） |

**正确做法**：把整个 `scm-kanban/` 目录原样压缩带走，**不要排除任何目录**。

> 唯一可以考虑排除的是 `frontend\dist\`（构建产物）和 `runtime\` 里的 `.pdb` 调试符号文件（可选优化，非必需）。

### 2.2 内网无需关心的事情

- **不需要**安装 Python / Node / uv / pnpm —— 全部在 `runtime\` 里。
- **不需要**修改 `start-all.bat` / `start-all.sh` —— 脚本用 `%~dp0` / `$(pwd)` 相对定位，项目搬到哪都认。
- **不需要**联网 —— 依赖已装好，脚本检测到 `fastapi` / `node_modules` 存在会跳过安装。

---

## 三、常见坑（AI 最容易犯的错误）

### 坑 1：往文件里写死绝对路径（★ 最致命）

```powershell
# ❌ 错误：在脚本/配置里写 C:\Users\lisax\... 之类绝对路径
# 项目一挪位置（内网路径不同）就炸

# ✅ 正确：一律用相对路径
cd backend && ..\runtime\python\python.exe -m uvicorn app.main:app ...
```

### 坑 2：创建 venv 并依赖 pyvenv.cfg 定位解释器

```powershell
# ❌ 错误：python -m venv .venv 或 uv venv .venv
# pyvenv.cfg 的 home 用绝对路径 → 搬移就炸
# home 改成相对路径 → Windows 下依赖 CWD 解析，从 backend 目录启动报
#   did not find executable at 'runtime\python\python.exe'

# ✅ 正确：不建 venv，直接用 runtime\python\python.exe
..\runtime\python\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 坑 3：直接用 `python` / `uv` 命令

```powershell
# ❌ 错误
python --version      # Windows 商店占位符，可能返回空/报错
uv --version          # 没有独立 uv 命令

# ✅ 正确
& "runtime\python\python.exe" --version
& "runtime\python\python.exe" -m uv --version
```

### 坑 4：内网迁移只带源码，不带 runtime / node_modules

```powershell
# ❌ 错误：只拷了源码
# 启动时：ModuleNotFoundError: No module named 'fastapi'
# 前端：Cannot find module 'react'

# ✅ 正确：整目录压缩，runtime/ 和 node_modules/ 全带上
```

### 坑 5：用 npm 代替 pnpm

```powershell
# ❌ 错误
cd frontend && npm install    # 会忽略 pnpm-lock.yaml，可能导致版本不一致

# ✅ 正确
cd frontend && ..\runtime\node\pnpm.cmd install   # 使用项目内置 pnpm
```

---

## 四、快速诊断清单

如果内网启动失败，按这个顺序排查：

| 步骤 | 命令 | 预期结果 |
|------|------|---------|
| 1. 检查 runtime Python | `& "runtime\python\python.exe" --version` | `Python 3.13.12` |
| 2. 检查 uv | `& "runtime\python\python.exe" -m uv --version` | `uv 0.12.8` |
| 3. 检查后端依赖 | `& "runtime\python\python.exe" -c "import fastapi"` | 无报错 |
| 4. 检查 runtime Node | `& "runtime\node\node.exe" --version` | `v22.20.0` |
| 5. 检查 pnpm | `& "runtime\node\pnpm.cmd" --version` | `11.24.0` |
| 6. 检查 node_modules | `Test-Path "frontend\node_modules\react"` | `True` |

---

## 五、启动脚本说明

| 文件 | 用途 | 说明 |
|------|------|------|
| `start-all.bat` | Windows 一键启动 | 全相对路径，`runtime\python` → `runtime\node` 优先，缺失时回退系统 / `.workbuddy` |
| `start-all.sh` | macOS/Linux 一键启动 | 同上，兼容 linux/mac 布局（`bin/python3`、`bin/node`） |

脚本行为：
1. 定位 Python：`runtime\python\python.exe` → 回退 `.workbuddy` → 报错提示。
2. 定位 Node：`runtime\node\node.exe` → 加入 PATH → 回退系统 PATH。
3. 依赖已存在（`fastapi` / `node_modules`）自动跳过安装，内网无网可启动。
4. 后端直接以 `runtime\python\python.exe` 启动，**无 venv**。

---

## 六、版本锁定

为确保内网环境一致性，以下版本不要擅自升级：

| 组件 | 锁定版本 | 原因 |
|------|---------|------|
| Python | 3.13.12 | 与 runtime\python 中的依赖兼容 |
| uv | 0.12.8 | 虚拟环境格式可能随版本变化 |
| Node.js | 22.20.0 | 与 node_modules 中的 native 模块兼容 |
| pnpm | 11.24.0 | 与 pnpm-lock.yaml 格式兼容 |
| FastAPI | 0.141.1 | 代码基于该版本编写 |
| SQLAlchemy | 2.0.52 | ORM 语法版本敏感 |
| React | 18.3.1 | 前端代码基于该版本编写 |

---

## 七、紧急回退方案

如果内网连 `runtime/` 都丢了，可用最原始的方式：

1. **后端**：找到任意 Python 3.10+，用 `python -m pip install -r requirements.txt` 安装依赖（需提前把依赖 wheel 文件拷进内网），然后 `python -m uvicorn app.main:app ...` 启动。
2. **前端**：如果 Node 和 pnpm 都不可用，直接把 `frontend\node_modules` 整个目录拷贝过去即可运行（不需要重新 install）。

> 最底线：只要 `runtime/` 和 `node_modules/` 完整带过去，哪怕内网什么工具都没有，项目也能跑。
