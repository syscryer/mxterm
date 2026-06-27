# macOS RDP 嵌入式方案 Spike

## 1. 背景

mXterm 当前 Windows RDP 有两条成熟路径：

- `mstsc_activex`：Windows-only 的 ActiveX 原生宿主，用于内置/原生子窗口。
- `mstsc`：通过系统 `mstsc.exe` 打开 `.rdp` 文件。

macOS 侧已经具备生产可用的外部客户端路径：通过 `/usr/bin/open` 优先调用 `Windows App` / `Microsoft Remote Desktop` 打开临时 `.rdp` 文件。如果未检测到官方客户端，则交给系统默认 `.rdp` 处理程序。

本 Spike 只评估 macOS “像 Windows 一样窗口嵌入”的可行性，不把未达质量门槛的嵌入方案暴露给用户。Windows 现有 `mstsc_activex` / `mstsc.exe` 行为必须保持不变。

## 2. 当前决策

短期生产路径：

- macOS RDP 使用官方客户端外部启动，保障兼容性、画质和流畅度。
- macOS UI 不展示“内置宿主”作为可选打开方式，避免给用户错误预期。
- 保存过的 Windows embedded 偏好不做迁移或重写；在 Windows 上继续使用 ActiveX，在 macOS 上运行时按平台能力走外部客户端。

中期探索路径：

- 只在原型满足质量门槛后，才把 macOS embedded 作为实验开关进入产品。
- 优先评估协议/渲染可控的嵌入方案，不做外部窗口截图、窗口强拉、低质量转码这类折中路线。

## 3. 候选方案

| 方案 | 协议 / 许可证 | 嵌入形态 | 优点 | 主要风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| Microsoft Windows App / Microsoft Remote Desktop | 闭源官方客户端 | 外部 App 打开 `.rdp` | 兼容性、性能、输入、证书、NLA、网关和多显示器能力最成熟 | macOS 没有类似 Windows ActiveX 的公开嵌入 SDK | 生产首选外部路径 |
| FreeRDP | Apache-2.0 | C 库 + Mac/SDL 客户端 | RDP 协议成熟，已有多平台客户端，适合验证画质和协议覆盖 | 要做 Cocoa/Tauri 嵌入、生命周期、输入、剪贴板、音频、DPI 和打包适配，集成成本高 | 可作为高质量 native 原型候选 |
| IronRDP | Apache-2.0 | Rust crates + `ironrdp-client` / viewer | Rust 生态更贴近 Tauri 后端，便于长期内聚；可控渲染管线 | 客户端成熟度、硬件加速、通道能力和 macOS 包体体验需要验证 | 推荐优先做最小原型 |
| Apache Guacamole | Apache-2.0 | `guacd` 网关 + 浏览器画布 | Web 嵌入模式成熟，前端接入自然 | 需要本地/远端网关进程，路径更长；对“质量流畅度优先”不一定达标 | 作为备用，不作为首选 |
| rdesktop | GPL-3.0 | 传统客户端 | 历史资料可参考 | GPL-3.0 强 copyleft，维护状态不理想 | 不复用代码 |

## 4. 推荐推进顺序

### Phase A：保持生产链路稳定

- macOS 外部官方客户端作为默认生产路径。
- `PlatformCapabilities.supportsEmbeddedRdp` 仅 Windows 为 true。
- 后端 `select_runner` 在 macOS 选择 `macos_app`；`embedded_fallback_reason` 对非 Windows 继续回退外部 runner。
- 连接配置 UI 按平台能力展示 RDP 打开方式。

### Phase B：IronRDP 最小内嵌原型

目标不是立刻产品化，而是验证能否达到 mXterm 要求的质量底线：

- 具体推进计划见 `docs/plans/2026-06-27-ironrdp-macos-prototype.md`。
- 在 macOS 上连接一台标准 Windows Server / Windows Pro RDP 主机。
- 将 RDP frame 渲染到 mXterm 可承载的原生视图或 Tauri webview 可控 surface。
- 支持键盘、鼠标、剪贴板、动态分辨率、Retina 缩放。
- 支持 NLA / TLS / 证书提示基础流程。
- 测量 1080p 和 Retina 场景下的帧率、延迟、CPU、内存。

