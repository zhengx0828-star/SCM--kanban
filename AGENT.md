# AGENT.md —— 内网 AI 开发指南（避坑 + 命令速查）

> **本文件是给内网 AI 助手的唯一说明书。** 先读本文，再动手。
>
> 你的任务对象是「SCM 供应链看板」项目。**所有命令都已按 Windows 转义规则写好，直接复制即可**，不要改写、不要自作主张换成绝对路径、不要重新创建 venv。

---

## ⚠️ 核心纪律（违反必出问题）

1. **永远使用相对路径**：`..\runtime\python\python.exe`，**禁止**写 `C:\Users\...` 之类绝对路径（内网路径不同，写了就炸）。
2. **不要创建 `.venv` / 不要用 `python -m venv`**：本项目后端直接用 `runtime\python\python.exe`，依赖已装入其 `Lib\site-packages`。
3. **不要用系统的 `python` / `node` 命令**：Windows 的 `python` 是应用商店占位符，不可用。一律用 `runtime\` 下的。
4. **前端一律用 `pnpm`**（`..\runtime\node\pnpm.cmd`），**不要用 npm**（会忽略 `pnpm-lock.yaml`）。
5. **Windows 转义**：PowerShell 中调用带路径命令用单引号 `& '..\runtime\python\python.exe' ...`；命令里尽量不含 `$` 符号；cmd 中路径带空格用 `""` 包裹。
6. **内网优先离线**：项目已自带全部运行时和依赖，**先保证能跑起来**，网络问题按「第五节」逐级试探，不要死磕。

---

## 一、项目现状（已被大幅改造，以此为准）

| 事实 | 值 |
| --- | --- |
| 项目名 | SCM 供应链看板（前后端分离 Web 应用） |
| 后端 | FastAPI + SQLAlchemy 2 + SQLite，代码在 `backend\app\` |
| 前端 | React 18 + Vite 5 + Tailwind 4，代码在 `frontend\src\` |
| Python | `runtime\python\python.exe`（3.13.12，自带 uv） |
| 后端依赖 | 已装入 `runtime\python\Lib\site-packages\` |
| Node | `runtime\node\node.exe`（22.20.0，自带 npm/npx） |
| pnpm | `runtime\node\pnpm.cmd`（11.24.0） |
| 前端依赖 | `frontend\node_modules\`（已装） |
| 数据库 | `backend\products.db`（业务数据，**不进 git**） |
| 端口 | 后端 8000 / 前端 5173 |
| Git | 已初始化，master 分支，初始提交 `2fddd53` |

**功能模块**：Dashboard、供需管理、份额管理、主数据（供应商/物料/供应关系/项目）、规则手册。API 全量清单见 `README.md`「十一、API 概览」。

---

## 二、命令速查（Windows，直接复制）

### 2.1 启动 / 停止

```powershell
# 一键启动前后端（会自动定位 runtime，依赖已装则跳过安装）
start-all.bat

# 只启动后端（在项目根执行）
scripts\start-backend.bat

# 只启动前端
scripts\start-frontend.bat
```

> 停止：关闭启动后弹出的两个 cmd 窗口即可。`start-all.bat` 会自动跳过已被占用的端口。

### 2.2 验证是否跑起来

```powershell
# 后端健康检查（预期输出 {"status":"ok",...}）
curl.exe -s http://127.0.0.1:8000/api/health

# 前端（预期输出 HTTP 状态码 200）
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:5173

# 后端冒烟测试（在 backend 目录）
cd backend
..\runtime\python\python.exe scripts\smoke_test.py
```

### 2.3 后端常用命令（在 backend 目录执行）

```powershell
# 查版本（预期 Python 3.13.12）
& '..\runtime\python\python.exe' --version

# 查 uv（预期 uv 0.12.8）
& '..\runtime\python\python.exe' -m uv --version

# 查依赖是否装好（预期无报错）
& '..\runtime\python\python.exe' -c "import fastapi"

# 手动启动后端
& '..\runtime\python\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 安装/更新后端依赖（仅新增依赖或依赖缺失时需要）
& '..\runtime\python\python.exe' -m uv pip install -r requirements.txt --python '..\runtime\python\python.exe'
```

### 2.4 前端常用命令（在 frontend 目录执行）

```powershell
# 查 Node / pnpm 版本
& '..\runtime\node\node.exe' --version
& '..\runtime\node\pnpm.cmd' --version

# 安装依赖（已装则跳过）
& '..\runtime\node\pnpm.cmd' install

# 启动开发服务
& '..\runtime\node\pnpm.cmd' run dev --host 127.0.0.1

