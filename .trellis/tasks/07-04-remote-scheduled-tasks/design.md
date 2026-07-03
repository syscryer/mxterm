# Design

## Architecture

- Backend 新增 `scheduled_tasks` 模块，复用 `RemoteExecSessionPool` 与 `resolve_saved_connection`。
- Frontend 在 `DockerToolPanel` 的 `schedule` toolbox view 中渲染 `ScheduledTasksView`，保持工具箱内部 tab 结构不变。
- Tauri 命令提供列表、保存、删除、启停、手动执行五类能力。

## Remote Storage Contract

只写当前用户 crontab 中的 mXterm 管理块：

```text
# MXTERM-SCHEDULE-BEGIN
# id=<id>
# name=<base64url>
# enabled=true
# updated_at=<rfc3339>
<cron> /bin/sh -lc '<wrapped command>'
# MXTERM-SCHEDULE-END
```

普通 crontab 行按原样保留。解析失败的 mXterm 管理块不自动删除，返回错误提示，避免误写。

## Execution And Logs

- 计划任务命令包装为：
  - 创建 `~/.mxterm/scheduled-tasks/logs`
  - 记录开始时间、退出码、stdout/stderr
  - 日志文件按任务 id 分文件追加
- 手动执行复用同一个包装脚本，但通过 SSH 立即执行。
- 列表命令读取 crontab 管理块，再 tail 每个任务日志末尾，生成最近执行摘要。

## Data Contracts

- `ScheduledTaskSummary`: id、name、cron、command、enabled、updated_at、last_run。
- `ScheduledTaskInput`: id 可选、name、cron、command、enabled。
- `ScheduledTaskActionResult`: ok、message、output。
- `ScheduledTaskLogEntry`: started_at、exit_code、status、output_preview。

## Compatibility

- 若远端没有 crontab，返回“远端未安装 crontab 或当前用户不能访问 crontab”。
- 命令和名称通过 base64/url-safe 或 shell quote 安全写入，避免直接拼接导致 crontab 结构被破坏。
- 仅支持 5 段 cron 表达式和常见宏 `@hourly`、`@daily`、`@weekly`、`@monthly`、`@reboot`。

## Tradeoffs

- 选择 crontab 而非本地调度：可靠性更高，应用关闭后仍执行；代价是依赖远端 cron 环境。
- 只管理 mXterm 块：避免误伤用户已有 crontab；代价是不能在本次直接编辑所有系统任务。
