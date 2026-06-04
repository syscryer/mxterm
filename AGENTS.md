# mXterm Agent 规则

- 所有回答使用中文。
- 后续项目开发优先使用 Trellis 管理。
- 进入仓库后先查看 `trellis.hjson`，确认可用工作流。
- 如果本机已安装 `trellis-ctl`，优先使用 `trellis-ctl -json status`、`trellis-ctl -json workflow list`、`trellis-ctl -json workflow run <id>` 进行状态查看和任务执行。
- 如果 `trellis-ctl` 不可用，先说明环境缺少 Trellis 命令，再使用等价本地命令完成必要检查。
- 不要提交 `.superpowers/`、`.learnings/`、`.trellis/` 或敏感配置文件。
- 不自动提交 git；只有用户明确要求提交时才提交。
- 提交前必须检查 `git status --short`，并确认没有敏感信息。
