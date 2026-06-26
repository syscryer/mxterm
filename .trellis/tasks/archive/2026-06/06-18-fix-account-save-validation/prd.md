# 修复账号保存校验并评估重构

## Goal

修复账号管理中保存账号时，表单已填写用户名但仍提示“请填写账号用户名”的问题，并评估账号管理保存链路是否需要重构。

## Requirements

- 账号管理表单中的“用户名”必须随保存请求提交到后端。
- 保存密码账号时，名称、用户名、密码填写后应能成功保存。
- 保存私钥账号时，名称、用户名、私钥路径填写后应能成功保存，私钥口令保持可选。
- 提交前应在前端归一化账号输入，空白字符串转换为 `undefined`，非空字段去除首尾空白。
- 账号管理相关文案必须表达“账号=用户名+密码/密钥”，不能暗示只有密码或密钥本身也可以作为一个可用账号。
- 密码、私钥口令等 secret 输入框必须限制在表单容器内，不得横向溢出或压过右侧显示按钮。
- 名称与类型第一行必须限制在表单容器内，账号类型下拉不得被全局 select 最小宽度撑出右侧面板。
- 保持现有 UI 风格和共享组件用法，不重写账号管理页面布局。
- 需要识别并记录当前“账号是否包含用户名”的前后端合同漂移，避免后续再出现字段遗漏。
- 私钥账号本轮继续使用本机私钥路径，不新增私钥内容直输；直接保存私钥文本的用处有限，且会扩大敏感内容存储和解析范围。
- 私钥账号路径输入需要支持从本机文件选择器选择私钥文件，并把选中的路径填入表单。

## Acceptance Criteria

- [ ] `useCredentials` 提交给 `credentialUpsert` 的 payload 包含归一化后的 `username`。
- [ ] 截图中的场景：名称为“测试”、用户名为 `root`、密码已填写时，点击“保存账号”不再触发 `credential_username_missing`。
- [ ] 切换账号类型时继续保留名称、用户名、备注，并清理另一种认证方式的 secret 字段。
- [ ] 密码和私钥口令输入框在当前设置页宽度下不再越出字段容器，显示/隐藏按钮仍可点击。
- [ ] 名称输入框和类型下拉在当前设置页宽度下不再越出表单面板，类型下拉仍能完整显示“密码账号 / 私钥账号”。
- [ ] 私钥账号表单可以通过“选择”按钮打开本机文件选择器，并将选中的私钥文件路径填入账号私钥路径输入框。
- [ ] 账号管理标题、说明、空状态、类型/按钮文案与列表文案统一为“密码账号 / 私钥账号”或“登录账号”，不再使用容易误解的“凭据”概念。
- [ ] 如果继续采用“账号=用户名+认证材料”的现状，前后端 Trellis command contract 同步补充 `CredentialProfileInput.username` 与对应校验。
- [ ] 只做必要的小范围重构，不把设置页整块拆分为独立任务，除非排查发现结构性耦合会阻碍修复。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- 已确认前端表单状态包含 `username`：`SettingsView.tsx` 中新增、编辑、空表单都会维护该字段。
- 已确认后端 `CredentialProfileInput` 和 `validate_credential_input` 要求 `username`，缺失时返回 `credential_username_missing`。
- 初步根因：`src/features/connections/useCredentials.ts` 的 `normalizeCredentialInput` 归一化时遗漏 `username`，导致表单值没有进入 `credential_upsert`。
- 设计漂移：早期 Trellis 设计与当前 frontend/backend contract 仍写着“CredentialProfile 不存 username”，但当前 UI、类型和 Rust 实现已经改成“账号包含用户名和认证材料”。
