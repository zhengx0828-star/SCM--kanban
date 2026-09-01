#!/usr/bin/env bash
# ============================================
#  Product Manager - Frontend Launcher
#  Starts Vite dev server on http://localhost:5173
#  运行时：项目内置 runtime/node（全相对路径，可整体搬移），pnpm 优先
# ============================================
set -e
cd "$(dirname "$0")/../frontend"

# 定位 Node：项目内置 runtime 优先（linux/mac 布局 bin/node，win 布局 node.exe）
if [ -d "../runtime/node" ]; then
  NODE_ABS="$(cd ../runtime/node && pwd)"
  export PATH="$NODE_ABS/bin:$NODE_ABS:$PATH"
fi

# 定位包管理器（pnpm 优先）
if command -v pnpm >/dev/null 2>&1; then
  PKGMGR="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PKGMGR="npm"
else
  echo "[错误] 未找到 npm/pnpm。请将 runtime/node 目录放回项目后重试。"
  exit 1
fi
echo "使用 ${PKGMGR} 作为包管理器。"

# 依赖缺失时才安装（内网已装则跳过）
if [ ! -d "node_modules" ]; then
  echo "[1/2] 安装前端依赖（首次较慢）..."
  ${PKGMGR} install
fi

echo "[2/2] 启动 Vite 开发服务 http://localhost:5173 ..."
if [ "${PKGMGR}" = "pnpm" ]; then
  ${PKGMGR} run dev --host 127.0.0.1
else
  ${PKGMGR} run dev -- --host 127.0.0.1
fi
