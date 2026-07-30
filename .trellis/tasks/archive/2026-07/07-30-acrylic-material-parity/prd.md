# 统一 Acrylic 材质表现

## Goal

让 mXterm 在 Windows 亮色、暗色与 system-dark 下的 Acrylic 窗口材质保持稳定、克制和可读，并与 CodeM 已验证的 Acrylic 视觉语义一致：桌面壁纸可被感知，但不会以高饱和色块直接污染标题栏和左侧导航。

## Requirements

- 保留 Windows 原生 Acrylic backdrop，不改现有材质 id、Tauri 命令契约或设置入口。
- Acrylic 的调整必须通过 `src/styles/tokens.css` 的全局 `--mx-*` token 落地，不能在业务组件中增加私有颜色或一次性覆盖。
- 亮色 Acrylic 使用中性冷白遮罩抑制壁纸高饱和色穿透，同时保留原生模糊质感。
- 暗色 Acrylic 使用中性深灰遮罩，并与显式 dark、system-dark 保持一致。
- 标题栏与 `.app-sidebar` 继续读取同一根材质层，保持连续的 Acrylic chrome；主工作区、设置内容和终端等高信息密度区域继续使用可读的面板表面。
- 不改变 Mica、Mica Alt、macOS glass 或 Auto 的视觉语义，除非实现一致性确实要求共享 token 的机械调整。
- 不把 CodeM 的产品布局、组件样式或业务文案迁入 mXterm，仅对齐 Acrylic 材质策略。

## Acceptance Criteria

- [ ] 在亮色 Acrylic 下，标题栏和左侧导航仍能看到壁纸的模糊色彩，但不会出现截图中大面积高饱和紫红、蓝绿穿透。
- [ ] 左侧导航的主文本、次级文本、图标、树连接线和计数在浅色与复杂壁纸上保持清晰层级。
- [ ] 显式暗色与 system-dark 的 Acrylic token 结果一致，不出现纯黑实心侧栏或壁纸颜色过度穿透。
- [ ] 主工作区、设置内容、表单、终端和弹窗维持现有可读面板层级，不被 Acrylic 透明化。
- [ ] Mica、Mica Alt、Auto 和 macOS 材质未发生非预期视觉回归。
- [ ] 相关 token/材质测试、启动模块边界检查和前端构建通过。
- [ ] 在 Windows 亮色与暗色下使用实际桌面窗口截图验证 Acrylic 效果。

## Confirmed Facts

- CodeM 与 mXterm 的 Windows Acrylic 都使用原生材质 id `3`，窗口均为透明；原生层不是当前差异来源。
- CodeM 的 Acrylic 根遮罩为亮色 `rgba(238, 242, 248, 0.62)`、暗色 `rgba(30, 31, 34, 0.64)`，根层使用 `72px` blur。
- mXterm 的 Acrylic `--mx-chrome-fill` 当前在亮色为 `0%` alpha，根 `.app-shell::before` 因此基本直接暴露原生 Acrylic；`--mx-material-bg` 还叠加了与主色相关的径向渐变。
- mXterm 的后置主题适配已经明确要求标题栏和侧栏共享根材质，主内容使用不透明 `--mx-panel`，结构无需重做。
- 截图显示 mXterm Acrylic 的壁纸色彩穿透显著强于 CodeM，并降低了侧栏次级文字与图标的对比度。

## Out of Scope

- 调整连接树布局、字体、图标或分组结构。
- 重做所有浮层、弹窗和卡片的玻璃样式。
- 修改 Windows 原生 Acrylic API、材质枚举或持久化数据模型。

## Confirmed Decision

- Acrylic 严格采用 CodeM 已验证的中性遮罩参数，不保留更高的桌面通透度：亮色 `rgba(238, 242, 248, 0.62)`，暗色 `rgba(30, 31, 34, 0.64)`，根材质层使用 `72px` blur。
- 显式 dark 与 system-dark 使用同一组 Acrylic 参数；本次只调整 Acrylic，不改变 Mica、Mica Alt、Auto 和 macOS glass。
