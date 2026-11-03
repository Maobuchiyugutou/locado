# Locado 分发与原生应用状态

[返回中文 README](../README.zh-CN.md)

## 当前获取方式

Locado 提供[在线 Web/PWA Demo](https://maobuchiyugutou.github.io/locado/)，并通过**源码 + 三平台启动脚本**分发。在线 Demo 无需安装；任务与统计数据仅保存在当前浏览器，不上传。用户也可以克隆仓库，按照 [快速开始](../README.zh-CN.md#快速开始) 运行对应脚本使用本地 Web/PWA 生产版本。

- Windows：`scripts\run-windows.cmd`
- macOS：`bash scripts/run-macos.sh`
- Linux：`bash scripts/run-linux.sh`

脚本会检查 Node.js 24+、安装项目依赖、构建应用并打开 `http://localhost:1420`。此路径不需要 Rust、WSL 或原生编译依赖。

当前**不发布 GitHub Releases 安装包，也不提供 PyPI 包**。README 不放置尚未提供的下载链接。

## 平台状态

| 平台 | Web/PWA 启动脚本 | Tauri 原生状态 |
|---|---|---|
| Windows | 已提供 | 原生构建与真机验收未完成 |
| macOS | 已提供 | 原生构建与真机验收未完成 |
| Linux | 已提供 | CI 编译检查和 WSLg 部分功能验收已完成，系统通知仍待复验 |

“CI 构建通过”只说明代码能够在对应环境编译，不等于该平台的功能验收通过。

## 原生壳现状

`src-tauri` 中的 Tauri 2 原生壳复用现有前端，不重写业务逻辑：

- 使用本地 `dist` 资源，原生模式不注册 Service Worker。
- 保留浏览器/Tauri WebView `localStorage` 数据层，不同步引入 SQLite。
- 配置窗口、图标、严格 CSP、单实例，以及文件保存和通知插件。
- GitHub Actions 执行测试、前端生产构建、Rust `cargo check` 和 Linux 不打包原生构建。

Linux/WSL 已验证原生 Release 构建、离线启动、重启持久化、JSON 导出、应用内提醒和单实例行为。当前 WSL 环境没有系统通知服务，因此不能据此宣称 Linux 系统级通知已通过。

## 后续验收任务

- [Windows 原生应用验收](https://github.com/Maobuchiyugutou/locado/issues/2)
- [macOS 原生应用验收](https://github.com/Maobuchiyugutou/locado/issues/3)
- [Linux 桌面通知复验](https://github.com/Maobuchiyugutou/locado/issues/1)
- [浏览器端到端回归测试](https://github.com/Maobuchiyugutou/locado/issues/4)

这些任务用于明确当前限制，不代表承诺发布安装包。

## 数据与提醒边界

- 浏览器/PWA 与 Tauri WebView 的数据空间相互独立，迁移时使用 JSON 导出和导入。
- 提醒只在 Locado 运行时检查，不提供关闭应用后的后台通知服务。
- 自动备份与当前快照位于同一本地存储中，不能替代独立导出的 JSON 副本。

## 分发策略变更

目前不以安装包、签名、公证或应用商店上架为目标。若未来决定改变分发方式，应先单独评估构建矩阵、逐平台验收、签名与数据迁移，再更新本文和 README；在正式提供前不提前展示下载入口。
