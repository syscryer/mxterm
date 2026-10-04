# 编码 Agent 完整化计划

这份清单用于按本地 ZCode 的编码 Agent 能力逐项补齐 mXterm。每项完成后先做代码检查和可观察的本地/SSH 验证，再进入下一项。

## P0：先修复当前主流程

- [x] **P0-1 编辑闭环**：修复 `preview_patch` / `apply_patch`、文件变更应用和回滚的参数衔接；远程完整写入生成 diff；写入操作保留可用的备份编号。
- [x] **P0-2 工具历史与工作区状态恢复**：恢复完整的工具调用、工具结果、审批状态和文件读取快照，确保重启或继续会话后 Agent 不丢失事实。
- [x] **P0-3 上下文窗口管理**：按模型配置估算 token 使用量，达到 80% 时自动压缩到约 60%，保留最近 8 条消息并摘要旧上下文；提供 `compact_context` 手动压缩；命令和联网工具的超长输出落盘为 artifact，并通过 `read_tool_output` 分段读取；删除或清空会话时清理 artifact。
- [x] **P0-4 请求重试与中断恢复**：Agent 和普通聊天流对尚未产生正文/思考输出的网络、超时、限流和服务端瞬时错误执行最多 2 次指数退避重试；鉴权、参数、解析错误，已有部分输出以及用户停止均不重试，并保留当前已生成内容。

## P1：编码体验与长期任务

- [x] 项目级 `AGENTS.md`、用户指令、Skills 和项目记忆加载：按已授权工作区读取祖先链中的 `AGENTS.md`，支持工作区内指令、记忆和 Skills 文件；SSH 工作区在 Agent 启动前通过当前远程目录读取同类上下文，并限制层级、文件数量和字符数。
- [x] 统一本地与 SSH 的 `glob` / `grep` 能力，统一支持正则或字面量、大小写、多行、上下文、输出模式、`offset` / `limit` / `head_limit` 分页；结果包含匹配内容、文件数、匹配数、是否截断、下一页偏移和二进制跳过信息。SSH 优先使用 `rg`，未安装时使用同一套 Rust 正则和 glob 匹配器，并显式返回引擎与降级告警。
- [x] 多文件变更汇总、工作区检查点、整体回滚和重启后的变更状态恢复：新增 `workspace_changes`、`create_workspace_checkpoint`、`rollback_workspace` 工具；检查点记录已应用变更及应用顺序，一次确认后按逆序回滚，并沿用现有工作区状态持久化恢复旧会话状态。
- [x] 明确文件工具的 `local` / `ssh` 目标，保持当前终端主机为文件工具默认目标；SSH 会话可通过 `target=local` 操作已选择的本地文件工作区，本机终端无须另选工作区即可操作本机当前目录。
- [x] 命令输出流式展示、完整输出文件化、前后台任务衔接和后台完成通知。

## P2：可选扩展

- [ ] 子 Agent、外部 MCP 客户端、Skill 工具、Node REPL。
- [ ] 定时任务、工作流、会话 fork/rewind。
- [ ] 图片、PDF、Notebook 等文件类型支持。

## P2-3 附件支持拆分

- [x] 图片附件：多选、剪贴板粘贴、预览、移除、会话持久化，以及 OpenAI 兼容、Responses、Anthropic 和 Agent 请求格式。
- [x] 文本类附件：代码、日志、配置、CSV 等 UTF-8 文本，保留完整内容并支持历史预览。
- [ ] PDF、Office、压缩包和 Notebook 解析。

## 当前验证记录

