# Locado 全平台分发规划

## 1. 目标与边界

目标：普通 Windows、macOS 和 Linux 用户无需安装 Node.js、WSL 或开发工具，能够从 GitHub Releases 下载、安装并离线使用 Locado。

当前阶段只覆盖桌面原生安装包。Android 和 iOS 可通过现有 PWA 使用，不纳入首轮原生打包。自动更新、应用商店上架和 SQLite 迁移也不作为首轮发布前置条件。

## 2. 当前基础与主要缺口

已有：

- Vite + TypeScript 前端、PWA 和离线应用壳
- 浏览器 `localStorage` 数据层、JSON 备份和 CSV 导入
- Tauri 2 前端依赖、自动化测试和生产构建
- 基础 GitHub Actions CI

缺少：

- `src-tauri` 原生应用、窗口与打包配置
- 原生备份导出、通知和持久化验收
- 三平台构建矩阵、签名、公证和 Release 产物
- 面向普通用户的下载与排障教程

WSL 只是当前开发电脑的限制，不是 Locado 的运行依赖。其他开发者可以在 Windows、macOS 或 Linux 上直接使用原生 Node.js 24+ 构建。

## 3. 下载产物

| 平台 | 主下载 | 备用下载 | 目标用户 |
|---|---|---|---|
| Windows x64 | NSIS 安装包 `.exe` | 免安装 `.zip` | 普通用户；无管理员权限用户使用 ZIP |
| macOS Apple Silicon | ARM64 `.dmg` | — | M 系列芯片 Mac |
| macOS Intel | x64 `.dmg` | — | Intel Mac |
| Linux x64 | AppImage | `.deb` | 主流发行版；AppImage/FUSE 异常时使用 DEB |

建议命名：

```text
Locado_<version>_windows-x64-setup.exe
Locado_<version>_windows-x64-portable.zip
Locado_<version>_macos-arm64.dmg
Locado_<version>_macos-x64.dmg
Locado_<version>_linux-x64.AppImage
Locado_<version>_linux-x64.deb
```

下载页每个系统只突出一个主按钮，其余格式放入“更多下载”，避免用户选择困难。

## 4. 分阶段实施

### 阶段 A：最小 Tauri 原生壳

- 创建 `src-tauri`，复用现有 `dist` 前端，不重写业务逻辑。
- 配置应用标识、版本、窗口尺寸、图标、单实例和严格 CSP。
- 原生模式不注册 Service Worker；静态资源由 Tauri 本地协议加载。
- 验证 JSON 导出在原生环境使用可靠的文件保存方式。
- 保持现有 `localStorage`，不把 SQLite 迁移与安装包绑定。
- Windows、macOS、Linux 分别完成开发模式启动和生产构建。

验收：应用能离线启动，新增任务后重启仍存在，主题、提醒和 JSON 备份恢复可用。

### 阶段 B：GitHub Actions 构建矩阵

- `windows-latest`：Windows x64 NSIS 和便携 ZIP。
- `macos-latest`：ARM64 与 x64 DMG。
- `ubuntu-latest`：AppImage 和 DEB。
- 所有平台先执行 `npm ci`、`npm test`、`npm run build`，再执行 Tauri 构建。
- 手动触发或推送预发布标签时上传构件，先形成内部测试 Release。
- 为每个产物生成 SHA-256 校验和，证书只保存在 GitHub Secrets。

验收：干净 CI 环境可以重复生成相同类型的安装包，Release 中不包含本机路径、日志或个人数据。

### 阶段 C：逐平台兼容性验收

- Windows 10/11：安装包与便携 ZIP、WebView2 引导、SmartScreen 行为。
- macOS Apple Silicon 与 Intel：架构选择、DMG 安装、Gatekeeper、签名和公证。
- Ubuntu LTS：AppImage 与 DEB、WebKitGTK 依赖、离线启动。

每个平台均检查：首次启动、新增/编辑任务、重启持久化、完全离线、JSON 备份恢复、通知、深浅色和关闭后再打开。

### 阶段 D：签名、公开发布与下载教程

- Windows 配置代码签名，降低 SmartScreen 和 Smart App Control 拦截。
- macOS 使用 Developer ID 签名并完成公证。需要 Apple Developer 账号（官方费用为 99 美元/年）以及可用于签名和验证的 Mac 环境。
- 未签名产物只能作为明确标注的测试版，不作为“下载即用”的正式公开版本。
- 推送 `v*` 标签生成 GitHub Release，附安装包、校验和和 Release Notes。
- 自动更新在首个稳定版本验证后单独加入。

## 5. 数据与迁移

浏览器和 Tauri WebView 的存储空间不能视为同一份数据。

- 从浏览器迁移到原生版：用户在浏览器导出 JSON，再在原生版导入。
- 从原生版迁回浏览器：反向执行相同步骤。
- 不静默扫描或搬运浏览器数据，不自动覆盖已有快照。
- 导入前显示替换提示，继续沿用现有快照规整与损坏备份。
- 后续 SQLite 适配器必须独立评估迁移，不改变本轮安装包的数据语义。

## 6. 用户常见问题与预案

| 问题 | 预案 |
|---|---|
| 用户没有 Node.js 或 WSL | 普通下载页不要求任何开发工具；开发构建单独说明 Node.js 24+ |
| Windows 启动缺少 WebView2 | 安装器检测并提供引导，文档附手动入口 |
| 公司电脑没有管理员权限 | 提供 Windows 便携 ZIP |
| Windows SmartScreen / Smart App Control | 正式版签名；测试版明确警告，不指导用户关闭系统安全功能 |
| 用户不知道 Mac 芯片 | 下载页提供 Apple Silicon 与 Intel 的识别说明 |
| macOS 提示无法验证开发者 | 正式版签名并公证，不以绕过 Gatekeeper 作为正式教程 |
| AppImage 无法运行 | 提供 DEB 和 WebKitGTK/FUSE 排障说明 |
| 浏览器已有任务 | 提供 JSON 迁移教程和导入前备份提示 |
| 原生版离线无法打开 | 在逐平台验收中覆盖完全离线启动 |
| 用户误下错误架构 | 使用清晰文件名、系统主按钮和校验和 |

## 7. 发布流程

1. 更新 `package.json`、Tauri 配置、Rust 包版本和 `CHANGELOG.md`。
2. 运行全部单元测试、生产构建和原生兼容性验收。
3. 创建预发布标签，检查 CI 产物与 Release 内容。
4. 在真实 Windows、macOS、Linux 环境安装并验证。
5. 完成正式签名和 macOS 公证后发布稳定版本。
6. 提供中文/英文下载说明、校验和、问题反馈入口和回退版本。

## 8. 文档要求

- README 首先区分“普通用户下载”和“开发者从源码构建”。
- 安装包发布前不放置虚假下载链接，明确标注当前状态。
- Windows 教程不再以 WSL 为主路径；WSL 仅保留为当前开发环境的可选方案。
- 每个平台只展示一个推荐下载入口，其他格式折叠到“更多下载”。
- 排障内容覆盖架构、权限、WebView2、签名、公证、数据迁移和离线启动。

## 官方参考

- [Tauri 分发概览](https://v2.tauri.app/distribute/)
- [Tauri GitHub Actions 流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)
- [Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)
