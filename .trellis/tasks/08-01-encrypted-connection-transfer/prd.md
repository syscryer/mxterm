# 实现加密连接导入导出

## Goal

把首页“导入连接”假入口替换为可验证的本地迁移能力，并提供全量加密导出，使用户可以在 mXterm 安装之间迁移多协议连接、分组、可复用账号及凭据。

## Dependencies

- 无兄弟任务依赖，可独立实现和验收。
- 必须复用项目现有存储模型、凭据保险库和 `Argon2id + AES-256-GCM` 密码学基础能力。
- 不得依赖 MIT License 或 Trellis 清理子任务先完成。

## Requirements

- 使用独立的 `mxterm-connections` v1 JSON 格式，不读取或写入 `mxterm-sync` 快照。
- 全量导出全部 SSH、RDP、VNC、Telnet、串口连接、连接分组、可复用账号及其已保存密码/私钥口令。
- 连接、分组、账号元数据保持可读；敏感值只存在于 AES-256-GCM 密文中，明文数据摘要作为认证关联数据。
- 导出密码必须非空并二次确认，只存在于当前交互内存和 command 参数中，不保存、不记录日志。
- 不打包私钥文件内容，不复制或修改私钥文件；保留路径并在导入预检中提示当前设备不可访问的路径。
- 导入先完成文件大小、格式版本、结构、摘要、密码、密文、引用和冲突预检，再返回新增、冲突、跳过、覆盖候选和警告摘要。
- 冲突默认跳过，用户可明确切换为覆盖；连接和账号按稳定 ID 判定，分组同时处理稳定 ID 与唯一名称冲突。
- 应用导入时重新读取并验证文件摘要，防止预检后文件被替换。
- SQLite 数据和凭据写入必须形成单批一致操作；失败时回滚数据库并恢复或删除本批次已写凭据。
- 首页仓库维护区提供独立导入、导出入口；弹窗按需加载并复用 Radix、Lucide、`AppSelect` 和全局 token。
- 成功后刷新连接与分组；取消、预检失败或写入失败不刷新且不产生部分结果。

## Acceptance Criteria

- [x] 首页导入按钮不再调用普通刷新，导入和导出均可从仓库维护区进入。
- [x] 正确密码可以导出并重新导入多协议连接、分组、账号和保存凭据。
- [x] 导出 JSON 不包含明文密码、私钥口令、保险库引用或私钥文件内容。
- [x] 错误密码、密文损坏、明文数据篡改、非法引用和格式不兼容均在任何写入前失败。
- [x] 预检显示新增与冲突数量、默认跳过策略及不可访问私钥路径警告。
- [x] 覆盖必须由用户明确选择；跳过和覆盖结果符合稳定 ID/分组名称规则。
- [x] 任一数据库或凭据写入失败后，本地连接仓库和凭据仍保持导入前状态。
- [x] 导入成功后连接列表刷新，失败或取消时不刷新。
- [ ] 新 UI 在亮色、显式暗色和 system-dark 下使用现有 token，键盘可操作且有明确 busy/error 状态。
- [x] Rust 单元测试、TypeScript 检查、生产构建、源回归脚本和启动模块边界检查通过。

## Validation Evidence

- 2026-08-01: focused Rust transfer suite passed 12/12; TypeScript, transfer source regression, startup boundary, production build, release tests (12/12), formatting, and diff checks passed.
- Production build kept `ConnectionTransferDialog` in a separate 8.52 kB chunk.
- Desktop light-theme homepage smoke confirmed the independent import/export entries and stable layout. The attempt to open the dialog was interrupted with the physical Escape key, so explicit-dark/system-dark and keyboard dialog smoke remain unchecked.
- Full Rust suite remains 245/246 because the pre-existing `terminal::local::tests::local_session_accepts_input_and_returns_output` blocks in PTY read and times out; `src-tauri/src/terminal/local.rs` is outside this task and was not changed.

## Out Of Scope

- OpenSSH config、第三方专有格式、团队共享和云同步。
- 单连接导出、列表勾选批量导出和分享链接。
- 私钥文件打包、托管、复制、重命名或自动清理。
- 新增前端单元测试框架。
