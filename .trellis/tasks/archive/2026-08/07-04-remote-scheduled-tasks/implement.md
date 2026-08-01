# Implement

## Checklist

- [x] 读取前端/后端规范与相关工具面板代码。
- [x] 新增后端 scheduled task 类型、crontab 解析/生成、日志解析和 Tauri 命令。
- [x] 注册 Tauri 命令并补前端 typed invoke wrappers/types。
- [x] 在 `DockerToolPanel` 接入定时任务视图，包含列表、空状态、表单、启停/删除/手动执行和日志摘要。
- [x] 补充单元测试：cron 校验、管理块解析/保留普通 crontab、日志解析、命令包装不泄漏结构。
- [x] 运行启动边界检查、相关 Rust 测试、前端类型/检查命令中可承受的最小集合。
- [x] 检查 git diff 和敏感信息，提交并推送。

## Validation Commands

- `node scripts/check-startup-module-boundary-source.mjs`
- `cargo test scheduled_tasks --manifest-path src-tauri/Cargo.toml`
- `cargo test docker_tools::tests:: --manifest-path src-tauri/Cargo.toml` if DockerToolPanel contracts are indirectly touched only by types, skip unless Rust module impact expands.
- `npm run typecheck` if available and reasonably scoped; otherwise document inability.

## Risk Points

- crontab 写回必须保留用户原有内容。
- shell quote 必须覆盖单引号、换行和空命令。
- UI 不能引入新视觉体系或阻塞 Docker/网络诊断已有行为。
