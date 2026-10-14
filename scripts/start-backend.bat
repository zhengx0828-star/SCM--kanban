@echo off
rem ============================================
rem  SCM 供应链看板 - 后端启动器
rem  FastAPI 服务于 http://localhost:8000
rem ============================================
setlocal
cd /d "%~dp0..\backend"

rem ===== 定位 Python：项目内置 runtime 优先，其次 .workbuddy venv / 托管 =====
set "PYTHON=..\runtime\python\python.exe"
if not exist "%PYTHON%" (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe" (
        set "PYTHON=%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
    )
)
if not exist "%PYTHON%" (
    if exist "%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe" (
        set "PYTHON=%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
    )
)
if not exist "%PYTHON%" (
    echo [错误] 未找到 Python 解释器。
    echo   已尝试: %~dp0..\runtime\python\python.exe
    echo   请将 runtime\python 放回项目，或安装 .workbuddy 托管 Python。
    pause
    exit /b 1
)
echo 后端 Python: %PYTHON%

rem ===== 依赖缺失时安装（用 pip，不依赖 uv）=====
"%PYTHON%" -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo [1/2] 安装后端依赖（首次略慢）...
    "%PYTHON%" -m pip install -r requirements.txt || goto :error
)

echo [2/2] 启动 FastAPI 服务于 http://localhost:8000 ...
echo API 文档: http://localhost:8000/docs
"%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:error
echo.
echo 启动失败，请查看上方错误信息后重试。
pause
exit /b 1
