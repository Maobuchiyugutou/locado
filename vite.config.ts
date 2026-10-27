import { defineConfig } from "vite";

// Tauri expects a fixed port and no auto-clearing of the terminal.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // 只监听本机回环;同时让启动日志显示 localhost,避免误用 127.0.0.1 打开。
    // 注意:localhost 和 127.0.0.1 在浏览器里是两个存储空间,请固定用 localhost。
    host: "localhost",
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
