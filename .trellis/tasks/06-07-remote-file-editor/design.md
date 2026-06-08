# 完整远程文件编辑器设计

## Architecture

本任务新增一个远程文件编辑工作区能力，复用现有连接仓库、终端 session、右侧远程文件树和 Tauri typed command 结构。

- `src/features/files/RemoteFilePanel.tsx`
  - 保持右侧文件浏览入口。
  - 文件双击触发 `onOpenFile(entry)`。
  - 文件/目录右键菜单或操作菜单承载新建、重命名、删除、下载、上传、复制路径入口。
  - 顶部上传、目录右键上传和拖拽上传都归一到 `onUploadFiles(parentPath, filesOrDirectories)` 一类入口。
  - 远程文件/目录拖拽下载触发 `onDownloadEntries(entries)`，按当前下载策略落盘。
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
  - 维护右侧工具面板 active tool：`files` / `transfers`，以及传输任务列表。
- `src/shared/tauri/commands.ts`
  - 新增 `remoteFileRead`、`remoteFileWrite`、`remoteFileCreateFile`、`remoteFileCreateDirectory`、`remoteFileRename`、`remoteFileDelete`、`remoteFileDownload`、`remoteFileUploadFile` typed wrappers。
  - 新增下载到本地路径、上传本地文件夹归档、下载远程目录归档相关 typed wrapper，返回本地保存路径和传输结果。
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

上传文件：

```text
Top upload / directory context menu / file tree drop
→ frontend resolves target remote directory
→ local file picker or DataTransfer files
→ read local bytes through browser File API or Tauri fs API
→ remoteFileUploadFile(connectionId, remotePath, bytes)
→ RemoteFileManager writes bytes through SSH exec stdin
→ refresh target directory
```

上传文件夹：

```text
Folder picker / DataTransfer directory
→ local archive builder creates .tar.gz in app temp/cache
→ upload archive to remote temp path through SSH exec stdin
→ remote tar -xzf archive -C target directory
→ cleanup remote temp archive and local temp archive
→ refresh target directory
→ report per-folder result
```

下载文件：

```text
Remote file context menu download
→ remoteFileDownload(connectionId, remotePath)
→ resolve local destination:
   Downloads/<connection name>/<yyyyMMddHHmm>/<remote file name>
   or configured settings policy
→ write local file through Tauri fs capability or backend command
→ show completion feedback with local path
```

下载文件夹：

