# mXterm

mXterm 是一个个人桌面 SSH/SFTP 客户端项目，首版目标是提供连接管理、SSH 终端、SFTP 上传下载、传输队列和远程文件编辑能力。

## 当前文档

- [需求文档](docs/requirements/m-xterm-requirements.md)
- [宽松协议开源项目参考](docs/research/permissive-open-source-references.md)
- [MVP 工程基座与 SSH Spike 计划](docs/plans/2026-06-05-mxterm-mvp-foundation-and-ssh-spike.md)

## Trellis

后续项目开发使用 [Trellis](https://docs.trytrellis.app/zh) 管理。

当前仓库已通过 `trellis init --codex -u MNL --yes --skip-existing --workflow native` 初始化：

- `.trellis/`：共享工作流、规范、任务和项目记忆。
- `.codex/`：Codex hooks 和 Trellis agent 配置。
- `.agents/skills/`：Trellis 技能说明，供 Codex、Cursor、Gemini CLI 等工具读取。

常用命令：

```powershell
trellis --version
python ./.trellis/scripts/task.py list
python ./.trellis/scripts/task.py current --source
python ./.trellis/scripts/get_context.py --mode packages
```

Codex hooks 需要用户级 `~/.codex/config.toml` 启用 `features.hooks = true`，并将本项目设置为 trusted。

## GitHub 发布

本仓库只配置 GitHub Release 发布渠道，目标仓库为 `syscryer/mxterm`。正式发布由 `v*` tag 触发，手动触发 workflow 只做构建、资产整理、`latest.json` 和校验文件验证，不创建 GitHub Release。

发布前需要保证三个版本号一致：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

GitHub Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`：必填，Tauri updater 私钥内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：可选，私钥密码。

发布步骤：

```powershell
git status --short
git tag v0.1.0
git push origin v0.1.0
```

Release workflow 会构建 Windows x64、macOS Apple Silicon、Linux x64。首版不发布 macOS Intel。

自动更新覆盖：

- Windows NSIS 安装版。
- macOS Apple Silicon 的 Tauri updater 资产。
- Linux AppImage。

手动下载覆盖：

- Windows 绿色版 zip。
- Linux deb/rpm。

GitHub Release 会包含平台安装包、源码 zip、源码 tar.gz、`latest.json` 和 `SHA256SUMS.txt`。Windows 代码签名、macOS Developer ID 签名和 notarization 暂未接入，workflow 里保留了后续扩展入口。
