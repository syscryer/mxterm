# Trellis 状态清理执行计划

## 归档前核验

- [x] 对以下目标逐项读取 `task.json`、PRD/设计/计划、相关源码和提交，记录可以证明完成的 commit：

```text
06-26-fix-vnc-unreachable-target-timeout
06-26-multi-protocol-character-sessions
06-27-network-diagnostics
06-27-startup-performance
06-28-macos-dark-theme
06-30-rdp-native-host-window
07-01-mx-agent-universal-agent-project
07-02-ai-terminal-assistant
07-02-docker-container-perf
07-02-tunnel-entry-tools
07-03-fix-terminal-directory-prompt-detection
07-03-unified-terminal-file-tabs
07-04-remote-mcp-http-service
07-04-remote-scheduled-tasks
07-08-remote-editor-tab-overflow-controls
07-10-terminal-split-panes
```

- [x] 对证据不足的任务停止归档并在本任务 Notes 中记录缺口，不根据标题或旧路线图猜测完成状态。

## Completion Evidence

| Task | Evidence |
|---|---|
| `06-26-fix-vnc-unreachable-target-timeout` | `e5ff095` VNC runner host timeout and error-state implementation |
| `06-26-multi-protocol-character-sessions` | `74b7dfe` Telnet and serial character sessions |
| `06-27-network-diagnostics` | `4f50b5c` network diagnostics toolbox |
| `06-27-startup-performance` | `fe8dac4` startup module loading optimization |
| `06-28-macos-dark-theme` | `13853df` macOS dark glass theme adaptation |
| `06-30-rdp-native-host-window` | `76c5719` native RDP host window improvements |
| `07-01-mx-agent-universal-agent-project` | Live check: `D:\ai_proj\mx-agent\docs\prd.md` and independent `.trellis/` exist; latest repository commit `94ac615` |
| `07-02-ai-terminal-assistant` | `e942e9b` AI terminal assistant implementation |
| `07-02-docker-container-perf` | `4e53f9b` Docker panel switch performance fix |
| `07-02-tunnel-entry-tools` | `ad10666` tunnel entry moved into tools |
| `07-03-fix-terminal-directory-prompt-detection` | `d289fb3`, `feba8c6` terminal snapshot and prompt-directory correction |
| `07-03-unified-terminal-file-tabs` | `3533c8f`, `e43e8b9` unified terminal/file tabs and follow-up fixes |
| `07-04-remote-mcp-http-service` | `453d9ff` remote MCP HTTP service |
| `07-04-remote-scheduled-tasks` | `ba7d9cc` remote scheduled tasks tool |
| `07-08-remote-editor-tab-overflow-controls` | `9c957aa` remote editor tab overflow controls |
| `07-10-terminal-split-panes` | `a4eec6a` terminal split panes and session selection completion |

No target lacked completion evidence. Backend/frontend index review found only `tauri-command-contracts.md` and frontend `component-guidelines.md` contain project-specific executable rules; their existing `Active` labels are correct. Remaining entries are still templates and correctly remain `To fill`.

## 执行归档

- [x] 使用 `python ./.trellis/scripts/task.py archive <task>` 逐项归档已核实目标；每次归档后检查命令退出码和目标 archive 路径。
- [x] 运行 `python ./.trellis/scripts/task.py list`，确认 `00-bootstrap-guidelines`、父任务和三个子任务仍活动。
- [x] 运行 `python ./.trellis/scripts/task.py list-archive`，确认目标任务可查。

## 规范索引核对

- [x] 阅读 `.trellis/spec/backend/index.md` 和其链接文件，只将已有项目特定可执行内容的条目标记为 `Active`。
- [x] 阅读 `.trellis/spec/frontend/index.md` 和其链接文件，只将已有项目特定可执行内容的条目标记为 `Active`。
- [x] 保留真实模板条目的 `To fill`，不新增虚构规则。

## 验证与回滚

```powershell
python ./.trellis/scripts/task.py list
python ./.trellis/scripts/task.py list-archive
python ./.trellis/scripts/task.py validate 08-01-close-current-gaps
git status --short
git diff --check
```

若归档目标错误，在提交前将对应目录从 `.trellis/tasks/archive/<year-month>/` 恢复到 `.trellis/tasks/`，并把 `task.json.status`、`completedAt` 恢复为归档前值；不得使用 `git reset --hard` 或覆盖用户改动。

## Verification Result

- `task.py list`, `task.py list-archive`, and all four current parent/child `task.py validate` commands passed on 2026-08-01.
- `git diff --check` passed. The existing user-owned `.codex/config.toml`, `.opencode/`, and `.tmp-dev/` paths remain excluded from task staging.
