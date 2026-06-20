# Storage Vault Migration

## Goal

交付 Storage/Security/Sync 的 Phase 2：把现有 JSON 中的 SSH 密码和私钥口令迁移到 mXterm 自管加密保险库 `secrets.enc`，把结构化数据迁移到 SQLite，并在迁移成功后把连接、凭据、known_hosts、隧道的生产读写切到 SQLite。整个过程必须保证失败可重试、不破坏旧 JSON 数据、不把明文 secret 写入 SQLite。

## Background

Phase 1 已提交 SQLite foundation：`src-tauri/src/storage_sqlite.rs` 提供 schema 初始化、版本记录和 secret 引用字段，但没有接入生产命令。当前生产路径仍是 JSON：`connections.json`、`credentials.json`、`known_hosts.json`、`tunnels.json`。Phase 2 是从 JSON 主存储切到 SQLite + encrypted vault 的关键地基，也是后续 WebDAV 同步 `mxterm.db + secrets.enc` 的前置条件。

## Requirements

- 不使用系统 密钥环；secret 主存储是应用数据目录下的 `secrets.enc`。
- `secrets.enc` 使用成熟加密库实现：Argon2id 从主密码派生密钥，AES-256-GCM 加密 vault plaintext。
- 新增 `SecretStore` 边界，支持 set/get/delete SSH 密码和私钥口令。
- SQLite 只保存 `secret_ref` 和 `secret_slot_id`，不得保存明文 password/passphrase。
- 默认不开启主密码保护；应用启动时使用本机自动生成的 local vault key 解锁 `secrets.enc`，不弹解锁遮罩。
- 设置页提供“启用主密码保护”开关；用户主动开启后才要求设置主密码，后续启动需要主密码解锁。
- 关闭主密码保护时，vault 会重新用本机 local vault key 加密，继续保持非明文保存。
- 本次运行内存缓存解锁状态，不使用系统密钥环。
- 开启主密码保护后，忘记主密码无法恢复已保存 secret，只能重置 vault 并重新录入。
- JSON 到 SQLite + vault 迁移必须是幂等流程：未迁移可执行，迁移成功后不重复写入，失败后可重试。
- 迁移必须先读取旧 JSON，写入 vault，准备 SQLite 单事务，事务提交成功后才写入 `app_meta(storage_migrated_from_json=true)`。
- 迁移失败不得删除、重命名或破坏旧 JSON；下次启动/访问可以继续用旧 JSON 或重试迁移。
- 迁移成功后保留旧 JSON 为 `.migrated.bak`，不立即删除。
- 新安装用户没有旧 JSON 时，应直接初始化 SQLite 并走 SQLite repository。
- 连接、凭据、known_hosts、隧道的 Tauri command 生产读写在迁移成功后切到 SQLite repository。
- `resolve_saved_connection` 必须能从 SQLite + vault 解析 saved/inline/prompt 三种凭据模式，并保持 proxy、jump、known_hosts、advanced timeout 行为一致。
- 保存/更新连接或凭据时，同步维护 vault；vault 写入失败时整个保存失败，不静默降级到明文 JSON/SQLite。
- 删除连接或凭据时，应尽量删除对应 vault secret；删除失败返回可理解错误，避免用户误以为已清理。
- prompt runtime credentials 仍只用于本次连接/测试/隧道启动，不写入 SQLite 或 vault。
- 本阶段不实现 WebDAV 传输、同步 UI、密钥轮换或系统密钥环自动解锁。

## Acceptance Criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml storage_vault --lib` 通过。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml storage_migration --lib` 通过。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib` 继续通过。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml ssh_config --lib` 或覆盖 saved connection resolution 的等价过滤测试通过。
- [ ] `npm run check` 通过。
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过或只保留既有无关 warning。
- [ ] 迁移测试覆盖：旧 JSON inline password、inline private key passphrase、saved credential password、saved credential private key passphrase、known_hosts host lowercase、tunnels round-trip。
- [ ] secret store 写入失败时迁移不标记成功，SQLite 不留下半迁移成功状态，旧 JSON 仍保留。
- [ ] SQLite schema/测试证明 `connections`、`credentials` 没有 plaintext password/passphrase 列。
- [ ] `secrets.enc` 测试证明文件内容不包含明文 secret，错误主密码无法解锁。
- [ ] 默认主密码保护关闭时，应用能通过本机 local vault key 自动解锁并保存/读取 secret；启用/关闭主密码保护时，已有 secret 不丢失。
- [ ] 生产 command 不再直接写 `connections.json`、`credentials.json`、`known_hosts.json`、`tunnels.json`，除非是迁移成功后的 `.migrated.bak` 保留逻辑。
- [ ] 新增/修改代码已暂存，提交前检查 staged diff 没有真实 secret。

## Out Of Scope

- WebDAV transport 和同步设置 UI。
- `manifest.json` / `data.json` / 云同步协议实现。
- 多设备冲突合并、自动同步。
- 系统 密钥环、系统自动解锁、应用锁屏密码。
- 私钥文件内容同步。

## Scope Decision

- 已确认按完整 Phase 2 范围一次做完：encrypted vault、JSON 到 SQLite/vault 原子迁移、生产读写切 SQLite。
- 风险控制方式：严格 TDD、迁移失败不破坏旧 JSON、vault/SQLite 任一步失败都不标记迁移成功、不静默降级到明文存储。