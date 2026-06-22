# Command snippets and history 技术设计

## Product Shape

本功能作为 Command Sender 的增强层，不新增独立页面。入口放在现有右侧工具面板内，底部 Command Sender 仍是唯一发送操作台：

- 右侧工具面板：新增“命令”tab，内部提供“片段 / 历史”分段。
- 片段视图：一层树形文件夹分组，文件夹标题下直接缩进展示片段；片段可以插入 Command Sender，也可以后台触发对当前目标发送。
- 历史视图：紧凑命令行列表；历史可以按当前连接/profile、其它连接/profile 或全部历史筛选，也可以插入、再次发送、存为片段、删除或清空。
- Command Sender：保留发送模式、目标选择、textarea、风险提示和底部发送动作。
- 本地终端工作区：复用右侧工具面板，但只暴露“命令”tab，隐藏文件、传输、监控、隧道。
- 片段保存弹窗：使用 Radix Dialog，只承载当前片段的轻量表单；列表、编辑、删除、复制和分组右键操作留在右侧命令面板内。

ui-ux-pro-max 审查结论：该功能属于桌面运维工具的高频辅助能力，应保持高密度、低装饰、状态文本明确、token 驱动，不引入营销式卡片或大面积新视觉体系。

## Data Model

新增后端模块建议为 `src-tauri/src/command_library.rs`。

```rust
pub struct CommandSnippet {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub group: String,
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
    pub source: CommandHistorySource, // command_sender | terminal_input
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
    group_name TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS command_history_scopes (
    history_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source TEXT NOT NULL,
    target_count INTEGER NOT NULL DEFAULT 0,
    append_enter INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(history_id, scope_kind, scope_id),
    FOREIGN KEY(history_id) REFERENCES command_history(id) ON DELETE CASCADE
);
```

`command` 允许多行，但会做长度限制。首版建议最大 4000 字符，避免意外粘贴大量文本进入历史/片段。`group` 为空时直接归入根目录，SQLite 使用 `group_name` 字段并为老库补列；历史值“未分组”会迁移为根目录。`tags` 用逗号分隔输入，后端规范化为去重、trim 后的数组，SQLite 里用 JSON 字符串存储，减少新建 tag 表的复杂度。`source` 初始支持 `command_sender` 与 `terminal_input`，同一命令仍按文本合并，避免来源变化导致历史列表膨胀。

历史文本仍然在 `command_history.command` 上全局去重；`command_history_scopes` 只记录这条命令在哪些 SSH 连接或本地 profile 下使用过。按 scope 筛选时使用 scope 自己的 `source/use_count/last_used_at`，全部历史使用全局聚合值。旧历史没有 scope，不做假关联，只在“全部历史”中展示。

## Backend Commands

新增 Tauri commands：

```rust
command_snippet_list(app: AppHandle) -> Result<Vec<CommandSnippet>, AppError>
command_snippet_upsert(app: AppHandle, request: CommandSnippetInput) -> Result<CommandSnippet, AppError>
command_snippet_delete(app: AppHandle, request: CommandSnippetIdRequest) -> Result<(), AppError>
command_snippet_mark_used(app: AppHandle, request: CommandSnippetIdRequest) -> Result<CommandSnippet, AppError>

command_history_list(app: AppHandle, request: CommandHistoryListRequest { limit, scope }) -> Result<Vec<CommandHistoryEntry>, AppError>
command_history_record(app: AppHandle, request: CommandHistoryRecordRequest) -> Result<CommandHistoryEntry, AppError>
command_history_delete(app: AppHandle, request: CommandHistoryIdRequest) -> Result<(), AppError>
command_history_clear(app: AppHandle) -> Result<(), AppError>
```

命令历史由前端在 Command Sender 写入完成后调用：

- 至少一个目标写入成功才记录。
- `command` 使用发送前的原始输入 trim 后版本，避免记录空白。
- `target_count` 记录成功写入数量，不记录 session id、connection id 或目标名称。
- 重复命令使用 `ON CONFLICT(command)` 合并，更新 `target_count`、`append_enter`、`use_count`、`last_used_at`。
- 成功写入目标会生成 scope：SSH 目标记录 `ssh_connection + connection_id`，本地终端记录 `local_profile + profile_id`。多目标发送会去重 scope 后写入，不记录 runtime tab id 或 session id。

