import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const buildId = process.env.LOCADO_BUILD_ID || `${packageJson.version}-${Date.now().toString(36)}`;

function buildMetadata(): Plugin {
  return {
    name: "locado-build-metadata",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: packageJson.version, build: buildId }),
      });
    },
  };
}

// Tauri expects a fixed port and no auto-clearing of the terminal.
export default defineConfig({
  // GitHub Pages 部署在仓库子路径；本地和其他静态托管默认使用根路径。
  base: process.env.LOCADO_BASE || "/",
  define: {
    __LOCADO_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [buildMetadata()],
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
