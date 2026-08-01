# 远程文件悬浮信息设计

## Goal

在不增加目录列表初始负担的前提下，为远程文件树提供单实例、自定义、可访问的元数据信息浮层，并扩展现有远程条目元数据契约以支持所有者、所属组和文件系统创建时间。

## Architecture

### 1. Remote metadata contract

只扩展 `RemoteFileEntryMetadata`，不改变用于编辑冲突检测的 `RemoteFileMetadata`。新增显式可空字段：

```text
owner: string | null
uid: number | null
group: string | null
gid: number | null
birthtime: number | null
```

Rust 的 `build_remote_entry_metadata_command` 在现有 kind/path/size/mtime/mode 后追加这些字段，继续使用 NUL 分隔，避免空格、换行或非 ASCII 名称破坏解析。GNU/Linux 使用 `stat -c`，BSD/macOS 使用 `stat -f`；所有者、组和 birth time 属于可选信息，读取失败不得使整个属性请求失败。`birthtime <= 0` 统一解析为 `None`，禁止用 POSIX `ctime` 代替创建时间。

### 2. Single anchored information surface

`RemoteFilePanel` 维护一个当前 hover/focus 条目和一个锚点元素引用。达到共享 tooltip 相近的延迟后，只挂载一个信息浮层；文件树中的其他行不创建独立 Tooltip Root 或 Portal。

浮层复用 `AnchoredSurfacePortal` 和全局 `ui-tooltip` / glass token 体系，并为共享锚定浮层补充向左/向右放置能力，默认行为保持不变。远程文件面板位于窗口右侧时优先向左展开，空间不足时回退到另一侧。浮层使用 `role="tooltip"`、稳定 id 和 `aria-describedby`，不抢焦点、不承载必须点击的操作。

文件行删除原生 `title`。鼠标离开、焦点离开、切换连接/工具、条目消失或按 Escape 时关闭浮层；现有点击、双击、拖拽、右键菜单和多选事件保持原样。

### 3. Lazy loading and cache

悬停延迟结束后再发起 `remoteFileMetadata(connectionId, path)`，避免鼠标扫过列表时产生请求。缓存按 `connectionId + normalizedPath` 隔离，并记录 loading/success/error 状态以合并同一路径的并发读取。

连接切换时清空当前面板的浮层、在途展示资格和缓存。强制刷新目录时清理该目录及其子路径的元数据缓存；操作流程触发的目录刷新因此能自然失效缓存。请求完成后必须再次校验连接、路径和当前展示目标，过期结果可以进入正确缓存但不得覆盖另一个条目的可见内容。

浏览器预览模式返回确定性的元数据，保证不依赖 Tauri 也能检查布局、加载状态和主题。

### 4. Presentation and formatting

信息浮层使用紧凑的标题加定义列表，不嵌套卡片。所有条目显示类型、所有者、所属组、权限、修改时间、创建时间和完整路径；普通文件及其他有意义的非目录条目显示大小，文件夹隐藏大小。

所有者/组优先显示名称，名称无法解析时显示 `UID <id>` / `GID <id>`，完全不可用时显示“未知”。创建时间为空时显示“系统不支持”。路径允许换行但不溢出固定宽度。时间和文件大小格式化从 feature 共享 helper 复用，属性对话框不得维护冲突的字段解释。

### 5. Error and accessibility states

- 加载中：保留名称、类型和路径，元数据区显示轻量加载状态。
- 读取失败或条目已消失：显示简短可恢复错误，不阻塞文件树操作；缓存随目录刷新失效。
- 键盘：行获得焦点后同样触发延迟展示，移焦关闭，Escape 可关闭。
- 主题：浮层只使用 `--mx-*` token 和共享浮层材质，检查亮色、显式暗色、system-dark。

## Boundaries

- `src-tauri/src/remote_files.rs`: 远端命令、响应结构、NUL 解析和 Rust 单元测试。
- `src/features/files/remoteFileTypes.ts`: TypeScript 响应契约。
- `src/shared/tauri/commands.ts`: 继续作为唯一 invoke wrapper，不新增 raw invoke。
- `src/features/files/RemoteFilePanel.tsx`: hover/focus 状态、请求缓存、失效和单实例浮层接入。
- `src/features/files/RemoteFileInfoTooltip.tsx`: feature 内的元数据展示，不拥有远端请求。
- `src/shared/ui/AnchoredSurfacePortal.tsx`: 向侧边放置的通用能力，保持现有调用兼容。
- `src/styles/app.css`: 紧凑信息浮层样式和主题兼容，全部走全局 token。
- `src/features/layout/WorkspaceShell.tsx`: 现有属性视图复用扩展后的格式化语义，避免同一字段出现两种解释。

## Data Flow

```text
row hover/focus
  -> delay gate
  -> one active anchored surface
  -> cache lookup by connection + path
  -> typed remoteFileMetadata wrapper
  -> Tauri remote_file_metadata
  -> quoted GNU/BSD stat command
  -> NUL parser + typed response
  -> stale-target check
  -> compact tooltip rendering
```

## Trade-offs

- 按需读取使首次悬停需要等待远端响应，但避免每次目录展开都为所有条目执行多次 `stat`。
- 单实例浮层状态比给每行包一层 Tooltip 略复杂，但能控制大目录的 React/Radix 挂载成本。
- 元数据缓存可能在远端被外部修改后短暂陈旧；以用户刷新目录和应用内文件操作触发的刷新作为明确失效边界。
- 文件系统 birth time 不具备普适性，明确显示“不支持”比展示含义错误的 `ctime` 更可靠。

## Compatibility And Rollback

- 新字段只扩展同一版本内的 Tauri 响应，不改变命令名或请求参数。
- GNU/Linux、BSD/macOS 的可选字段分别探测；缺失字段退化为 null，不影响已有 size/mtime/mode。
- 如 UI 浮层出现问题，可回滚前端浮层接入而保留向后兼容的新增响应字段；不得恢复浏览器原生 tooltip 作为完成方案。
