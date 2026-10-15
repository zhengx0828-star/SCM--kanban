# AGENT.md —— 内网 AI 开发指南（避坑 + 命令速查）

> **本文件是给内网 AI 助手的唯一说明书**（WorkBuddy / opencode / 其它任何 AI 助手都适用）。先读本文，再动手。
>
> 你的任务对象是「SCM 供应链看板」项目。**所有命令都已按 Windows 转义规则写好，直接复制即可**，不要改写、不要自作主张换成绝对路径、不要重新创建 venv。
>
> **新会话可先读 `OPENCODE.md`（开场指令 + 数据红线速览），再读本文件。**

---

## ⚠️ 核心纪律（违反必出问题）

1. **永远使用相对路径**：`..\runtime\python\python.exe`，**禁止**写 `C:\Users\...` 之类绝对路径（内网路径不同，写了就炸）。
2. **不要创建 `.venv` / 不要用 `python -m venv`**：本项目后端直接用 `runtime\python\python.exe`，依赖已装入其 `Lib\site-packages`。
3. **不要用系统的 `python` / `node` 命令**：Windows 的 `python` 是应用商店占位符，不可用。一律用 `runtime\` 下的。
4. **前端一律用 `pnpm`**（`..\runtime\node\pnpm.cmd`），**不要用 npm**（会忽略 `pnpm-lock.yaml`）。
5. **Windows 转义**：PowerShell 中调用带路径命令用单引号 `& '..\runtime\python\python.exe' ...`；命令里尽量不含 `$` 符号；cmd 中路径带空格用 `""` 包裹。
6. **内网优先离线**：项目已自带全部运行时和依赖，**先保证能跑起来**，网络问题按「第五节」逐级试探，不要死磕。
7. **改 `.bat` 必须保持 GBK(cp936) + CRLF**：`start-all.bat`、`scripts\*.bat` 三个文件存的是 **GBK 编码**。**用编辑器或脚本按 UTF-8 保存会立刻炸** —— 双击后刷一屏「不是内部或外部命令」，用户会直接判定「项目无法运行」。原因与改法见「六、坑 7」，**这是本项目最容易被无意破坏的地方**。
8. **★ `backend\products.db` 是用户的业务数据，绝对红线 —— 任何情况下不得删除、清空、覆盖、重建。**
   它是**唯一**存放看板录入数据的地方，**不在 git 里**（`.gitignore` 的 `*.db`），因此 **git 不会保护它，也没有任何自动备份**。具体禁令：
   - ❌ 禁止 `del` / `rm` / `Remove-Item` 指向 `products.db`、`backend\` 或整个项目目录；
   - ❌ **禁止删除整个项目目录、禁止重新 `git clone` 到同一位置覆盖** —— clone/下载下来的版本里**没有** `products.db`、`runtime\`、`frontend\node_modules\`，等于「数据全没 + 系统起不来」；
   - ❌ 禁止为了"重置环境""重新部署""同步到最新"而重建目录或用下载的文件夹**顶替**原目录；
   - ✅ 更新代码只允许两种方式：`git pull`（不碰 db）；或项目根 `update-from-zip.bat`（自动备份 db 后只换代码）；
   - ✅ 需要改数据库结构时，只允许走 `backend\app\migrations.py` 的**幂等增量迁移**（`ALTER TABLE ADD COLUMN` / 带数据拷贝的一次性重建），**严禁 `DROP TABLE`**；
   - ℹ️ **git 操作（`checkout` / `reset` / `pull` / `stash`）不会影响 `products.db`** —— 因为它未被跟踪。真正危险的是**文件级删除/覆盖**。
   - 判断口诀：**「我只是读代码、改代码、跑 git」= 安全；「我要删文件、覆盖目录、重新克隆」= 停手先问用户。**

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
| Git | `master` 分支，`origin` = `https://github.com/zhengx0828-star/SCM--kanban.git`（凭证已就位，可直接 `git push`）｜**git 只在 WorkBuddy 自带 PortableGit 中、未加系统 PATH**（2026-10-14 核实） |

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

**推送前必读（2026-09-17 实测查清：GitHub 完全可达，是 git 的默认 TLS 后端在本机卡死）**：

