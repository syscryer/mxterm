# Implementation Plan

1. 读取现有右侧工具面板、Tauri command wrapper、SSH exec session、确认弹窗和 tooltip/button 样式。
2. 新增 Docker 后端类型和 Tauri commands：
   - 容器列表
   - 镜像列表
   - 容器操作
   - 镜像拉取/删除
   - 容器日志
   - 镜像拉取进度事件
3. 在 `src/shared/tauri/commands.ts` 增加 typed wrappers 和前端类型。
4. 新增 `DockerToolPanel`，实现工具 tab 外壳、Docker 容器/镜像视图、网络/定时占位。
   - 拉取镜像提交后在镜像列表显示临时进度行，成功后刷新真实镜像列表，失败时保留失败行。
5. 将 `RemoteFilePanel` 右侧一级工具接入 `tools`，并从 `WorkspaceShell` 传入当前连接和 Docker 操作回调。
6. 实现进入容器终端：
   - 创建当前连接的新 SSH 终端 tab。
   - 连接成功后写入 `docker exec -it <container> sh`。
   - 如果后续要自动探测 bash，再单独优化。
7. 更新 CSS，使用现有 `--mx-*` token 和共享按钮/列表风格。
8. 更新前后端 command contract spec。
9. 验证：
   - `npm run check`
   - Rust 代码格式检查/相关测试按需要运行。
   - `git diff --check`

## Review Gates

- 后端命令不得接收明文 SSH 凭据。
- 所有 Docker 参数必须 shell quote。
- 删除动作必须确认。
- 网络诊断/定时任务本轮只占位，不写后端命令。
