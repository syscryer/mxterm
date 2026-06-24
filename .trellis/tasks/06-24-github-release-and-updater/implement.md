# GitHub 发布流程与应用更新实施计划

## 0. 准备检查

- [ ] 确认当前 dirty files，避免误改用户未提交内容。
- [ ] 确认 `.mcp.json` 是既有未跟踪文件，不纳入本任务。
- [ ] 读取 `prd.md`、`design.md`、`research/tauri-updater-and-codem.md`。
- [ ] 进入实现前加载 `trellis-before-dev`。

## 1. Updater key 与 Tauri 配置

- [ ] 生成 mXterm 独立 Tauri updater key。
  - public key 写入 `src-tauri/tauri.conf.json`。
  - private key 放在 ignored 路径，例如 `.trellis/.runtime/mxterm-updater.key`，不暂存、不提交。
- [ ] 更新 `src-tauri/tauri.conf.json`：
  - 添加 `plugins.updater.pubkey`。
  - 添加 endpoint `https://github.com/syscryer/mxterm/releases/latest/download/latest.json`。
  - Windows updater install mode 使用 passive。
- [ ] 添加 Rust / JS 插件依赖：
  - `tauri-plugin-updater`
  - `tauri-plugin-process`
  - `@tauri-apps/plugin-updater`
  - `@tauri-apps/plugin-process`
- [ ] 更新 `src-tauri/capabilities/default.json`，加入 `updater:default`、`process:default`。
- [ ] 更新 `src-tauri/src/lib.rs` 初始化 updater/process 插件。

## 2. Runtime info command

- [ ] 在 Rust command 层新增 `get_app_runtime_info`。
- [ ] 返回版本、仓库地址、分发形态和 Tauri 标记。
- [ ] Windows 检测可执行文件目录中的 `portable.marker`，命中时返回 `desktop-portable`。
- [ ] Linux 检测 `APPIMAGE` 环境变量，命中时返回 `desktop-appimage`，否则返回 `desktop-package`。
- [ ] macOS 和普通 Windows 安装版返回 `desktop-installer`。
- [ ] 在 `src/shared/tauri/commands.ts` 增加 typed wrapper。
- [ ] 给 Rust 分发形态检测 helper 补单测。

## 3. 发布脚本

- [ ] 新增 `scripts/build-platform.mjs`：
  - 支持 `win-x64`、`mac-arm64`、`linux-x64`、`all`。
  - Windows 运行 `tauri build --bundles nsis`。
  - macOS 运行 `tauri build --target aarch64-apple-darwin --bundles app,dmg`。
  - Linux 运行 `tauri build --target x86_64-unknown-linux-gnu --bundles deb,rpm,appimage`。
  - `MXTERM_CREATE_UPDATER_ARTIFACTS=1` 时追加 `--config {"bundle":{"createUpdaterArtifacts":true}}`。
- [ ] 新增 `scripts/release-assets.mjs`：
  - 递归收集支持扩展。
  - 平台后缀重命名。
  - 同步复制 `.sig`。
  - 没有资产时失败。
- [ ] 新增 `scripts/generate-latest-json.mjs`：
  - 选择 Windows NSIS `.exe`、macOS arm64 `.app.tar.gz`、Linux `.AppImage`。
  - 读取 `.sig` 内容。
  - 写入 `latest.json`。
  - 匹配缺失或歧义时失败。
- [ ] 新增脚本测试：
  - `scripts/build-platform.test.mjs`
  - `scripts/release-assets.test.mjs`
  - `scripts/generate-latest-json.test.mjs`
- [ ] 更新 `package.json` scripts：
  - `package:win`
  - `package:mac-arm64`
  - `package:linux`
  - `package:all`
  - `test:release`

## 4. GitHub Actions workflow

