# 连接配置优化与连接步骤设计

## Scope

本阶段把 SSH 连接拆成四类对象：连接配置、凭据、主机密钥信任记录、运行时会话。连接配置描述目标和行为；凭据只描述秘密材料；主机密钥信任记录负责安全确认；运行时会话只在连接成功后存在。

## Data Model

### ConnectionProfile

连接配置保存到 `connections.json`，文档保留 `version`。建议字段：

- `id`
- `name`
- `group_id` 或 `group_name`
- `host`
- `port`
- `username`
- `credential_mode`: `saved` / `inline` / `prompt`
- `credential_id`
- `inline_auth_kind`: `password` / `private_key`
- `inline_password`
- `inline_private_key_path`
- `inline_private_key_passphrase`
- `proxy`
- `jump`
- `advanced`
- `notes`
- `created_at`
- `updated_at`

`credential_mode=saved` 时使用 `credential_id`，不保存 inline secret。`credential_mode=inline` 时保存 inline 凭据。`credential_mode=prompt` 时不保存 secret，连接步骤页面临时收集。

### CredentialProfile

凭据保存到 `credentials.json`，文档保留 `version`。凭据只保存秘密材料，不保存主机、端口、用户名。建议字段：

- `id`
- `name`
- `kind`: `password` / `private_key`
- `password`
- `private_key_path`
- `private_key_passphrase`
- `notes`
- `created_at`
- `updated_at`

删除凭据前要检查是否被连接引用。首版可以阻断删除并提示先修改连接；避免静默让连接失效。

### KnownHostEntry

主机密钥信任保存到 `known_hosts.json`，文档保留 `version`。建议字段：

- `id`
- `host`
- `port`
- `key_algorithm`
- `fingerprint_sha256`
- `public_key`
- `trusted_at`
- `updated_at`

匹配键使用 `host + port`。首次出现返回“需要确认”，用户确认后写入。已有记录且指纹一致时放行。已有记录但指纹变化时阻断，只有用户明确更新信任后才覆盖。

### ProxyConfig

代理配置作为连接配置子对象：

- `kind`: `none` / `http_connect` / `socks5`
- `host`
- `port`
- `username`
- `password`

`none` 不需要其他字段。HTTP CONNECT 和 SOCKS5 必须校验代理主机和端口。代理认证可选。首版不做代理链和系统代理自动读取。

### JumpConfig

跳板机配置作为连接配置子对象：

- `kind`: `none` / `ssh_jump`
- `jump_connection_id`

`none` 不需要其他字段。`ssh_jump` 必须引用一条已保存连接，引用值保存到 `jump_connection_id`。首版只完成前端入口、入库字段、后端校验和解析对象透传，不在终端、测试连接或远程文件路径中打开真实跳板机链路。后续接入时应先登录跳板机，再使用 russh `channel_open_direct_tcpip(target_host, target_port, ...)` 打开到目标机的通道，并将通道流交给目标机 SSH 握手。

### AdvancedConfig

高级配置作为连接配置子对象：

- `connect_timeout_ms`
- `auth_timeout_ms`
- `keepalive_interval_ms`
- `terminal_encoding`: `utf-8` / `gbk` / `gb18030` / `big5` / `euc-jp` / `iso-2022-jp` / `shift-jis` / `euc-kr`

终端显示编码由 Rust 终端层负责。SSH 输出仍以远端原始字节进入后端，后端按连接配置解码成 UTF-8 字节后发送给前端；前端输入仍发送 Unicode 字符串，后端按连接配置编码成远端字节后写入 SSH channel。远程文件 exec 不跟随终端显示编码，继续保持文件读写自身的 UTF-8/bytes 语义。

## Backend

### Stores

保留现有 `src-tauri/src/connections/`，扩展为连接 store，并新增：

- `src-tauri/src/credentials/`
- `src-tauri/src/known_hosts/`

三类 store 都使用 JSON 文件持久化到 Tauri app data 目录。测试中使用临时路径。读写策略可以继续保持每次 command 加载，因为操作频率低。

### Commands

连接命令：

- `connection_list`
- `connection_upsert`
- `connection_delete`
- `connection_get`
- `connection_test`

凭据命令：

- `credential_list`
- `credential_upsert`
- `credential_delete`

主机密钥命令：

- `known_host_trust`
- `known_host_update`
- `known_host_delete` 可后续补充；如果本期设置页不管理 known hosts，可以不暴露列表 UI。

连接步骤命令需要返回结构化结果，而不是只把日志写入终端。建议 `connection_test` 和 `terminal_prepare` 复用同一个后端连接准备流程。流程遇到未知主机密钥或密钥变化时返回可恢复状态，由前端展示确认动作。用户确认后携带确认 token 或重新执行并带 trust decision。

### Connection Resolution

新增统一解析函数，例如 `resolve_connection_request(app, connection_id, prompt_secret)`：

