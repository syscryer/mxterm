# GitHub 发布流程与应用更新设计

## 目标边界

本任务建立 mXterm 的正式发版主干，而不是临时打包脚本。发布范围为 Windows x64、macOS Apple Silicon、Linux x64。Windows 提供 NSIS 安装包和绿色版 zip；macOS 提供 Apple Silicon 的安装/手动下载资产；Linux 提供 `deb`、`rpm`、`AppImage`。应用内更新只覆盖可由 Tauri updater 安装的目标资产：Windows NSIS 安装包、macOS `.app.tar.gz`、Linux AppImage。

本任务不引入 Node runtime flavor，不打包 Node runtime。OS 级代码签名、Apple notarization 只在 workflow 中预留接入位置，不作为本任务的完成条件。

## 发布流水线

新增 `.github/workflows/release.yml`，触发条件为：

- `workflow_dispatch`：完整运行多平台构建、资产收集、源码包、`latest.json` 和 `SHA256SUMS.txt` 验证，但不创建 GitHub Release。
- `push.tags: v*`：运行同样构建和资产准备，publish job 只消费已准备资产并创建 GitHub Release。

构建 job 使用矩阵：

| 平台 | runner | 构建目标 | bundle | updater 目标 |
|---|---|---|---|---|
| Windows x64 | `windows-latest` | host x64 | `nsis` | NSIS `.exe` |
| macOS arm64 | `macos-26` | `aarch64-apple-darwin` | `app,dmg` | `.app.tar.gz` |
| Linux x64 | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `deb,rpm,appimage` | `.AppImage` |

Workflow 使用 pnpm，因为项目的 Tauri `beforeBuildCommand` 已经使用 `pnpm build && pnpm build:mcp-sidecar`，且仓库有 `pnpm-lock.yaml`。Node 版本使用 22，Rust 使用 stable。Linux runner 安装 Tauri 所需 GTK/WebKit、RPM、AppImage 相关依赖。

正式发布前校验 `vX.Y.Z` tag 和三个版本源一致：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

校验失败时直接失败并输出明确错误。手动触发没有 tag 时仍可构建验证，但不会 publish。

## 构建脚本

新增 `scripts/build-platform.mjs` 作为本地和 CI 的统一入口，`package.json` 添加：

- `package:win`
- `package:mac-arm64`
- `package:linux`
- `package:all`

脚本只负责组合 Tauri CLI 参数。普通本地打包不默认生成 updater 签名产物，避免没有私钥时本地 build 被阻断。Release workflow 设置 `MXTERM_CREATE_UPDATER_ARTIFACTS=1`，脚本再向 Tauri CLI 追加：

```json
{"bundle":{"createUpdaterArtifacts":true}}
```

这样 `tauri.conf.json` 保存 updater endpoint/public key，但 updater artifact 只在发布构建中生成。

## 资产整理

新增 `scripts/release-assets.mjs`：

- 递归扫描 Tauri bundle 输出目录。
- 只复制支持的发布扩展：`.AppImage`、`.app.tar.gz`、`.deb`、`.dmg`、`.exe`、`.rpm`、`.zip`。
- 给资产名追加平台后缀，不追加 flavor，例如 `...-windows-x64.exe`、`...-macos-arm64.dmg`。
- 若源资产旁有 `.sig`，同步复制并保持和重命名后资产对应。

Windows 绿色版 zip 在 workflow 中从 release 可执行文件目录整理，包含应用可执行文件、Tauri updater 需要的 `_up_` 目录（如果存在）和 `portable.marker`。`portable.marker` 用于运行时识别绿色版，从而禁用应用内自动安装更新。

Prepare job 下载所有平台 artifacts 后：

- 复制平台资产到 `release-assets/`。
- 生成 `mxterm-<version>-source.zip`。
- 生成 `mxterm-<version>-source.tar.gz`。
- 运行 `scripts/generate-latest-json.mjs`。
- 生成 `SHA256SUMS.txt`。

Publish job 仅在 tag 触发时运行，下载 prepare job 上传的 `mxterm-release-assets`，并用 `softprops/action-gh-release` 创建 GitHub Release。`workflow_dispatch` 只保留准备好的 artifact 供人工检查。

## latest.json

新增 `scripts/generate-latest-json.mjs`，严格选择唯一 updater 资产：

| Tauri platform key | 选择规则 |
|---|---|
| `windows-x86_64` | 匹配 Windows x64 NSIS `.exe`，排除绿色版 zip |
| `darwin-aarch64` | 匹配 macOS arm64 `.app.tar.gz` |
| `linux-x86_64` | 匹配 Linux x64 `.AppImage` |

