# 远程文件传输性能隔离设计

## Architecture

新增 `src/features/files/remoteFileTransferStore.ts`：

- 定义 `RemoteFileTransferItem`、`RemoteFileTransferRetry`、`TransferStatus` 等传输领域类型。
- 使用 Zustand vanilla store 保存传输列表，并通过 selector 订阅传输列表、摘要和单行数据。
- Store 内部维护 `items` 和 `itemById` 视图，所有更新通过集中方法进入。
- 高频进度事件使用模块内 pending map 和 timeout 批量合并，同一 transfer 只应用最新事件。
- Store 更新只通知订阅传输状态的组件，避免触发 `WorkspaceShell` 主组件渲染。

新增 `src/features/files/remoteFileTransferController.ts` 或 hook：

- 拥有队列、运行中集合、任务 map、并发数 ref、取消、重试、清理、移除等动作。
- 接收 shell 提供的低频依赖：
  - 当前连接查询。
  - 远端刷新回调。
  - 设置快照。
  - 传输执行函数或 retry runner。
- 传输任务执行仍由现有上传/下载函数发起，但状态读写改走 store/controller。

新增 `src/features/files/RemoteFileTransferPanel.tsx`：

- 从传输 store 订阅列表。
- 保留现有面板 DOM 结构和 class 名，CSS 继续沿用 `src/styles/app.css`。
- 可用 `memo` 包住行组件，后续传输列表更新只影响变更行和摘要。

## Data Flow

```
用户操作
  -> WorkspaceShell 创建传输任务
  -> remoteFileTransferController 入队
  -> controller 按并发数运行任务
  -> Tauri command 执行真实上传/下载
  -> remote_file:transfer_progress 事件
  -> transfer store 合并进度事件
  -> RemoteFileTransferPanel 订阅并渲染
  -> command resolve/reject
  -> controller 更新完成/失败/取消
  -> 低频回调通知 WorkspaceShell 刷新文件树
```

边界原则：

- `WorkspaceShell` 不订阅传输进度。
- `WorkspaceShell` 不持有传输列表 state。
- Store 只管理 UI 传输状态，不负责远程文件业务命令。
- Controller 负责任务生命周期，业务命令仍走 typed Tauri wrappers。

## Cleanup And Retention

- 所有传输任务在 finally 中移出 `runningTransferIds` 和 `transferTasks`。
- 取消排队任务会同时移出队列和 task map。
- 进度合并 timeout 在没有 pending event 时不继续存在。
- 浏览器预览和本地打包的 pulse interval 由任务函数自己清理；controller 不保留 interval。
- 历史项保留策略：
  - 手动“清理完成项”仍可用。
  - 自动裁剪已完成历史项，最多保留最近 100 条。
  - 错误历史单独最多保留最近 100 条，保留重试能力但避免失败任务无限堆积。
  - 运行中、排队中任务不因自动裁剪丢失。

## UI / UX

- 视觉结构不换风格，只维持当前紧凑桌面工具面板。
- 进度条继续显示真实进度，上传真实 100% 但尚未命令确认时显示 99% 和“等待远端确认”。
- CSS 进度动画使用 transform scaleX，避免 width 动画造成布局重排；系统 reduced-motion 开启时禁用进度过渡和无限脉冲。
- 图标继续使用 lucide。
- 颜色、边框、状态使用现有 `--mx-*` token。

## Compatibility

- 允许新增 `zustand`。选择依据：
  - MIT 许可，社区成熟。
  - 支持 vanilla store，可在 React 组件外部运行队列和事件处理。
  - 支持 selector 订阅，传输高频更新只触发传输面板/行组件。
  - API 小，不引入 UI 框架或复杂响应式体系。
- 不改变 Rust 命令和事件 payload。
- 不改变设置项 `fileTransfer.concurrentTransfers` 的语义。
- 不改变现有上传/下载、冲突策略、重试、取消、打开本地路径等用户可见语义。

## Rollback

- 新增 store/controller/panel 是前端边界改造，若出现问题，可以把传输状态调用临时退回 `WorkspaceShell` 原有 state 路径。
- 不涉及数据库、配置迁移或后端协议迁移。
