# 任务：将「凭据库」升级为「账号」模型

## 背景
当前 mXterm 把 SSH 登录身份拆成两处管理：
- **用户名**：存在每个 Connection 里（`username` 字段）
- **凭据**：独立的凭据库（CredentialProfile），只存密码/私钥，不含用户名

这导致一个完整登录身份（用户名+密码/私钥）被强行拆开，引用凭据时还要单独填用户名，容易配对错误。

## 目标
将凭据升级为**账号（Account）**：一个账号 = 用户名 + 认证材料（密码或私钥）。连接里只需选择账号，不再分别填用户名和凭据。

原型参考：`prototype/light-neutral/mxterm-connection-dialog-compact.html`

## 数据模型变更

### 后端 Rust

**文件：`src-tauri/src/credentials/mod.rs`**

1. `CredentialProfileInput` 新增字段：
   ```rust
   #[serde(default)]
   pub username: Option<String>,
   ```

2. `ValidatedCredentialProfileInput` 新增字段：
   ```rust
   pub username: String,  // 必填，trim 校验
   ```

3. `CredentialProfile` 新增字段：
   ```rust
   #[serde(default)]
   pub username: Option<String>,  // 历史数据可能没有，default 兼容
   ```

4. `validate_credential_input` 新增校验：
   - `username` 为空时报错 `credential_username_missing`，提示"请填写账号用户名。"
   - trim 后存入 `ValidatedCredentialProfileInput.username`

5. `upsert` 方法里构造 `CredentialProfile` 时带上 `username: validated.username`

6. 存储文件 `credentials.json` 的 `version` 保持 1，靠 `#[serde(default)]` 兼容老数据（老凭据 username 为 None）。

**文件：`src-tauri/src/commands.rs`**
- `credential_list` / `credential_upsert` / `credential_delete` 命令签名不变，只是传入传出的数据多了 username。
- 新增迁移逻辑（可选，建议）：在应用启动时（`lib.rs` setup）扫描凭据库，对 username 为 None 的记录，尝试从引用它的连接里回填 username（取第一个引用连接的 username），并标注 notes 提示用户检查。

### 前端 TypeScript

**文件：`src/features/connections/connectionTypes.ts`**

1. `CredentialProfileInput` 新增：
   ```typescript
   username?: string;
   ```

2. `CredentialProfile` 新增：
   ```typescript
   username?: string | null;
   ```

3. `ConnectionProfile` / `ConnectionProfileInput`：
   - **保留** `username` 字段（inline 模式和 prompt 模式仍需要）
   - **保留** `credential_mode`（saved / inline / prompt）和 `credential_id`
   - 不删除字段，保证向后兼容

**文件：`src/shared/tauri/commands.ts`**
- 凭据相关命令的 TS 类型同步加 username。

## 连接对话框 UI 变更

**文件：`src/features/connections/ConnectionDialog.tsx`**

当前 SSH 基本页结构（要改的部分）：
```
用户名          [input]
凭据来源         [select: saved/inline/prompt]
（inline 时）认证方式 [select] / 密码 [input]
```

改为账号选择形态（参考原型）：

```
登录账号  [select: 已保存账号列表 / 在此填写 / 连接时询问]  [管理按钮]
```

具体逻辑：
1. **saved 模式**：下拉显示所有账号，格式 `账号名（用户名·密码/私钥）`，选中后 `credential_id` 指向该账号。此时连接的 `username` 字段隐藏（从账号取）。
2. **inline 模式**：展开内联表单，包含：用户名 + 认证方式（密码/私钥）+ 对应字段。这些直接存到连接的 `username` / `inline_password` / `inline_private_key_path` 等字段。
3. **prompt 模式**：不展开表单，仅显示提示"连接时弹出密码/私钥输入"。连接的 `prompt_auth_kind` 仍记录。

**保存时（normalizeForSubmit）**：
- saved 模式：`username` 不再从表单取，改为空或从所选账号读（后端连接时用 credential_id 查账号的 username）。建议保存时把账号 username 同步写入 connection.username，保证连接快照完整。
- inline 模式：保持现状（username + inline_* 存连接里）。
- prompt 模式：保持现状。

## 账号管理界面变更

**文件：`src/features/settings/SettingsView.tsx`**

当前 `CredentialSettingsSection`（凭据管理）改名概念为"账号管理"，表单新增字段：
- 在"名称"和"类型"之后、密码/私钥之前，新增 **「用户名」** 输入框（必填）。
- 表单 state `form` 加 `username` 字段。
- `emptyCredentialForm` 加 `username: ""`。
- `startEdit` 回填 `username: credential.username || ""`。
- 保存校验：username 为空时提示。

列表项（`credential-list-item`）显示调整：
- meta 行追加用户名显示，如 `deploy · 私钥`。
- 原文案"凭据"改为"账号"（标题、空状态、按钮文案）。

## 错误反馈文案

**文件：`src/features/connections/ConnectionDialog.tsx` 的 `describeDialogError`**
- "认证失败"的 detail 里，把"请检查用户名、密码、私钥路径或私钥口令"改为"请检查账号的用户名、密码或私钥"。
- 测试连接反馈区（`connection-dialog-test-result`）保留现有样式，无需大改。

## 注意事项

1. **向后兼容**：老数据（credentials.json 无 username）必须能正常加载，username 显示为空但不报错。老连接的 inline username/password 保持可用。
2. **不要删除** ConnectionProfile 的 username/inline_* 字段，inline 模式仍依赖它们。
3. **不要改** 凭据存储路径（`credential_store_path`）和文件名（credentials.json）。
4. 提交前跑 `npm run check`（tsc）和 `cargo test` 确保不破坏现有测试。
5. credentials/mod.rs 的测试用例（password_input 等）需补上 username 字段，否则编译失败。

## 验收标准

- [ ] 新建账号时必填用户名
- [ ] 连接对话框选 saved 账号后，不再显示用户名输入框
- [ ] 选 inline 仍可在此填写用户名+密码/私钥
- [ ] 选 prompt 不展开表单
- [ ] 老 credentials.json（无 username）能正常加载显示
- [ ] 老连接（inline username）能正常编辑保存
- [ ] `npm run check` 通过
- [ ] `cargo test` 通过
