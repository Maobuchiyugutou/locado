# Windows + WSL 开发指南

[返回中文 README](../README.zh-CN.md)

普通 Windows 用户不需要 WSL，直接运行 `scripts\run-windows.cmd` 即可。本指南仅用于当前电脑只能在 WSL Ubuntu 中运行 Node.js、npm 和 Vite 的特殊开发环境。

## 目录约定

当前流程以 `E:\Locado` 为唯一源码目录，并同步到 WSL 的 `~/Locado` 运行：

- 只在 `E:\Locado` 编辑源码，不要同时修改两个目录。
- `~/Locado` 是同步副本，其中的 `node_modules` 不参与同步。
- 固定使用 `http://localhost:1420`，避免浏览器按 origin 隔离后出现数据“丢失”的假象。

## 环境要求

- WSL Ubuntu
- nvm、Node.js 24+ 和 npm
- rsync

## 一键启动

双击项目根目录的 `start-locado.cmd`。脚本会先执行 `git pull --ff-only` 更新源码，再同步到 WSL、安装依赖、构建生产版本，并打开 `http://localhost:1420/`。如果无法快进更新，脚本会停止，不会继续构建旧代码。

也可以在 WSL 中手动执行：

```bash
bash /mnt/e/Locado/scripts/wsl-run.sh
cd ~/Locado
npm run build
npm run preview -- --host 127.0.0.1 --port 1420 --strictPort
```

保持终端运行，按 `Ctrl+C` 停止服务。

## 脚本用途

| 文件 | 用途 |
|---|---|
| `start-locado.cmd` | Windows 一键构建、启动并打开浏览器 |
| `scripts/wsl-run.sh` | 同步源码并执行 `npm ci` |
| `scripts/wsl-dev.sh` | 在 `~/Locado` 启动 Vite 开发服务 |
| `scripts/wsl-build.sh` | 准备 Node.js 环境、同步并构建 |
| `scripts/wsl-serve.sh` | 同步、构建并启动生产预览 |

## 验证

```bash
cd ~/Locado
npm test
npm run build
```

## 数据与网络安全

- `localhost:1420`、`127.0.0.1:1420` 和其他端口属于不同的数据空间，不要混用。
- 清理站点数据、换浏览器或换 origin 前，先通过“导入 / 导出”保存独立 JSON 备份。
- 开发服务只监听本机回环地址，不要为了局域网访问直接改为 `0.0.0.0`。
- Service Worker 只缓存应用壳和静态资源，不缓存任务快照。

## WSL 原生验收边界

WSLg 可用于检查 Tauri 窗口和基础功能，但 WSL 缺少系统通知服务时，无法验证 Linux 桌面通知。系统通知仍需在带通知服务的真实 Linux 桌面环境复验，详见 [分发与原生应用状态](distribution-plan.md)。
