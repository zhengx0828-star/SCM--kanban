#!/usr/bin/env bash
# ============================================
#  Product Manager - Backend Launcher
#  Starts FastAPI server on http://localhost:8000
#  运行时：项目内置 runtime/python（全相对路径，可整体搬移）
# ============================================
set -e
cd "$(dirname "$0")/../backend"

# 定位 Python：项目内置 runtime 优先
PYTHON=""
for cand in "../runtime/python/bin/python3" "../runtime/python/python.exe"; do
  if [ -x "$cand" ]; then PYTHON="$cand"; break; fi
done
if [ -z "$PYTHON" ]; then
  echo "[错误] 找不到 Python 3.13+。请将 runtime/python 目录放回项目后重试。"
  exit 1
fi

# 依赖缺失时才安装（内网已装则跳过）
if [ ! -d "../runtime/python/Lib/site-packages/fastapi" ] && [ ! -d "../runtime/python/lib/python3.13/site-packages/fastapi" ]; then
  echo "[1/2] 安装后端依赖（首次较慢）..."
  "$PYTHON" -m uv pip install -q -r requirements.txt --python "$PYTHON"
fi

echo "[2/2] 启动 FastAPI 服务 http://localhost:8000 ..."
echo "API 文档: http://localhost:8000/docs"
"$PYTHON" -m uvicorn app.main:app --reload --port 8000
