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
