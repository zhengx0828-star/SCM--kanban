@echo off
setlocal
rem ============================================================
rem  SCM 供应链看板 - 用 GitHub 下载的新代码更新本项目
rem  换代码，但保留：products.db(数据) / runtime / node_modules
rem
rem  用法：把从 GitHub 下载并解压出来的代码文件夹，
rem        直接拖到本 .bat 文件上松开即可。
rem ============================================================

rem 本项目目录（脚本所在目录，去掉尾部反斜杠）
set "TARGET=%~dp0"
set "TARGET=%TARGET:~0,-1%"

rem 拖拽进来的新代码目录，规范化为绝对路径
set "SOURCE=%~1"
if "%SOURCE%"=="" goto :usage
pushd "%SOURCE%" 2>nul || goto :badpath
set "SOURCE=%CD%"
popd
if not exist "%SOURCE%\backend\app" goto :badpath

echo ==========================================
echo   源（新代码）  : %SOURCE%
echo   目标（本项目）: %TARGET%
echo ==========================================
echo.
echo 将用新代码更新本项目，并保留以下本地资产：
echo   [保留] backend\products.db      你的看板数据
echo   [保留] runtime\                 Python 运行时
echo   [保留] frontend\node_modules\   前端依赖
echo.
pause

set "TS="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "TS=%%i"
if not defined TS set "TS=manual"

if exist "%TARGET%\backend\products.db" (
  copy /y "%TARGET%\backend\products.db" "%TARGET%\backend\products.db.bak-%TS%" >nul
  echo [1/3] 数据库已备份为 products.db.bak-%TS%
) else (
  echo [1/3] 未发现 products.db，跳过备份
)

echo [2/3] 正在更新代码，请稍候...
robocopy "%SOURCE%" "%TARGET%" /E /R:1 /W:1 /XD runtime node_modules .git .workbuddy __pycache__ .tmp-cleanup /XF products.db *.bak *.bak-orig /NFL /NDL /NJH /NJS /NP
if errorlevel 8 goto :fail
echo [3/3] 代码更新完成
echo.
echo 完成！请重新双击 start-all.bat 启动系统。
pause
exit /b 0

:usage
echo.
echo 用法：把从 GitHub 下载并解压出来的代码文件夹，拖到本脚本上再松开。
echo （解压后的文件夹里，应能直接看到 backend、frontend 等目录）
pause
exit /b 1

:badpath
echo.
echo [错误] 找不到这个文件夹，或它不像是本项目代码：%SOURCE%
echo 请确认拖入的是解压后、里面直接含 backend\app 的那一层文件夹。
pause
exit /b 1

:fail
echo.
echo [错误] 更新失败，请检查上方输出。
pause
exit /b 1