- [ ] 新增 `.github/workflows/release.yml`。
- [ ] 使用 `workflow_dispatch` 和 `v*` tag 触发。
- [ ] build job 使用 Windows x64、macOS arm64、Linux x64 矩阵。
- [ ] 安装 pnpm、Node 22、Rust stable。
- [ ] Linux 安装 WebKit/GTK/rpm/AppImage 相关依赖。
- [ ] tag 触发时校验 tag、package、Cargo、Tauri 版本一致。
- [ ] 校验 `TAURI_SIGNING_PRIVATE_KEY` 存在，否则失败。
- [ ] release 构建时设置 `MXTERM_CREATE_UPDATER_ARTIFACTS=1`。
- [ ] Windows job 额外创建绿色版 zip，包含 `portable.marker`。
- [ ] 上传每个平台整理后的 release assets。
- [ ] publish job 仅在 `v*` tag 触发时运行。
- [ ] publish job 生成源码包、`latest.json`、`SHA256SUMS.txt` 并创建 GitHub Release。
- [ ] 在 workflow 中保留 OS 级签名/notarization 的后续扩展注释或独立占位步骤。

## 5. 前端更新运行时

- [ ] 新增 `src/shared/tauri/appUpdate.ts`：
  - `getAppRuntimeInfo`
  - `checkForAppUpdate`
  - `installAppUpdate`
  - `formatUpdateDownloadProgress`
- [ ] 新增 `src/features/settings/useAppUpdate.ts`：
  - 读取 runtime info。
  - 根据 `settings.basic.autoCheckAppUpdate` 自动检查。
  - 管理 `idle/checking/latest/available/installing/failed/unsupported` 状态。
  - 管理同版本本次运行 dismiss 状态。
- [ ] Web、开发模式、Windows 绿色版、Linux deb/rpm 返回明确 unsupported 文案。
- [ ] 安装更新后调用 `@tauri-apps/plugin-process` 的 `relaunch()`。

## 6. 设置页 UI

- [ ] 更新 `BasicSettings`：
  - 添加 `autoCheckAppUpdate`。
  - 默认 true。
  - `normalizeSettings` 兼容旧 localStorage。
- [ ] 扩展 `SettingsView` / `BasicSettingsSection` props，接入 app update state/actions。
- [ ] 在基础设置中新增“应用更新”区域：
  - 当前版本。
  - 分发形态。
  - 仓库链接。
  - 检查状态。
  - 立即检查。
  - 安装并重启。
  - 自动检查开关。
- [ ] 复用现有 `SettingsRow`、`SettingsToggle`、`settings-action-button`，不硬编码新色板。
- [ ] 所有异步按钮具备 loading/disabled 状态。

## 7. 工作区主动提示

- [ ] 在 `WorkspaceShell` 中接入 `useAppUpdate`。
- [ ] 新增 `openSettingsSection(sectionId)` helper，复用设置页跳转。
- [ ] 扩展 `AppTitlebar` props，支持可关闭的更新状态入口。
- [ ] 在标题栏窗口控制前渲染紧凑更新 pill：
  - 点击进入基础设置的应用更新区域。
  - 关闭按钮只关闭当前版本提示。
  - 不阻断终端和文件操作。
- [ ] 更新 `src/styles/app.css`，使用 `--mx-*` token 和现有 titlebar/settings 风格。

## 8. README

- [ ] 补充 Release 发布流程：
  - 更新版本号。
  - 配置 GitHub Secrets。
  - 打 `vX.Y.Z` tag。
  - 手动 workflow 只验证不发布。
- [ ] 说明 updater 覆盖范围：
  - Windows NSIS 安装版。
  - macOS Apple Silicon。
  - Linux AppImage。
  - Windows 绿色版、Linux deb/rpm 需手动下载。
- [ ] 说明 OS 级签名/notarization 尚未接入。

## 9. 验证

- [ ] `node --test scripts/build-platform.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`
- [ ] `pnpm check`
- [ ] 如用户允许，再运行 Rust 检查：`cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] 检查 `git status --short`，确认 private key 未出现。
- [ ] 检查 staged/working diff 中没有 private key 内容。
- [ ] 源码搜索确认没有 Node runtime flavor 新逻辑。

## 10. 回滚点

- [ ] 如果 updater 插件运行异常，先回滚前端更新入口和 titlebar 提示。
- [ ] 如果 release workflow 失败，保留本地脚本测试，先修复脚本匹配规则。
- [ ] 如果 key 配置异常，保留 release workflow，重新生成 public/private key pair 后只替换 public key 和 GitHub Secrets。