1. 加载连接。
2. 校验连接目标、代理、跳板机引用和高级参数。
3. 根据 `credential_mode` 解析凭据。
4. 组合为运行时 SSH 请求。

终端、远程文件、测试连接都必须使用同一套解析函数，不能各自从 `ConnectionProfile` 直接取 password/key。

### Host Key Verification

当前 `TrustingClient.check_server_key` 直接信任，需要替换为有状态 handler。`russh::client::Handler` 的 `check_server_key` 可以访问服务端公钥，但返回类型必须能表达 `russh::Error`。可设计自定义 handler error，或在 handler 内记录待确认信息并让连接失败返回上层可识别错误。

主机密钥流程：

- known：指纹一致 -> `Ok(true)`
- unknown：返回“需要确认”错误，前端展示指纹和信任动作
- changed：返回“主机密钥已变化”错误，前端阻断并展示更新信任动作

确认后写入 `known_hosts.json`，然后重新执行连接准备。

### Proxy Transport

`russh` 提供 `client::connect_stream`，可先建立代理后的 TCP 流，再交给 SSH 握手。

HTTP CONNECT：

1. TCP 连接代理。
2. 发送 CONNECT `<target_host>:<target_port>`。
3. 读取 2xx 响应。
4. 将流交给 `connect_stream`。

SOCKS5：

1. TCP 连接代理。
2. 执行 SOCKS5 greeting。
3. 可选用户名密码认证。
4. 发送 CONNECT target。
5. 成功后将流交给 `connect_stream`。

代理失败要返回可读错误并出现在连接步骤日志中。

## Frontend

### Connection Dialog

连接编辑弹窗使用顶部页签：

- 基本
- 网络路径
- 高级

页签使用文字和下划线选中态，不使用圆角按钮样式。底部固定“测试连接 / 取消 / 保存”。基本页包含连接高频字段和凭据来源，不把认证单独放到页签里。

基本页字段：

- 名称
- 分组
- 主机
- 端口
- 用户名
- 凭据来源
- 保存的凭据或 inline 凭据
- 备注

网络路径页字段：

- 连接方式：直连 / 网络代理 / SSH 跳板机
- 网络代理：代理类型、代理主机、代理端口、代理用户名、代理密码
- SSH 跳板机：已保存连接下拉，排除当前正在编辑的连接

SSH 跳板机入口本次只保存 `jump.kind=ssh_jump` 和 `jump_connection_id`。如果用户选择 SSH 跳板机但未选择连接，前端应停留在网络路径页并提示，不应静默降级为直连。

高级页字段：

- 连接超时
- 认证超时
- 心跳间隔
- 终端显示编码

### Credential Settings

设置页新增“认证管理”或“凭据管理”导航项。页面提供凭据列表、新增、编辑、删除。连接弹窗中的凭据下拉旁提供“管理”入口，可跳转设置页认证管理。

凭据表单只展示凭据字段，不展示主机、端口、用户名。

### Connection Step Page

测试连接和打开终端共用连接步骤页面。页面在主工作区展示，不在终端 tab 内展示。建议步骤：

1. 初始化配置
2. 建立网络连接
3. 确认主机密钥
4. 输入临时凭据（仅 `credential_mode=prompt`）
5. 验证用户
6. 打开终端或完成测试

连接步骤页包含：

- 连接标题和地址
- 步骤列表
- 结构化日志
- 复制日志
- 编辑连接
- 取消
- 重试或继续动作

打开终端路径中，只有远程 shell 成功准备好后才创建 `TerminalTab`。测试连接路径不创建终端 tab。

### Connection Tree Groups

连接分组从连接数据恢复。左侧自定义分组的本地 UI 状态可以保留展开/折叠等偏好，但连接归属必须来自连接 profile。

## Error Handling

- Rust command 返回现有 `AppError`，但需要增加可恢复错误 code。
- 未知主机密钥、主机密钥变化、需要临时凭据、代理失败、跳板机引用缺失、凭据缺失、凭据被删除都应有明确 code。
- 前端对可恢复错误展示下一步动作，对不可恢复错误展示编辑和重试入口。

## Migration

现有 `connections.json` version 1 数据可迁移：

- 旧 password/private key 连接迁为 `credential_mode=inline`
- 分组为空
- 代理为 `none`
- 跳板机为 `none`
- 高级使用默认值

现有 localStorage 分组无法可靠跨设备迁移到后端 store；首版可在前端启动时尝试读取旧 `mxterm.connectionGroupAssignments.v1` 并写回连接分组，迁移成功后不再依赖该 localStorage。

## Validation

- Rust store/validation 单测覆盖连接、凭据、known hosts、代理配置、跳板机引用。
- Rust SSH handler 单测覆盖 unknown/known/changed host key 判断。
- 前端 TypeScript 校验覆盖新增类型和状态流。
- Tauri 窗口手动验证：测试连接、首次信任、密钥变化、保存凭据、引用凭据、代理失败、打开终端。
