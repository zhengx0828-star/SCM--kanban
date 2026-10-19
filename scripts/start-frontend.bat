@echo off
rem ============================================
rem  SCM 供应链看板 - 前端启动器
rem  Vite 开发服务于 http://localhost
rem ============================================
setlocal
cd /d "%~dp0..\frontend"

rem ===== 定位 Node：项目内置 runtime 优先，其次 .workbuddy 托管 =====
set "NODE_DIR=..\runtime\node"
if not exist "%NODE_DIR%\node.exe" set "NODE_DIR="
if not defined NODE_DIR (
    if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" (
        set "NODE_DIR=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6"
    )
)
if defined NODE_DIR (
    set "PATH=%NODE_DIR%;%PATH%"
    echo 前端 Node: %NODE_DIR%\node.exe
) else (
    echo 前端 Node: 使用系统 PATH
)

rem ===== 端口占用检查 =====
netstat -ano | findstr /C:":80 " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo.
    echo 端口 80 已被占用，前端可能已在运行，无需重复启动。
    echo 直接访问 http://localhost 即可。
    goto :eof
)

rem ===== 依赖缺失时安装 =====
if not exist "node_modules\vite" (
    echo [1/2] 安装前端依赖（首次略慢）...
    call npm install || goto :error
)

echo [2/2] 启动 Vite 服务于 http://localhost ...
"%NODE_DIR%\node.exe" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 80
goto :eof

:error
echo.
echo 启动失败，请查看上方错误信息后重试。
pause
exit /b 1
