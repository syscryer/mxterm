# 收敛当前产品与工程缺口：总体设计

## 任务边界

父任务只维护统一需求、子任务映射和最终集成验收，不直接承载业务实现。三个子任务可独立开发和验证：

1. `08-01-encrypted-connection-transfer`：实现独立的加密连接导入/导出格式、后端事务和桌面端交互。
2. `08-01-add-mit-license`：加入标准 MIT License 并修正 README 许可说明。
3. `08-01-reconcile-trellis-state`：按代码与提交证据归档陈旧任务，核对规范索引状态。

## 集成边界

- 连接迁移不得改变 WebDAV 同步快照的文件格式、整体替换语义或发布行为。
- License 子任务只修改根目录 `LICENSE` 和 README 的许可段落。
- Trellis 清理只移动/修正已经核实的 Trellis 文件，不修改业务源码，也不归档当前父任务及三个子任务。
- 子任务之间没有实现依赖。父任务最终验收依赖三个子任务各自完成并通过其验收标准。

## 风险控制

- 当前工作树中用户已有的 `.codex/config.toml`、`.opencode/`、`.tmp-dev/` 始终排除在本任务修改和暂存范围外。
- CI、前端测试框架、Windows/macOS 系统签名和 Apple notarization 均保持现状。
- 任务执行期间不自动提交或推送；完成后只暂存本任务文件并等待人工审核。

## 最终验收

父任务在三个子任务完成后统一运行 TypeScript、Rust、启动边界、release 脚本和 Trellis 上下文检查，并检查工作树与 staged diff 中不存在敏感信息或无关文件。
