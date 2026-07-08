# 远程文件传输性能隔离实现计划

## Checklist

1. 创建传输 store：
   - 抽出传输类型。
   - 引入 `zustand`。
   - 使用 vanilla store + selector hook 提供增删改查、批量进度应用。
   - 加入 finished 历史裁剪。
2. 创建传输控制器 hook：
   - 抽出队列、运行集合、任务 map。
   - 接入并发数变化。
   - 暴露 add/update/setProgress/fail/finish/cancel/retry/clear/remove 等动作。
3. 拆出 `RemoteFileTransferPanel`：
   - 面板自己订阅 store。
   - 保持现有 class 和 UI。
   - 提供操作回调给 controller。
4. 精简 `WorkspaceShell`：
   - 移除传输列表 state 和进度事件 effect。
   - 保留上传/下载业务函数，但改为调用 controller/store。
   - 保留完成后的文件树刷新。
5. 处理残留：
   - 检查 task map、queue、running set、pending progress timeout。
   - 检查 retry 和取消路径。
   - 检查完成项和错误项自动裁剪不会移除运行中、排队中任务。
   - 检查取消/失败后的晚到成功结果不会覆盖当前状态。
6. 验证：
   - `npm run check`
   - `node scripts/check-startup-module-boundary-source.mjs`
   - `node scripts/check-remote-file-editor-source.mjs`
   - 必要时补跑 `npm run build`，但除非改动导致 bundling 风险，默认不做完整构建。

## Risky Files

- `src/features/layout/WorkspaceShell.tsx`
- `src/features/files/remoteFileTypes.ts`
- `src/features/files/RemoteFileTransferPanel.tsx`
- `src/features/files/remoteFileTransferStore.ts`
- `src/features/files/useRemoteFileTransferController.ts`
- `src/styles/app.css`

## Review Gates

- 不新增外部依赖。
- 若新增依赖，仅允许 `zustand`，并确认 `package.json` / lockfile 改动可审查。
- 不复制外部 GPL 代码。
- `WorkspaceShell` 中不能再出现高频传输列表 state。
- `remote_file:transfer_progress` 监听应只在传输模块内出现。
- 传输面板的 props 不应携带整个传输列表从 shell 下发。