> **★ 2026-10-14 复测更新 —— 先看这一段，下面三条只在出问题时当排查手册用**：
> - **本机直连已不需 schannel workaround**：本目录此前**没有 `.git`**（GitHub 源码包快照），重新 `git init` 后**未设任何 `sslBackend` / `http.proxy` / `http.version`**，`git fetch` 与 `git push` 均**一次成功**。下方 1/2/3 三条**不是每次推送的前置步骤**。
> - **认证已就绪**：GCM 2.9.0 已保存账号 `zhengx0828-star`，`git push origin master` 直接通。**下文「认证」段的旧结论（GCM 无凭证 / 沙箱里弹不出窗口 / 登录必须由用户在自己终端完成）全部作废**。
> - **⚠️ git 不在系统 PATH**：本机**未独立安装 Git**（`C:\Program Files\Git` 不存在，机器级与用户级 PATH 均无 git 条目），git 与 GCM 只存在于 `%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\<ver>\`。**所有 git 命令必须在 WorkBuddy 会话内执行**；在自己开的 PowerShell / cmd 里敲 `git` 会报「不是内部或外部命令」。
> - **别再把这个目录当全新仓库推**：远程已有历史（`b5a3ee9`、`ef6c5cf`、`05916b8` …），正确做法是 `git fetch origin` 后在 `origin/master` 之上追加提交。

本机有三个隐形障碍（**2026-09-17 实测**），**决定性因素是第 3 条**，三个都处理才能稳定连通：

1. **沙箱代理**：环境变量里有 `http_proxy/https_proxy=http://127.0.0.1:55144`，该代理**到 GitHub 是不通的**（实测 `curl -x` 该代理 → `http=000`）。git 若走它必卡死 → 需 `http.proxy=` 置空。
2. **fake-IP 域名**：`github.com` 被解析到 `198.18.0.22`（fake-IP 网段，本地 TUN 接管）。该 TUN 对 HTTP/2 不友好 → 需 `http.version=HTTP/1.1`。
3. **★ TLS 后端（根因）**：git 默认 `http.sslBackend=openssl`，本机 OpenSSL 与 fake-IP TUN 组合下 **TLS 握手发完 ClientHello 就永远等不到 ServerHello**（`GIT_TRACE_CURL` 可复现：卡在 `Send SSL data` 之后）。换成 Windows 原生 **schannel** 后**秒通**（`ls-remote` 1 秒内返回）。

```powershell
# 一次性写入本仓库配置（推荐，之后裸命令即可用；实测裸 git ls-remote 已秒回）
git config http.sslBackend schannel
git config http.version HTTP/1.1
git config http.proxy ""

# 连通性自检（能看到 refs/heads/master 即正常）
git ls-remote --heads origin
```

若不想改配置，等价写法（三个参数都要带）：

```powershell
git -c http.sslBackend=schannel -c http.version=HTTP/1.1 -c http.proxy= ls-remote --heads origin
```

**认证（2026-10-14 修正，旧结论已作废）**：push 需要 GitHub 凭证。本机 GCM 2.9.0 **已保存凭证**（账号 `zhengx0828-star`，落在 Windows 凭据管理器），`git push origin master` 直接通，**无需 PAT、不会再弹授权窗口**。

> ~~旧结论：「本机 Git Credential Manager 中没有已保存凭证（`git credential fill` 返回空），首次需在本机终端执行 push 完成授权」「headless / 沙箱会话里 GCM 弹不出交互窗口，登录这一步只能由用户在自己终端完成」~~ —— 2026-10-14 实测**两条均不成立**：在 WorkBuddy 会话内直接执行 `git credential-manager github login` 即完成 OAuth 授权并把凭证落库。
>
> 凭证失效时的自检与重授权（WorkBuddy 会话内）：
> ```powershell
> git credential-manager github list    # 应列出 zhengx0828-star；为空即需重登
> git credential-manager github login   # 重走一次 OAuth
> ```

> 诊断要点（下次再遇到「git 连不上但 curl 正常」照此排查）：
> ① `curl --noproxy '*' -I https://github.com` 通 → 网络没问题，问题在 git 自身；
> ② `GIT_TRACE_CURL=1 git ls-remote origin`：若停在 `Send SSL data`（ClientHello）后无 `Recv` → **换 `http.sslBackend=schannel`**；
> ③ 还不行再加 `http.version=HTTP/1.1`、`http.proxy=`。
>
> 旧结论（2026-09-16「GitHub 完全不可达、只能 bundle 中转」）已被推翻；确需离线中转时仍可用 bundle：
> `git bundle create D:\unpushed.bundle origin/master..master`（有网机器 `git fetch <bundle> master`）。

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

### 坑 8：★ 并行跑 CDP 抓取脚本（`dump.mjs` / `shot.mjs`）会串页

**症状**：同时抓两个 URL 做对比，结果**两个输出文件内容一样**，而且都不是你要的页面（例如想要 `/changes?project=2`，拿到的却是 `/dashboard`）。字符数还都是同一个值，很容易被当成"页面没渲染"。

**根因**：`scripts/_tmp/dump.mjs`（端口 9336）与 `scripts/_tmp/shot.mjs`（9339）都用**固定调试端口**。并行启动时后一个 Chrome 抢不到端口，脚本的 `/json/list` 拿到的是**同一个已存在的 page**，两个脚本各自 `Page.navigate` 到自己的 URL，最后写盘的是同一份正文。

**规矩**：
1. 抓页面**一律串行**，一次一个 URL（同一个脚本尤其不能并行）。
2. 抓完先看**字符数**，再用 Read 打开确认首行是不是目标页面 —— 别只看文件存在就当作通过。
3. 批量对比时改动 URL 前先确认上一次的 Chrome 已退出（脚本结尾会 kill，但要等它跑完）。
4. `shot-clip.mjs` 抓「视口下方」的元素时必须带 `captureBeyondViewport: true`（已加），否则截出来是**纯白图**——不报错也不警告，很容易被误判成「页面白屏」。

**顺带**：`.bat` 内调 `timeout` 要写 `"%SystemRoot%\System32\timeout.exe" /t 6`，否则 PATH 里有 Git Bash 时会解析成 GNU timeout，报 `invalid time interval '/t'`。

