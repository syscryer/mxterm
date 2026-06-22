# Command snippets and history 实施计划

## Before Start

- 用户已授权从需求设计到开发按推荐方案推进，早上 review。
- 当前已有隧道增强变更处于 staged，不能回滚或混入无关修改。
- 本任务只做 Command Sender 的命令片段和主动发送历史，不做普通终端输入监听。
- 开发前加载 `trellis-before-dev`，读取前后端规范。

## Ordered Checklist

1. 任务文档
   - 写 `prd.md`、`design.md`、`implement.md`。
   - 明确不记录普通终端输入、不接入 WebDAV 同步。

2. 后端模型和 schema
   - 新增 `src-tauri/src/command_library.rs`。
   - 在 `storage_sqlite.rs` 增加 `command_snippets`、`command_history` 表和索引。
   - 在 `StorageRepository` 增加 snippet/history CRUD 方法。
   - 注意不要存目标 session id、connection id 或命令执行结果。

3. 后端 Tauri commands
   - 在 `commands.rs` 增加 command snippet/history request/response 使用。
   - 在 `lib.rs` 注册新命令。
   - 在 `shared/tauri/commands.ts` 增加 typed wrapper。

4. 后端测试
   - command snippet 校验测试。
   - command history 合并、排序、删除、清空测试。
   - 运行 `cargo test --manifest-path src-tauri/Cargo.toml command_library --lib`。

5. 前端类型和状态
   - 新增 `src/features/commands/commandLibraryTypes.ts`。
   - `WorkspaceShell` 加载片段/历史状态。
   - 替换原内存 `commandSenderHistory: string[]`。

6. Command Sender UI
   - 顶部工具栏加入片段下拉、历史下拉、保存/管理片段按钮。
   - 新增片段管理 Dialog。
   - 发送成功后记录历史，片段直接发送后 mark used。
   - 清空/删除历史需要明确用户动作，避免误删。

7. 样式
   - 样式写入 `src/styles/app.css`。
   - 使用 `--mx-*` token、现有 command sender 选择器和共享弹窗风格。
   - 下拉继续使用 `AppSelect`。

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

- 不要在 `TerminalPanel` 的 `onData` 中捕获历史，否则可能记录密码、控制键或 TUI 输入。
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
