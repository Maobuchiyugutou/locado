# Locado

**[English](README.md) | 简体中文**

Locado 是一个本地优先的待办工具，支持清单、标签、四象限、习惯打卡、专注番茄钟，以及可安装、可离线运行的 PWA。

基于 Vite 和 TypeScript 构建，不依赖 UI 框架。数据保存在本机，可随时导出备份。

[![CI](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml/badge.svg)](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml)
[![许可证: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

![Locado 桌面应用](docs/assets/locado-desktop.png)

## 功能特点

- **完整的任务管理**：清单、标签、子任务、备注、优先级、提醒、置顶，以及独立的重要性和紧急度。
- **多种规划视图**：今天、最近 7 天、全部、已完成、日历、自定义筛选器和可拖拽的四象限。
- **习惯与专注**：每日习惯打卡，以及可关联任务的番茄钟。
- **本地优先、支持离线**：无需账号、遥测或后端，支持安装 PWA 并离线工作。
- **数据可迁移**：JSON 备份与恢复，支持滴答清单 CSV 导入。
- **桌面端体验**：浅色/深色主题、液态玻璃界面、键盘导航和无障碍弹窗。

## 普通用户使用

当前版本仍需从源码运行，Windows、macOS 和 Linux 原生安装包尚未发布，不提供虚假下载链接。

全平台安装包、签名和发布计划见 [全平台分发规划](docs/distribution-plan.md)。后续正式下载页会区分普通用户与开发者，不要求安装 Node.js 或 WSL。

## 从源码运行

### 环境要求

- Windows、macOS 或 Linux
- Node.js 24 或更新版本
- npm

**普通 Windows 用户不需要 WSL。** WSL 只是当前开发电脑的特殊环境方案。

```bash
npm ci
npm run dev
```

打开 [http://localhost:1420](http://localhost:1420)。

### 生产构建

```bash
npm run build
npm run preview -- --port 1420 --strictPort
```

### 自动化测试

```bash
npm test
npm run build
```

测试覆盖中文自然语言日期、CSV 导入、旧快照兼容、本地存储、番茄记录幂等和损坏数据恢复。

当前电脑的一键 Windows + WSL 流程见 [中文使用与 WSL 指南](docs/zh-CN.md)。

## 数据与隐私

Locado 当前将数据快照保存在浏览器 `localStorage` 中，不会把任务数据上传到服务器。

- 定期通过“导入 / 导出 → 导出 JSON 备份”保存数据。
- 浏览器数据按 origin 隔离，请固定使用 `http://localhost:1420`，不要在 `localhost`、`127.0.0.1` 或不同端口之间切换。
- 清理站点数据或更换浏览器前，请先导出备份。
- 浏览器与后续原生应用的数据空间不同，迁移时通过 JSON 导出和导入完成。

## 项目结构

```text
src/                 应用、存储、解析与界面
public/              PWA manifest、Service Worker 和图标
tests/               Node.js 回归测试
scripts/             Windows + WSL 开发脚本
docs/                使用指南、分发规划和应用截图
.github/             CI、Issue 表单和 PR 模板
```

## 开发规划

- [全平台原生安装包与发布流水线](docs/distribution-plan.md)
- Tauri + SQLite 存储适配器
- 移动端导航与窄屏布局
- 可重复运行的浏览器端到端测试
- 更多导入与导出格式

## 社区文档

- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [更新日志](CHANGELOG.md)

## 许可证

[MIT](LICENSE) © 2026 Maobuchiyugutou
