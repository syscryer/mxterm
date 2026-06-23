# Permissive Docker UI Tools

## Goal

筛选可用于产品思路和交互结构分析的 Docker UI/TUI 项目。只记录宽松协议项目；不复制代码。

## Projects

| Project | License | Useful Ideas |
| --- | --- | --- |
| Portainer CE | zlib | 完整 Docker 资源分类：容器、镜像、卷、网络、日志、控制台和危险操作确认。适合观察资源覆盖范围。 |
| lazydocker | MIT | 高密度容器/镜像/日志/状态组合，适合观察紧凑操作模型和键盘效率思路。 |
| Dockge | MIT | 日志、Web terminal 和 stack 操作联动顺手，但重点是 compose/stack，本轮只吸收“日志/终端入口清晰”的思路。 |
| Yacht | MIT | 轻量容器管理和应用模板，适合观察更简单的信息层级。 |
| ctop | MIT | 容器实时指标视图，适合后续 stats/资源监控扩展。 |
| dockly | MIT | TUI 容器管理，适合观察快捷动作和日志入口。 |
| Podman Desktop | Apache-2.0 | 桌面端 containers/images 页面结构可作为信息层级分析材料，但产品体量较大，不适合作为 mXterm 第一版结构。 |
| Rancher | Apache-2.0 | 偏 Kubernetes/平台管理，范围太重，本任务不作为主要分析对象。 |

## Design Takeaways For mXterm

- mXterm 应保持“SSH 远端工具”定位，不做 Docker Desktop 或 Portainer 替代品。
- 第一版只覆盖容器、镜像、日志和进入容器终端。
- 危险操作必须显式确认；不做批量危险操作。
- 列表要比 Portainer 更紧凑，接近 lazydocker/ctop 的扫描效率，但保留桌面工具按钮和 tooltip。
- 未来网络诊断和定时任务应进入同一个“工具”tab，不再增加新的右侧一级入口。
