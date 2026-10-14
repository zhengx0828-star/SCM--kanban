@echo off
rem ============================================
rem  SCM 供应链看板 - 一键启动器
rem  前端(5173) + 后端(8000) + 自动打开浏览器
rem
rem  定位顺序（全相对路径，迁移后无需修改）：
rem    Python : runtime\python\python.exe  →  .workbuddy venv  →  .workbuddy 托管
rem    Node   : runtime\node\node.exe      →  系统 PATH
rem ============================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo   SCM 供应链看板 - 一键启动
echo   前端页面: http://localhost:5173
echo   API 文档: http://localhost:8000/docs
echo ==========================================
echo.

rem ===== 定位 Python：项目内置 runtime 优先 =====
set "PYTHON="
if exist "%ROOT%runtime\python\python.exe" (
    set "PYTHON=%ROOT%runtime\python\python.exe"
    set "SITE=%ROOT%runtime\python\Lib\site-packages"
)
if not defined PYTHON (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe" (
        set "PYTHON=%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
        set "SITE=%USERPROFILE%\.workbuddy\binaries\python\envs\default\Lib\site-packages"
    )
)
if not defined PYTHON (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe" (
        set "PYTHON=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
        set "SITE=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\Lib\site-packages"
    )
)
if not defined PYTHON (
    echo [错误] 未找到 Python 解释器。
    echo   已尝试: runtime\python\python.exe
    echo   已尝试: .workbuddy venv / 托管 Python
    pause
    exit /b 1
)
echo 后端 Python: %PYTHON%

rem ===== 检查后端依赖是否就绪 =====
if exist "%SITE%\fastapi" (
    echo [1/4] 后端依赖已就绪，跳过安装。
) else (
    echo [1/4] 安装后端依赖（首次略慢）...
    "%PYTHON%" -m pip install -r backend\requirements.txt
    if errorlevel 1 goto :error
)

rem ===== 定位 Node =====
set "NODE_DIR=%ROOT%runtime\node"
if not exist "%NODE_DIR%\node.exe" set "NODE_DIR="
if not defined NODE_DIR (
    if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" (
        set "NODE_DIR=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6"
    )
)
if defined NODE_DIR (
    set "PATH=%NODE_DIR%;%PATH%"
    echo 前端 Node  : %NODE_DIR%\node.exe
) else (
    echo 前端 Node  : 使用系统 PATH
)

rem ===== 检查前端依赖 =====
echo [2/4] 检查前端依赖...
if not exist "frontend\node_modules\vite" (
    echo       安装前端依赖（首次略慢）...
    pushd frontend
    call npm install
    popd
    if errorlevel 1 goto :error
)
echo       前端依赖已就绪。

rem ===== 启动后端 =====
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [3/4] 端口 8000 已被占用，后端可能已在运行，跳过。
) else (
    echo [3/4] 启动后端服务 http://127.0.0.1:8000 ...
    start "SCM Backend" cmd /k "cd /d ""%ROOT%backend"" && ""%PYTHON%"" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
)

rem ===== 启动前端（直接调 vite 入口，不依赖 pnpm）=====
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [4/4] 端口 5173 已被占用，前端可能已在运行，跳过。
) else (
    echo [4/4] 启动前端服务 http://localhost:5173 ...
    start "SCM Frontend" cmd /k "cd /d ""%ROOT%frontend"" && ""%NODE_DIR%\node.exe"" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173"
)

echo.
echo 稍候数秒，浏览器将自动打开...
"%SystemRoot%\System32\timeout.exe" /t 8 /nobreak >nul 2>&1
start "" "http://localhost:5173"

echo.
echo 启动完成！
echo   SCM 供应链看板: http://localhost:5173
echo   API 文档: http://localhost:8000/docs
echo   关闭对应服务窗口即可停止。
pause
exit /b 0

:error
echo.
echo 启动失败，请查看上方错误信息后重试。
pause
exit /b 1
