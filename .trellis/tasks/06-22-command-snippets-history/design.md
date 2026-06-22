# Command snippets and history 技术设计

## Product Shape

本功能作为 Command Sender 的增强层，不新增独立页面。入口保持在现有底部命令操作台内：

- 顶部工具栏：保留发送模式，下拉加入“命令片段”和“历史命令”。
- 命令编辑区：保留 textarea、风险提示和底部发送动作。
- 辅助动作：提供“保存为片段”和“管理片段”小按钮。
- 管理弹窗：使用 Radix Dialog，展示片段列表、编辑表单、删除动作；历史管理以轻量动作完成，避免再开一个复杂页面。

ui-ux-pro-max 审查结论：该功能属于桌面运维工具的高频辅助能力，应保持高密度、低装饰、状态文本明确、token 驱动，不引入营销式卡片或大面积新视觉体系。

## Data Model

新增后端模块建议为 `src-tauri/src/command_library.rs`。

```rust
pub struct CommandSnippet {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub use_count: u32,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct CommandHistoryEntry {
    pub id: String,
    pub command: String,
    pub source: CommandHistorySource, // command_sender
    pub target_count: u32,
    pub append_enter: bool,
    pub use_count: u32,
    pub last_used_at: String,
    pub created_at: String,
}
```

SQLite 新增表：

```sql
CREATE TABLE IF NOT EXISTS command_snippets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    command TEXT NOT NULL,
    description TEXT,
    tags_json TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_history (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    target_count INTEGER NOT NULL DEFAULT 0,
    append_enter INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

`command` 允许多行，但会做长度限制。首版建议最大 4000 字符，避免意外粘贴大量文本进入历史/片段。`tags` 用逗号分隔输入，后端规范化为去重、trim 后的数组，SQLite 里用 JSON 字符串存储，减少新建 tag 表的复杂度。

## Backend Commands

新增 Tauri commands：

```rust
command_snippet_list(app: AppHandle) -> Result<Vec<CommandSnippet>, AppError>
command_snippet_upsert(app: AppHandle, request: CommandSnippetInput) -> Result<CommandSnippet, AppError>
command_snippet_delete(app: AppHandle, request: CommandSnippetIdRequest) -> Result<(), AppError>
command_snippet_mark_used(app: AppHandle, request: CommandSnippetIdRequest) -> Result<CommandSnippet, AppError>

command_history_list(app: AppHandle, request: CommandHistoryListRequest) -> Result<Vec<CommandHistoryEntry>, AppError>
command_history_record(app: AppHandle, request: CommandHistoryRecordRequest) -> Result<CommandHistoryEntry, AppError>
command_history_delete(app: AppHandle, request: CommandHistoryIdRequest) -> Result<(), AppError>
command_history_clear(app: AppHandle) -> Result<(), AppError>
```

命令历史由前端在 Command Sender 写入完成后调用：

- 至少一个目标写入成功才记录。
- `command` 使用发送前的原始输入 trim 后版本，避免记录空白。
- `target_count` 记录成功写入数量，不记录 session id、connection id 或目标名称。
- 重复命令使用 `ON CONFLICT(command)` 合并，更新 `target_count`、`append_enter`、`use_count`、`last_used_at`。

错误码建议：

- `command_snippet_title_missing`
- `command_snippet_command_missing`
- `command_snippet_too_long`
- `command_snippet_missing`
- `command_history_command_missing`
- `command_history_too_long`
- `command_history_missing`

## Frontend Flow

`src/shared/tauri/commands.ts` 新增 typed wrappers，`src/features/commands/commandLibraryTypes.ts` 放前端类型。

`WorkspaceShell` 当前承载 Command Sender 状态。本轮以最小风险改动为主：

- 把内存态 `commandSenderHistory: string[]` 替换为 `CommandHistoryEntry[]`。
- 新增 `commandSnippets`、`commandLibraryLoading`、`commandLibraryError`、`selectedCommandSnippetId`、`snippetDialogState`。
- 打开 Command Sender 或 `storageReady` 后加载片段和历史。
- 选择片段：设置输入框并记录 `selectedCommandSnippetId`。
- 输入框手动变化：清空 `selectedCommandSnippetId`，避免把改过的命令算到原片段。
- 发送成功：记录历史；如果 `selectedCommandSnippetId` 仍存在，则 mark used。
- 保存片段：当前输入非空时打开片段弹窗，默认标题取第一行或前 32 字。

如果 `WorkspaceShell` 继续膨胀明显，后续应把 Command Sender UI 提取到 `src/features/commands/CommandSenderPanel.tsx`。本轮可以先补类型与 helper，避免大迁移引发回归。

## UI Details

- 片段下拉触发文案：`命令片段`，空状态禁用并显示“暂无片段”。
- 历史下拉触发文案：`历史命令`，空状态禁用并显示“暂无历史”。
- 片段列表排序：收藏优先，其次最后使用时间，再按更新时间。
- 历史列表排序：最后使用时间倒序，最多显示 50 条。
- 管理弹窗保持 520px 左右宽度，左侧片段列表，右侧编辑区；如果空间不够，使用单列纵向布局。
- 操作按钮使用 Lucide 图标：`Star` 收藏、`Pencil` 编辑、`Trash2` 删除、`Plus` 新建。
- 不用原生 `<select>`，不新增硬编码颜色，状态样式复用 `--mx-*` token。

## Compatibility

- SQLite `CREATE TABLE IF NOT EXISTS` 可在现有数据库初始化时补表。
- 旧内存历史不会迁移，因为它没有持久化来源。
- Browser preview 不调用 Tauri，可显示空列表并禁用真实保存/删除。
- WebDAV 同步暂不纳入本轮；后续同步片段时再扩展 snapshot contract。

## Testing

- Rust 单元测试覆盖：
  - snippet title/command 校验。
  - tag trim/去重。
  - snippet upsert/list/delete/mark used。
  - history record 合并 use_count。
  - history list limit 和倒序。
  - history delete/clear。
- 前端运行 `npm run check`。
- 后端运行 `cargo test --manifest-path src-tauri/Cargo.toml command_library --lib`。
- 后端运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
