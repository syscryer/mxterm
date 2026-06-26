# Command snippets and history 实施计划

## Before Start

- 用户已授权从需求设计到开发按推荐方案推进，早上 review。
- 当前已有隧道增强变更处于 staged，不能回滚或混入无关修改。
- 本任务做 Command Sender 的命令片段、主动发送历史、本地终端目标支持，以及默认关闭的终端回车输入历史。
- 历史命令按 SSH 连接和本地终端 profile 增加筛选范围；默认跟随当前工作区上下文。
- 开发前加载 `trellis-before-dev`，读取前后端规范。

## Ordered Checklist

1. 任务文档
   - 写 `prd.md`、`design.md`、`implement.md`。
   - 明确不记录普通终端输入、不接入 WebDAV 同步。

2. 后端模型和 schema
   - 新增 `src-tauri/src/command_library.rs`。
   - 在 `storage_sqlite.rs` 增加 `command_snippets`、`command_history`、`command_history_scopes` 表和索引。
   - 在 `StorageRepository` 增加 snippet/history CRUD 方法。
   - 注意不要存目标 session id、connection id 或命令执行结果。

3. 后端 Tauri commands
   - 在 `commands.rs` 增加 command snippet/history request/response 使用。
   - 在 `lib.rs` 注册新命令。
   - 在 `shared/tauri/commands.ts` 增加 typed wrapper。

4. 后端测试
   - command snippet 校验测试。
   - command history 合并、排序、scope 筛选、删除、清空测试。
   - 运行 `cargo test --manifest-path src-tauri/Cargo.toml command_library --lib`。

5. 前端类型和状态
   - 新增 `src/features/commands/commandLibraryTypes.ts`。
   - 新增 `src/features/commands/CommandLibraryPanel.tsx`，作为右侧命令 tab 的片段/历史管理面板。
   - `WorkspaceShell` 加载片段/历史状态。
   - 替换原内存 `commandSenderHistory: string[]`。
   - 增加 `settings.command.recordTerminalInputHistory`，默认关闭，入口放到系统设置。

6. Command Sender UI
   - `RemoteFilePanel` 增加 `commands` 工具 tab，并接入 `CommandLibraryPanel`。
   - 片段视图使用单列一层树形分组，不使用左右分栏或横向分组 chip。
   - 历史视图使用紧凑命令行列表，不做卡片。
   - 历史视图顶部提供展平范围下拉，默认 SSH 当前连接、本地当前 profile，可切换其它连接/profile 或全部历史。
   - 新增轻量片段保存/编辑 Dialog，并补文件夹分组下拉。
   - 分组新增使用主界面轻量弹窗，分组编辑/删除放在分组右键菜单。
   - 片段行只常驻复制、插入、发送按钮，编辑/删除放右键菜单。
   - 历史行只常驻复制、插入、发送按钮，存为片段/删除放右键菜单。
   - 片段和历史都提供复制命令动作，复制不记录历史、不更新使用次数。
   - 右侧直接发送不展开底部 Command Sender，也不清空底部输入草稿。
   - 本地终端工作区右侧只显示命令工具，不显示文件、传输、监控、隧道。
   - Command Sender 目标列表包含已连接的 SSH 终端和本地终端。
   - 发送成功后记录历史，片段直接发送后 mark used。
   - 开启终端输入历史后，TerminalPanel 只记录回车提交的普通可打印输入，并记录到当前连接/profile scope；控制序列或疑似敏感命令丢弃。
   - 清空/删除历史需要明确用户动作，避免误删。

7. 样式
   - 样式写入 `src/styles/app.css`。
   - 使用 `--mx-*` token、右侧工具面板、现有 command sender 选择器和共享弹窗风格。
   - 不使用原生 `<select>`；本轮命令片段/历史入口不再做顶部下拉。

8. 规范更新
   - 更新 `.trellis/spec/backend/tauri-command-contracts.md`：记录 command library commands、存储边界和错误码。
   - 更新 `.trellis/spec/frontend/tauri-command-contracts.md` / component guideline：记录 Command Sender 历史只来自主动发送，不被动监听终端输入。

9. 验证
   - `npm run check`
   - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
   - `cargo test --manifest-path src-tauri/Cargo.toml command_library --lib`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `git diff --check`
   - staged diff 和敏感信息检查。

## Risk Points

- `TerminalPanel` 的终端输入历史必须默认关闭，并且只在成功写入后记录保守过滤后的回车命令；不要记录控制键、TUI 输入、密码提示或敏感变量。
- 不要让 snippet/history 记录目标 session id；历史只表达命令文本和成功写入数量。
- `WorkspaceShell.tsx` 已经很大，改动要集中，避免顺手重构整个工作台。
- 保存为片段时不要自动覆盖同名片段；如果要覆盖，必须通过编辑现有片段完成。
- 片段和历史可能包含敏感命令，必须提供删除单条和清空全部。
- Browser preview 不能因为 Tauri command 缺失而白屏。

## Validation Commands

```powershell
npm run check
```

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

```powershell
cargo test --manifest-path src-tauri/Cargo.toml command_library --lib
```

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```