# 构建生产包
& '..\runtime\node\pnpm.cmd' run build
```

### 2.5 Git 命令（在项目根执行）

```powershell
git status                 # 看改动
git add -A
git commit -m "描述改动"
git pull                   # 内网拉取（先 pull 再动手）
git push                   # 外网推送
git log --oneline -5       # 看最近提交
```

> 本机未配置 git 身份时提交会失败；可用一次性参数提交（不改配置文件）：
> `git -c user.name="scm-kanban" -c user.email="scm-kanban@localhost" commit -m "..."`

### 2.6 网络探测 / 换源

```powershell
# 探测某 URL 是否通（返回 200/301 即通）
curl.exe -I -L --max-time 8 https://registry.npmmirror.com

# 测端口连通
Test-NetConnection github.com -Port 443 | Select-Object TcpTestSucceeded

# npm/pnpm 换国内源安装
cd frontend
& '..\runtime\node\pnpm.cmd' install --registry=https://registry.npmmirror.com

# pip/uv 换国内源安装
cd backend
& '..\runtime\python\python.exe' -m uv pip install -r requirements.txt --index-url https://pypi.tuna.tsinghua.edu.cn/simple --python '..\runtime\python\python.exe'
```

---

## 三、Windows 转义避坑（务必看完）

| 场景 | ❌ 错误写法 | ✅ 正确写法 |
| --- | --- | --- |
| PowerShell 调带路径命令 | `..\runtime\python\python.exe -m uvicorn`（路径含反斜杠会被解析为转义） | `& '..\runtime\python\python.exe' -m uvicorn`（单引号） |
| cmd 调带空格路径 | `C:\Program Files\nodejs\node.exe --version` | `"C:\Program Files\nodejs\node.exe" --version` |
| 命令里出现 `$` | `$_`、`$var` 在部分 shell 会被吞 | 避免使用；必须用时写成 `.ps1` 脚本文件执行 |
| 用 npm | `npm install` | `& '..\runtime\node\pnpm.cmd' install` |
| 用系统 python | `python --version` | `& '..\runtime\python\python.exe' --version` |
| 写绝对路径 | `C:\Users\lisax\...` | 一律相对路径 `..\runtime\...` |

> 追加：若在 cmd 里执行且遇到 `系统找不到指定的路径`，先确认当前目录（`cd` 一下），相对路径要从正确目录出发（backend 命令在 `backend\` 下，前端命令在 `frontend\` 下）。

---

## 四、内网网络说明（重要认知）

- 内网是**访问受限**而非断网：常见站点（GitHub 等）可能通，但**规则不透明**，需自己探测。
- **项目默认离线可跑**：`runtime/` + `node_modules/` 自带全部依赖，**启动 Demo 不需要任何网络**。
- 只有以下场景才需要网络：① `git clone/pull/push` GitHub；② 新增依赖需要 `pnpm install` / `uv pip install`；③ `runtime/` 丢失需要重建。

---

## 五、网络源与试错流程（给内网 AI 的明示指令）

### 5.1 固定流程（严格按顺序）

1. **先探测再执行**：任何需要网络的命令前，先用 `curl.exe -I -L --max-time 8 <url>` 探一下源是否通。不通直接换下一个源，**不要盲等**。
2. **按优先级逐级回退**：官方源 → 国内镜像 A → 国内镜像 B。每换一个源都要重新探测。
3. **超时保护**：所有下载/安装命令加 `--max-time`（curl）或不要让其无限制重试。
4. **离线兜底**：如果所有源都不通，**不要硬装**。改用「外网下载好 → U 盘/共享带进内网」的方式：`pnpm` 可以用 `pnpm store` / 打包 `node_modules`；`uv/pip` 可以先 `pip download -d <目录>` 再 `--find-links` 离线安装。
5. **记录结论**：把「哪个源通/不通」记录到第八节「内网实测记录」，后续直接复用，避免重复试探。

### 5.2 源清单（优先级从高到低）

**GitHub（clone/pull/push）**
| 优先级 | 源 | 示例 |
| --- | --- | --- |
| 1 | 官方 | `git clone https://github.com/user/repo.git` |
| 2 | 源码 zip | `https://github.com/user/repo/archive/refs/heads/main.zip` |
| 3 | 加速代理（试错） | `https://ghproxy.com/https://github.com/user/repo/archive/refs/heads/main.zip` |
| 4 | 其他代理（试错） | `https://mirror.ghproxy.com/...`、`https://ghfast.top/...`、`https://gh-proxy.com/...` |

> 代理是第三方服务，时好时坏，**只作尝试项**。主路径优先官方直连。

**npm/pnpm 包**
| 优先级 | 源 | 命令 |
| --- | --- | --- |
| 1 | 官方 registry | `pnpm install` |
| 2 | 淘宝 npmmirror | `pnpm install --registry=https://registry.npmmirror.com` |
| 3 | 华为云 | `pnpm install --registry=https://mirrors.huaweicloud.com/repository/npm/` |
| 4 | 腾讯云 | `pnpm install --registry=https://mirrors.cloud.tencent.com/npm/` |