**验证**：重跑脚本，按 cp936 解码输出，确认七类签名**全部消失**：`不是内部或外部命令` / `is not recognized` / `invalid time interval` / `系统找不到` / `未被识别` / `Syntax error` / `The syntax of the command`。

### 坑 9：★ Excel 导入的 `file_path` 必须是**绝对路径**；两种 404 要分开看

> **2026-10-15 更新**：份额 / 库存 / 变更三个导入接口已统一改为「浏览器选择文件」方式
> （与供需管理一致）：前端弹窗点「选择文件」，Excel 内容以 `application/octet-stream`
> 放在**请求体**里上传，后端 `await request.body()` → `io.BytesIO` → openpyxl 解析。
> `file_path` 查询参数仅作**本地脚本兼容**（请求体为空时才走路径），HTTP 调用一律走请求体。
> 注意：`seed_inventory_validation.py` 直调的入口改为 `import_inventory_from_path(path, db)`。

**症状**：`POST /api/changes/import?file_path=scripts/_tmp/x.xlsx` 返回 `404`，第一反应是「路由不存在」，其实是**文件找不到**。

**根因**：后端以 `cd backend` 启动，进程工作目录是 `backend/`，相对路径被解析成 `backend/scripts/_tmp/x.xlsx`。

**两种 404 的区分（关键）**：
| 返回 | 含义 |
| --- | --- |
| `{"detail":"文件不存在: xxx"}`（中文） | 路由没问题，**文件路径**不对 |
| `{"detail":"Not Found"}`（英文） | FastAPI 默认 404，**路径/方法**没匹配上（例如少写了 `/changes`） |

