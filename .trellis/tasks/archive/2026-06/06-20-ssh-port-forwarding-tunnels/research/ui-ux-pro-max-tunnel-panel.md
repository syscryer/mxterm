# ui-ux-pro-max 隧道面板设计校准

## 查询

`desktop SSH terminal tunnel manager compact operations dark light tool panel`

## 结论

- 该功能属于运维工具界面，应优先保证数据密度、扫描效率和状态反馈。
- 关键状态要可读：运行、启动中、失败、需要凭据、已停止不能只靠颜色表达。
- 操作按钮应清晰分主次：新增规则是主操作；启动、停止、编辑、删除是行内操作。
- 表单必须有明确标签、错误靠近字段、提交时有 loading/disabled 状态。
- 下拉、菜单和浮层必须复用项目共享能力，不能使用原生 `<select>`。

## mXterm 落地约束

- 不采用查询结果里偏 OLED 黑绿的独立视觉体系，只吸收“运维工具、状态清晰、数据可扫描”的原则。
- 颜色、边框、背景、状态、阴影必须使用 `--mx-*` token 和 `src/styles/app.css` 共享样式。
- 隧道面板放入现有右侧工具页，与 `文件 / 传输 / 监控` 并列。
- 复用 Lucide 图标、`AppSelect`、Radix 弹窗/菜单、`Tooltip`、现有 mini-action 和表单样式。