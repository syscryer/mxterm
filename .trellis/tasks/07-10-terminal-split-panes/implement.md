# 终端完整分屏实施计划

## Checklist

1. 调整布局纯函数
   - 行优先 pane 顺序。
   - 四分屏保留已有 binding。
   - 增加全布局均分函数。

2. 建立分屏组子 Tab 状态
   - 保存 host、anchor index、active、focused pane。
   - 子 Tab 列表过滤组内 binding，保留组外普通 Tab。
   - 普通 Tab、分屏组 Tab 和外部连接导航可以正确切换。

3. 稳定终端渲染
   - 合并 SSH/本地终端的运行面板宿主。
   - 每个 `TerminalPanel` 只挂载一次。
   - 普通和分屏仅改变位置、visible、active 与 fit revision。

4. 完成 pane 操作
   - 同会话自动创建、空 pane 会话选择与自动展开。
   - 过滤其他 pane 已占用的会话。
   - pane 搜索、清屏、关闭。
   - 单 pane 自动退化普通 Tab。

5. 完成组级操作
   - 布局菜单与四分屏保留绑定。
   - 同步输入开关和目标选择。
   - 均分布局。
   - 关闭分屏组确认。

6. 视觉与可访问性
   - 使用现有 token 重写 pane header、焦点、空状态、同步状态和 resizer。
   - 菜单焦点、方向键、Escape 和 Tooltip。
   - 检查亮色、暗色、system-dark。

7. 验证
   - `npm run check`
   - `node scripts/check-startup-module-boundary-source.mjs`
   - `node scripts/check-terminal-startup-output-source.mjs`
   - `node scripts/check-terminal-resize-debounce-source.mjs`
   - `node scripts/check-terminal-interactive-pty-source.mjs`
   - `git diff --check`
   - 浏览器/Electron 视觉检查普通 Tab、分屏组、选择器、同步输入和窄窗口。

## Risky Files

- `src/features/layout/WorkspaceShell.tsx`
- `src/features/terminal/TerminalPanel.tsx`
- `src/features/terminal/TerminalSplitSurface.tsx`
- `src/features/terminal/terminalSplitLayout.ts`
- `src/shared/ui/AppSelect.tsx`
- `src/styles/app.css`

## Rollback Points

- 布局纯函数完成后先跑类型检查。
- 合并稳定 terminal stack 后验证 SSH、本地、Telnet、Serial 普通切换。
- 同步输入接入后单独验证只广播用户输入且失败可见。
