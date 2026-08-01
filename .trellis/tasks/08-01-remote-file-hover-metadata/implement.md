# 远程文件悬浮信息实施计划

1. 扩展远程条目元数据契约。
   - 在 Rust `RemoteFileEntryMetadata` 和 TypeScript `RemoteFileEntryMetadata` 中加入 owner/uid/group/gid/birthtime 可空字段。
   - 更新 GNU/BSD `stat` 命令和 NUL 解析，保持路径 shell quoting，不使用 `ctime`。
   - 更新 browser preview 元数据生产者和现有属性视图字段格式。

2. 先补后端契约回归测试。
   - 覆盖完整 owner/group/birthtime 输出。
   - 覆盖 birth time 为 `0`、名称缺失但 UID/GID 存在、可选字段为空。
   - 断言命令包含 GNU/BSD fallback、NUL 分隔和安全引用，不包含把 `%Z`/`ctime` 当创建时间的逻辑。

3. 实现单实例悬浮信息表面。
   - 为共享 `AnchoredSurfacePortal` 增加向左/向右放置和空间回退，保持现有菜单默认定位不变。
   - 新增 feature 内 `RemoteFileInfoTooltip`，实现紧凑定义列表、加载/错误状态和格式化回退。
   - 在 `RemoteFilePanel` 中接入 hover/focus 延迟、锚点、Escape/离开关闭和 `aria-describedby`，删除行上的原生 `title`。

4. 实现请求合并、缓存与失效。
   - 缓存键包含连接和规范化路径，同一路径 loading 请求只执行一次。
   - 连接切换清空缓存和可见浮层；强制目录刷新使目标目录树的缓存失效。
   - 完成请求前校验目标，防止快速移动或连接切换导致元数据串线。

5. 落实 token 驱动样式与主题。
   - 在 `src/styles/app.css` 增加固定宽度、路径换行、紧凑行距和加载/错误状态样式。
   - 复用 `ui-tooltip` / 全局 glass token；检查亮色、显式暗色和 system-dark，不写 feature 硬编码色或阴影。

6. 添加并运行针对性验证。
   - Rust: `cargo test --manifest-path src-tauri/Cargo.toml remote_files::tests`
   - TypeScript: `npm run check`
   - 启动边界: `node scripts/check-startup-module-boundary-source.mjs`
   - 构建: `npm run build`，确认远程文件/编辑器等重模块未合并回首屏 chunk。
   - 增加源级回归检查，至少断言文件行不再含原生路径 `title`、单实例浮层接入和扩展契约字段未漂移。
   - 使用浏览器预览或桌面运行态检查 hover 延迟、快速扫过、键盘聚焦、Escape、刷新失效、长路径、加载/错误、文件夹无大小，以及三种主题。

## Risk And Rollback Points

- `src-tauri/src/remote_files.rs` 的 NUL 字段顺序是前后端契约关键点；先用 Rust 测试锁定再接 UI。
- `AnchoredSurfacePortal` 已被多个菜单使用；新增 side 能力必须保持省略参数时的现有上下定位和尺寸行为。
- `RemoteFilePanel` 已有点击、多选、拖拽、右键和展开状态；hover 监听不得阻止或重排这些事件。
- 若在途请求无法取消，只丢弃过期展示结果，不中断共享 SSH exec session。

## Review Gate

- 用户审核 `prd.md`、`design.md`、`implement.md` 后，才运行 `task.py start` 进入实现。
