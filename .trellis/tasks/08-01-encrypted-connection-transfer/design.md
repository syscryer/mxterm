# 加密连接导入导出设计

## 架构边界

新增后端 `connection_transfer` 模块作为独立格式与流程所有者。它通过 `StorageRepository` 读取/合并连接范围数据，通过共享密码学模块使用与同步快照相同的 Argon2id 参数和 AES-256-GCM 原语，但不调用 `SyncSnapshotService::import_bundle`，也不继承 `replace_sync_data` 的清库语义。

前端新增按需加载的 `ConnectionTransferDialog`。`WorkspaceShell` 只保留轻量 loader、打开状态和成功后的 `reload` 回调，避免把弹窗与文件迁移逻辑静态引入首屏 chunk。

## 文件契约

单文件 JSON 顶层契约：

```json
{
  "format": "mxterm-connections",
  "version": 1,
  "created_at": "RFC3339 timestamp",
  "data": {
    "version": 1,
    "connection_groups": [],
    "credentials": [],
    "connections": []
  },
  "data_sha256": "lowercase hex",
  "secrets": {
    "kdf": {
      "name": "argon2id",
      "memory_cost_kib": 19456,
      "time_cost": 2,
      "parallelism": 1
    },
    "cipher": "aes-256-gcm",
    "salt": "base64",
    "nonce": "base64",
    "ciphertext": "base64"
  }
}
```

`data` 使用专用 transfer DTO，覆盖现有连接协议配置但不包含数据库 `secret_ref`。加密明文是带版本号的 secret entries，只允许四种现有保险库类型：账号密码、账号私钥口令、连接内联密码、连接内联私钥口令。AES-GCM AAD 由固定格式名、版本和 `data_sha256` 组成；导入重新规范化序列化 `data` 并计算摘要，篡改明文或摘要都会导致认证失败。

私钥字段只保留路径字符串。预检用只读文件元数据检查生成警告，不读取文件内容，也不把路径不可用视为结构错误。

## 后端 API

- `connection_transfer_export(request)`：验证密码和目标路径，读取全量 transfer 数据与凭据，构建 bundle，使用现有原子 JSON 写入能力落盘，返回导出计数。
- `connection_transfer_preview(request)`：限制输入文件大小，解析和验证 bundle，解密 secrets，校验所有引用，计算冲突和私钥路径警告，返回摘要及 bundle fingerprint，不写入任何状态。
- `connection_transfer_import(request)`：重新读取、解密和预检，要求 fingerprint 与 UI 预检一致，然后按 `skip` 或 `overwrite` 策略调用仓储原子合并，返回实际新增/覆盖/跳过计数。

所有错误使用稳定 `AppError.code`，用户可见消息区分文件不可读、格式不兼容、密码或密文错误、数据被修改、引用无效、冲突和写入回滚失败。密码、明文 secrets 和完整 bundle 不进入日志或错误 raw message。

## 冲突与引用规则

- 连接、账号：相同稳定 ID 为冲突；名称或地址相同但 ID 不同仍是不同记录。
- 分组：相同 ID 或相同唯一名称为冲突。名称命中不同 ID 时复用本地分组 ID，并把导入连接的 `group_id` 映射到本地 ID，避免违反唯一约束。
- `skip`：保留本地冲突项及其凭据，仅插入无冲突项。
- `overwrite`：用导入元数据与凭据更新相同身份项；分组名称映射冲突保留本地主键，更新可覆盖字段。
- 被跳过连接的内联凭据和被跳过账号的凭据不写入保险库。
- 每条导入连接引用的分组和账号必须能解析到导入新增项、本地保留项或名称映射项，否则整批预检失败。

## 一致性与回滚

预检在事务外完成所有纯校验和解密。应用前生成 transaction ID，创建当前加密保险库文件的同目录备份，并原子写入不含明文秘密的 pending journal。应用阶段开启 `BEGIN IMMEDIATE`，执行数据库 upsert 和保险库写入，并在同一 SQLite 事务内写入 transaction ID 提交标识。

任一步在当前进程内失败时，回滚 SQLite 并从加密备份恢复保险库。若进程在操作中崩溃，下次 `StorageRepository::open_app` 在暴露数据前读取 pending journal：SQLite 中不存在对应提交标识时恢复保险库备份，存在标识时说明数据库已提交，只清理 journal 和备份。这样 SQLite 自动回滚与保险库恢复可以在崩溃后收敛到同一批次状态，journal 本身不保存密码或解密后的 secrets。

实现必须为失败注入覆盖数据库写入、凭据写入、数据库 commit、恢复和崩溃恢复判定路径。恢复失败时锁定连接仓库并返回明确的高严重度错误，不继续暴露可能不一致的数据。现有同步快照行为保持不变。

## 前端交互

仓库维护区显示两个紧凑 quick-link：导入连接与导出连接。导出弹窗显示全量范围说明、密码和确认密码，先选择保存位置再执行；成功后给出计数和文件名。

导入弹窗分为三个状态：选择文件、输入密码并预检、确认导入。预检摘要显示连接/分组/账号新增数、冲突数和私钥路径警告；冲突策略使用 `AppSelect`，默认 `skip`。执行期间锁定关闭和重复提交，错误就近显示并保留可修正输入。所有图标按钮有 accessible name，焦点顺序与视觉顺序一致。

样式写入 `src/styles/app.css` 并只使用 `tokens.css` 中现有 `--mx-*`、材质、边框和状态 token。弹窗内圆角不超过 8px，同时验证亮色、显式暗色和 system-dark。

## 兼容与限制

- v1 只接受精确格式名和支持的版本；未来版本通过显式迁移处理，不静默猜测。
- 设置、known hosts、隧道、命令库和应用状态不进入该格式。
- 文件大小和记录数量设置保守上限，超限在分配或解密前失败。
- 不保存导出/导入密码，不自动记住上次文件路径。
