# 连接仓库与终端会话设计

## Scope

本任务把连接配置、终端会话和 UI 入口分开。连接配置是可持久化的数据；终端会话是运行时资源；左侧连接仓库只负责选择、编辑和打开会话。

## Backend

- 新增 `src-tauri/src/connections/` 模块。
- `ConnectionProfile` 保存连接配置，包含 `id`、`name`、`host`、`port`、`username`、`auth`、`password`、`private_key_path`、`private_key_passphrase`、`notes`、`created_at`、`updated_at`。
- `ConnectionStore` 使用 JSON 文件持久化，文件放在 Tauri app data 目录；测试中使用临时路径。
- Tauri command 每次按 app data 路径加载 `ConnectionStore`，提供 list、upsert、delete、get；连接配置操作频率低，先避免引入长期锁和缓存一致性问题。
- `terminal_connect` 增加 `connection_id` 可选字段；前端也可以继续传完整连接信息，便于保留 Spike 路径。

## Frontend

- 新增 `src/features/connections/`，包含连接类型、hooks、连接仓库和连接弹窗。
- `WorkspaceShell` 管理连接列表、当前选择、终端 tab 列表。
- 没有通过右侧文件区双击打开文件时，不展示编辑器占位区域，终端占据主工作区。
- 左侧连接只负责选中连接；中间 tab 只展示当前连接下的终端，标题按“终端”“终端 1”递增。
- `TerminalPanel` 从临时表单改为接收 `TerminalTab` 和 `ConnectionProfile`，打开 tab 时调用真实 SSH。
- 一个连接可以创建多个 `TerminalTab`，每个 tab 持有自己的 `sessionId`、状态和标题。

## Error Handling

- Rust command 返回现有 `AppError`。
- 用户可修正的错误显示简短中文提示，同时保留原始错误细节。
- 删除不存在连接、打开不存在连接、缺少认证信息都返回明确 code。

## Storage Rule

首版明文保存密码和私钥口令，符合个人工具定位。数据文件带 `version` 字段，后续迁移到加密存储或锁屏密码时可升级。

## Validation

Rust 先写 store/validate/manager 单测，再实现 command。前端先保证 TypeScript 类型和普通浏览器预览不崩，再用 Tauri 窗口验证真实连接。