**规矩**：
1. 脚本里一律用 `os.path.dirname(os.path.abspath(__file__))` 推仓库根再拼绝对路径，Windows 下把 `\` 换成 `/`。
2. **清库脚本的 `commit()` 必须放在所有 DELETE 之后**，中间任何一条语句抛错都会让前面全部回滚（且不报警）——本次实测踩到：`DELETE FROM sqlite_sequence` 报 `no such table`（表不是 AUTOINCREMENT，压根没有这张表），导致三张业务表的删除**全部回滚**，数据原样还在，看起来像"清表没生效"。要删数据请直接走 `DELETE /api/changes/{id}?hard=true` 这类接口，比裸 SQL 安全。

### 坑 10：★ 探针脚本的 id 必须校验归属；openpyxl 写行不能用 `max_row`

**A. 跨实体 id 不校验归属 = 静默改错数据（本次真踩，且污染了数据集）**

写测试脚本时把 **change id 当 task id** 传给 `/api/change-tasks/{id}/toggle`。那个 id 恰好是**另一张单**下的真实任务 —— 后端不报错、**静默把它勾上了**（单据完成率 28.6% → 42.9%）。是靠事后反查归属、比对 `done_at` 时间戳（`22:58:26` 明显是刚写的）才发现并复原的。

**规矩**：
1. 跨实体引用 id **必须先校验归属**：先取父实体详情，从它自己的子列表里拿 id。
2. 脚本里断言归属（如 `task.change_id == change.id`），不靠"看起来对"。
3. 对「不该成功却成功了」的调用，要断言**业务语义**（状态/时间戳有没有变），不能只看状态码。

**B. `ws.append([])` 不会产生一行 → 导出数据全挤在第 1 行**

openpyxl 里 `append([])` 是空操作（空列表没有单元格），`ws.max_row` **不会变**。用 `ws.cell(row=ws.max_row, column=i, value=v)` 写值，等于**每次都写在同一行**——导出的表只剩 1 行，表头被最后一条数据覆盖，而且**不报错**。写表一律用**显式行游标**（`row = 2; row += 1`）。

---

### 坑 11：★ 同一屏上的数字必须同源；图上的百分比必须合计 100%

**A. 「待办项」把已完成的事也算进来，同一页出现两个互相打脸的数**

某看板卡片标题写"最需要盯的待办项"、footer 写"共 **21** 项待处理"，但统计卡写超期 6 + 临期 4 = **10**。原因：取数接口 `level` 不传时**默认连「迟交完成」一起返回**（21 = 6 超期 + 4 临期 + **11 已完成**）。

**规矩**：
1. 「待处理 / 待办 / 待盯」口径**只能含未完成项**。已经把事做完的（哪怕做晚了）不是待处理，放进去既名不副实、又让同一页两个数对不上。
2. 做聚合卡片时，先算清「这一屏上还有哪些数字指向同一个集合」，**让它们必然相等**，并在验收脚本里断言相等（本次断言：页面「已超期」chip 数 == `overdue_tasks`；footer「共 N 项」== 超期 + 临期）。
3. 口径有排除项时，**在卡片副标题里写明**（如"迟交完成已做完，不列入待处理"），别让用户自己猜。

**B. 各分项直接 `Math.round` → 百分比合计不是 100%**

`3/7, 2/7, 2/7` → 43、29、29 = **101%**；`11/33, 4/33, 6/33, 1/33, 11/33` → 33、12、18、3、33 = **99%**。饼图和堆叠条上的百分比加起来不是 100，看的人第一反应是"数据错了吧"，白白消耗信任。

**规矩**：分项百分比一律走**最大余数法**（先向下取整，剩余额度按小数部分从大到小补给各项），前端已有公共函数 `percentageSplit()`（`frontend/src/lib/utils.ts`），别自己写 `Math.round`。

---

### 坑 12：★ 时间轴图不能向未来"平推"；自动生成的结论必须有信息量

**A. 燃尽/趋势类图的「实际值」不能算到未来**

原实现对**未来日期**也照算 `actual_remaining`（= 未完成任务数）→ 在计划线之外画出一条永远不动、看起来"永远完不成"的尾巴。这是**推算，不是数据**。规矩：`日期 > 今天` 的点，实际值置 `null`，让实际线**停在今天**。（本次全局跨度 90 天，不修会多出 29 个假点。）

**B. 「由数据算出」≠「有信息量」**

自动生成的结论最初写成「落后自 **08-06** 起持续到现在」——而 08-06 恰好是数据第一天，**等于没说**。改成「差距最近一次扩大在 **10-02**」后才有用：那才是真正又掉一次链子的日子。

**规矩**：写自动结论时反问一句「看完这行字，我知道该去干什么了吗？」。边界值（第一天/最后一天/恒为 0）要专门想一遍——`恒为 0 的指标`不该单独占卡位，`从第一天就成立`的结论不该输出。

---

### 坑 13：★ 批量操作要清理"子级痕迹"，显示层要有"说谎闸门"

查数据时发现某单据 `archived_at` 是 NULL（未归档），但**归档留痕里还挂着它的"已归档"记录**。

根因：`unarchive_project`（取消整项目归档）只删 `scope == "project"` 的留痕。于是「先单独归档某单 → 再整项目归档 → 再取消整项目归档」会留下**指向未归档单的孤儿留痕**，对外谎报状态。

**规矩（两步都要做）**：
1. **写侧根治**：批量取消类操作要连带清理**本次受影响子项的痕迹**，不能只清理自己那一层。
2. **读侧加闸**：列表接口只返回「目标确实还处于该状态」的记录。**不删历史数据，只保证显示出来的一定是真的**——这样即使历史脏数据还在，用户也永远看不到矛盾的展示。

---

### 坑 14：★ 「由数据算出的文案」不能只做代码级通读 —— 用响应拦截覆盖降级分支

看板上凡是**由数据算出的一句话结论**（如变更首页每张图标题下那行 `ChangeInsight`），都有多个分支：空态 / good / warn / bad。而**真实库里通常只存在一种数据形状**——某次实测 3/3 项目都滞后，于是「所有项目都不落后于时间进度」这条 good 分支**永远不会被执行**。这类分支上线命中时的表现是**白屏或缺字**，只读代码等于没有证据。

**手法：拦响应，不造数据。** 用 CDP `Fetch.enable` + `Fetch.fulfillRequest` 在**浏览器侧**把接口响应换成合成 payload：

```js
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/changes*", requestStage: "Request" }] });
// Fetch.requestPaused 事件里按 URL 关键字返回合成 JSON
// ★ 每个 paused 请求都必须应答，漏一个页面就永远卡住
```

为什么优于"往库里塞测试实体"：① **一个字节都不写数据库**（本仓库有「造测试实体进正式库须先问用户」的约定，这就绕开了审批，也不必清理）；② 能构造现实中不存在的极端形状（如实际值大于计划值且差距持续扩大）；③ 跑完即走、可反复跑。落地脚本：`scripts/verify_degraded.mjs`（53 条 / 8 场景，**每个场景双视图取数**：主页 + 分析视图），与 `scripts/_tmp/verify_home.mjs`（38 条，数字对账；按视图分节）、`scripts/verify_mobile.mjs`（60 条：含全站 7 路由 @1440 与 @390 两套冒烟）、`scripts/verify_materials.mjs`（45 条 / 4 Tab）、`scripts/verify_changes_l0.mjs`（60 条：主页三饼并列与对齐 / 分析视图常显 / 视图切换与假死门禁 / 窄屏）并列。

**三个坑（都真实踩过）**：

1. **`urlPattern` 结尾用单星 `*/api/changes*`**。写成 `/api/changes/*` 会**漏掉 `?page=1` 这类无结尾斜杠的 URL** → 该请求穿透到真后端 → "空库降级"场景拿到真数据 → **假失败**。
2. **验某条文案必须带上渲染它的开关**。实测：偏差榜结论只在 `?deep=1`（默认折叠的深度分析区）才渲染，不带开关断言它 → 永远"未找到" → **会被误判成缺陷**。同理要留意分页 / `enabled` 参数 / localStorage 折叠态。
3. **mock 自己也要遵守业务不变量**。首版手填 `avg_deviation: -3`，却同时给 `avg_time_rate: 62` / `task_done_rate: 55` → 截图里出现「时间进度 62% / 完成率 55%」配绿色「−3 个点 超前」角标，**自相矛盾**。页面没 bug（它忠实渲染了 payload），但**复核的人分辨不出来，会当成真 bug**，截图就失去了证明力。规矩：造假数据同样要满足页面上的算术关系（`偏差 = 时间进度 − 完成率`、各分项之和 == 总数），mock 工厂的默认值取"低调自洽值"（如比率全 0）。

**另外两条**：断言要**连语义色一起核**（取结论行内语义圆点的 `bg-*` 类，`good=emerald / bad=red / warn=amber / info=blue / default=muted`）——文字对但颜色配错（绿字写"落后"）同样是缺陷；降级态还要专门验**正文无 `NaN`**、**无横向溢出**（空数据最容易把布局撑破或让 ECharts 吐 `NaN`）。

---

### 坑 15：★ 改了聚合口径，要按清单排查**全部**消费方（漏一处就静默错数）

变更模块的 `total` 从「未归档（含作废）」改成「有效单（不含作废）」时，连带 **10 处**要改。**这些错都是静默的**（不报错、不白屏，只是数字悄悄变小或某些实体凭空消失）：

| 类型 | 症状 | 具体 |
| --- | --- | --- |
| **重复减** | 比率/计数变小甚至归零 | `done/(total−voided)`、项目饼图 `total−voided−archived`（乘用车 1−1=0） |
| **可见性反向失效** | 实体凭空消失 | 卡片墙「有单」判定 `total>0` → 只剩作废单的项目不再显示，改 `total+voided>0` |
| **下游张数少报** | 批量操作影响面说不全 | 归档弹窗张数 = `total` → 后端归档**连作废单一起冻**（只按 `archived_at` 过滤），须 `total+voided` |
| **兜底句变噪音** | 口径已统一还在"解释差异" | 删掉 `（另有 N 张作废未计入）` |
| **文案误读** | 连排分项被当成加数 | 作废应写成 `｜另有作废 1`，**不是** `· 作废 1` |

**规矩**：改口径前先 `grep` 出该字段的**全部消费点**，逐个判断"它算的是不是同一个集合"；改完把能推出来的等式全部写成断言（`total == active + done`、`type_counts 合计 == total`、`sum(open_tasks) == 未完成档位之和`）。

**★ 同一个词在同一屏只能有一个口径**：实测统计卡「待办项」=33（全量含已完成）vs 项目饼图「待办项数」=21（未完成）—— 两侧各自都"对"，合起来错。口径要固化成常量共享（`frontend/src/types/change.ts` 的 `TASK_STATE_OPEN`），**不要在两处各写一遍 `filter`**。

### 坑 16：★ 后端写入类测试：「脚本全绿」不等于「库是干净的」

`scripts/_tmp/` 下三套后端测试（`test_lifecycle` / `test_task_tree` / `test_change_import`）都是"跑完自动复原"设计。但实测踩中：某条断言把**正常的 `201`** 判成失败 → 进错误分支 → `finally` 里的清理代码**根本没执行** → 库里留下 0 任务的空壳临时单。脚本输出「存在未通过项」**完全看不出库被污染**；把断言修好后重跑，三套全绿，**残留还在**。

**跑它们用 `./runtime/python/python.exe`**（自带 `openpyxl`，后端导表同款，不必另建 venv）。

**收尾必须对指纹（三段式）**：

```bash
python scripts/_tmp/fp_check.py before
./runtime/python/python.exe scripts/_tmp/test_lifecycle.py   # 另两套同理
python scripts/_tmp/fp_check.py after
python scripts/_tmp/fp_check.py diff      # 退出码非 0 = 有残留
```

指纹覆盖：summary 全字段 + 五色档位 + **逐单 id/标题/状态/叶子数** + 项目概览。

**顺手查「化石断言」**（写死常量，全来自"当年 demo 数据恰好长那样"）：`archived==1`、`len(voided)==1`、`abs(done_rate−28.6)<0.1`（28.6% = 当年 2/7，现在 2/8）、`st!=200`（不认 201）。
**规矩**：断言只比**基线**或**关系**，不比"当前数据的绝对值"；测试**不依赖库里恰好存在的边角状态**——自建临时实体 → 验 → 硬删（`?hard=true`，失败先 `unarchive`）。
（实例：「归档单只读」用例因库里 `archived=0` 长期直接判失败，**从来没被真验到过**；改成自建临时单后第一次跑通。）

### 坑 17：★ `<button>` 套 `<button>` —— 不报错、不溢出，只在控制台留一条警告

无效 HTML 嵌套（`button` 套 `button`、`a` 里放 `button`）**没有任何视觉症状**，只留一条 `validateDOMNesting`。实测 `/materials` 有 **7 处**（项目卡 3 张 × 2 图标按钮 = 6 处，物料行 1 处）。

- **修法**：外层容器改 `role="button" tabIndex={0}` + `onKeyDown` 处理 Enter/Space + `cursor-pointer` + focus ring（参考 `components/changes/ProjectChangeCard.tsx`）。**别为了消警告把可点区域降级成死 `div`** —— 会丢键盘可达性。
- **已落成常驻门禁**：`scripts/verify_mobile.mjs` 第 0 节对全站 7 条路由断言 `button button / a button / button a` 数量为 0。
- **★ 只测默认态会漏一半**：那 7 处分属不同 Tab（默认「项目」Tab 6 处、另一 Tab 1 处），默认只渲染前者。逐 Tab 排查：`node scripts/_tmp/probe-nested-tabs.mjs <url> <Tab文案1,Tab文案2>`。
- **该页的常驻验收**：`scripts/verify_materials.mjs`（45 条，含键盘可达性 / 行内按钮不误触 / 数据对账 / 窄屏四 Tab）。

### 坑 18：★ `overflow` 会把「放不下」藏起来 —— 窄屏别只断言「无横向溢出」

`overflow-x: auto` / `overflow: hidden` 一加上，外层的 `scrollWidth − clientWidth` 立刻归零 —— **「无横向溢出」断言从此恒真，等于没测**。实测 `/materials` 的 Tab 条连踩三层：

1. **文案被挤成两行**：不溢出、不截断、控制台干净，但排版已塌（「物/料」「供应关/系」）。判法：按钮内容区高度 ÷ `line-height` = 行数，>1 即折行。修：`shrink-0 whitespace-nowrap`。
2. **子元素被裁**：修了 ① 后 Tab 条内容 386px > 可用 342px，**溢出 44px**，第四个 Tab 滑出视野 —— 手机上等于不存在。判法：量**容器自身**的 `scrollWidth − clientWidth`，并逐个断言子元素 `rect` 完整落在容器可视区内。
3. **图标是窄屏的奢侈品**：两行修完还是差 44px，最后靠窄屏收起 Tab 图标（`hidden sm:block`）解决 —— 窄屏要的是「四个 Tab 都看得见」，不是图标。

> **规矩**：查窄屏必须量三样 —— ① 文档级 `scrollWidth − clientWidth`；② **各滚动容器自身**的 `scrollWidth − clientWidth`；③ 关键子元素的 `rect` 是否完整落在容器可视区内。只看 ① 会漏掉全部。

> **★ 全站扫描前先校准探针的假阳性率**：把这条规矩推广成全站扫描（7 路由）时，第一版探针报出 **49 处"发现"，核实后假阳性率 100%** —— ① `truncate`（`text-overflow: ellipsis`）必然 `scrollWidth > clientWidth`，那是设计如此；② 对元素整体 `selectNodeContents` 时，**内联 SVG 图标与文字基线不同会被算成不同的"行"**（实测「供应链控制台」报 3 行，而元素总高 24px 恰好 = 1 行高）。**改用 `TreeWalker` 只量文本节点** + 排除 ellipsis 后，真实结果是「导航类容器需要滚动 0 处」。**报出几十处问题时先怀疑探针，再怀疑代码。**

> **★ 冒烟必须两套尺寸**：第 0 节 @1440、第 0.5 节 @390。窄屏是另一套响应式分支（布局 / 显示隐藏 / 栅格列数 / flex 方向都不同），桌面绿 ≠ 手机绿。实测原本 7 条路由里只有 2 条在 390px 下被量过，其余 5 条**从未在手机宽度下验证**。

### 坑 19：★ 截图要拍在**断言成立的那一刻**

实测 S2（键盘可达性）的证据截图与首屏**字节完全相同**（md5 一致）—— 因为 `shot()` 写在了「复原」之后：断言说「已切到详情视图」，图拍的是返回后的列表态。

这类**截图与断言状态错位**比不截图更坏：看起来有据可查，实际对不上，而且脚本全绿、不报任何错。

- **规矩**：`await shot(...)` 紧跟在 `check(...)` 之后，**在复原/清理之前**。
- **门禁**：`shot()` 返回 md5，对「证据图」断言 `hash(证据图) !== hash(上一状态图)`。这条才抓得住错位。

### 坑 20：★ 改了版面（折叠/隐藏/换顺序），**所有"只验文字"的旧门禁会集体假失败**

2026-10-06 把变更页的燃尽图 / 两张饼图 / 待办项清单收进折叠区后，三套旧脚本一次性报出 **22 条失败**，
逐条核实**全是假失败** —— 页面没坏，是"内容不挂载就不在 DOM 上"这个前提变了：

| 脚本 | 症状 | 真因 |
| --- | --- | --- |
| `scripts/_tmp/verify_home.mjs` | 17 条 `未找到` + 五色图例合计 143% | 图表在折叠区里未渲染；切片边界「整体燃尽图」现在切到了饼图的百分比 |
| `scripts/verify_degraded.mjs` | 17 条降级结论 `未找到` | 同上（这脚本**早就**为「深度分析」踩过一次，加了 `deep=1`，但没推广成规矩） |
| `scripts/verify_mobile.mjs` | 「待办项任务名宽度」0 行；「最长截断 440px」 | 清单收起 → 0 行；**折叠头摘要的 `truncate` 是有意的单行预览**，被当成"关键信息被吃掉" |

- **规矩 1**：验收脚本要"先保证内容被渲染，再验内容"。折叠/懒加载/Tab 之后，**用 URL 参数把状态摆好**
  （本项目：`?todos=1&trend=1&deep=1`），别去模拟点击（慢且脆）。
- **规矩 2**：任何"页面级"扫描型断言（全页 `.truncate` / 全页百分比 / 全页关键数字），
  都要**先想清楚新加的元素会不会污染它**。折叠头摘要属于"点开即见全文"的预览，
  应豁免：`if (el.closest("button")) return;`。
- **规矩 3**：改版面时必须**同时**回答「新结构该用什么信号判定」——
  例：待办项在**分组模式（默认）下是 div，不是 `<table>`**（只有平铺模式才用 Table 组件），
  判定"内容挂载了没有"要用单元格的 `data-role="task-days"`，用 `table` 标签数会永远得 0。

### 坑 21：★ 内容**搬家**（不只是折叠）→ 断言会**跨视图**，且旧参数不能直接删

2026-10-06 深夜：把「待办项 / 整体燃尽图 / 深度分析」从主页搬进同页视图 `?view=analysis`，
同时把「五色堆叠条」改画成饼图并与另两张饼并列。踩到四个新坑：

**① 断言跨视图 —— 一个场景要跑两个 URL。**
降级态套件里同一个场景（如 S2）同时验「类型饼结论」（住主页）与「燃尽图结论」（住分析视图）。
只换 URL 必然一半假失败。
→ **规矩**：同一场景 / 同一断言集，**两个视图各取一次，结论在任一侧命中即算命中**；
`verify_degraded.mjs` 的执行器已改成"双视图取数 + 正文拼接 + 结论行合并 + 溢出取较大值"。

**② 旧参数不能直接删，但兼容必须放在"渲染时判断"。**
`todos` / `trend` / `deep` 已随内容迁入分析视图 → 读它们是**兼容旧链接**（老书签不点空）。
★ **必须**用渲染期变量（`const analysisOpen = ... || sp.get("todos") === "1"`），
**不能**用 `useEffect` 去改写 URL —— 否则点「返回项目总览」时会被残留的 `risk` 立刻弹回分析视图，
**返回按钮假死**（比"点了没反应"更难查，因为 URL 看起来是对的）。

**③ `min-h-[Npx]` 加在 grid 容器上会"反向拉伸"。**
三张饼要圆心同高，第一版给 `CardHeader` 加 `min-h-[116px]` → 结果 header 被撑到 148px、
首屏可见度从 87% 掉到 47%。
原因：shadcn 的 `CardHeader` 是 `grid auto-rows-min`，`min-height` 让 grid 把多余空间**分配到行**上。
→ **正确做法**：分别兜住**变量**（结论句 `min-h-[2.5rem]` 按 2 行占位 + 标题行 `min-h-[26px]`），
而不是给容器一个总高。

**④ 图画进 canvas 后，DOM 里就读不到它的图例了。**
原「五色图例百分比合计 == 100%」断言**不能平移**到饼图（ECharts 把 legend 画在 canvas 上）。
→ 该断言改写为"标题齐全 + 结论句带百分比"；百分比合计交给 `percentageSplit`（最大余数法）+ 后端单测。

**⑤ 判别信号要跟着图形走。**
`canvas` 数量是"图上有没有东西"的可靠信号：主页应恰好 **3**（三饼）、
分析视图应恰好 **1**（燃尽图）—— 数字对不上就说明有图表漏挂或漏删。


---

### 坑 22：★ `Card` 自带 `overflow-hidden`，会把**下拉面板整块裁掉**

2026-10-14：供需管理页的「项目 / 物料」下拉点开**只看到一个搜索框，选项列表完全不见**，
项目和物料都选不了 → 下方图表与热力图永远出不来。用户报的是"物料供需出不来"，
但根因跟物料、供需、热力图**一点关系都没有**。

**根因**：`components/ui/card.tsx` 的 `Card` 基础类里有 `overflow-hidden`。
下拉面板是 `absolute left-0 top-full`（向下超出卡片），于是被 `overflow:hidden` **连同命中测试一起裁掉**：
`elementFromPoint(面板中心)` 返回的是面板**下面那张卡**（实测拿到 `SPAN 客户需求`）。

**为什么 tsc / vite build / 静态检查全都抓不到**：DOM 里元素在、`getBoundingClientRect()` 也有正常尺寸，
只是"画不出来、也点不到"。**必须真实渲染 + 命中测试**。

**修法**：给那张 `Card` 补 `overflow-visible`。
`cn()` 走 twMerge，后写的 `overflow-visible` 会覆盖基础类的 `overflow-hidden`。

**规矩**：
1. **凡是把 `MultiSelectDropdown` / 任何自研绝对定位浮层放进 `Card`、`AnalysisSection` 这类
   带 `overflow-hidden` 的容器，必须显式加 `overflow-visible`。**
2. 验收浮层类交互，一律用 `scripts/verify_supply_demand_page.mjs` 那套判据：
   开面板 → `elementFromPoint` 命中测试是否落在面板内 → 再断言选项能勾选。
   **只看截图"面板好像出来了"不够**，半截面板（只露搜索框）同样要判为失败。


---

### 坑 23：★ 项目级的写入，绝不能顺手改「全局主数据」

2026-10-14 用户报障：「供应商列表导入，一开始导入 LFP3，后来导入 EP1，**LFP3 的内容自己变了**」。

**现象**：LFP3 页面上的物料 `191` 从「模组侧板」变成了「CCS」。用户根本没碰 LFP3。

**根因**：`routers/projects.py::quick_add_project_relation` 里写了
`elif material.name != payload.material_name: material.name = ...`（供应商同理）。
本意是"顺手同步一下名称"，但三层五表里 **物料按 PN、供应商按 code 是全局唯一的一条，项目只是引用** ——
所以项目级的 Excel 导入，改一行 = 改掉所有引用它的项目。

**定位手法（可复用）**：`updated_at` 时间戳就是铁证 ——
被改的主数据 `created_at` 是旧的、`updated_at` 恰好等于导入那一刻，而同批新建的行 `created_at` 等于同一秒。

**修法**：`quick-add` 增加 `sync_master_names` 开关，**默认 `False`（安全侧：漏传也不会误伤）**。
- Excel 批量导入 → `False`：只复用、绝不改全局主数据；名称不一致由前端对照返回体提示「已沿用系统原名」。
- 手动「快速新增」→ 显式 `True`：名称是用户当场亲手打的，属明确意图。
  （附带发现：物料接口只有新建 / 删除、**没有改名**，所以手动快速新增是目前唯一能改物料名的入口，不能直接删掉这个能力。）

**规矩**：
1. **任何"项目级"写接口，都不允许改 L1/L2 全局主数据。** 要改主数据，就做成主数据自己的显式编辑接口。
2. 新增跨层写逻辑时，先问一句：**这条记录还有谁在用？** 有就绝不能顺手改。
3. 验收：`~/.workbuddy/tmp` 下那套做法 —— **复制整个 `backend/` 到临时目录跑副本**（DB 路径写死为
   `backend/products.db`，无法用环境变量重定向），改完再核对真实库 `mtime` 未变。
   ⚠️ 绝不要对着用户**正在运行**的真实后端点「确认导入」——那会真的再改一次数据。

### 坑 24：★ 批处理的两个路径坑（`%~dp0.` 让 `if exist` 判假；尾反斜杠 + 引号毁掉 robocopy）

2026-10-15 新增 `update-from-zip.bat`（内网机器不能直连 GitHub 时，用下载的 zip 换代码、保留本地数据）时踩到，实测结论：

**坑 A：`set "T=%~dp0."` 之后 `if exist "%T%backend\products.db"` 永远为假。**

```
%~dp0   -> C:\...\old\    -> if exist "...\backend\products.db"  -> FOUND
%~dp0.  -> C:\...\old\.   -> if exist "...\backend\products.db"  -> MISSING
```

cmd 的 `if exist` 不做路径规范化，多一个 `\.` 就查不到（`dir` / `robocopy` 却能正常工作，所以特别隐蔽：文件明明在，备份逻辑却静默跳过）。**`%~dp0` 自带尾反斜杠，直接用，不要画蛇添足加 `.`。**

**坑 B：`"C:\path\dir\"` 结尾的 `\"` 被当成转义引号，参数串提前闭合。**

`robocopy "%SOURCE%" "%TARGET%"` 若 `%TARGET%` 以 `\` 结尾 → 变成 `"...\old\"` → robocopy 参数错乱，直接打印一整屏 usage（帮助里会出现 `/MIR` 字样，**别被误导**以为是自己传错了开关）。

**规矩**：凡是要传给外部程序（robocopy / xcopy 等）的目录变量，**先去尾反斜杠**，拼接时显式写分隔符：

```bat
set "TARGET=%~dp0"
set "TARGET=%TARGET:~0,-1%"          rem %~dp0 必以 \ 结尾，无条件截掉最后一位
robocopy "%SOURCE%" "%TARGET%" ...    rem 此时引号安全
```

**关联坑**：`%~1`（拖拽进来的路径）也可能带尾反斜杠，规范化用 `pushd "%SOURCE%"` → `set "SOURCE=%CD%"` → `popd`。

**新脚本 `update-from-zip.bat`（项目根目录）**：把 GitHub 下载解压出来的代码文件夹**拖到它上面松手**，自动执行「备份 `products.db` → robocopy 覆盖代码（排除 `runtime/`、`node_modules/`、`products.db`）→ 提示完成」。改它同样受坑 7 约束（**必须 GBK + CRLF**，现文件已是 GBK）。


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
| **2026-10-14** | **github.com (443)** | ✅ **直连即通，无需任何 workaround** | 本目录此前无 `.git`（GitHub 源码包快照），`git init` 后**未设 `sslBackend`/`http.proxy`/`http.version`**，`git fetch` + `git push` 一次成功，`b5a3ee9..0b10318 master -> master`。同时 GCM 完成 `github login`，凭证落库后可裸 `git push`。**详见「2.5 推送前必读」的 2026-10-14 更新** |
| 2026-09-17 | github.com (443) | ✅ **通** | 根因查明：git 默认 `sslBackend=openssl` 在本机 fake-IP(198.18.0.22) 网络下 TLS 握手卡死。改 `http.sslBackend=schannel` + `http.version=HTTP/1.1` + `http.proxy=` 后裸命令秒回 `refs/heads/master`；`curl --noproxy '*' https://github.com` → `http=200`(0.4s)。**详见「2.5 推送前必读」**（注：该 workaround 在 2026-10-14 复测中已非必需） |
| 2026-09-16 | github.com (443) | ❌ 误判为不通 | 当时裸 `git ls-remote`（openssl + 走沙箱代理 + HTTP/2）25s 超时、`curl` 未加 `--noproxy` 得 `http=000`。**根因已在 2026-09-17 查明** |
| | registry.npmjs.org | | |
| | registry.npmmirror.com | | |
| | pypi.org | | |
| | pypi.tuna.tsinghua.edu.cn | | |
| | nodejs.org | | |
| | ghproxy.com | | |

> 通道确实不通时的替代做法：本地 commit 后用 `git bundle create <file> origin/master..master` 打包，拿到有网机器上 `git fetch <file> master` 即可取回提交。

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
