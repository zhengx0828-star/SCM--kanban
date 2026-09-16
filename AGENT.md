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
7. **改 `.bat` 必须保持 GBK(cp936) + CRLF**：`start-all.bat`、`scripts\*.bat` 三个文件存的是 **GBK 编码**。**用编辑器或脚本按 UTF-8 保存会立刻炸** —— 双击后刷一屏「不是内部或外部命令」，用户会直接判定「项目无法运行」。原因与改法见「六、坑 7」，**这是本项目最容易被无意破坏的地方**。

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

**功能模块**：Dashboard、供需管理、份额管理、库存管理（信号塔）、主数据（供应商/物料/供应关系/项目）、规则手册。API 全量清单见 `README.md`「十一、API 概览」。

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
git push                   # 外网推送 —— 见下方「推送前必读」
git log --oneline -5       # 看最近提交
git log --oneline origin/master..master   # 看本地领先远程多少提交
```

> 本机未配置 git 身份时提交会失败；可用一次性参数提交（不改配置文件）：
> `git -c user.name="scm-kanban" -c user.email="scm-kanban@localhost" commit -m "..."`

**推送前必读（本机 GitHub 不通，2026-09-16 实测）**：直接 `git push` 会长时间无响应卡死，**先探测再推**：

```powershell
# 探一下能不能连上（两个都要看）
curl.exe -s -o NUL -w "http=%{http_code} time=%{time_total}s`n" --max-time 10 https://github.com
git ls-remote --heads origin    # 能列出分支才说明能推
```

判读：`http=000` + `curl` 非 0 退出（SSL 失败）＋ `git ls-remote` 超时 = **不通，别推了**。
此时改为**本地提交 + bundle 中转**，拿到有网机器上再推：

```powershell
# 打包未推送的提交
git bundle create D:\unpushed.bundle origin/master..master
git bundle verify D:\unpushed.bundle     # 应输出 "is okay"
# 有网机器上执行：git fetch D:\unpushed.bundle master  然后 git push
```

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
| 写绝对路径 | `C:\Users\<用户名>\...` | 一律相对路径 `..\runtime\...` |

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
C:\Users\<用户名>\...\python.exe

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

### 坑 7：★ 把 `.bat` 存成了 UTF-8（本机最致命的坑）

**症状**：双击 `start-all.bat` 后刷出一屏红字，中文注释被拆碎当命令执行：

```
'n.exe（内置，优先；后端依赖已装入…' 不是内部或外部命令
'找不到时回退' 不是内部或外部命令
'端页面:' 不是内部或外部命令
timeout: invalid time interval '/t'
```

脚本其实还会继续往下跑，但用户看到满屏报错，**直接判定「项目无法运行」** —— 2026-09-16 排查「项目无法运行」就是栽在这里。

**根因**：中文 Windows 控制台**活动代码页 = 936(GBK)**。cmd.exe 是**逐行按当前代码页解析**批处理文件的，若 .bat 存成 UTF-8 且含中文，字节边界在 cp936 下错位，注释碎片就被当成命令。行内 `chcp 65001` 更会让后续行读取偏移错乱（所以连末尾的 `echo` 行也会炸）。

**诊断**：

```powershell
chcp.com                       # 看活动代码页，中文 Windows 应为 936
# 逐文件检查编码与行尾
& 'runtime\python\python.exe' -c "
for f in ['start-all.bat','scripts/start-backend.bat','scripts/start-frontend.bat']:
    d=open(f,'rb').read()
    try: d.decode('gbk'); g='GBK-OK'
    except: g='GBK-FAIL'
    try: d.decode('utf-8'); u='仍UTF-8可解(危险)'
    except: u='非UTF-8-OK'
    crlf=d.count(b'\r\n'); lf=d.count(b'\n')-crlf
    print('%-28s %-9s %-16s CRLF=%d 裸LF=%d' % (f,g,u,crlf,lf))
"
```

**修复（三件事，缺一不可）**：

```powershell
# 1) 编码 UTF-8 -> GBK，行尾统一 CRLF；务必用 Python 转换
& 'runtime\python\python.exe' -c "
import io
for f in ['start-all.bat','scripts/start-backend.bat','scripts/start-frontend.bat']:
    t=open(f,encoding='utf-8').read()
    lines=[l.rstrip('\r') for l in t.split('\n')]
    open(f,'wb').write('\r\n'.join(lines).encode('gbk'))
    print('converted', f)
"
# 2) 删掉文件里所有 chcp 65001（控制台本来就是 936，切换反而破坏解析）
# 3) 行尾必须 CRLF —— 纯 LF 会让标签 / goto 解析异常
```

**不要用编辑器「另存为 UTF-8」，也不要让 AI 用普通文本编辑工具直接改 `.bat`** —— 那些工具默认按 UTF-8 写盘，改一个字就毁掉整个文件。改 `.bat` 请走上面的 Python 转换流程。

**顺带**：`.bat` 内调 `timeout` 要写 `"%SystemRoot%\System32\timeout.exe" /t 6`，否则 PATH 里有 Git Bash 时会解析成 GNU timeout，报 `invalid time interval '/t'`。

**验证**：重跑脚本，按 cp936 解码输出，确认七类签名**全部消失**：`不是内部或外部命令` / `is not recognized` / `invalid time interval` / `系统找不到` / `未被识别` / `Syntax error` / `The syntax of the command`。

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
| 9. 启动脚本编码 | 见「六、坑 7」的编码检查命令 | 三个 `.bat` 均 `GBK-OK` / `非UTF-8-OK` / `裸LF=0` |
| 10. 手动绕过脚本 | `cd backend` 后 `& '..\runtime\python\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000` | 能起则问题在脚本，不在项目 |

> **判据**：若第 7、8 步不通，但第 10 步手动能起服务 → 说明**项目本身没问题，是启动脚本坏了**，优先查第 9 步的 `.bat` 编码，不要浪费时间重装依赖。

---

## 八、内网实测记录（给内网 AI 填写）

> 探测过哪些源、结论如何，记在这里，避免重复试探。

| 日期 | 源 | 是否可用 | 备注 |
| --- | --- | --- | --- |
| 2026-09-16 | github.com (443) | ❌ **不通** | `curl --noproxy '*' https://github.com` → `http=000` exit 35（SSL 失败，10s 超时）；`git ls-remote origin` 25s 超时 exit 124。**本机 push 不可行，别反复重试** |
| | registry.npmjs.org | | |
| | registry.npmmirror.com | | |
| | pypi.org | | |
| | pypi.tuna.tsinghua.edu.cn | | |
| | nodejs.org | | |
| | ghproxy.com | | |

> 本机无法 push 时的替代做法：本地 commit 后用 `git bundle create <file> origin/master..master` 打包，拿到有网机器上 `git fetch <file> master` 即可取回提交。

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
