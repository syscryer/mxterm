# Credential security model design

## Product Model

mXterm 的安全模型分两层：

1. 普通模式：高级保护关闭。vault 使用本机 local key 自动解锁，用户日常使用不受安全弹窗打扰。底层仍然加密保存 secret。
2. 高级保护模式：vault 使用总安全密码加密。应用启动后必须输入总安全密码解锁；闲置锁定会清掉内存解锁状态；安全设置页需要单独解锁后才能修改安全策略。

“启动时需要安全密码”不做独立开关。开启高级保护后，启动解锁是密码学必然结果；关闭这个行为会让高级保护退回 local key 或引入按需解锁复杂分支。

## Backend Contracts

### Secret preservation

连接和凭据保存需要支持“未触碰则保留旧 secret”：

- 前端提交新增时，必填 secret 仍按现有校验执行。
- 前端提交编辑时，如果 secret 字段未触碰，后端保留既有 `secret_ref` 和 `secret_slot_id`。
- 如果认证方式、凭据模式或 secret 类型切换导致旧 secret 不再适用，后端删除或替换旧 secret。
- 不能依赖空字符串表达删除；删除需要显式语义，避免误删。

### Reveal commands

新增或扩展后端命令：

- `connection_reveal_inline_secret(connection_id)`：只返回连接内置 secret；saved/prompt 模式返回业务错误。
- `credential_reveal_secret(credential_id)`：只在账号管理入口使用，返回该凭据对应 secret。
- reveal 命令必须先检查 vault 已解锁，并遵守“允许查看已保存密码”设置。

返回值只通过 Tauri IPC 临时进入前端状态，不写入 SQLite/localStorage/日志。

### Security settings

安全设置拆成两个状态：

- vault 状态：是否启用高级保护、当前是否解锁。
- 安全策略：是否允许查看已保存密码、闲置自动锁定分钟数。

总开关开启、关闭、修改安全密码均走 vault rekey。rekey 必须写临时文件并原子替换，失败保留旧 vault。

安全设置页解锁不是一个新的 vault 密钥，只是短期授权状态；初版可仅在前端页面生命周期内保持，离开页面即失效。

## Frontend Design

### 连接编辑页

内置密码字段显示：

- 已保存：显示“已保存”，不填入真实密码。
- 眼睛按钮：当策略允许查看时可用，点击调用 reveal 命令并临时填入字段。
- 替换：用户输入新值后保存，替换旧 secret。
- 留空且未触碰：保存时保留旧 secret。

引用账号管理凭据时：

- 只显示凭据下拉和账号管理按钮。
- 不显示公共凭据 secret，也不显示眼睛按钮。

### 账号管理

账号管理右侧表单是公共凭据唯一查看/修改入口：

- 密码/私钥口令默认显示“已保存”。
- 策略允许时显示眼睛按钮。
- 未修改保存时保留旧 secret。
- 输入新值保存时替换旧 secret。

### 安全设置

高级保护关闭：

- 只展示“高级安全保护”总开关卡片。
- 不展示子选项。
- 开启时进入设置总安全密码流程。

高级保护开启：

- 进入安全设置页默认锁定。
- 锁定态只显示总开关状态和“解锁安全设置”按钮。
- 解锁后显示：闲置自动锁定、允许查看已保存密码、修改安全密码、关闭高级保护。

UI 使用现有设置页卡片、按钮、AppSelect、Radix 浮层和 `--mx-*` token。

## Error Handling

- vault 未解锁：返回可恢复错误，引导用户解锁。
- reveal 被策略禁止：返回可恢复错误，前端提示需在安全设置中开启查看。
- rekey 失败：保持原 vault，不修改安全配置状态。
- secret 缺失：提示重新输入并保存，不静默创建空 secret。

## Testing

- Rust 测试覆盖 connection inline secret preserve/reveal。
- Rust 测试覆盖 credential secret preserve/reveal。
- Rust 测试覆盖 vault rekey 原子写。
- 前端 typecheck 覆盖新增命令类型、表单 touched 状态和设置页 props。
- 必要时用桌面开发模式人工检查连接编辑、账号管理、安全设置三块 UI。
