# GitHub 发布流程与应用更新

## Goal

为 mXterm 建立生产级、可长期维护的 GitHub Release 发布流程，并接入应用内更新能力，让用户可以从 `syscryer/mxterm` 下载正式产物，并在支持的桌面安装版中检查、下载、安装新版本。

本任务参考本机既有发布和更新链路调研结果，但需要按 mXterm 的实际结构简化：mXterm 目前没有 Node runtime flavor，也没有既有 `.github` 发布 workflow。

## Confirmed Facts

- 当前仓库为 Tauri v2 + Vite/React 项目，版本在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 中均为 `0.1.0`。
- 当前 `package.json` 只有 `build`、`build:mcp-sidecar`、`check`、`test`、`tauri`、`tauri:dev` 等基础脚本，没有平台打包脚本。
- 当前 `src-tauri/tauri.conf.json` 的 bundle `targets` 为 `"all"`，但没有 updater 插件配置。
- 当前 `src-tauri/Cargo.toml` 只接入了 `tauri-plugin-dialog` 和 `tauri-plugin-opener`，未接入 `tauri-plugin-updater` / `tauri-plugin-process`。
- 当前前端设置页已有 `基础设置` 分区和统一 `SettingsRow`、`SettingsToggle`、`settings-action-button` 等样式，可承载应用更新入口。
- 当前设置状态保存在 `localStorage` 的 `mxterm.settings.v1`，`BasicSettings` 尚无自动检查更新字段。
- 当前 `src/shared/tauri/runtime.ts` 只有 `hasTauriRuntime()`；`src/shared/tauri/commands.ts` 是前端调用 Tauri command 的统一包装层。
- `codem` 的发布链路包含 `.github/workflows/release.yml`、`scripts/release-assets.mjs`、`scripts/generate-latest-json.mjs`、脚本测试、Tauri updater 配置、运行时信息 command、设置页应用更新 UI。
- `codem` 的 updater 只选择带签名的安装类主产物写入 `latest.json`；其他安装包、源码包、绿色包作为手动下载资产保留。
- mXterm 不需要 Node runtime 分发，不应引入 Node runtime flavor；这是既有发布链路中需要避免复制的复杂度。
- mXterm 正式发布矩阵为 Windows x64、macOS Apple Silicon、Linux x64；首版不发布 macOS Intel。
- Windows Release 需要额外提供绿色版 zip 作为手动下载资产；应用内自动更新只覆盖安装版，不覆盖绿色版。
- Linux Release 同时发布 `deb`、`rpm`、`AppImage`；应用内更新只使用 `AppImage` 作为 Linux updater 目标。
- 本任务强制接入 Tauri updater 签名；操作系统级代码签名和 macOS notarization 不在本任务内实现，但 workflow 需要预留后续接入位置。
- 本任务直接为 mXterm 配置独立的 Tauri updater public key；private key 只能进入 GitHub Secrets，不得提交到仓库。
- 自动检查更新发现新版本后，需要在工作区主动提示用户；提示不得自动下载、自动安装或打断当前 SSH/文件操作。
- 自动检查更新提示采用可关闭的常驻状态入口，不使用一次性 toast；用户关闭后，本次运行不再提示同一版本。
- `workflow_dispatch` 手动触发只做完整构建和发布资产验证，不创建 GitHub Release；正式 Release 只由 `v*` tag 触发创建。
- Tauri v2 updater 支持 GitHub Release 上的静态 `latest.json`，其中平台 key 使用 `linux-x86_64`、`windows-x86_64`、`darwin-aarch64` 等 `OS-ARCH` 格式；每个平台需要可下载 URL 和 `.sig` 文件内容。

## Requirements

