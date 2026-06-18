# 改进远程文件编辑器路径与语法高亮

## Goal

提升远程文件编辑器的路径展示和语法高亮体验：路径栏只显示远程绝对路径，不再带会话名称前缀；常见配置、脚本和源码文件能获得更准确的 Monaco 语言模式。

## Requirements

- 编辑器顶部路径栏只显示 `tab.path` 这样的远程绝对路径，例如 `/etc/containerd/config.toml`。
- 路径栏不得再显示 `<connectionName>:` 前缀；保存、刷新、关闭和脏状态逻辑不受影响。
- 扩展远程文件语言识别，覆盖常见源码、配置、脚本、服务文件和容器相关文件。
- 对 Monaco 没有默认可靠高亮的常见配置类文件，补轻量本地语言注册，不引入额外高亮库。
- 至少支持 TOML、INI/properties、Dockerfile、nginx/apache/conf、shell/env、YAML/compose、SQL、XML、Markdown、JSON、HTML/CSS/JS/TS、Python、Rust、Go、C/C++、Java、PHP、Ruby 等常见类型。
- 语言识别应优先匹配完整文件名，再匹配复合扩展名/普通扩展名。

## Acceptance Criteria

- [x] 编辑器路径栏显示 `/etc/containerd/config.toml`，不显示 `192.168.31.190:/etc/containerd/config.toml`。
- [x] `config.toml` 使用 TOML 语言模式并有基础注释、键、字符串、数字、布尔值高亮。
- [x] `Dockerfile` / `docker-compose.yml` / `.env` / `nginx.conf` 等常见文件能映射到合适语言模式。
- [x] 现有保存、重载、查找、关闭按钮仍可用。
- [x] TypeScript 类型检查通过。

## Notes

- 用户截图指出编辑器路径栏前面的会话名冗余，并且 `config.toml` 等文件高亮不足。
- 当前 `RemoteFileEditor` 路径栏使用 `${tab.connectionName}:${tab.path}`。
- 当前 `remoteFileLanguages.ts` 语言映射较少，且 Monaco 未必自带 TOML/Dockerfile 等配置语言高亮。
