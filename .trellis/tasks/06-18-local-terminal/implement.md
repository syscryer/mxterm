# 本地终端实施计划

## 实施顺序

1. 后端引入 `portable-pty`，实现本地 PTY 会话
2. 后端实现本地 profile 自动发现和 `local_terminal_*` 命令
3. 前端补类型、设置模型和本地 profile 合并逻辑
4. 前端扩展顶栏，增加固定“本地终端”入口和图标
5. 前端实现本地终端工作区、子 tab、默认 `+`、下拉菜单
6. 前端实现本地终端设置页和自定义 profile 管理
7. 统一样式、图标和错误状态
8. 最小验证和自查

## 代码改动重点

### 后端

- `src-tauri/Cargo.toml`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/terminal/mod.rs`
- `src-tauri/src/terminal/manager.rs`
- `src-tauri/src/terminal/local.rs` 新增
- `src-tauri/src/terminal/local_profiles.rs` 新增

### 前端

- `src/shared/tauri/commands.ts`
- `src/features/terminal/terminalTypes.ts`
- `src/features/settings/settingsTypes.ts`
- `src/features/settings/useSettings.ts`
- `src/features/settings/SettingsView.tsx`
- `src/features/layout/AppTitlebar.tsx`
- `src/features/layout/WorkspaceShell.tsx`
- `src/styles/app.css`
- `src/features/terminal/localTerminalTypes.ts` 新增
- `src/features/terminal/LocalTerminalIcons.tsx` 新增

## 验证点

### 后端

- 能列出本地 profile
- 能打开 PowerShell / cmd / WSL 等本地会话
- `terminal_write` / `terminal_resize` / `terminal_close` 对本地会话有效
- 会话退出后能收到 `terminal:state_changed`

### 前端

- 顶栏固定显示“本地终端”
- 第一次点击本地终端可自动打开默认 profile
- `+` 新建默认 profile
- 下拉可选不同 profile
- 不同类型会话左侧图标不同
- SSH 工作区不回归
- 本地终端工作区不会显示右侧远程工具

## 验证命令

优先执行最小必要验证：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
npm run typecheck
```

如果有现成测试可补充，再跑针对性的：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 回滚关注点

- `WorkspaceShell.tsx` 的工作区切换逻辑
- `AppTitlebar.tsx` 的顶栏标签结构
- `TerminalManager` 从单一 SSH 会话改成统一会话枚举
- 设置结构新增 `localTerminal` 后的兼容性