- P0-1：已完成代码修复；`rtk npm run check`、`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml` 和 `rtk git diff --check` 均通过。Rust 仍有既有未使用代码警告。
- P0-2：工具调用和参数在助手消息更新时增量持久化；历史恢复时重建 OpenAI/Anthropic 工具调用与结果；工作区读取快照、待应用变更和回滚索引按会话与工作区作用域保存。前端检查、Rust 格式和编译检查通过；Rust 单测受 Windows `0xc0000139` 测试清单问题阻断。
- P0-3：上下文窗口使用模型配置，默认 200000；达到 80% 自动压缩，保留最近 8 条并摘要旧消息；`compact_context` 可强制压缩；超长命令和联网结果保存完整 artifact，并可用 `read_tool_output` 按偏移分段读取。`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml`、`rtk npm run check` 和 `rtk git diff --check` 均通过；Rust 单测仍受 Windows `0xc0000139` 测试清单问题阻断。
- P0-4：普通聊天和 Agent 请求共享瞬时错误分类，最多重试 2 次，退避 400ms/800ms；收到部分正文或思考后不重放请求，用户停止时不会进入重试；重试分类边界测试已加入，Rust 测试目标成功编译。`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml`、`rtk cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、`rtk npm run check` 和 `rtk git diff --check` 均通过；Rust 测试运行仍受 Windows `0xc0000139` 测试清单问题阻断。
- P1-1：本地 Agent 从选定的本地文件工作区或本地主机工作目录加载 `AGENTS.md`、`USER_INSTRUCTIONS.md` / `INSTRUCTIONS.md`、`MEMORY.md` 和 `.codex` / `.agents` 下的 Skills；SSH Agent 在启动模型请求前从当前远程目录及其仓库祖先读取同类文件。上下文限制为最多 32 个文件、12 层祖先目录、总计 24000 字符，并隐藏常见敏感配置赋值和私有 IP；读取失败会明确写入上下文状态，不改变命令主机或文件工作区边界。`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml`、`rtk cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、`rtk npm run check` 和 `rtk git diff --check` 均通过；Rust 测试运行仍受 Windows `0xc0000139` 测试清单问题阻断。
- P1-2：新增统一搜索引擎，修复本地嵌套工作区路径解析和固定 200 文件遍历上限；本地使用 `.gitignore` 感知遍历，SSH 优先 `rg --json` / `rg --files`，无 `rg` 时用远程文件列表加本地同一正则/glob 解析，并在结果中返回 `engine`、`output_mode`、匹配统计、上下文行、分页和截断信息。新增 5 个搜索单测全部通过（使用 Common Controls v6 清单重新链接测试 exe）；`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml`、`rtk cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、`rtk npm run check` 和 `rtk git diff --check` 均通过。
- P1-3：工作区状态新增检查点、已应用变更顺序和回滚状态；`workspace_changes` 返回待应用/已应用变更及检查点汇总，`create_workspace_checkpoint` 持久化当前多文件变更，`rollback_workspace` 经过一次文件确认后按逆序执行本地或 SSH 回滚，并在冲突时停止并保留真实错误。旧版工作区状态 JSON 兼容测试、23 个 Agent 测试和 5 个搜索测试均通过；`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、`rtk npm run check` 和 `rtk git diff --check` 均通过。
- P1-5：前台命令按 stdout/stderr 增量发送，后台任务保持运行态直到真实退出；非零退出码、取消未确认和输出落盘失败会进入失败/未确认状态，任务查询可读取运行中的尾部输出，完整输出保存为 artifact，完成事件会更新同一工具记录且不会覆盖已结束会话状态。前端接收主流结束后到达的后台最终工具记录。`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml`、`rtk cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、`rtk npm run check` 和 `rtk git diff --check` 通过；桌面开发版已启动并在 `http://localhost:5520/` 返回 HTTP 200，SSH 长任务和取消链路仍需真实连接验收。
- P1-4：文件工具新增可选 `target=local|ssh`；省略时跟随当前终端主机，SSH 会话中本地文件操作必须显式选择 `local`，本机终端默认使用本机当前目录。读取快照、远程元数据、补丁和回滚记录按目标隔离；本地与 SSH 可在同一会话中协同操作，重启后的工作区状态作用域同时包含两类目标。`rtk cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`rtk cargo check --manifest-path src-tauri/Cargo.toml`、`rtk cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、`rtk npm run check` 和 `rtk git diff --check` 均通过。
- 本计划只记录编码 Agent 能力，不替代 `docs/spec/` 中的前后端契约。
