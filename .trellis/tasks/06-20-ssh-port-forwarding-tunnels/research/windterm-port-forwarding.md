# WindTerm 端口转发参考

## 结论

WindTerm README 明确声明支持三类 SSH forwarding：

- direct/local port forwarding，本地端口转发。
- reverse/remote port forwarding，远程端口转发。
- dynamic port forwarding，动态 SOCKS 转发。

当前本地仓库搜索主要命中 `src/libssh` 的文档、头文件和实现，例如 `ssh_channel_open_forward`、`ssh_channel_listen_forward`、`ssh_channel_accept_forward`、`direct-tcpip`、`tcpip-forward`、`forwarded-tcpip` 等。未在当前开源仓库中定位到 WindTerm 自己完整的 UI/配置业务层代码。

## 对 mXterm 的启发

- mXterm 第一版不需要照 WindTerm 一次做完三类，先做本地转发即可。
- 数据模型应预留 `kind` 字段，避免后续补 `remote` 和 `dynamic` 时迁移成本过高。
- 后端应封装独立 `TunnelManager`，不要把隧道生命周期绑在终端 tab 上。
- 状态文案要保守：监听建立代表隧道本身可接入，不代表远端目标服务一定可用。

## 源码证据

- `D:\cursor_project\WindTerm\README.md:59`：支持 direct/local、reverse/remote、dynamic port forwarding。
- `D:\cursor_project\WindTerm\src\libssh\doc\forwarding.dox`：解释 direct/reverse forwarding。
- `D:\cursor_project\WindTerm\src\libssh\src\channels.c`：包含 direct-tcpip 和 tcpip-forward 相关实现。