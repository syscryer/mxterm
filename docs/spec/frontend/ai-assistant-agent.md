# AI 助手 Agent 前端契约

## 工作区选择

Agent 请求必须明确携带当前终端主机，并可选携带本地文件工作区：

- 当前主机：`connection_id` 与当前终端目录，或本机终端与本机目录。
- SSH 未选择工作区且当前终端目录暂时不可用时，后端在当前 SSH 主机上解析登录用户的真实家目录作为默认工作区；界面可以显示 `~`，但文件工具使用解析后的绝对路径。
- SSH 会话可以在“添加上下文”菜单中单独指定绝对路径作为文件工作区；未指定时跟随当前终端目录，切换到“跟随当前目录”会清除覆盖。
- 本地文件工作区：`local_workspace_path`，只用于本地文件工具。

文件工具的 `target` 可显式指定为 `local` 或 `ssh`；省略时跟随当前终端主机。SSH 会话中操作本地文件必须显式传 `target=local`，本机终端不选择独立工作区时直接使用本机当前目录。

本地和 SSH 工作区均为默认目录与编码上下文，不限制文件工具只能访问该目录。相对路径按对应工作区解析，绝对路径可访问目标主机上的其它目录，访问结果由目标主机用户权限决定；模式审批、文件冲突校验、备份和回滚规则继续生效。

顶部显示会话标题，下方用紧凑一行展示当前终端主机和已选择的本地文件工作区；Agent 执行目标在发送时固定；切换会话 Tab 只切换界面，不改变后台执行目标；调整正在运行的同一会话文件工作区前需要结束当前运行。

## 工具状态

工具行需要展示工具名称和运行状态，展开后显示目标工作区、风险级别、审批状态、耗时、退出码和输出是否截断。待确认命令显示完整命令和风险原因，用户确认后才能继续；完全访问模式遵循后端的跳过普通命令确认规则。

模型返回的思考流按原始正文和工具位置交错展示；生成中的折叠行跟随最新思考内容滚动，用户可展开查看完整文本，完成后保持折叠状态。

对话停在底部时自动跟随新输出，同时响应工具展开、图片加载、输入区及视口尺寸变化；布局变化产生的滚动事件不视为用户上翻。用户主动向上滚动（包含滚轮、键盘、触摸或拖动滚动条）后暂停跟随，保留阅读位置，有新输出时显示“新内容”。向下回到底部或点击“新内容”恢复跟随；轻微上翻也不会被底部距离阈值立即拉回。

文件修改先显示 diff 预览。用户拒绝时不产生文件副作用；冲突时要求 Agent 重新读取文件。

文件读取、预览、应用和回滚采用紧凑单行：动作、文件名、目录、增删行数，路径过长时省略并保留悬停完整路径；点击或键盘操作展开原始 diff / 输出与完整路径。普通文件行默认折叠，成功时不显示重复的完成徽标；运行、失败、取消及真实审批仍保留状态。预览行明确标为“预览”，不冒充已写入文件；只有应用工具真正等待审批时才默认展开执行 / 拒绝区域。文件信息优先读取后端 `file_activity`；旧记录仅使用明确的路径参数，不把内部变更编号当文件名或伪造增删数。

## 每轮文件修改汇总

assistant 回复末尾显示紧凑汇总条：“N 个文件已更改 +增行 −删行”，左侧展开查看文件名、完整路径悬停、目标主机和净增删行数，右侧“撤销”复用共享确认弹窗。所有颜色和状态使用全局 token，同时支持亮色、暗色与 system-dark。

汇总只使用后端持久化检查点及 `file_changes` 事件，不从模型正文或工具输出推断。Agent 运行中禁用撤销。执行后按原 session/message/checkpoint 更新所有已打开的对应会话，不把异步结果写入后来切换的会话；完整撤销显示“已撤销”，部分完成保留可重试入口与具体错误，冲突明确展示。历史恢复保留已撤销状态；旧记录没有回复归属时不伪造汇总。

## Rendering and session responsiveness

- Retain an opened AI view under a stable workspace host for each live terminal scope. Switching tabs, tools, workspace modes, or collapsing the pane must not rebuild its history DOM. Closing the terminal releases its view.
- Hidden AI views unsubscribe from UI snapshots and pause elapsed-time ticks and scroll observation. The stream listener continues updating the scope store; activation reads the latest state. Transient overlays close on deactivation, while drafts, expanded records, scroll position, and pending approvals remain scoped.
- Commands from a retained view must validate the currently committed terminal scope before dispatch. Hidden views cannot send a delayed action into another terminal.
- Keep message, text, and tool renderers stable across stream deltas. Reuse unchanged history rows and tool records; only changed content and controls should render again.
- The elapsed-time tick must reuse the existing message flow. A collapsed reasoning preview reads the latest non-empty line from the end while retaining the complete text for expansion.
- Commit and resize notifications share one scroll measurement per animation frame. Pause, return-to-bottom, hidden-panel cancellation, and scope cleanup remain authoritative; unchanged new-content state must not trigger another panel render.
- Memoization must include interactive state and callback dependencies. Switching scopes must preserve draft, stream ID, approvals, questions, and undo ownership. Performance optimizations must not disable React timing APIs, discard events, or hide history.

## Agent 模式说明

聊天模式只提供查询和解释；Agent 模式提供文件搜索、文件读取、diff、命令执行和后台任务工具。Agent 模式隐藏聊天建议卡，显示计划、工具进度和验证结果。命令执行中的 stdout/stderr 通过工具事件增量显示在当前工具行下方；输出过长时界面只保留尾部预览，完整内容通过 artifact 读取。后台任务完成后更新原工具行，即使主回复已经结束也显示完成或失败通知；完成状态不自动展开详情。

## 附件

输入框的“+”菜单提供图片和文本附件入口，支持多选、从剪贴板粘贴截图、发送前预览和移除。图片显示缩略图，文本类文件显示文件名和行数；点击附件可以在统一浮层中查看图片或完整文本。附件随用户消息写入会话历史，重新打开会话后仍可按会话附件编号取回并预览。图片超过大小、附件超过数量或 UTF-8 校验失败时在输入框附近显示原因，不静默丢弃文件；发送后后端将附件保存为会话级 Artifact，消息只保留元数据、短预览和 Artifact 编号，模型需要全文时通过 `read_attachment` 分段读取。当前范围是图片与文本类文件，PDF、Office、压缩包等需要后续解析能力。
