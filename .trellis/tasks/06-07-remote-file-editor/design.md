# 完整远程文件编辑器设计

## Architecture

本任务新增一个远程文件编辑工作区能力，复用现有连接仓库、终端 session、右侧远程文件树和 Tauri typed command 结构。

- `src/features/files/RemoteFilePanel.tsx`
  - 保持右侧文件浏览入口。
  - 文件双击触发 `onOpenFile(entry)`。
  - 文件/目录右键菜单或操作菜单承载新建、重命名、删除、下载、上传入口。
- `src/features/editor/RemoteFileEditor.tsx`
  - Monaco Editor 容器、编辑器工具栏、保存状态、冲突状态、错误状态。
  - 负责 Monaco 生命周期、layout、语言识别和快捷键绑定。
- `src/features/editor/remoteFileEditorTypes.ts`
  - 远程文件 tab、文档元数据、保存状态、冲突状态。
- `src/features/editor/remoteFileLanguages.ts`
  - 从远程路径/扩展名映射 Monaco language id。
- `src/features/layout/WorkspaceShell.tsx`
  - 将中间工作区从“终端会话”扩展为“终端 tab + 文件 tab”。
  - 维护打开文件 tab 列表、active workbench tab、dirty 状态、关闭确认。
- `src/shared/tauri/commands.ts`
  - 新增 `remoteFileRead`、`remoteFileWrite`、`remoteFileCreateFile`、`remoteFileCreateDirectory`、`remoteFileRename`、`remoteFileDelete`、`remoteFileDownload`、`remoteFileUploadFile` typed wrappers。
- `src-tauri/src/commands.rs`
  - 新增对应 Tauri command request/response 类型。
- `src-tauri/src/remote_files.rs`
  - 扩展 `RemoteFileManager`，新增文件读写和文件管理命令。
- `src-tauri/src/terminal/session.rs`
  - 为 `ReusableExecSession` 增加可选 stdin 的 exec 能力，避免保存内容拼进 shell 命令字符串。

## Data Flow

打开文件：

```text
RemoteFilePanel double click
→ WorkspaceShell openRemoteFile(connectionId, path)
→ remoteFileRead typed command
→ Tauri loads connection profile
→ RemoteFileManager reads metadata + content over SSH exec
→ frontend creates/updates RemoteFileTab
→ RemoteFileEditor renders Monaco model
```

保存文件：

```text
Monaco content
→ WorkspaceShell saveRemoteFile(tabId)
→ remoteFileWrite(connectionId, path, content, openedVersion)
→ Tauri checks current remote metadata
→ if changed: return conflict error / conflict payload
→ else: write stdin to temp file
→ chmod/chown preservation where feasible
→ mv temp file to target path
→ return new metadata
→ frontend clears dirty and refreshes parent directory
```

文件管理：

```text
RemoteFilePanel action
→ typed command
→ RemoteFileManager executes safe quoted shell operation
→ frontend refreshes affected directory
```

## Remote File Contract

建议前端类型：

```ts
interface RemoteFileReadResult {
  content: string;
  encoding: "utf-8";
  isBinary: boolean;
  editable: boolean;
  name: string;
  path: string;
  size: number;
  mtime: number;
  mode?: string;
}

interface RemoteFileWriteRequest {
  connectionId: string;
  path: string;
  content: string;
  expectedMtime: number;
  expectedSize: number;
  overwrite?: boolean;
}
```

后端读文件需要先检查：

- 路径必须指向普通文件或可解析为普通文件的 symlink。
- 大小不超过默认阈值，建议 2 MB。
- 内容不是二进制。可以读取前若大小可接受，再用字节层检测 NUL 或明显非 UTF-8。
- UTF-8 解码失败时返回不可编辑，而不是用有损解码进入编辑器。

## Save Strategy

保存不能将完整内容插入 shell 命令。推荐实现：

1. `stat` 目标文件，检查 `mtime` 和 `size`。
2. 若版本不匹配且未 `overwrite`，返回冲突错误。
3. 创建同目录临时文件：`.filename.mxterm.<timestamp>.tmp`。
4. 通过 SSH exec channel stdin 将 Monaco 内容写入临时文件。
5. 对临时文件设置可保留的 mode。
6. `mv` 临时文件到目标路径。
7. 返回新的 `mtime` / `size`。

如果目标目录权限不允许写临时文件，应返回明确错误。`sudo` 保存不进入首版。

## Monaco Integration

使用 `monaco-editor` 依赖。前端不引入完整 UI 框架。

Monaco 约束：

- 使用动态 import 或 Vite-friendly worker 配置，避免首屏加载被编辑器体积拖慢。
- Editor theme 先使用浅色基础主题，并通过 CSS token 调整外层工具栏。
- `fontFamily` 使用 `var(--font-mono)` 解析后的实际字体栈；如果 Monaco 不接受 CSS var，则从设置解析函数传入字符串。
- `fontSize` 可以跟随终端字号或独立使用终端字号作为首版默认。
- `automaticLayout: true`。
- 每个远程文件 tab 创建独立 Monaco model，关闭 tab 时 dispose model。

语言映射：

- `.sh`, `.bash`, `.zsh` → `shell`
- `.json` → `json`
- `.yaml`, `.yml` → `yaml`
- `.toml` → `toml`
- `.md` → `markdown`
- `.js`, `.jsx`, `.ts`, `.tsx` → JS/TS
- `.py` → `python`
- `.rs` → `rust`
- `.css`, `.html` → CSS/HTML
- `.conf`, `.ini`, `.env`, `nginx.conf` → plaintext 或可用 conf-like language

## UI Design

中间工作区：

```text
┌──────────────────────────────────────────────┐
│ 终端 1   app.conf *   deploy.sh              │
├──────────────────────────────────────────────┤
│ app.conf                                      │
│ prod-core:/opt/app/config/app.conf            │
│ [保存] [重新加载] [放弃更改] [查找] [关闭]     │
│ 状态：已修改 / 正在保存 / 已保存 / 远端已变化 │
├──────────────────────────────────────────────┤
│ Monaco Editor                                │
└──────────────────────────────────────────────┘
```

右侧文件树：

- 单击目录：展开/收起。
- 双击文件：打开文件 tab。
- 右键文件：打开、下载、重命名、删除。
- 右键目录：新建文件、新建文件夹、上传文件、上传文件夹占位、重命名、删除、刷新。
- 顶部上传菜单继续保留，接入上传文件；上传文件夹若未实现递归，保持禁用并说明。

确认弹窗使用项目共享 `ConfirmDialog` 或补共享对话框能力，不使用 `window.confirm`。

## Error Handling

- 读取失败：文件 tab 可显示错误页，允许重试或关闭。
- 保存失败：保留 dirty 内容，工具栏显示错误。
- 冲突：打开冲突确认，不覆盖本地编辑内容。
- 删除失败 / 重命名失败：右侧文件面板显示错误，不清空当前目录。
- 连接变更：同连接同路径 tab 继续存在；如果连接不存在，tab 显示连接不可用。

## Compatibility

- 工作区切换设置页时仍不能卸载终端和编辑器状态。
- 远程文件面板已有大量 WIP，修改时保持目录 listing 和定位终端目录行为。
- 不要求上传文件夹首版完整递归，但 UI 必须诚实表达不可用。
- 不自动提交或推送。

## Out Of Scope

- 远端 LSP。
- sudo 保存。
- Git diff/merge。
- 大文件流式编辑。
- 二进制 hex editor。
- 完整 IDE 项目资源管理器。
