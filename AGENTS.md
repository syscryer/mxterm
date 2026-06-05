# mXterm Agent 规则

- 所有回答使用中文。
- 后续项目开发使用 trytrellis.app 的 Trellis 管理。
- 进入仓库后先查看 `.trellis/workflow.md`、`.trellis/config.yaml` 和当前任务上下文。
- 使用 `trellis` CLI，不使用 `trellis-ctl`。
- 开发前优先通过 `python ./.trellis/scripts/task.py list`、`current --source`、`create`、`start` 管理任务。
- 实现前使用 `.agents/skills/trellis-before-dev` 读取 `.trellis/spec/` 规范。
- `.trellis/`、`.codex/`、`.agents/` 是 Trellis 项目文件，应随项目维护；不要提交 `.trellis/.runtime/`、`.trellis/.developer`、Python 缓存或敏感配置。
- 不要提交 `.superpowers/`、`.learnings/` 或敏感配置文件。
- 本仓库允许直接在 `master` 分支开发，不强制创建隔离 worktree。
- 不自动提交或推送 git；所有更改先暂存并等待人工审核。
- 提交前必须检查 `git status --short` 和 staged diff，并确认没有敏感信息。
