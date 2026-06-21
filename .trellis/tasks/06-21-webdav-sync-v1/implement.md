# WebDAV Sync v1 Implementation Plan

## Steps

1. 读取现有实现和规范：
   - `src-tauri/src/sync_snapshot.rs`
   - `src-tauri/src/storage_repository.rs`
   - `src-tauri/src/storage_vault.rs`
   - `src-tauri/src/commands.rs`
   - `src-tauri/src/lib.rs`
   - `src/features/settings/`
   - `src/shared/tauri/commands.ts`
   - `src/shared/ui/`
   - `.trellis/spec/backend/tauri-command-contracts.md`
   - `.trellis/spec/frontend/`
2. 先写后端测试骨架：URL 编码/redaction、MKCOL 兼容、GET 大小限制、settings password_touched、sync lock、upload order。
3. 新增 `src-tauri/src/webdav.rs`：transport primitives 和 redaction。
4. 新增 `src-tauri/src/webdav_sync.rs`：settings 读写、vault password、sync manager、upload/download 编排。
5. 扩展 `StorageRepository` app_settings helper 和 WebDAV password secret reference helper。
6. 在 `commands.rs` / `lib.rs` 注册 WebDAV commands。
7. 更新 `src/shared/tauri/commands.ts` typed wrappers。
8. 新增或扩展 frontend sync/settings types。
9. 在 SettingsView 增加 WebDAV 同步分区，复用共享 UI、token 和确认弹窗。
10. 实现上传/下载确认与结果状态展示。
11. 更新 `.trellis/spec/backend/tauri-command-contracts.md`，必要时补 frontend spec。
12. 暂存代码，提交前检查没有 WebDAV 密码、同步主密码或 SSH secret。

## Validation Commands

```powershell
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo test --manifest-path src-tauri\Cargo.toml webdav --lib
cargo test --manifest-path src-tauri\Cargo.toml webdav_sync --lib
cargo test --manifest-path src-tauri\Cargo.toml sync_snapshot --lib
cargo check --manifest-path src-tauri\Cargo.toml
npm run check
git diff --check
git diff --cached --check
```

## Backend Test Checklist

- [ ] URL path segment encoding handles spaces, Chinese, leading/trailing slashes, and avoids double slash.
- [ ] Redacted URL hides username, password and query values.
- [ ] Basic Auth header is added only when username is present.
- [ ] MKCOL 405/409 verifies directory exists by PROPFIND.
- [ ] GET oversized response fails with `webdav_response_too_large`.
- [ ] Settings save with `password_touched=false` preserves existing password.
- [ ] Settings save with `password_touched=true` and blank password deletes existing password.
- [ ] Upload/download sync lock returns `webdav_sync_locked` on concurrent operation.
- [ ] Upload operation calls PUT for `manifest.json` last.
- [ ] Download rejects incompatible manifest before calling snapshot import.

## Frontend Test / Check Checklist

- [ ] Settings UI uses shared controls and global token classes.
- [ ] No native `<select>` for service/profile options.
- [ ] Password input tracks touched state.
- [ ] Save payload does not include blank password unless user touched the field.
- [ ] Upload confirm clearly says it overwrites remote latest.
- [ ] Download confirm clearly says it overwrites local sync data and creates backup.
- [ ] Remote info handles empty, compatible, incompatible and error states.

## Risk Points

- WebDAV HTTP client dependency may require Cargo dependency updates; keep dependency minimal and cross-platform.
- 不要把 WebDAV 密码存进 `app_settings` JSON。
- 不要把同步主密码存进设置或日志。
- 不要绕过 `sync_snapshot` 直接上传本机 `secrets.enc`。
- 不要让前端通过 localStorage 私自保存同步配置。
- SettingsView 可能已经较大，若新增逻辑超过局部可控范围，应抽 `features/sync` 子组件和 typed hooks。

## Review Gate

开始实现前确认：

- WebDAV v1 是否只做一个 `default` profile。
- 同步主密码首版是否每次上传/下载 secrets 都手动输入，不保存。
- 设置是否放在 SettingsView 新“同步”分区，不做右侧工作区入口。
- 下载覆盖是否只做确认弹窗，不做字段级 diff。
