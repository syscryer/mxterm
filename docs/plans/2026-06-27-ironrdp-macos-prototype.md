# IronRDP macOS 内嵌原型推进计划

## 1. 目标

验证 mXterm 是否可以在 macOS 上做高质量内嵌 RDP，而不是外部打开官方客户端窗口。

本计划只覆盖原型，不进入生产 UI：

- 不新增用户可见的 macOS embedded RDP 入口。
- 不修改 Windows `mstsc_activex` / `mstsc.exe` 路径。
- 不把未验证的大依赖直接加入 `src-tauri/Cargo.toml`。
- 不通过命令行、日志或临时文件传递明文密码。

生产路径继续使用 macOS 官方客户端外部打开 `.rdp` 文件。

## 2. 调研结论

IronRDP 的仓库结构适合做 mXterm 原型，但不能直接当成稳定 crates.io 依赖接入主应用：

- `ironrdp-client` 是无窗口的客户端库，README 明确说明它通过 `tokio::sync::mpsc::Sender<RdpOutputEvent>` 输出事件，embedder 自己负责消费和转发到 GUI/event loop。
- `ironrdp-viewer` 是完整 GUI 示例，使用 `winit` + `softbuffer`，适合做性能和协议能力基线。
- `ironrdp-client`、`ironrdp-viewer`、`ironrdp-rdpfile` 在仓库内 `Cargo.toml` 标记 `publish = false`，当前不能按同名 crates.io 包直接依赖。
- viewer 主流程已经展示了我们需要的桥接形态：`RdpClient` 后台运行，`RdpOutputEvent` 从 mpsc channel 转发到 GUI event loop。

因此第一阶段应在 repo 外或 `prototype/` 隔离目录做 Git/vendor 原型，等 API、许可证、打包、性能和安全边界明确后，再决定是否进入 `src-tauri`。

## 3. 原型架构

```text
Saved RDP profile
  -> mXterm RDP config adapter
  -> IronRDP Config
  -> RdpClient async runtime
  -> RdpOutputEvent bridge
  -> macOS render surface
  -> input / clipboard / resize event bridge
```

关键边界：

- Rust 后端负责连接配置、凭据解析、证书/NLA 状态和 RDP runtime 生命周期。
- 渲染 surface 只消费 IronRDP 输出事件，不重新解析连接配置。
- React/Tauri 只显示实验状态和承载 surface，不拥有协议细节。
- 后续如果需要保存实验偏好，必须新增显式 `experimental` 配置，不复用 Windows `mstsc_activex` 语义。

## 4. 分阶段交付

### Phase 0：环境与依赖验证

- 使用独立 Git checkout 或临时 vendor 构建 `ironrdp-viewer`。
- 通过 `pnpm prototype:ironrdp-viewer status|prepare|build|smoke|run` 管理隔离 checkout，默认位置是 `.trellis/.runtime/ironrdp-macos-prototype`。
- 网络较慢时使用 `--proxy http://127.0.0.1:7890`，脚本会把代理传给 Cargo/Git 下载阶段。
- 使用 `pnpm prototype:ironrdp-viewer write-rdp --host <host> --username <name>` 生成不含密码的测试 `.rdp` 模板。
- 使用 `pnpm prototype:ironrdp-viewer smoke --rdp-file <path>` 在连接前确认本地 viewer binary、`--rdp-file`、用户名、CredSSP/NLA、剪贴板和桌面尺寸参数可用。
- 使用 `pnpm prototype:ironrdp-viewer write-report --host <host> --username <name>` 生成连接实测记录模板，记录体验质量和错误分类。
- 在 macOS 上通过 `.rdp` 文件连接测试主机。
- 传入 `.rdp` 文件时拒绝 `ClearTextPassword` / `GatewayPassword` 字段；运行 viewer 时拒绝 `--password` 参数，凭据必须由 viewer 交互提示。
- 记录支持的 `.rdp` 字段、登录方式、证书提示、NLA 行为和日志开关。
- 确认构建需要的 Xcode CLT、Rust 版本、系统库和包体大小。

通过条件：

- `ironrdp-viewer` 可在 macOS 本地启动并连接。
- 1080p/Retina 常规桌面操作可观察，没有基础协议阻断。
- 失败能明确区分认证、证书、网络和协议问题。

### Phase 1：事件桥原型

- 基于 `ironrdp-client`，写独立 Rust 原型，不依赖 mXterm 主程序。
- 把 `RdpOutputEvent` 转为我们自己的最小事件模型：
  - frame / bitmap update
  - cursor update
  - connection state
  - error
  - resize acknowledgement
- 输入只支持最小闭环：鼠标移动/点击、键盘文本、窗口 resize。
- 禁用或 stub 剪贴板、音频、驱动器重定向，避免早期范围失控。

通过条件：

- 可以在单个 macOS 窗口里看到远程桌面并完成基本输入。
- 事件桥有清晰 backpressure 策略，不让帧更新无限堆积。
- 所有错误都能转为结构化状态。

### Phase 2：mXterm surface 原型

只在 Phase 1 达标后进入：

