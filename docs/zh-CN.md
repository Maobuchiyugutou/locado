# Locado 中文使用与 WSL 指南

[返回完整中文 README](../README.zh-CN.md)

Locado 是一个本地优先的待办、习惯打卡与专注工具。当前版本在浏览器中运行，数据保存在浏览器 `localStorage`，无需账号或后端服务。

## 功能

- 清单、标签、子任务、备注、优先级、提醒和置顶
- 独立的重要性与紧急度，以及可拖拽的四象限视图
- 今天、最近 7 天、全部、已完成、日历和自定义筛选器
- 习惯打卡、番茄钟及关联任务
- 浅色/深色主题、键盘操作、PWA 安装与离线运行
- JSON 备份/恢复、滴答清单 CSV 导入

## 常规开发

需要 Node.js 24 或更新版本。

```bash
npm ci
npm run dev
```

打开 `http://localhost:1420`。

```bash
npm test          # 运行自动化测试
npm run build     # 类型检查与生产构建
npm run preview -- --port 1420 --strictPort
```

## Windows + WSL 一键启动

当前电脑约定以 `E:\Locado` 为主源码目录，再同步到 WSL 的 `~/Locado` 运行。不要在两个目录中分别编辑。

1. 在 WSL Ubuntu 中安装 nvm、Node.js 24、npm 和 rsync。
2. 双击项目根目录的 `start-locado.cmd`。
3. 脚本会同步、构建并打开 `http://localhost:1420/`。

也可以手动执行：

```bash
bash /mnt/e/Locado/scripts/wsl-run.sh
cd ~/Locado
npm test
npm run build
npm run preview -- --port 1420 --strictPort
```

`wsl-dev.sh` 用于 Vite 开发服务，`wsl-serve.sh` 用于同步、构建和生产预览。

## 数据安全与备份

- 数据只保存在当前浏览器和当前 origin 中，不会上传。
- `localhost:1420`、`127.0.0.1:1420` 和其他端口属于不同的数据空间。
- 重启电脑、关闭浏览器或停止本地服务不会主动清除数据。
- 清理浏览器站点数据、换浏览器或换 origin 前，请先在“导入 / 导出”中导出 JSON 备份。
- Service Worker 只缓存应用壳和静态资源，不缓存任务快照。

## 参与贡献

提交前请运行：

```bash
npm test
npm run build
```

详见 [Contributing](../CONTRIBUTING.md)、[安全策略](../SECURITY.md) 和 [更新日志](../CHANGELOG.md)。
