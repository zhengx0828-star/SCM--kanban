import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    // 前端固定监听 80：浏览器直接访问 http://localhost（不带端口号）。
    // strictPort 必须开：否则 80 被占用时 Vite 会静默换到 81，页面"改了像没改"。
    port: 80,
    strictPort: true,
    // 开发环境将 /api 请求代理到 FastAPI 后端，规避 CORS 问题
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
