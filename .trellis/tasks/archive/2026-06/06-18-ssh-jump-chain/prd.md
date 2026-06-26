# 实现真实 SSH 跳板机链路

## Goal

让已保存的 SSH 跳板机引用真正参与建连，而不是只作为连接配置字段保存。

## Confirmed Facts

- 连接配置、凭据、主机密钥信任和代理链路已经存在。
- `jump.kind = ssh_jump` 和 `jump_connection_id` 目前只被保存、校验和透传。
- 当前 `TerminalSession` 建连路径只处理直连和代理，没有真正使用跳板机打开 `direct-tcpip` 通道。
- 现有设计文档明确写过：跳板机首版先做入口与入库，真实链路后续单独实现。

## Requirements

- 跳板机连接必须从已保存连接中加载。
- 跳板机链路必须使用真实 SSH 通道，不只是配置透传。
- 跳板机失败时要返回明确错误，不得静默降级为直连。
- 跳板机逻辑应复用现有连接、凭据、主机密钥和代理解析流程。

## Acceptance Criteria

- [ ] 终端、测试连接、远程文件、远程监控在 `jump.kind = ssh_jump` 时，会先连跳板机，再通过真实 SSH 通道连目标机。
- [ ] 跳板机引用缺失、跳板机连接失败、目标机连接失败都会返回明确错误。
- [ ] 跳板机连接不允许自引用，也不允许再次带 `jump.kind = ssh_jump` 形成多级链路。
- [ ] 现有直连与代理路径不回退。
- [ ] 相关 Rust / 前端验证通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
