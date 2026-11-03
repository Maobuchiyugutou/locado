# Locado

**[English](README.md) | 简体中文**

Locado 是一个本地优先的待办工具，用于规划任务、培养习惯和专注工作。支持自然语言创建任务、灵活的整理方式和可安装的离线 PWA，无需账号、遥测或后端服务。

[![CI](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml/badge.svg)](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml)
[![许可证: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

![Locado 桌面应用](docs/assets/locado-desktop.png)

## 在线体验

[打开在线 Demo](https://maobuchiyugutou.github.io/locado/)，无需安装即可使用 Web/PWA 版本。任务和统计数据只保存在当前浏览器，不会上传；在线 Demo 与本地运行、桌面端的数据空间相互独立。

## 功能特点

- **自然语言 Quick Add**：一句话识别日期、时间、清单、标签、优先级、提醒和重复规则，保存前可逐项检查并修正。
- **灵活整理任务**：管理清单、子任务、备注和置顶，支持每天、每周、每月、每年及完成后若干天的重复规则。
- **实用的规划视图**：提供今天、最近 7 天、日历、自定义筛选器和可拖拽的四象限。
- **习惯与专注**：每日习惯打卡，番茄钟可关联任务，并在刷新后恢复运行或暂停状态。
- **本地优先 PWA**：支持离线使用、浅色/深色主题和键盘导航，无需账号，不收集遥测数据。
- **本机使用统计**：查看活跃天数、任务完成、Quick Add 识别质量和近 30 天活动；只保存每日计数，不记录任务内容。
- **数据可迁移**：支持滴答清单 CSV 导入、JSON 导出，以及最新 5 份本地备份的预览与恢复。

## 快速开始

克隆仓库：

```bash
git clone https://github.com/Maobuchiyugutou/locado.git
cd locado
```

运行对应系统的启动脚本：

**Windows**

```bat
scripts\run-windows.cmd
```

**macOS**

```bash
bash scripts/run-macos.sh
```

**Linux**

```bash
bash scripts/run-linux.sh
```

脚本会检查 Node.js 24+：Windows 通过 winget 安装，macOS/Linux 通过用户目录中的 nvm 安装。随后自动构建生产版本并打开 [http://localhost:1420](http://localhost:1420)。

保持终端运行，按 `Ctrl+C` 停止服务。脚本运行的是 Web/PWA 版本，不需要 Rust 或原生编译依赖。

## 数据与提醒

Locado 将数据保存在浏览器或 Tauri WebView 的 `localStorage` 中，不会把任务数据上传到服务器。

- 定期通过 **导入 / 导出** 单独导出 JSON 备份。5 份自动备份仍在同一本地存储中，不能替代独立导出的副本。
- 请固定使用 `http://localhost:1420`。浏览器数据按 origin 隔离，更换主机名或端口会使用不同的数据空间；清理站点数据或更换浏览器前请先导出。
- 浏览器/PWA 与桌面端的数据空间相互独立，可通过 JSON 导出和导入迁移。
- 提醒只在 Locado 运行时检查。关闭应用后不再检查提醒，当前不提供后台常驻通知服务。

## 开发

已安装 Node.js 24 或更新版本时：

```bash
npm ci
npm run dev
```

打开 [http://localhost:1420](http://localhost:1420)。运行回归测试并验证生产构建：

```bash
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 1420 --strictPort
```

## 项目结构

```text
src/                 应用、界面、存储与自然语言解析
src-tauri/           Tauri 2 桌面壳
public/              PWA manifest、Service Worker 和图标
tests/               Node.js 回归测试
scripts/             三平台启动与 WSL 开发脚本
docs/                使用指南、分发规划和应用截图
.github/             CI、Issue 表单和 PR 模板
```

## 文档与社区

- [Windows + WSL 开发指南](docs/zh-CN.md)
- [原生应用与分发状态](docs/distribution-plan.md)
- [后续任务](https://github.com/Maobuchiyugutou/locado/issues)
- [贡献指南](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)
- [安全策略](SECURITY.md)
- [报告问题](https://github.com/Maobuchiyugutou/locado/issues/new?template=bug_report.yml) · [提出功能建议](https://github.com/Maobuchiyugutou/locado/issues/new?template=feature_request.yml)

## 许可证

[MIT](LICENSE) © 2026 Maobuchiyugutou
