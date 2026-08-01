# AI 终端小帮手 Technical Design

## Architecture

第一版采用“后端统一模型请求 + 前端右侧工具面板”的结构：

- `src-tauri/src/ai_assistant.rs` 负责 AI 配置、API Key vault 存储、对话历史、危险命令检测、OpenAI-compatible / Claude 格式流式请求，以及生成停止。
- `src/shared/tauri/commands.ts` 暴露 typed wrappers，`src/shared/tauri/events.ts` 暴露 AI 流式事件监听。
- `src/features/ai/` 新增前端类型、状态管理与 `AiAssistantPanel`。
- `RemoteFilePanel` 增加一级 `ai` 工具标签，`WorkspaceShell` lazy-load AI 面板。
- `TerminalPanel` 增加统一右键菜单入口，把 xterm 选中文本发送给 `WorkspaceShell`，由 `WorkspaceShell` 打开右侧 AI 面板并注入上下文块。
- 设置页新增 AI 配置入口，采用左侧配置列表 + 右侧详情编辑的 master-detail 结构，并继续使用现有设置页面板风格、`AppSelect`、共享菜单/按钮样式和 `--mx-*` token。

## Data Model

### Provider Config

用户可维护多条 AI 配置：

- `id`
- `name`（用户看到的配置名称，也是用户口径里的“供应商”）
- `provider`: `openai | claude`（由界面接入模式派生的内部字段）
- `api_format`: `openai_compatible | anthropic`（界面展示为接入模式）
- `endpoint`
- `model`
- `api_key_saved`
- `created_at`
- `updated_at`

配置元数据保存在 `app_settings`，API Key 使用现有 vault `SecretReference` 保存。保存配置时采用 `api_key_touched` 语义：未触碰时保留旧 key，触碰为空时删除 key。

### Chat History

对话历史本地持久化完整保存：

- 会话：`ai_chat_sessions`
  - `id`, `title`, `provider_config_id`, `created_at`, `updated_at`
- 消息：`ai_chat_messages`
  - `id`, `session_id`, `role`, `content`, `contexts_json`, `commands_json`, `status`, `created_at`, `updated_at`

`contexts_json` 保存当次发送的可见上下文块完整内容；`commands_json` 保存 AI 回复中识别出的命令建议和风险等级。用户可继续、删除单个会话、清空当前会话。

## Streaming Contract

前端调用 `ai_chat_stream_start(request)`，后端立即创建/更新用户消息和占位 assistant 消息，返回：

- `stream_id`
- `session_id`
- `assistant_message_id`
- `user_message_id`

后端后台任务向前端发送事件：

- `ai:chat_stream`
  - `kind: "chunk" | "finished" | "error" | "stopped"`
  - `stream_id`
  - `session_id`
  - `message_id`
  - `delta?`
  - `content?`
  - `error?`

前端按 `stream_id` 合并 delta。停止生成调用 `ai_chat_stream_stop(stream_id)`，后端取消任务并把已生成内容标记为 `stopped`。

## Provider Protocols

### OpenAI-compatible

后端 POST 到配置的 `endpoint`，请求体使用 Chat Completions 兼容形态：

```json
{
  "model": "...",
  "stream": true,
  "messages": [...]
}
```

默认按 SSE `data:` 行解析 `choices[0].delta.content`。

### Claude / Anthropic

后端 POST 到配置的 `endpoint`，请求体使用 Messages API 形态：

```json
{
  "model": "...",
  "stream": true,
  "max_tokens": 4096,
  "messages": [...]
}
```

默认按 SSE `content_block_delta` / `message_delta` / `message_stop` 事件解析文本增量。认证使用 `x-api-key` 和 `anthropic-version` header；如果用户把 Claude 格式指向兼容网关，仍以 `api_format` 决定请求协议。

## Context Package

AI 面板中的上下文包由前端组装并显示：

- 终端选中文本
- 最近终端输出
- 当前连接脱敏信息
- 命令草稿/最近命令

每个上下文块包含 `id`、`kind`、`title`、`content`、`source`、`line_count`、`char_count`。发送前用户可移除。终端右键发送选中文本只打开 AI 面板并注入上下文，不自动提交。

## Command Suggestions And Safety

AI 回复文本中的 fenced code blocks 和 shell-like 单行命令会被提取为命令建议。建议卡片支持：

- 复制
- 插入到 Command Sender
- 保存为命令片段
- 发送到终端

危险命令检测在前后端共享语义，后端提供 `ai_command_assess(command)` 作为权威判断。危险模式包括但不限于：

- `rm -rf` / 批量删除
- `mkfs` / `fdisk` / `parted` / 格式化磁盘
- `dd of=...`
- 覆盖系统配置或 SSH 配置
- 防火墙、路由、权限、用户、服务重启等高影响操作
- `sudo` 与高风险命令组合

普通命令发送到终端不二次确认；危险命令发送到终端前必须使用现有确认弹窗模式。复制、插入和保存片段不弹确认。

## UI

- AI 面板是右侧工具面板一级标签，紧凑桌面工具布局，不做营销式 hero 或大卡片视觉。
- 面板顶部包含当前配置选择、新会话/历史入口、配置缺失提示。
- 中部为消息列表和上下文块展示。
- 底部为输入框、上下文管理、发送/停止按钮。
- 设置页 AI 配置使用已有设置页 panel、表单、`AppSelect` 和 token，不引入原生 select 或一次性视觉体系；左侧列表展示配置名称与接入摘要，右侧表单编辑配置名称、接入模式、请求地址、模型和 API Key。

## Startup Boundary

`WorkspaceShell` 通过 `React.lazy` 动态加载 `AiAssistantPanel`。AI feature 不在 `main.tsx`、`App.tsx` 或 Workspace 顶层静态引入重逻辑。后端模块随 Tauri 启动注册命令，但前端 UI 和 provider 操作按需加载。

## Validation

- `npm run check`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node scripts/check-startup-module-boundary-source.mjs`
- 后端 provider parser / command risk detector 单元测试
- 不使用 Codex 自带浏览器工具

## Security Notes

- API Key 不写入源码、Trellis 文档、日志或普通 app settings。
- 模型请求错误必须脱敏，不回显 Authorization、x-api-key 或完整请求体。
- 对话历史按需求完整保存，但用户必须有删除会话和清空当前会话入口。
- 后续 Agent 模式作为新的 provider/tool layer 接入，不复用本次“建议命令”路径做静默执行。
