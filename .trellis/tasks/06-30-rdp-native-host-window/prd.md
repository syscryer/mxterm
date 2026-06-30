# RDP 独立子窗体

## Goal

将现有 Windows 原生 RDP 宿主从主窗体附属行为调整为真正独立的 RDP 子窗体，确保用户最小化后能在任务栏单独恢复，并且再次从主窗体打开同一 RDP 连接时可以唤起并聚焦已有 RDP 宿主窗口。

## Requirements

- 主窗体整体结构暂时不调整，当前 RDP 工作区页保留为会话管理/状态入口。
- Windows ActiveX RDP 继续复用现有 Rust 原生宿主能力，不新建新的 WebView runner 页面。
- 整个应用只保留 1 个 RDP 原生宿主窗口；多个 RDP 会话继续在该窗口内部以原生标签复用。
- RDP 原生宿主窗口必须脱离主窗体 owner 关系，表现为独立顶层窗口，任务栏能单独显示和恢复。
- 再次从主窗体打开已存在的 RDP 会话时，应切到对应运行时 tab，并唤起/聚焦已有 RDP 原生宿主窗口。
- RDP 原生宿主窗口需要单独记住自身大小、位置和最大化状态，与主窗体分开恢复。
- 前端必须通过 typed Tauri wrapper 调用新的 `rdp_reveal_session` 能力，不直接 `invoke("rdp_*")`。
- 现有 RDP 会话关闭、原生宿主主动关闭、前端 runtime tab 清理逻辑不能回归。

## Acceptance Criteria

- [ ] 打开第一个 Windows RDP 会话时，会创建独立的原生 RDP 宿主窗口，而不是主窗体附属窗口。
- [ ] 最小化该 RDP 宿主窗口后，任务栏可单独恢复。
- [ ] 主窗体再次打开同一 RDP 连接时，不重复创建新宿主，而是激活已有会话并唤起原生 RDP 宿主窗口。
- [ ] RDP 原生宿主窗口关闭后，后端会话关闭事件仍能同步到前端，相关 runtime tab 能正确移除。
- [ ] RDP 原生宿主窗口关闭并重新打开后，能恢复上次窗口大小/位置，最大化状态也能恢复。
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- [ ] `npm run check` 通过。

## Notes

- 本轮不重构主窗体 RDP 状态面板，不新增第二套会话模型。
- 本轮不改 Linux/macOS RDP runner 路径；独立子窗体能力仅针对现有 Windows 原生宿主。
