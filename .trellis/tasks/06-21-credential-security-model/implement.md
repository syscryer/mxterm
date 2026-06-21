# Credential security model implementation plan

## Order

1. 读取相关代码和规范：storage repository、storage vault、commands、ConnectionDialog、账号管理 UI、设置页安全 UI。
2. 先写后端失败测试：
   - 编辑连接未触碰 inline password 时保留旧 secret。
   - reveal inline connection secret 只允许 inline 模式。
   - 编辑账号凭据未触碰 secret 时保留旧 secret。
   - reveal credential secret 返回对应 secret。
   - vault rekey 原子写失败不破坏旧 vault。
3. 实现后端：
   - 输入类型增加 secret touched / preserve 语义。
   - repository upsert 保留旧 secret。
   - reveal 命令和策略检查。
   - 安全设置字段与命令补齐。
4. 实现前端连接编辑：
   - secret 字段改为“已保存 + reveal + 替换”状态。
   - saved credential 模式不展示公共 secret。
   - 保存 payload 带 touched 语义。
5. 实现账号管理：
   - 凭据 secret 支持 preserve/reveal/replace。
   - 受“允许查看已保存密码”策略控制眼睛按钮。
6. 实现安全设置：
   - 高级保护关闭只显示总开关。
   - 高级保护开启默认锁定，解锁后显示配置。
   - 移除“启动时需要安全密码”开关。
7. 验证：
   - 相关 Rust 测试。
   - `cargo check --manifest-path src-tauri\Cargo.toml`。
   - `npm run check`。
   - `git diff --check`。
8. 暂存新增代码文件，提交前检查 `git status --short` 和 staged diff；不自动提交。

## Notes

- 不做按需解锁模型。
- 不做每次点眼睛输入安全密码。
- 不跨层在连接编辑页展示账号管理凭据 secret。
- 避免把 secret 写入日志、localStorage 或错误消息。
