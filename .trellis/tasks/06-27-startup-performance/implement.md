# 启动速度优化实施计划

1. 收集证据 `[done]`
   - 查看 `main.tsx`、`App.tsx`、`WorkspaceShell.tsx` 的启动 import 和初始化 effect。
   - 构建前后对比 `dist/assets` 初始 chunk 和懒加载 chunk。

2. 入口拆分 `[done]`
   - 将 `App.tsx` 改为根据 URL 动态加载主工作区或 VNC runner。
   - 保留 `tokens.css` / `app.css` 静态加载，确保启动主题和基础样式稳定。
   - `main.tsx` 等窗口状态恢复后渲染轻量 `App`，不再等待 `WorkspaceShell` chunk 解析完成才显示窗口。

3. 工作区模块拆分 `[done]`
   - 把非首屏重型面板改为 lazy import。
   - 在使用点包裹 `Suspense` fallback，fallback 使用共享/token 化样式。
   - `TerminalPanel` / xterm 相关代码已拆成独立 chunk，终端加载 fallback 复用现有状态面板。

4. 空闲初始化检查 `[done]`
   - 检查终端配色、profile 探测、Windows PTY 信息等 effect 是否过早阻塞首屏。
   - 只做低风险延后，不改变功能结果。

5. 验证 `[done]`
   - `node scripts/check-startup-module-boundary-source.mjs`
   - `npm run check`
   - `npm run build`
   - `git diff --check`
   - 检查 `git status --short`，确认临时日志和敏感文件未被纳入。

## Build Evidence

- `App-*.js`: 1.68 kB
- `WorkspaceShell-*.js`: 368.00 kB
- `TerminalPanel-*.js`: 409.27 kB
- `ConnectionSearchDialog-*.js`: 3.57 kB
- `SettingsView-*.js`: 71.75 kB
- `DockerToolPanel-*.js`: 62.39 kB
- `RemoteFilePanel-*.js`: 29.91 kB
- `RemoteFileEditor-*.js` and Monaco workers remain lazy editor chunks.
