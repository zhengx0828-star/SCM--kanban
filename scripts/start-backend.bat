@echo off
rem ============================================
rem  Product Manager - Backend Launcher
rem  Starts FastAPI server on http://localhost:8000
rem  运行时：项目内置 runtime\python（全相对路径，可整体搬移）
rem ============================================
setlocal
cd /d "%~dp0..\backend"

rem ===== 定位 Python：项目内置 runtime 优先，回退 .workbuddy =====
set "PYTHON=..\runtime\python\python.exe"
if not exist "%PYTHON%" (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe" (
        set "PYTHON=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
    )
)
if not exist "%PYTHON%" (
    echo [错误] 找不到 Python 3.13.12。
    echo   已尝试内置: %~dp0..\runtime\python\python.exe
    echo   请将 runtime\python 目录放回项目后重试。
    exit /b 1
)

rem ===== 依赖缺失时才安装（内网已装则跳过）=====
if not exist "..\runtime\python\Lib\site-packages\fastapi" (
    echo [1/2] 安装后端依赖（首次较慢）...
    "%PYTHON%" -m uv pip install -r requirements.txt --python "%PYTHON%" || goto :error
)

echo [2/2] 启动 FastAPI 服务 http://localhost:8000 ...
echo API 文档: http://localhost:8000/docs
"%PYTHON%" -m uvicorn app.main:app --reload --port 8000
goto :eof

:error
echo.
echo 启动失败，请检查上方错误信息后重试。
exit /b 1
