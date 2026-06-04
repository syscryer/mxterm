# mXterm

mXterm 是一个个人桌面 SSH/SFTP 客户端项目，首版目标是提供连接管理、SSH 终端、SFTP 上传下载、传输队列和远程文件编辑能力。

## 当前文档

- [需求文档](docs/requirements/m-xterm-requirements.md)
- [宽松协议开源项目参考](docs/research/permissive-open-source-references.md)

## Trellis

后续项目开发使用 Trellis 管理。

当前仓库已包含 `trellis.hjson`，配置了基础工作流：

- `docs-check`：检查需求和研究文档中的占位词。
- `git-status`：查看当前分支和工作区状态。

安装并启动 Trellis 后，可以在项目根目录执行：

```powershell
trellis -config trellis.hjson
trellis-ctl -json workflow list
trellis-ctl -json workflow run docs-check
```

当前项目还没有 Tauri/React 脚手架，开发、检查、测试、打包相关工作流会在脚手架创建后补充。