```text
Remote directory context menu / drag download
→ remote tar -czf temp archive from selected directory
→ download archive bytes/stream
→ write archive to local temp path
→ extract into Downloads/<connection name>/<yyyyMMddHHmm>/<directory name>
→ cleanup remote temp archive and local temp archive unless settings keep archives
→ show completion feedback with local folder path
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

如果目标目录权限不允许写临时文件，应返回明确错误。`sudo` 保存不进入本轮。

## Monaco Integration

使用 `monaco-editor` 依赖。前端不引入完整 UI 框架。

Monaco 约束：

- 使用动态 import 或 Vite-friendly worker 配置，避免首屏加载被编辑器体积拖慢。
- Editor theme 先使用浅色基础主题，并通过 CSS token 调整外层工具栏。
- `fontFamily` 使用 `var(--font-mono)` 解析后的实际字体栈；如果 Monaco 不接受 CSS var，则从设置解析函数传入字符串。
- `fontSize` 可以跟随终端字号或独立使用终端字号作为本轮默认。
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
- 右键文件：
  - 刷新。
  - 上传文件。
  - 下载。
  - 打开方式：内置编辑器打开、下载后用系统默认程序打开、以纯文本打开。
  - 重命名。
  - 复制绝对路径。
  - 查看属性：权限、大小、修改时间、类型、远程绝对路径。
  - 终端：在父目录打开终端、复制 `cd <parent>` 命令。
  - 其他：刷新父目录。
  - 删除。
- 右键目录：
  - 刷新。
  - 上传文件。
  - 上传文件夹。
  - 新建文件。
  - 新建文件夹。
  - 下载目录。
  - 重命名。
  - 复制绝对路径。
  - 查看属性：权限、大小、修改时间、类型、远程绝对路径；目录大小可显示为“需计算”或按后端能力计算。
  - 终端：在此处打开终端、复制 `cd <path>` 命令、定位当前终端目录。
  - 其他：刷新父目录。
  - 删除。
- 右键文件树空白区：
  - 刷新当前目录。
  - 上传文件。
  - 上传文件夹。
  - 新建文件。
  - 新建文件夹。
  - 下载当前目录。
  - 复制当前绝对路径。
  - 终端：在当前目录打开终端、复制 `cd <currentPath>` 命令。
- 顶部上传菜单继续保留，接入上传文件和上传文件夹。
- 文件面板工具栏行上传按钮使用当前路径作为目标目录，菜单包含上传文件、上传文件夹，并复用右键/拖拽上传的同一套传输调度、冲突确认和状态反馈。

右侧工具面板：

```text
┌────────────────────────────┐
│ [ 文件 ] [ 传输 2 ]         │
├────────────────────────────┤
│ 文件面板或传输面板内容      │
└────────────────────────────┘
```

- “文件”和“传输”是同级 tab。
- 文件面板发起上传/下载后，传输 tab 徽标显示活动/失败任务数量。
- 是否自动切到传输面板：默认不强制切换，避免打断文件浏览；失败时可高亮徽标。
- 传输面板展示队列项：方向、名称、远端路径、本地路径、阶段、进度、状态、取消/重试/打开目录/复制路径。
- 传输阶段包含：等待、检查冲突、本地打包、上传、远端解压、远端打包、下载、本地解压、清理、完成、失败、取消。
- 拖拽本地文件或文件夹到目录行：上传到该目录。
- 拖拽本地文件或文件夹到当前文件列表空白区：上传到当前路径。
- 拖拽远程文件或目录：下载到当前下载策略目录；Windows 平台优先补 OS 级拖出到资源管理器/桌面体验。
- 拖拽上传需要有明确 drop target 高亮和上传中的反馈；失败时保留当前目录状态并显示错误。

确认弹窗使用项目共享 `ConfirmDialog` 或补共享对话框能力，不使用 `window.confirm`。

## Rename Behavior

重命名是原地改名，不是移动。

- 弹窗输入框只显示并编辑当前条目的名称，例如 `nginx.conf`。
- 父目录作为只读上下文展示，例如 `父目录：/opt/app/config`。
- 提交时使用 `joinRemotePath(parentPath, newName)` 生成 `newPath`。
- `newName` 不能包含 `/`、`\`、空字符串或 `.` / `..`。
- 如果用户需要移动文件，后续应单独做“移动到...”动作，不复用重命名。
- 重命名目录时，已打开的子文件 tab 按原有逻辑批量改路径，但父目录以旧路径的 parent 为准，不允许从重命名输入框改动。

## Download Location Settings

本轮默认下载路径：

```text
<用户下载目录>/<连接名称>/<yyyyMMddHHmm>/<文件名>
```

连接分组名称优先使用连接名称；如果连接名称为空，使用连接 host，最后兜底为 `mxterm-session`。该名称需要清理 Windows 不合法路径字符。时间戳默认使用用户本地时区，精度到分钟。

设置模型接入：

- downloadRoot: 可选的自定义下载根目录；留空时使用系统 Downloads，设置页提供目录选择入口和手动输入。
- groupBySession: 是否按连接名称创建子目录。
- timestampDirectory: 是否按时间戳创建子目录。
- timestampFormat: 默认 `yyyyMMddHHmm`。
- keepArchives: 文件夹上传/下载是否保留中间 `tar.gz` 包，默认 false。
- conflictPolicyDefault: 同名目标默认策略，默认 ask。

设置页需要提供下载根目录、连接分组、时间戳目录、保留压缩包和同名冲突默认策略。若当前设置页没有对应 section，本任务补到外观/基础设置里的文件传输设置组。

如果 Tauri dialog/fs 插件尚未接入，本任务需要补依赖、capability 权限和 typed helper；不要继续使用浏览器 Blob 下载作为桌面应用的下载路径。

## Archive Strategy

文件夹上传：

- 本地侧生成 `tar.gz`，保留原目录名作为归档根目录。
- 上传到远端目标目录下 `.mxterm-upload-<timestamp>-<random>.tar.gz` 临时文件。
- 远端执行 `tar -xzf <archive> -C <targetDir>`；如果远端缺少 `tar` 或 `gzip`，返回明确错误。
- 解压前检查目标目录下同名根目录冲突，按覆盖、跳过、重命名策略处理。
- 解压完成后清理远端临时归档；失败时尽量清理并保留错误详情。

文件夹下载：

- 远端在可写临时目录生成 `.mxterm-download-<timestamp>-<random>.tar.gz`。
- 远端执行 `tar -czf <archive> -C <parentDir> <directoryName>`，保留目录根名。
- 下载归档到本地临时路径后解压到当前下载分组目录。
- 本地目标同名时按覆盖、跳过、重命名策略处理。
- 成功后默认清理远端和本地临时归档；如果设置 `keepArchives`，在下载分组目录额外保留归档。

## Drag Download

完整交互包含两层：

- 稳定闭环：从文件树拖拽远程文件/目录，在应用内触发下载到当前下载策略目录，并展示下载结果。
- Windows-first OS 拖出：调研并实现从文件树拖到资源管理器/桌面的原生文件拖出体验。若 Tauri v2 官方 API 无直接支持，需要通过 Windows 原生能力或临时文件 provider 实现；若平台无法支持，必须在验收说明中明确限制，不能留下假可用 UI。

## Error Handling

- 读取失败：文件 tab 可显示错误页，允许重试或关闭。
- 保存失败：保留 dirty 内容，工具栏显示错误。
- 冲突：打开冲突确认，不覆盖本地编辑内容。
- 删除失败 / 重命名失败：右侧文件面板显示错误，不清空当前目录。
- 上传/下载失败：传输状态面板保留失败项、远端路径、本地路径和错误详情。
- 归档/解压失败：说明失败发生在打包、上传、远端解压、远端打包、下载、本地解压或清理阶段。
- 连接变更：同连接同路径 tab 继续存在；如果连接不存在，tab 显示连接不可用。

## Compatibility

- 工作区切换设置页时仍不能卸载终端和编辑器状态。
- 远程文件面板已有大量 WIP，修改时保持目录 listing 和定位终端目录行为。
- 文件夹上传/下载作为本轮完整交付项，使用 `tar.gz` 归档链路。
- OS 级拖出下载作为完整体验的一部分做 Windows-first 实现或明确平台能力限制。
- 不自动提交或推送。

## Out Of Scope

- 远端 LSP。
- sudo 保存。
- Git diff/merge。
- 大文件流式编辑。
- 二进制 hex editor。
- 完整 IDE 项目资源管理器。