每个目标必须刚好匹配一个资产，并且必须存在同名 `.sig`。脚本读取 `.sig` 文件内容写入 `signature`，URL 指向 `https://github.com/syscryer/mxterm/releases/download/<tag>/<asset>`。任何缺失、空签名或歧义匹配都失败，防止发布损坏的 updater metadata。

## Tauri 集成

依赖和权限：

- Rust 依赖添加 `tauri-plugin-updater = "2"` 和 `tauri-plugin-process = "2"`。
- 前端依赖添加 `@tauri-apps/plugin-updater` 和 `@tauri-apps/plugin-process`。
- `src-tauri/capabilities/default.json` 添加 `updater:default` 和 `process:default`。
- `src-tauri/src/lib.rs` 初始化 updater/process 插件。

配置：

- `src-tauri/tauri.conf.json` 添加 `plugins.updater.pubkey`。
- endpoint 为 `https://github.com/syscryer/mxterm/releases/latest/download/latest.json`。
- Windows updater install mode 使用 passive。

Runtime command：

新增 `get_app_runtime_info` Tauri command，返回：

- `version`
- `repositoryUrl`
- `distributionMode`
- `isTauri`

`distributionMode` 至少区分：

- `desktop-installer`
- `desktop-portable`
- `desktop-appimage`
- `desktop-package`
- `web`

Windows 通过可执行文件目录下的 `portable.marker` 判断绿色版。Linux 通过 `APPIMAGE` 环境变量判断 AppImage；非 AppImage 的 deb/rpm 安装态返回 `desktop-package`，因为本任务的 Linux updater 目标只覆盖 AppImage。

## 前端更新状态

新增共享更新运行时模块和 hook：

- `src/shared/tauri/appUpdate.ts`：封装 `getAppRuntimeInfo`、`checkForAppUpdate`、`installAppUpdate`、下载进度文案。
- `src/features/settings/useAppUpdate.ts`：维护当前版本、检查状态、可用更新、安装进度、同版本本次运行关闭状态。

状态模型：

- `idle`
- `checking`
- `latest`
- `available`
- `installing`
- `failed`
- `unsupported`

自动检查只在以下条件触发：

- Tauri 桌面运行时。
- 非开发模式。
- `settings.basic.autoCheckAppUpdate` 为 true。
- 当前分发形态支持自动安装更新。

不支持场景：

- Web/预览环境：显示 Web 版不支持。
- 开发模式：显示开发模式不会检查更新。
- Windows 绿色版：提示去 Release 手动下载。
- Linux deb/rpm：提示当前 Linux 安装包需手动下载，AppImage 才支持自动安装。

## 设置页 UI

`BasicSettings` 新增 `autoCheckAppUpdate`，默认 true，并在 `normalizeSettings` 中兼容旧 localStorage。

`SettingsView` 的基础设置中新增“应用更新”信息区，复用现有 `SettingsRow`、`SettingsToggle`、`settings-action-button`、Lucide 图标和全局 token，不新建独立视觉体系。它展示：

- 当前版本和分发形态。
- 仓库链接 `https://github.com/syscryer/mxterm`。
- 当前检查/安装状态。
- “立即检查”按钮。
- 发现更新后的“安装并重启”按钮。
- “自动检查更新”开关。

按钮必须有 loading/disabled 状态。失败文案必须说明原因或恢复路径。

## 工作区主动提示

自动检查发现新版本后，`WorkspaceShell` 显示可关闭的常驻更新入口。推荐位置是标题栏右侧、窗口控制按钮左侧的紧凑状态 pill：

- `Download` 或 `RefreshCw` 图标。
- 文案为 `发现新版本 vX.Y.Z` 或 `有可用更新`。
- 主区域点击进入设置页基础设置的应用更新区域。
- 关闭按钮只关闭提示，不清除 updateInfo。

实现上补一个 `openSettingsSection(sectionId)` helper，统一：

```ts
setSettingsSectionRequest(sectionId);
setActiveView("settings");
```

关闭提示后，本次运行不再提示同一个版本；用户仍可在设置页手动检查或安装。

## 安全与敏感信息

本任务会生成或配置 Tauri updater key：

- public key 写入 `tauri.conf.json`。
- private key 保存到 ignored runtime 路径或由用户配置到 GitHub Secrets，绝不暂存。
- `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 只出现在 workflow secret 引用或 README 说明中。

实现和提交前必须检查没有 private key 文件、私钥内容或 signing password 进入 git。

## 回滚

若发布 workflow 或 updater 接入出问题，可按层回滚：

1. 先关闭前端自动检查入口和 workspace 提示。
2. 移除 updater/plugin-process 依赖与 capability。
3. 移除 `plugins.updater` 配置。
4. 保留 release asset 脚本可单独使用，或整体移除 `.github/workflows/release.yml` 与 `scripts/release-*`。