- 评估 Tauri webview canvas、native child window、sidecar window 三种 surface。
- 优先选择画质和输入延迟最好的方案。
- surface 原型必须独立于生产 RDP runner 选择，不进入普通连接配置下拉。

通过条件：

- mXterm 窗口内可承载 RDP surface。
- resize、隐藏/恢复、关闭不会泄漏线程或进程。
- Windows build 不引入 macOS/IronRDP 编译依赖。

### Phase 3：产品化评审

只有满足以下条件才考虑产品入口：

- 画质、输入延迟、CPU/内存达到日常使用要求。
- 支持 NLA/TLS、证书异常提示、基本剪贴板。
- 打包签名、公证和更新链路可控。
- 有清晰回退：macOS 默认仍可一键用官方客户端打开。

## 5. 明确不做

- 不做外部窗口截图/转流式嵌入。
- 不做强行移动官方客户端窗口到 mXterm 内部。
- 不复制 GPL 或协议不清晰代码。
- 不在主应用里加入未达标的“实验入口”。
- 不把 IronRDP Git 依赖直接加到生产 `src-tauri/Cargo.toml`。

## 6. 验证命令

本阶段新增一个 source guard：

```bash
node scripts/check-ironrdp-macos-prototype.mjs
pnpm prototype:ironrdp-viewer status
```

它用于确认：

- macOS embedded RDP 仍未暴露为生产能力。
- 主应用 Cargo 依赖没有直接引入未发布的 IronRDP client/viewer crates。
- 原型文档保留 `publish = false`、`RdpOutputEvent` 和生产隔离边界。
- 在 macOS 上能发现基础开发工具链。
- viewer 原型脚本默认使用 `.trellis/.runtime`，并拒绝命令行或 `.rdp` 明文密码。
- `write-rdp` 只生成 IronRDP 支持的基础字段，不写入任何密码字段。
- `smoke` 会运行已构建的 `ironrdp-viewer --help`，确认 `.rdp`、用户名、CredSSP/NLA、剪贴板和桌面尺寸能力仍可见。
- `write-report` 会生成标准化连接实测记录，避免只凭主观印象推进到 Phase 1。

## 7. Phase 0 本机验证记录

2026-06-27 在 macOS Apple Silicon 本机验证：

- `pnpm prototype:ironrdp-viewer prepare` 成功，checkout revision 为 `9d206a3d`。
- 直接构建受 crates.io/GitHub 网络速度影响，10 分钟内未完成下载。
- 使用 `--toolchain stable --proxy http://127.0.0.1:7890 --timeout-ms 1800000` 后，`ironrdp-viewer` debug 构建成功。
- 生成的 debug binary 位于 `.trellis/.runtime/ironrdp-macos-prototype/IronRDP/target/debug/ironrdp-viewer`，大小约 23 MB。
- 隔离原型目录当前约 2.3 GB，仍由 `.trellis/.gitignore` 排除，不进入仓库。
- `ironrdp-viewer --help` 确认支持 `--rdp-file`、`--username`、`--password`、CredSSP/NLA、clipboard、desktop size 等参数；mXterm 原型脚本会继续拒绝明文密码参数，只允许交互输入或安全凭据桥后续再接入。

可复现命令：

```bash
pnpm prototype:ironrdp-viewer prepare
pnpm prototype:ironrdp-viewer build --toolchain stable --proxy http://127.0.0.1:7890 --timeout-ms 1800000
pnpm prototype:ironrdp-viewer smoke --toolchain stable --proxy http://127.0.0.1:7890
pnpm prototype:ironrdp-viewer status --toolchain stable --proxy http://127.0.0.1:7890
pnpm prototype:ironrdp-viewer write-rdp --host <host> --username <name>
pnpm prototype:ironrdp-viewer write-report --host <host> --username <name>
```

## 8. 连接实测清单

每次连接测试都应记录：

- 测试主机、远端系统、macOS 版本和芯片型号。
- 分辨率、缩放、debug/release build、IronRDP revision。
- NLA/CredSSP、证书提示、登录耗时、断开重连行为。
- 画质、帧流畅度、输入延迟、鼠标拖拽、键盘快捷键、IME、剪贴板。
- CPU/内存观察值，以及认证、证书、网络、协议、渲染、输入类错误日志。

## 9. Phase 0 收口判定

Phase 0 在本机侧完成：

- 隔离 checkout、debug 构建、viewer `--help` smoke、`.rdp` 安全模板和实测报告模板均已就绪。
- `pnpm check:rdp-release-readiness` 会确认官方 macOS RDP 客户端可发现、IronRDP viewer binary 可运行、`.rdp` 模板不含明文密码字段。
- `pnpm check:ironrdp-macos-prototype` 会继续锁住生产边界：macOS embedded 不进入 UI，IronRDP 不进入生产 Cargo 依赖，Windows `mstsc_activex` / `mstsc.exe` 路径不变。

是否进入 Phase 1 只取决于真实连接质量：

- 至少一台 Windows Server 或 Windows Pro RDP 主机连接实测通过。
- 登录、证书/NLA、画质、输入、剪贴板、CPU/内存记录没有阻断项。
- 如果真实连接质量不达标，维持 macOS 官方客户端外部启动，不推进内嵌产品化。
