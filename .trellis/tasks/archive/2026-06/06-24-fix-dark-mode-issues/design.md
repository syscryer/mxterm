# 修复暗色模式视觉问题设计

## Scope

本任务是视觉一致性修复，不改业务数据流。优先覆盖用户截图中的三个区域：

- 远程监控面板：`src/features/monitor/monitor.css`
- 设置页和共享设置控件：`src/styles/app.css`
- 命令操作台：`src/styles/app.css` 中 `.command-sender-*` 相关规则

## Root Cause

现有暗色主题已经通过 `src/styles/tokens.css` 提供了 `--mx-bg`、`--mx-panel`、`--mx-panel-soft`、`--mx-line`、`--mx-text` 等基础 token，但部分 feature CSS 在浅色主题开发阶段写入了固定浅色值。

这些固定值在深色主题下不会随 token 变化，导致深色容器里出现浅色 tile、浅色图表和浅色输入框。根因是样式源头未使用语义 token，而不是 React 状态或监控数据错误。

## Approach

采用“先语义化，再补暗色覆盖”的保守方案：

1. 能直接替换为 token 的浅色值，改为 `var(--mx-panel)`、`var(--mx-panel-soft)`、`var(--mx-line-soft)`、`var(--mx-active)` 或 `color-mix()`。
2. 需要 light/dark 差异的图表、进度条、告警背景等，新增局部 CSS 变量，并在深色主题和 system-dark 规则里改变量值。
3. 共享设置控件和命令操作台尽量改现有规则，不新增 feature 私有重复控件。
4. 对 `data-theme-mode="dark"` 和 `@media (prefers-color-scheme: dark) .app-shell[data-theme-mode="system"]` 保持等价覆盖。

## Visual Rules

- Dense desktop tool surfaces should be opaque enough for readability.
- Dark cards should sit on `--mx-panel` or `--mx-panel-soft`, with borders from `--mx-line` / `--mx-line-soft`.
- Secondary text should use `--mx-muted` or `--mx-subtle`, not low-alpha white on unknown backgrounds.
- Accent colors stay semantic: `--mx-primary` for active/focus, `--mx-success` for online/healthy, `--mx-warning` for hot utilization, `--mx-danger` for error.
- Charts should use dark panel backgrounds, subtle grid lines, token-derived line colors, and low-alpha area fills.
- Disabled buttons must remain recognizable as disabled, not disappear into the panel.

## Compatibility

- Light mode remains the baseline for existing users. Token replacements must be checked in both light and dark screenshots or DOM inspection.
- The existing window material model stays chrome-focused; dense work surfaces should not become transparent acrylic panels.
- Do not touch monitor collection, terminal write behavior, settings persistence, or command sending logic.

## Risk

- `app.css` is large and shared across many features, so broad selectors can have unintended effects. Keep selectors scoped to visible settings/command-sender classes or existing dark-mode override blocks.
- `monitor.css` is feature-scoped and safer, but replacing all hardcoded colors at once could alter light mode. Prefer semantic CSS variables with light defaults where needed.
- System-dark duplication can drift from explicit dark mode. Keep the override selectors grouped or identical where possible.
