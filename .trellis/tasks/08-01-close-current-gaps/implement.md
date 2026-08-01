# 收敛当前产品与工程缺口执行计划

> 当前平台为 Codex inline，执行阶段由主会话逐项实现和检查，不派发 implement/check 子代理。

## 执行顺序

- [ ] 启动并完成 `08-01-encrypted-connection-transfer`，按该子任务的 `design.md` 和 `implement.md` 实现、测试和验收。
- [ ] 启动并完成 `08-01-add-mit-license`，只修改 `LICENSE` 与 README 许可说明。
- [ ] 启动并完成 `08-01-reconcile-trellis-state`，逐项核验证据后归档任务并修正规范索引。
- [ ] 回到父任务执行集成验证，确认三个子任务的验收结果可以同时成立。

## 集成验证

```powershell
pnpm check
pnpm build
pnpm test:release
node scripts/check-startup-module-boundary-source.mjs
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
python ./.trellis/scripts/task.py validate 08-01-close-current-gaps
git status --short
git diff --check
git diff --cached --check
```

预期结果：所有检查退出码为 0；构建产物未将连接迁移弹窗静态合并到首屏模块；父子任务引用有效；工作树中用户原有文件未被纳入本任务暂存。

## 回滚点

- 任一子任务验收失败时，父任务不得进入完成状态。
- 连接迁移格式一旦进入发布版本，其 `format` 与 `version` 即成为兼容契约；实现阶段不得在缺少迁移测试时改名或重排语义。
- Trellis 归档前保存目标清单和对应实现证据；发现证据不足时保留活动任务，不以“清空列表”为目标。
