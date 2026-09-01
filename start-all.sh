#!/usr/bin/env bash
# ============================================
#  Product Manager - One-Click Launcher
#  Starts backend (8000) + frontend (5173) together.
#
#  Runtime strategy (★ ALL RELATIVE PATHS, project is fully relocatable):
#    Python : runtime/python (linux/mac: bin/python3, win: python.exe)  -> preferred
#             backend deps are installed INTO its own site-packages
#             fallback: .workbuddy python
#    Node   : runtime/node  (bin/node or node.exe) -> prepended to PATH
#             fallback: system pnpm/npm
#  Package manager : pnpm preferred, then npm
# ============================================
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "=========================================="
echo "  产品管理系统 - 一键启动器"
echo "  前端页面: http://localhost:5173"
echo "  API 文档: http://localhost:8000/docs"
echo "=========================================="
echo

# --- locate Python: project runtime first ---
PYTHON=""
for cand in "$ROOT/runtime/python/bin/python3" "$ROOT/runtime/python/python.exe"; do
  if [ -x "$cand" ]; then PYTHON="$cand"; break; fi
done
if [ -z "$PYTHON" ] && [ -x "/c/Users/lisax/.workbuddy/binaries/python/versions/3.13.12/python.exe" ]; then
  PYTHON="/c/Users/lisax/.workbuddy/binaries/python/versions/3.13.12/python.exe"
fi
if [ -z "$PYTHON" ]; then
  echo "[错误] 找不到 Python 3.13+。请将 runtime/python 目录放回项目后重试。"
  exit 1
fi
echo "后端 Python: $PYTHON"

# --- locate Node: project runtime first (linux/mac layout: bin/node, win: node.exe) ---
NODE_DIR=""
if [ -x "$ROOT/runtime/node/bin/node" ] || [ -x "$ROOT/runtime/node/node.exe" ]; then
  NODE_DIR="$ROOT/runtime/node"
  export PATH="$NODE_DIR/bin:$NODE_DIR:$PATH"
  echo "前端 Node  : $NODE_DIR"
else
  echo "前端 Node  : 使用系统 PATH"
fi

# --- package manager: pnpm preferred ---
if command -v pnpm >/dev/null 2>&1; then
  PKGMGR="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PKGMGR="npm"
else
  echo "[错误] 未找到 npm/pnpm。请将 runtime/node 放回项目后重试。"
  exit 1
fi
echo "前端包管理器: $PKGMGR"
echo

# --- [1/3] backend deps (skip if present -> works offline) ---
if [ -d "$ROOT/runtime/python/Lib/site-packages/fastapi" ] || [ -d "$ROOT/runtime/python/lib/python3.13/site-packages/fastapi" ]; then
  echo "[1/3] 后端依赖已就绪，跳过安装。"
else
  echo "[1/3] 安装后端依赖（首次较慢）..."
  "$PYTHON" -m uv pip install -q -r backend/requirements.txt --python "$PYTHON"
fi

# --- [2/3] frontend deps ---
if [ ! -d "frontend/node_modules" ]; then
  echo "[2/3] 安装前端依赖（首次较慢）..."
  (cd frontend && ${PKGMGR} install)
else
  echo "[2/3] 前端依赖已就绪。"
fi
echo

# --- [3/3] start backend ---
echo "[3/3] 启动后端服务 http://127.0.0.1:8000 ..."
(cd backend && "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACK_PID=$!

# --- [4/4] start frontend ---
echo "[4/4] 启动前端服务 http://localhost:5173 ..."
if [ "${PKGMGR}" = "pnpm" ]; then
  (cd frontend && ${PKGMGR} run dev --host 127.0.0.1) &
else
  (cd frontend && ${PKGMGR} run dev -- --host 127.0.0.1) &
fi
FRONT_PID=$!

trap 'echo; echo "正在停止服务..."; kill $BACK_PID $FRONT_PID 2>/dev/null' EXIT

echo
echo "两个服务均已启动，按 Ctrl+C 可同时停止。"
echo "前端页面: http://localhost:5173"
echo "API 文档: http://localhost:8000/docs"
echo
wait
