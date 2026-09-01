@echo off
rem ============================================
rem  Product Manager - One-Click Launcher
rem  一键启动：后端(8000) + 前端(5173) + 浏览器
rem
rem  运行时策略（★ 全部相对路径，项目可整体搬移，内网迁移无需改脚本）：
rem    Python : runtime\python\python.exe（内置，优先；后端依赖已装入其 site-packages）
rem             找不到时回退 .workbuddy 托管 Python
rem    Node   : runtime\node\node.exe（内置，优先，自带 npm/pnpm）
rem             找不到时回退系统 PATH
rem  前端包管理器 : pnpm 优先，回退 npm
rem ============================================
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo   产品管理系统 - 一键启动器
echo   前端页面: http://localhost:5173
echo   API 文档: http://localhost:8000/docs
echo ==========================================
echo.

rem ===== 定位 Python：项目内置 runtime 优先 =====
set "PYTHON=%ROOT%runtime\python\python.exe"
if not exist "%PYTHON%" (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe" (
        set "PYTHON=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
    )
)
if not exist "%PYTHON%" (
    echo [错误] 找不到 Python 3.13.12。
    echo   已尝试内置: %ROOT%runtime\python\python.exe
    echo   请将 runtime\python 目录放回项目后重试（内网迁移必须带上）。
    pause
    exit /b 1
)
echo 后端 Python: %PYTHON%

rem ===== 定位 Node：项目内置 runtime 优先 =====
set "NODE_DIR=%ROOT%runtime\node"
if not exist "%NODE_DIR%\node.exe" set "NODE_DIR="
if defined NODE_DIR (
    set "PATH=%NODE_DIR%;%PATH%"
    echo 前端 Node  : %NODE_DIR%\node.exe
) else (
    echo 前端 Node  : 使用系统 PATH
)

rem ===== 定位前端包管理器（pnpm 优先）=====
set "PKG_NAME="
set "PKG_CMD="
call :detect_pkgmgr
if not defined PKG_CMD goto :no_pkgmgr
echo 前端包管理器: %PKG_NAME%
echo.

rem ---- [1] 检查后端依赖（已装则跳过，内网无网也可直接启动）----
if exist "%ROOT%runtime\python\Lib\site-packages\fastapi" (
    echo [1/3] 后端依赖已就绪，跳过安装。
) else (
    echo [1/3] 安装后端依赖（首次较慢，请稍候）...
    "%PYTHON%" -m uv pip install -r backend\requirements.txt --python "%PYTHON%"
    if errorlevel 1 goto :error
)

rem ---- [2] 检查前端依赖 ----
echo [2/3] 检查前端依赖...
if not exist "frontend\node_modules" goto :setup_frontend
goto :frontend_ready

:setup_frontend
echo       安装前端依赖（首次较慢，请稍候）...
pushd frontend
call "%PKG_CMD%" install
popd
if errorlevel 1 goto :error

:frontend_ready
echo [2/3] 依赖检查完成.
echo.

rem ---- [3] 启动后端（端口空闲时） ----
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [3/3] 端口 8000 已被占用，后端可能已在运行，跳过启动。
) else (
    echo [3/3] 启动后端服务 http://127.0.0.1:8000 ...
    start "Product Backend" cmd /k "cd /d ""%~dp0backend"" && ""%PYTHON%"" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
)

rem ---- [4] 启动前端（端口空闲时） ----
if "%PKG_NAME%"=="pnpm" (
    set "DEV_CMD="%PKG_CMD%" run dev --host 127.0.0.1"
) else (
    set "DEV_CMD="%PKG_CMD%" run dev -- --host 127.0.0.1"
)
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [4/4] 端口 5173 已被占用，前端可能已在运行，跳过启动。
) else (
    echo [4/4] 启动前端服务 http://localhost:5173 ...
    start "Product Frontend" cmd /k "cd /d ""%~dp0frontend"" && %DEV_CMD%"
)

echo.
echo 正在等待服务启动，稍后自动打开浏览器...
timeout /t 6 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo 启动完成！
echo   前端页面: http://localhost:5173
echo   API 文档: http://localhost:8000/docs
echo   关闭对应的服务窗口即可停止该服务。
pause
exit /b 0

rem ===== 子过程：定位包管理器（内置 runtime 优先，其次系统）=====
:detect_pkgmgr
if defined NODE_DIR (
    if exist "%NODE_DIR%\pnpm.cmd" (
        set "PKG_NAME=pnpm" & set "PKG_CMD=%NODE_DIR%\pnpm.cmd" & goto :eof
    )
    if exist "%NODE_DIR%\npm.cmd" (
        set "PKG_NAME=npm" & set "PKG_CMD=%NODE_DIR%\npm.cmd" & goto :eof
    )
)
where pnpm >nul 2>&1
if not errorlevel 1 ( set "PKG_NAME=pnpm" & set "PKG_CMD=pnpm" & goto :eof )
where npm >nul 2>&1
if not errorlevel 1 ( set "PKG_NAME=npm" & set "PKG_CMD=npm" & goto :eof )
if exist "%ProgramFiles%\nodejs\npm.cmd" (
    set "PKG_NAME=npm" & set "PKG_CMD=%ProgramFiles%\nodejs\npm.cmd" & goto :eof
)
goto :eof

:no_pkgmgr
echo.
echo [错误] 未找到 npm / pnpm 命令。
echo 请将 runtime\node 目录放回项目后重试，或安装 Node.js LTS 并加入 PATH。
pause
exit /b 1

:error
echo.
echo 启动失败，请检查上方错误信息后重试。
pause
exit /b 1
