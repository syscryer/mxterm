# Tauri updater 与 codem 发布链路调研

## mXterm 当前状态

- `package.json` 当前版本是 `0.1.0`，脚本只有基础构建、检查、测试和 Tauri dev/build 入口，没有按平台封装的 package 脚本。
- `src-tauri/Cargo.toml` 当前包版本是 `0.1.0`，依赖中没有 `tauri-plugin-updater` 和 `tauri-plugin-process`。
- `src-tauri/tauri.conf.json` 当前版本是 `0.1.0`，bundle `targets` 为 `"all"`，没有 `plugins.updater`。
- `src-tauri/src/lib.rs` 是 Tauri builder 入口，当前只初始化 dialog 和 opener 插件，所有 command 都在这里集中注册。
- `src/features/settings/SettingsView.tsx` 已有基础设置分区，可复用 `SettingsRow`、`SettingsToggle` 和 `settings-action-button` 放置应用更新入口。
- `src/features/settings/settingsTypes.ts` 的 `BasicSettings` 尚无 `autoCheckAppUpdate` 字段；设置归一化需要同步新增默认值和兼容旧 localStorage。

## codem 可参考点

- `.github/workflows/release.yml`：
  - `workflow_dispatch` 和 `v*` tag 触发。
  - 校验 tag、`package.json`、`tauri.conf.json` 版本一致。
  - 矩阵构建 Windows、macOS、Linux。
  - 缺少 `TAURI_SIGNING_PRIVATE_KEY` 时让 updater 构建失败。
  - 构建后收集 release assets，再由 publish job 生成 source archive、`latest.json`、`SHA256SUMS.txt` 并创建 GitHub Release。
- `scripts/release-assets.mjs`：
  - 递归扫描 Tauri bundle 目录。
  - 只复制支持的发布资产扩展名。
  - 给资产名追加平台/flavor 后缀，并同步复制 `.sig`。
- `scripts/generate-latest-json.mjs`：
  - 从 release assets 中选择 updater 可安装的主产物。
  - 读取同名 `.sig` 内容写入 `latest.json`。
  - 输出 GitHub Release 下载 URL。
- `src/lib/settings-runtime.ts` 和 `BasicSettings.tsx`：
  - 区分 Web、开发模式、绿色版/特殊分发。
  - 设置页展示当前版本、仓库地址、检查状态。
  - 用户点击后调用 updater `check()`，发现更新后执行 `downloadAndInstall()` 并 relaunch。
- mXterm 没有 Node runtime 分发，因此不需要完整复制 runtime flavor 矩阵。

## Tauri updater 约束

官方 Tauri v2 updater 文档说明，静态 JSON 文件适合 GitHub Release 等场景。`latest.json` 必须包含 `version` 和 `platforms.[target].url`、`platforms.[target].signature`，平台 key 使用 `OS-ARCH` 格式，例如 `windows-x86_64`、`darwin-aarch64`、`linux-x86_64`。签名字段必须是生成的 `.sig` 文件内容，不是路径或 URL。

官方文档还说明，Tauri 会在比较版本前验证整个 JSON，因此写入 `latest.json` 的每个平台都必须完整、有效。Windows installer install mode 可以配置为 `passive`、`basicUi` 或 `quiet`，其中 `passive` 是默认推荐模式。

Source: https://v2.tauri.app/plugin/updater/

## 初步建议

- 发布 workflow 参考 codem 的结构，但去掉 runtime flavor 维度。
- 构建脚本增加平台选择入口，避免 workflow 里直接堆 Tauri CLI 参数。
- `latest.json` 只写入明确可自动安装且已签名的主产物，其他包保留为手动下载。
- 设置页更新入口放在基础设置内，使用现有紧凑行布局。

## 已定范围

- 不引入 Node runtime flavor，mXterm 不需要 Node runtime 分发。
- 正式发布矩阵为 Windows x64、macOS Apple Silicon、Linux x64。
- 不发布 macOS Intel，不生成 macOS Intel updater metadata。
- Windows Release 包含安装包和绿色版 zip；绿色版 zip 仅手动下载，不进入 `latest.json`。
- Linux Release 包含 `deb`、`rpm`、`AppImage`；`latest.json` 只使用 `AppImage`。
- 手动触发 GitHub Actions 只做构建和资产验证；正式 Release 只由 `v*` tag 创建。
- 本任务只强制 Tauri updater 签名；Windows 代码签名、macOS Developer ID 签名和 notarization 只预留入口。

## UI/UX 约束

按 `ui-ux-pro-max` 的开发工具界面建议，更新入口应保持工具型、信息密集且反馈明确。mXterm 已有全局 token 和设置页样式，因此不采用该工具建议的新色板或字体；实现时只吸收以下原则：

- 使用现有 `SettingsRow`、`SettingsToggle`、`settings-action-button` 和 Lucide 图标。
- 检查中、可更新、安装中、失败、最新、环境不支持等状态都要有直接文字反馈。
- 异步按钮必须有 disabled/loading 状态，避免重复触发检查或安装。
- 不新增硬编码颜色、独立阴影或脱离 mXterm 设置页的卡片布局。
