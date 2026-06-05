# 连接仓库与终端会话

## Goal

把上一阶段的 SSH Spike 连接条产品化：用户从左侧连接仓库选择或编辑连接，然后基于同一个连接打开多个终端会话。

## Requirements

- 左侧连接仓库展示本地保存的 SSH 连接。
- 支持新增、编辑、删除连接，编辑使用弹窗，不在终端 tab 内编辑。
- 连接字段包括名称、主机、端口、用户名、认证方式、密码、私钥路径、私钥口令和备注。
- 密码不做过度隐藏，用户可直接查看；后续锁屏密码单独实现。
- 首版本地持久化即可，不做导入导出，但数据结构要保留版本号。
- 一个连接可以打开多个终端，每个终端拥有独立 SSH session、tab 标题和断开状态。
- 连接仓库区域在普通浏览器预览下可展示静态/内存状态，真实持久化和 SSH 连接只在 Tauri 环境启用。
- 不在本任务实现 SFTP、传输队列、远程编辑、正式 known_hosts 或软件锁屏。

## Acceptance Criteria

- [ ] Rust 后端提供 connection CRUD command。
- [ ] 连接配置能保存到本机应用数据目录，并能重新加载。
- [ ] 连接校验覆盖 host、port、username、认证信息和名称默认值。
- [ ] 前端左侧连接仓库来自 connection command，而不是硬编码列表。
- [ ] 新增和编辑连接通过弹窗完成。
- [ ] 删除连接前有确认。
- [ ] 从连接仓库可以打开终端 tab。
- [ ] 同一个连接能打开多个终端 tab，tab 之间输出互不串线。
- [ ] 断开的 tab 保留历史输出和断开提示。
- [ ] `pnpm check`、Rust 单测、`cargo check`、Trellis docs check 通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
