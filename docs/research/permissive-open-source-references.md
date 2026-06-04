# 宽松协议开源项目参考

## 文档状态

- 日期：2026-06-04
- 用途：为 mXterm 后续开发选型和产品实现提供参考
- 范围：优先整理 MIT、Apache-2.0、BSD/ISC 等宽松协议项目
- 说明：许可证以对应仓库的 `LICENSE` 文件为准，后续引入代码或依赖前需要再次核对

## 1. 重点参考项目

| 项目 | 协议 | 相关度 | 可参考点 |
| --- | --- | --- | --- |
| [Rusty](https://github.com/hexajohnny/rusty) | MIT / Apache-2.0 | 很高 | Rust + React + Tauri 的跨平台 SSH 客户端，和 mXterm 技术路线最接近。可参考项目结构、Tauri/Rust/React 边界和 SSH 客户端实现方式。 |
| [WindTerm](https://github.com/kingToolbox/WindTerm) | Apache-2.0 | 很高 | 终端、SSH、SFTP、会话管理能力完整。可参考产品功能范围、连接管理、SFTP 体验和终端工具细节。 |
| [electerm](https://github.com/electerm/electerm) | MIT | 很高 | SSH/SFTP/终端一体化桌面客户端。虽然是 Electron 技术栈，但功能形态和 mXterm 很接近。 |
| [Tabby](https://github.com/Eugeny/tabby) | MIT | 高 | 现代终端客户端，支持本地 shell、SSH、串口和插件。可参考终端标签、配置、快捷键、插件化组织。 |
| [XPipe](https://github.com/xpipe-io/xpipe) | Apache-2.0 | 高 | 服务器连接和本地/远程环境管理工具。可参考连接资产组织、连接发现、桌面工具工作流。 |
| [Termscp](https://github.com/veeso/termscp) | MIT | 中高 | Rust 文件传输客户端，支持 SFTP/SCP/FTP/S3。可参考文件传输、错误处理和传输体验。 |

## 2. 终端能力参考

| 项目 | 协议 | 可参考点 |
| --- | --- | --- |
| [WezTerm](https://github.com/wezterm/wezterm) | MIT | Rust 终端模拟器，质量高。可参考终端配置、标签、分屏、字体、主题和键盘绑定设计。 |
| [Alacritty](https://github.com/alacritty/alacritty) | Apache-2.0 | Rust 高性能终端。可参考配置模型、终端性能和跨平台细节。 |
| [Windows Terminal](https://github.com/microsoft/terminal) | MIT | Windows 桌面终端体验参考。可参考 profile、tab、pane、快捷键和设置结构。 |

## 3. 技术组件参考

| 项目 | 协议 | 用途 |
| --- | --- | --- |
| [Tauri](https://github.com/tauri-apps/tauri) | MIT / Apache-2.0 | 桌面框架。mXterm 当前选定路线。 |
| [xterm.js](https://github.com/xtermjs/xterm.js) | MIT | 前端终端渲染。 |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | MIT | 远程文本文件编辑器。 |
| [russh](https://github.com/Eugeny/russh) | Apache-2.0 | Rust SSH 客户端/服务端库。可评估纯 Rust SSH 方案。 |
| [ssh2-rs](https://github.com/alexcrichton/ssh2-rs) | MIT / Apache-2.0 | libssh2 Rust 绑定。可评估 SSH/SFTP 的工程成熟度。 |
| [keyring-rs](https://github.com/open-source-cooperative/keyring-rs) | MIT / Apache-2.0 | 系统钥匙串访问。对应 mXterm 的凭据存储需求。 |

## 4. 参考优先级

建议优先参考顺序：

1. Rusty：技术路线最接近，适合作为 Tauri + React + Rust 的结构参考。
2. WindTerm：功能范围最接近，适合作为 SSH/SFTP 桌面工具的产品能力参考。
3. electerm：SSH/SFTP/终端整合完整，适合参考交互流程和功能清单。
4. Tabby：终端体验成熟，适合参考标签、配置、快捷键和插件组织。
5. Termscp：文件传输经验集中，适合参考 SFTP 上传下载和错误处理。

## 5. 不建议直接参考代码的项目类型

以下类型项目即使功能相近，也不建议直接参考代码实现：

- GPL / AGPL 项目。
- 没有明确 LICENSE 的项目。
- 许可证和商业授权混杂且边界不清晰的项目。
- 长期无人维护、依赖严重过期的项目。

这些项目可以作为功能观察对象，但不要复制代码、结构或资源文件。

## 6. 对 mXterm 的启发

### 6.1 产品能力

mXterm 首版可以把能力聚焦为：

- 连接管理。
- SSH 终端。
- SFTP 文件浏览。
- 上传下载队列。
- 远程文本编辑。
- 系统钥匙串凭据管理。

这与 Rusty、WindTerm、electerm 的核心能力重合，但 mXterm 不做团队、云同步、RDP/VNC/Telnet。

### 6.2 技术路线

当前路线建议保持：

- Tauri 负责桌面壳和系统能力。
- React + TypeScript 负责界面和状态。
- Rust 负责 SSH、SFTP、传输队列、凭据、SQLite。
- xterm.js 负责终端渲染。
- Monaco Editor 负责文本编辑。

SSH/SFTP 后端需要进一步在 `russh` 和 `ssh2-rs` 之间做验证。`russh` 更偏纯 Rust，`ssh2-rs` 工程成熟度和 SFTP 支持需要重点评估。

### 6.3 后续 Trellis 管理建议

后续接入 Trellis 后，建议至少维护这些项目入口：

- `.trellis/tasks/`：按阶段维护工程基座、SSH Spike、连接管理、SFTP、传输队列、远程编辑等任务。
- `.trellis/spec/`：维护前端、后端、跨层设计和质量规范。
- `.agents/skills/`：提醒后续 agents 使用 Trellis 任务流和规范。
- `package.json` scripts：维护 `dev`、`check`、`test`、`package-windows`。
- `scripts/trellis/docs-check.ps1`：保留文档占位词检查。

当前仓库使用 trytrellis.app 的 Trellis，入口是 `trellis` CLI 和 `.trellis/` 项目目录，不使用 `trellis-ctl`。
