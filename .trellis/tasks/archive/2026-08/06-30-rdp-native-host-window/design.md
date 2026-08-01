# RDP 独立子窗体设计

## 范围

本轮只调整现有 Windows 原生 RDP 宿主的窗口归属与唤起链路，不新建 WebView 子应用，也不重构主窗体中的 RDP 工作区。

## 现状与根因

当前 `src-tauri/src/rdp.rs` 已经有一个支持多会话、多原生标签的 ActiveX 宿主窗口。用户感知不对，主要不是因为没有 RDP 子窗体，而是该宿主窗口仍带着主窗体附属行为，最小化和恢复体验不像独立窗口。

## 方案

### 1. Rust 原生宿主改为独立顶层窗口

- 保留 `RdpSessionManager` 的单例宿主模型。
- 宿主创建时不再依赖 owner 绑定来决定复用。
- `CreateWindowExW` 继续创建普通顶层 Win32 窗口，但不再作为主窗体附属窗口参与展示。
- `RdpSessionManager::native_host()` 只按宿主句柄是否仍有效来复用已有宿主。

### 2. 补充宿主窗口唤起能力

- 在 Rust 侧新增 `rdp_reveal_session` 命令。
- 若目标会话属于当前原生宿主，向宿主线程发送 `ActivateSession { session_id }`。
- 宿主线程收到后切换原生 tab，并调用窗口恢复/置前逻辑。

### 3. 宿主窗口状态持久化

- 在 app data 下单独保存 `rdp-host-window-state.json`。
- 宿主销毁时记录 `x / y / width / height / maximized`。
- 再次创建宿主时优先恢复该状态；没有记录时沿用现有默认尺寸逻辑。

### 4. 前端接线

- `src/features/connections/connectionTypes.ts` 增加 `RdpSessionRevealResult`。
- `src/shared/tauri/commands.ts` 增加 `rdpRevealSession(sessionId)` typed wrapper。
- `WorkspaceShell.openRdpConnectionSession()` 命中已有 RDP runtime session 时：
  - 先激活当前工作区 tab；
  - 若是 Windows ActiveX 原生宿主会话，则调用 `rdpRevealSession(...)` 唤起原生宿主窗口。

## 兼容性与风险控制

- 不移除现有 `RdpSessionStatusPanel`，避免前端大范围回归。
- 不改变 RDP 关闭事件协议，继续依赖 `rdp:session_closed` 驱动前端清理。
- `parent_hwnd` 等历史字段先保守保留，避免误伤现有 resize/close 分支；仅把真实宿主创建与复用逻辑切离 owner。

## 验证

- 编译校验 Rust 命令签名和前端 typed wrapper 对齐。
- 手动烟测关注：
  - 打开第一个 RDP 会话；
  - 最小化后是否可单独恢复；
  - 再次打开同连接时是否唤起已有宿主；
  - 关闭宿主后前端 runtime tab 是否同步移除；
  - 重新打开后窗口状态是否恢复。