终端输入历史是可选增强：

- 设置项 `settings.command.recordTerminalInputHistory` 默认关闭，入口放在系统设置；历史页只展示状态和“去设置”入口。
- `TerminalPanel` 在 xterm `onData` 中维护轻量输入缓冲，只在 `terminalWrite` 成功后提交回车命令。
- 只接收普通可打印字符和退格；遇到 ESC/CSI、Tab、Ctrl/Alt 控制字符或其他控制序列时标记当前行 dirty，回车时丢弃。
- 过滤 `passwd`、`sshpass`、`sudo -S`、带 `-p` 的常见数据库客户端命令，以及包含 `password/token/secret/access_key=` 的命令。
- 不推断执行结果、不解析 shell history 文件、不注入远端 shell hook。

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
- 右侧 `CommandLibraryPanel` 接入 `RemoteFilePanel.commandPanel`，通过当前 `rightTool === "commands"` 展示；本地终端工作区传入 `availableTools=["commands"]`，只显示命令工具。
- 选择片段：打开 Command Sender、准备目标、设置输入框并记录 `selectedCommandSnippetId`。
- 输入框手动变化：清空 `selectedCommandSnippetId`，避免把改过的命令算到原片段。
- 发送成功：记录历史；如果 `selectedCommandSnippetId` 仍存在，则 mark used。
- 保存片段：当前输入非空时打开片段弹窗，默认标题取第一行或前 32 字。
- 右侧面板点“发送到终端”时使用本次计算出的目标列表，不依赖 React 异步更新后的选中目标状态，也不展开底部 Command Sender 或清空其中正在编辑的输入。
- Command Sender 目标列表包含 SSH 连接目标和本地终端目标。SSH 目标按连接聚合并可选子 tab；本地终端作为一个目标组，子 tab 下拉选择具体本地终端。

如果 `WorkspaceShell` 继续膨胀明显，后续应把 Command Sender UI 提取到 `src/features/commands/CommandSenderPanel.tsx`。本轮可以先补类型与 helper，避免大迁移引发回归。

## UI Details

- 右侧命令 tab 顶部显示短标题、分段切换、搜索框和数量。
- 片段视图使用单列一层树形分组，不做左右分栏、不做多级目录；横向 chip 分组不适合右侧窄面板，不使用。
- 空分组片段直接展示在根目录；显式分组只保留一层，可右键重命名或删除，删除分组会删除组内片段。
- 片段/历史卡片主体只展示命令内容，单击卡片不展开底部 Command Sender；回填必须点击插入图标或使用右键菜单。
- 片段行显示复制、插入、发送按钮；编辑、删除等维护动作放入片段行右键菜单。历史行同样只提供复制、插入、发送按钮，存为片段和删除放入历史行右键菜单。行内按钮默认隐藏，hover 或键盘 focus 时展示。
- 片段列表排序：收藏优先，其次最后使用时间，再按更新时间。
- 历史列表排序：最后使用时间倒序，最多显示 50 条；历史用紧凑行列表，不做大卡片。
- 历史列表显示来源 badge：主动发送显示“发送”，终端回车采集显示“终端”。
- 历史页头部提供范围下拉，列表展平显示“当前连接（名称）”、其它 SSH 连接、本地 profile（PowerShell/cmd/Git Bash 等）和“全部历史”。SSH 工作区默认当前连接，本地工作区默认当前 profile。
- 历史页不直接放“记录终端输入”开关，只显示“记录已开/记录关闭”状态和设置入口。
- 保存/编辑片段使用轻量弹窗，分组字段使用共享下拉；新增分组使用主界面轻量弹窗。
- 操作按钮使用 Lucide 图标：`Star` 收藏、`Pencil` 编辑、`Trash2` 删除、`Plus` 新建。
- 不用原生 `<select>`，不新增硬编码颜色，状态样式复用 `--mx-*` token。

## Compatibility

- SQLite `CREATE TABLE IF NOT EXISTS` 可在现有数据库初始化时补表；`group_name` 通过 `ALTER TABLE ... ADD COLUMN` 兼容已创建过 command_snippets 的老库。
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
