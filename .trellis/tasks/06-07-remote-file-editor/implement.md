# 完整远程文件编辑器实现计划

## Steps

1. 依赖和验证护栏
   - 添加 Monaco Editor 依赖。
   - 新增源码检查脚本，覆盖 Monaco 接入、typed Tauri wrappers、远端保存不拼接完整内容、dirty/冲突 UI 入口。
   - 确认 Vite + Monaco worker 配置方式。

2. 后端远程文件契约
   - 在 `commands.rs` 新增 read/write/create/rename/delete/download/upload request/response。
   - 在 `remote_files.rs` 新增元数据读取、文本读取、二进制/大小拦截。
   - 为 `ReusableExecSession` 新增带 stdin 的 exec 方法。
   - 实现保存：版本检查、stdin 写临时文件、原子替换、返回新 metadata。
   - 为 shell quoting、metadata parsing、二进制检测、冲突检测、保存命令构造添加 Rust 单元测试。

3. 前端 typed wrappers 和类型
   - 扩展 `src/shared/tauri/commands.ts`。
   - 新增 `RemoteFileReadResult`、`RemoteFileEditorTab`、`RemoteFileSaveState` 等类型。
   - 新增路径到 Monaco language 的映射工具。

4. 工作区 tab 模型
   - 将中间工作区 tab 扩展为 terminal/file union。
   - 文件双击打开时创建或激活文件 tab。
   - 文件 tab 支持 dirty 标记、关闭按钮、关闭确认。
   - 保持终端会话不卸载。

5. Monaco 编辑器组件
   - 新增 `RemoteFileEditor`。
   - 动态加载 Monaco，创建/dispose model。
   - 接入保存、重新加载、放弃更改、查找、关闭。
   - 接入 `Ctrl+S` / `Cmd+S`。
   - 使用 mXterm 等宽字体和紧凑工具栏样式。

6. 文件树操作补全
   - 文件双击打开。
   - 右键菜单或行内菜单：打开、下载、重命名、删除。
   - 目录菜单：新建文件、新建文件夹、上传文件、上传文件夹占位、重命名、删除、刷新。
   - 操作后刷新相关目录并保留展开状态。

7. 冲突、错误和边界状态
   - 保存冲突弹窗：重新加载、覆盖保存、取消。
   - 二进制/超大文件拦截页。
   - 读取失败/保存失败状态。
   - 连接丢失或连接配置删除后的 tab 状态。

8. 验证
   - `node scripts/check-remote-file-editor-source.mjs`
   - `npm run check`
   - `npm run build`
   - `npm test`
   - `cargo test` 或 `npm run tauri` 相关可用命令中的 Rust 测试。
   - 浏览器验证：打开文件、编辑、dirty 关闭确认、保存状态、二进制/大文件拦截、文件树刷新。

## Risk Points

- Monaco 体积较大，必须动态加载或合理配置 worker，避免拖慢首屏。
- 保存内容不能拼进 shell 命令；必须用 stdin 或等价安全传输方式。
- 远端 `stat` 输出在不同系统上可能差异较大；命令应尽量使用 POSIX 常见能力并有解析测试。
- 原子替换可能改变 owner/mode；首版至少保留 mode，owner 保留失败不应阻塞普通用户保存。
- 上传/下载如果走本地文件 picker，需要 Tauri dialog/fs 能力；若当前插件未接，需要分阶段接入或明确先实现命令层。
- 当前工作区已有大量 WIP，修改 `RemoteFilePanel`、`WorkspaceShell`、`app.css` 时要避免覆盖无关改动。

## Review Gate

实现前确认：

- Monaco 作为编辑器核心。
- 首版大小限制默认 2 MB。
- 上传文件夹如果递归能力成本过高，可以先禁用并保留入口说明。
- sudo 保存不进入首版。

## Validation Commands

```bash
node scripts/check-remote-file-editor-source.mjs
npm run check
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```