**PyPI（pip/uv）**
| 优先级 | 源 | 命令 |
| --- | --- | --- |
| 1 | 官方 | `uv pip install -r requirements.txt` |
| 2 | 清华 | `uv pip install -r requirements.txt --index-url https://pypi.tuna.tsinghua.edu.cn/simple` |
| 3 | 阿里 | `--index-url https://mirrors.aliyun.com/pypi/simple` |
| 4 | 腾讯 | `--index-url https://mirrors.cloud.tencent.com/pypi/simple` |
| 5 | 华为 | `--index-url https://mirrors.huaweicloud.com/repository/pypi/simple` |

**Node 二进制**（重建 `runtime\node` 用）：官方 `nodejs.org/dist` → npmmirror `registry.npmmirror.com/-/binary/node/` → 华为 `mirrors.huaweicloud.com/nodejs/` → 腾讯 `mirrors.cloud.tencent.com/nodejs-release/` → 阿里 `mirrors.aliyun.com/nodejs-release/`

**Python 二进制**（重建 `runtime\python` 用）：官方 `www.python.org/ftp/python/3.13.12/` → npmmirror `registry.npmmirror.com/-/binary/python/3.13.12/` → 华为 `mirrors.huaweicloud.com/python/3.13.12/`

---

## 六、常见坑（AI 最容易犯的错误）

### 坑 1：写绝对路径 / 用系统命令
```powershell
# ❌
python --version
C:\Users\lisax\...\python.exe

# ✅
& '..\runtime\python\python.exe' --version
```

### 坑 2：创建 venv
```powershell
# ❌ python -m venv .venv / uv venv .venv
# Windows 下 venv 定位解释器依赖 CWD，从 backend 目录启动会报
#   did not find executable at 'runtime\python\python.exe'

# ✅ 直接用 runtime python，依赖在它自己的 site-packages 里
& '..\runtime\python\python.exe' -m uvicorn app.main:app ...
```

### 坑 3：用 npm 装前端依赖
```powershell
# ❌ npm install   （忽略 pnpm-lock.yaml，版本会漂移）
# ✅
& '..\runtime\node\pnpm.cmd' install
```

### 坑 4：内网不带 runtime/ 和 node_modules/
```powershell
# 症状：No module named 'fastapi' / Cannot find module 'react'
# 原因：只拷了源码，runtime/ 和 node_modules/ 没带
# 解决：整目录压缩拷贝（README 6.2）
```

### 坑 5：依赖被改没了 / 要加新依赖，内网又没网
```powershell
# 处理：外网把包下载好带进内网
# 前端：外网 node_modules 整体打包拷贝，或 pnpm pack 具体包
# 后端：外网执行
#   python -m uv pip download -r requirements.txt -d deps_wheels
#   内网执行
#   python -m uv pip install -r requirements.txt --no-index --find-links deps_wheels --python runtime\python\python.exe
```

### 坑 6：改代码前没 git pull，导致冲突
```powershell
# 双向开发纪律：改任何代码前先 git pull；push 前先 git status 看清改动
```

---

## 七、快速诊断清单（内网启动失败时按顺序查）

| 步骤 | 命令 | 预期 |
| --- | --- | --- |
| 1. runtime Python | `& 'runtime\python\python.exe' --version` | `Python 3.13.12` |
| 2. 后端依赖 | `& 'runtime\python\python.exe' -c "import fastapi"` | 无报错 |
| 3. runtime Node | `& 'runtime\node\node.exe' --version` | `v22.20.0` |
| 4. pnpm | `& 'runtime\node\pnpm.cmd' --version` | `11.24.0` |
| 5. 前端依赖 | `Test-Path frontend\node_modules\react` | `True` |
| 6. 数据库 | `Test-Path backend\products.db` | `True`（无则自动建空表，不影响启动） |
| 7. 后端端口 | `curl.exe -s http://127.0.0.1:8000/api/health` | `{"status":"ok",...}` |
| 8. 前端端口 | `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:5173` | `200` |

---

## 八、内网实测记录（给内网 AI 填写）

> 探测过哪些源、结论如何，记在这里，避免重复试探。

| 日期 | 源 | 是否可用 | 备注 |
| --- | --- | --- | --- |
| | github.com (443) | | |
| | registry.npmjs.org | | |
| | registry.npmmirror.com | | |
| | pypi.org | | |
| | pypi.tuna.tsinghua.edu.cn | | |
| | nodejs.org | | |
| | ghproxy.com | | |

---

## 九、版本锁定（不要擅自升级）

| 组件 | 锁定版本 |
| --- | --- |
| Python / uv | 3.13.12 / 0.12.8 |
| Node.js / pnpm | 22.20.0 / 11.24.0 |
| FastAPI / SQLAlchemy | 0.141.1 / 2.0.52 |
| React | 18.3.1 |

---

## 十、最底线保障

只要 `runtime/` 和 `frontend/node_modules/` 完整带进内网，**即使所有网络源都不可用、任何工具都没装，项目也能直接运行 Demo**。遇到任何「装不上 / 下不了」的问题，先回到这句话：**离线能不能跑？能跑就先跑，网络问题后面再说。**