通过条件：

- 日常桌面操作无明显卡顿、输入无明显丢键。
- 分辨率变化、窗口 resize、全屏/退出全屏不会破坏连接。
- 断线、证书失败、认证失败能以结构化错误回到 UI。
- 打包后不要求用户额外安装复杂服务。

### Phase C：FreeRDP native 原型对照

如果 IronRDP 原型在编码、渲染或通道能力上达不到要求，再做 FreeRDP native 对照：

- 验证是否可复用 FreeRDP 客户端核心并嵌入 Cocoa/SDL surface。
- 明确 C ABI、打包体积、动态库签名、公证、崩溃隔离和升级成本。
- 不复制 GPL/协议不清晰代码；只使用 Apache-2.0 FreeRDP 许可边界内的实现。

### Phase D：产品化开关

只有 Phase B 或 C 达标后才进入产品：

- 增加 macOS experimental embedded runner。
- UI 默认仍保留官方客户端外部模式，实验入口必须明确标注。
- Windows `mstsc_activex` 和 `mstsc` 路径不改名、不迁移、不改变默认选择。

## 5. 验收清单

macOS embedded 进入产品前必须满足：

- 画质：Retina 下文字清晰，缩放不糊，颜色无明显异常。
- 流畅度：常规桌面拖动、窗口切换、文本输入可长期使用。
- 输入：常用组合键、Command/Control 映射、中文输入法、鼠标滚轮和拖拽可用。
- 剪贴板：文本双向复制稳定，失败有可见状态。
- 安全：支持 NLA/TLS，证书异常不静默信任。
- 凭据：不通过命令行传递明文密码，不写入日志。
- 生命周期：连接、重连、关闭、窗口隐藏/恢复不泄漏进程或线程。
- 打包：签名、公证、依赖库加载路径和更新流程可控。

## 6. 当前代码边界

- `src/shared/tauri/platformCapabilities.ts`：macOS `supportsEmbeddedRdp=false`，但 `supportsExternalRdp=true`。
- `src-tauri/src/rdp.rs`：macOS runner 使用 `/usr/bin/open` 打开 `.rdp`，优先官方客户端；非 Windows embedded 请求会回退到外部 runner。
- `src/features/connections/ConnectionDialog.tsx`：RDP 打开方式按平台能力展示，macOS 不展示内置宿主选项。
- `src/features/layout/WorkspaceShell.tsx`：浏览器预览按平台显示 runner，macOS 预览为系统 RDP 客户端。

## 7. RDP 收口状态

当前 RDP 生产适配按“稳定优先，不影响 Windows”的目标收口：

- macOS 生产路径：使用 `/usr/bin/open` 优先打开 `Windows App`，其次 `Microsoft Remote Desktop`，未检测到官方客户端时交给系统默认 `.rdp` 处理程序。
- Windows 生产路径：保留 `mstsc_activex` 内嵌宿主和 `mstsc.exe` 外部启动，不改名、不迁移、不改变默认选择。
- 平台能力：`supportsEmbeddedRdp` 仍仅 Windows 为 true；macOS / Linux 只暴露 external RDP。
- UI 边界：macOS 不展示 RDP 内置宿主选项；已有 Windows embedded 偏好跨平台运行时不会写回或污染保存配置。
- 依赖边界：IronRDP 仍在 `.trellis/.runtime` 隔离原型中验证，未进入生产 `src-tauri/Cargo.toml`。

本机已完成的收口检查：

```bash
pnpm check:ironrdp-macos-prototype
pnpm check:rdp-release-readiness
CI=true pnpm check
cargo check --manifest-path src-tauri/Cargo.toml
```

外部环境验收仍作为发布门槛，而不是继续改生产 RDP 代码的前置条件：

- macOS 真机用真实 RDP 主机确认官方客户端拉起、`.rdp` 字段、凭据提示、NLA/证书行为。
- Windows 真机确认 `mstsc_activex` 内嵌和 `mstsc.exe` 外部启动未回归。
- 发布阶段完成 macOS 签名、公证和 Windows 安装包验证。