- GitHub Release workflow 必须在 `v*` tag 触发，并支持手动触发。
- 手动触发必须只运行构建和资产验证，不能创建 GitHub Release。
- 只有 `v*` tag 触发的 workflow 才能执行 publish job 并创建 GitHub Release。
- Release workflow 必须按正式发版主干设计，不做仅用于临时过渡的单平台简化流程。
- Release workflow 必须覆盖 Windows x64、macOS Apple Silicon、Linux x64。
- Release workflow 首版不得包含 macOS Intel 产物或 macOS Intel updater metadata。
- Windows Release 必须额外产出绿色版 zip；该 zip 不写入 `latest.json`，仅作为手动下载资产。
- Linux Release 必须产出 `deb`、`rpm`、`AppImage`；`latest.json` 只选择 `AppImage` 作为 `linux-x86_64` updater 目标。
- Release workflow 必须校验 tag 版本与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 一致，避免发错版本。
- Release workflow 必须安装 Node、Rust 和各平台构建依赖，并用仓库脚本构建 Tauri bundle。
- Release workflow 必须收集、重命名 release 资产，生成源码包和 `SHA256SUMS.txt`。
- Release workflow 必须生成 `latest.json`，其下载链接指向 `https://github.com/syscryer/mxterm/releases/download/<tag>/...`。
- Updater 产物必须使用 Tauri updater 签名；GitHub Actions 缺少 `TAURI_SIGNING_PRIVATE_KEY` 时应明确失败。
- 仓库只能保存 Tauri updater public key；private key、private key password、临时签名 key 文件不得进入 git 暂存或提交。
- Release workflow 应保留后续接入 Windows 证书签名、macOS Developer ID 签名和 notarization 的注释或独立步骤位置，但本任务不要求配置这些 secrets。
- 发布和更新链路不得引入 Node runtime flavor、运行时 Node 打包或相关 UI 分支。
- Release workflow 的资产命名、平台矩阵和 updater metadata 生成逻辑必须可扩展，后续新增架构或包格式时不需要重写整条发布链路。
- 应用配置必须接入 updater endpoint：`https://github.com/syscryer/mxterm/releases/latest/download/latest.json`。
- 前端必须提供应用更新入口，至少包含当前版本、仓库链接、立即检查、发现更新后的安装并重启、自动检查更新开关。
- 自动检查发现新版本时，前端必须提供非阻断主动提示，并允许用户跳转到基础设置中的应用更新区域。
- 主动更新提示必须可关闭；关闭后本次运行不再提示同一版本，避免干扰终端操作。
- 开发模式、非 Tauri 环境、或不支持自动更新的分发形态必须展示明确状态，不静默失败。
- README 必须补充正式发布步骤、GitHub Secrets 要求、手动 workflow 语义和各平台自动更新覆盖范围。
- 代码实现必须沿用 mXterm 现有设置页组件和全局 token 风格，不引入独立视觉体系。
- 新增脚本应有 focused Node 测试覆盖 release 资产命名和 `latest.json` 选择逻辑。

## Acceptance Criteria

- [ ] 仓库新增 GitHub Release workflow，tag `vX.Y.Z` 构建并发布 mXterm release 资产。
- [ ] `workflow_dispatch` 手动触发不会创建 GitHub Release，只验证构建和资产整理。
- [ ] 只有 `v*` tag 触发会进入 publish job。
- [ ] workflow 使用正式多平台矩阵，不以 Windows-only 或手工补包作为首版目标。
- [ ] workflow 发布 Windows x64、macOS Apple Silicon、Linux x64 产物，不发布 macOS Intel。
- [ ] Windows Release 包含安装包和绿色版 zip；`latest.json` 只选择安装包作为 Windows updater 目标。
- [ ] Linux Release 包含 `deb`、`rpm`、`AppImage`；`latest.json` 只选择 `AppImage` 作为 Linux updater 目标。
- [ ] tag、`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 版本不一致时 workflow 会失败并输出清晰错误。
- [ ] 发布资产名稳定包含平台后缀，便于用户区分下载目标。
- [ ] GitHub Release 包含源码 zip、源码 tar.gz、`SHA256SUMS.txt` 和 `latest.json`。
- [ ] `latest.json` 只包含已签名且可被 Tauri updater 安装的目标产物；缺失目标产物或签名时脚本失败。
- [ ] workflow 对缺失 Tauri updater 签名私钥的情况失败并输出清晰错误。
- [ ] 仓库中只出现 updater public key 配置，不出现 private key 或签名密钥文件。
- [ ] workflow 对 OS 级签名/notarization 保留后续扩展入口，但不会因为缺少这些证书 secrets 阻塞本任务产物构建。
- [ ] Tauri 配置包含 `syscryer/mxterm` 的 updater endpoint 和 public key。
- [ ] 桌面端设置页能读取当前版本与仓库地址，支持立即检查更新。
- [ ] 发现更新时，用户可以从设置页触发下载、安装并重启。
- [ ] 自动检查发现更新时，工作区显示非阻断提示，并能进入基础设置的更新入口。
- [ ] 更新提示可关闭，关闭后本次运行不再重复提示同一版本。
- [ ] 自动检查更新开关默认开启，关闭后启动时不主动检查。
- [ ] Web/开发模式显示“不支持或不会检查更新”的明确状态。
- [ ] README 说明如何配置 `TAURI_SIGNING_PRIVATE_KEY`、如何打 `v*` tag 发布、手动 workflow 不会创建 Release。
- [ ] `pnpm check` 通过。
- [ ] release 脚本测试通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## Open Questions

- 无。

## Out of Scope

- Node runtime 双 flavor 分发。
- 内置 Node runtime 打包、运行时探测和相关安装包命名。
- macOS Intel 产物与 updater metadata。
- Windows 代码签名证书接入。
- macOS Developer ID 签名与 notarization。
