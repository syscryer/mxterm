# 清理 Trellis 任务与规范状态

## Goal

让 Trellis 活动任务和规范索引与当前代码、提交和迁移事实一致，使后续盘点不再把已完成工作误判为未完成。

## Dependencies

- 无兄弟任务实现依赖，可独立核验。
- 执行时不得归档父任务 `08-01-close-current-gaps`、三个当前子任务或确实未完成的 `00-bootstrap-guidelines`。
- 归档目标必须逐项具备当前源码、历史提交或迁移指针证据；证据不足即保留。

## Requirements

- 核验并归档 16 个已有完成证据的历史任务：VNC、Telnet/串口、网络诊断、启动性能、macOS 深色主题、RDP 原生宿主、mx-agent 迁移指针、AI 助手、Docker 性能、隧道入口、终端目录检测、统一标签、远程 MCP、定时任务、编辑器标签滚动、终端分屏。
- 使用 `task.py archive` 逐项归档，保持 `session_auto_commit: false`，不自动提交。
- 保留 `00-bootstrap-guidelines`，因为规范建设仍真实未完成。
- 逐项阅读 backend/frontend 规范文件；只有包含项目特定、可执行约定的文件标记 `Active`，模板或空泛内容继续标记 `To fill`。
- 不为消除 `To fill` 编造规范，也不修改无关 Trellis workflow/runtime 文件。

## Acceptance Criteria

- [x] 16 个目标任务均有可追溯证据并从活动列表移入 archive；证据不足的目标留在活动列表并记录原因。
- [x] `07-01-mx-agent-universal-agent-project` 作为跨仓库迁移指针完成归档。
- [x] `00-bootstrap-guidelines`、当前父任务和三个子任务仍保持活动状态。
- [x] backend/frontend 索引状态与对应文档实际内容一致，不存在内容已落地却仍明显标记 `To fill` 的条目。
- [x] `task.py list`、`list-archive` 和父任务 `validate` 通过。
- [x] 未提交 `.trellis/.runtime/`、`.trellis/.developer`、Python 缓存或敏感配置。

## Validation Evidence

- 2026-08-01: all 16 evidence-backed tasks are present under `.trellis/tasks/archive/2026-08/`; `list-archive` reports 17 archived tasks for the month including the earlier unrelated archive.
- 2026-08-01: `task.py list` retains `00-bootstrap-guidelines`, the parent task, and all three current child tasks.
- 2026-08-01: all four current parent/child `task.py validate` commands passed; no runtime, developer, cache, or sensitive configuration path is included.
