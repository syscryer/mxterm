# X11 Forwarding

X11 Forwarding 让 SSH 服务器上的图形程序通过加密连接，在运行 mXterm 的电脑上显示窗口。入口为 **编辑 SSH 连接 → 高级 → 启用 X11 Forwarding**。保存后重新连接 SSH 生效。

mXterm 使用现有 SSH 连接和网络路径转发 X11，支持配置中的代理和跳板机。图形窗口由本机的外部 X Server 显示；应用不内置 X Server，也不把窗口嵌入终端标签。

## 本机准备

本机需要运行 X Server，并安装可用的 `xauth`。X Server 必须启用 `MIT-MAGIC-COOKIE-1` 认证，mXterm 启动环境中的 `XAUTHORITY` 应指向该 X Server 使用的认证文件。修改环境变量后需要完全退出并重新启动 mXterm。

| 平台 | Display 示例 | xauth 查找顺序 |
| --- | --- | --- |
| Windows | `127.0.0.1:0`，对应 TCP 6000 端口 | 手动路径、Program Files 下的 VcXsrv/Xming、PATH |
| Linux | `:0`，使用 `/tmp/.X11-unix/X0` | 手动路径、PATH |
| macOS / XQuartz | XQuartz 设置的 `DISPLAY`，例如 `/private/tmp/.../org.xquartz:0` | 手动路径、`/opt/X11/bin/xauth`、PATH |

Display 留空时优先读取 mXterm 进程的 `DISPLAY`；Windows 未设置时使用 `127.0.0.1:0`。显示号和屏幕号可写为 `:1.2`，IPv6 地址写为 `[::1]:0`。xauth 路径只填写可执行文件路径，不附加命令参数。

Windows 未显式设置 `XAUTHORITY` 时，mXterm 会从绝对路径的 `HOME` 或 `USERPROFILE` 拼出 `.Xauthority`，避免 VcXsrv 某些版本生成无盘符路径并随当前工作盘变化。若出现认证文件路径或权限错误，请在连接配置中填写绝对路径，例如 `C:\Users\<用户名>\.Xauthority`，修改后完全退出并重启 mXterm。

Windows 的 X Server 需监听本机 TCP。以下 PowerShell 示例为 VcXsrv 创建独立认证文件，然后启动一个带认证的 display 0。先确认没有其他 X Server 占用 display 0，并按安装位置调整路径：

```powershell
$x11Bin = Join-Path $env:ProgramFiles 'VcXsrv'
$x11Authority = Join-Path $env:LOCALAPPDATA 'mxterm-x11-authority'
$x11Bytes = New-Object byte[] 16
$x11Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$x11Rng.GetBytes($x11Bytes)
$x11Rng.Dispose()
$x11Cookie = -join ($x11Bytes | ForEach-Object { $_.ToString('x2') })
"add 127.0.0.1:0 MIT-MAGIC-COOKIE-1 $x11Cookie" |
  & "$x11Bin\xauth.exe" -f $x11Authority
if ($LASTEXITCODE -ne 0) { throw 'xauth 创建认证文件失败' }
$env:XAUTHORITY = $x11Authority
$env:DISPLAY = '127.0.0.1:0'
& "$x11Bin\vcxsrv.exe" :0 -multiwindow -clipboard -listen tcp -auth $x11Authority
# 在同一个 PowerShell 窗口中启动已安装的 mXterm.exe，使其继承以上环境变量。
```

保留 X Server 的访问控制，Windows 防火墙限制外部主机访问其端口。不要用 `-ac` 或 `xhost +` 关闭认证。认证文件包含本地会话密钥，不应分享或提交到仓库。

Linux 桌面和 XQuartz 通常已配置好 `DISPLAY`、`XAUTHORITY`。从能正常运行本地 X11 程序的环境启动 mXterm，可继承这些变量。Wayland 桌面需要 XWayland。Windows 版不会自动连接 WSLg 的 Linux Unix socket。

## SSH 服务端准备

服务端需要安装 `xauth`，并允许 SSH X11 转发。由服务端管理员确认生效配置包含：

```text
X11Forwarding yes
X11UseLocalhost yes
```

`Match` 规则、账户限制或服务器的其他转发策略也可能拒绝请求。远程服务器无需安装桌面环境，但要有准备运行的 X11 程序及其依赖。

连接后在远端执行：

```sh
printf '%s\n' "$DISPLAY"
xclock
```

`xclock` 仅作为示例，需在远端安装。远端 `DISPLAY` 通常类似 `localhost:10.0`，由 SSH 服务端生成；不要手动把它改成本机设置中的 `127.0.0.1:0`。

## 访问权限

- **非信任（-X）**：默认选项。通过 X Server 的 SECURITY 扩展生成受限授权；远端图形程序访问本地会话的能力受限，部分程序可能不兼容。连接建立约 20 分钟后拒绝新的 X11 连接，已建立的图形连接继续运行。需要启动新程序时重新连接 SSH。
- **信任（-Y）**：使用本地完整授权，远端图形程序可以访问本地 X 会话。仅为可信主机启用。

非信任授权生成失败时，连接会明确报错，不自动切换为信任模式。可先用本地 `xdpyinfo -queryExtensions` 检查 SECURITY 扩展是否存在。

## 排查错误

| 错误代码 | 检查项 |
| --- | --- |
| `x11_display_missing` / `x11_display_invalid` | 本机 Display 是否填写正确，应用是否继承 DISPLAY |
| `x11_xauth_start_failed` | xauth 是否安装，可执行文件路径是否正确 |
| `x11_cookie_missing` | XAUTHORITY 是否指向正确文件，其中是否有当前 Display 的 MIT Cookie |
| `x11_local_connect_failed` / `x11_local_connect_timeout` | 本机 X Server 是否启动，Display 对应端口或 socket 是否可达 |
| `x11_local_auth_rejected` | X Server 与 xauth 是否使用同一份认证文件 |
| `x11_untrusted_failed` | X Server 是否支持 SECURITY；只有可信主机才考虑使用信任模式 |
| `x11_request_denied` / `x11_request_timeout` | SSH 服务端是否允许转发、是否安装 xauth，检查 sshd 日志 |
| `x11_auth_rejected` | 远端程序是否使用当前 SSH 会话的 DISPLAY 和认证文件 |
| `x11_auth_expired` | 非信任授权到期，重新连接 SSH 后启动新程序 |
| `x11_channel_limit` | 同一 SSH 会话已占用 32 条 X11 连接，关闭多余图形客户端 |

开启 X11 后，本机准备失败或服务端拒绝会阻止本次 SSH 连接；取消勾选可建立普通 SSH 终端。连接建立后的转发错误显示在对应终端中，以 `[X11 错误代码]` 开头，不把单个图形程序失败当成 SSH 断开。

## 实现与验证边界

每次 SSH 会话使用随机转发 Cookie，远端只能拿到这个临时值。本地真实 Cookie 在验证 X11 首包后替换，不保存到连接配置、发送给远端或写入日志。非信任模式使用独立临时认证文件，不修改用户原有认证；Unix 临时目录权限为 0700。关闭 SSH 会话会终止其全部 X11 转发。

自动化覆盖 X11 首包验证、大小端与分片、错误 Cookie 在本地连接前被拒绝、双向 TCP 数据转发、SSH 服务端接受/拒绝、取消与限流，以及配置存储和加密迁移。浏览器验收覆盖配置保存后重开、亮色、暗色和跟随系统暗色。完整的外部 X Server、真实 xauth SECURITY 授权和远端图形窗口仍需在目标平台实机验收。
