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
- 前端 UI 开发必须保持风格统一和组件复用；优先基于现有 Radix + Lucide + 项目共享组件封装实现，不要在各个 feature 里零散手写一套弹窗、按钮、确认框或表单样式。
- 新增 UI 交互前先检查 `src/shared/ui/` 和 `.trellis/spec/frontend/`；缺少通用能力时先补共享组件/规范，再在业务组件中使用。
- 后续做前端功能原型或交互探索时，默认基于 `prototype/light-neutral/mxterm-empty-session.html` 继续迭代；先在该 HTML 中实现可点击的伪功能、假数据状态、弹窗/菜单/筛选/搜索等交互动线，确认体验后再迁移到真实 React/Radix 项目实现。除非用户明确要求直接改项目，不要另起一份无关原型或跳过该原型母版。
- 修 bug 时不要用“虚假兜底”掩盖根因：例如用列表去重隐藏重复数据、静默截断/改写用户输入、只在 UI 层隐藏异常状态。必须先定位导致错误写入、重复事件、错误状态流转或错误命令调用的根因，从数据/命令/事件源头修复；确实需要兼容历史脏数据时，要明确标注为迁移/清理逻辑并说明原因。
- 不自动提交或推送 git；所有更改先暂存并等待人工审核。
- 提交前必须检查 `git status --short` 和 staged diff，并确认没有敏感信息。
