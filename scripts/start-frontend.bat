@echo off
rem ============================================
rem  Product Manager - Frontend Launcher
rem  Starts Vite dev server on http://localhost:5173
rem  运行时：项目内置 runtime\node（全相对路径，可整体搬移），pnpm 优先
rem ============================================
setlocal
cd /d "%~dp0..\frontend"

rem ===== 定位 Node：项目内置 runtime 优先 =====
set "NODE_DIR="
for %%I in ("..\runtime\node") do set "NODE_DIR=%%~fI"
if not exist "%NODE_DIR%\node.exe" set "NODE_DIR="
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"

rem ===== 定位前端包管理器（pnpm 优先）=====
set "PKG_NAME="
set "PKG_CMD="
call :detect_pkgmgr
if not defined PKG_CMD goto :no_pkgmgr
echo 使用 %PKG_NAME% 作为包管理器。

rem ===== 依赖缺失时才安装（内网已装则跳过）=====
if not exist "node_modules" (
    echo [1/2] 安装前端依赖（首次较慢）...
    call "%PKG_CMD%" install || goto :error
)

rem ===== 端口占用检查 =====
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo.
    echo 端口 5173 已被占用，前端可能已在运行，无需重复启动。
    echo 直接访问 http://localhost:5173 即可。
    goto :eof
)

echo [2/2] 启动 Vite 开发服务 http://localhost:5173 ...
if "%PKG_NAME%"=="pnpm" (
    call "%PKG_CMD%" run dev --host 127.0.0.1
) else (
    call "%PKG_CMD%" run dev -- --host 127.0.0.1
)
goto :eof

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
exit /b 1
