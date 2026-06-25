# Windows RDP Manager Source Notes

## Scope

This note records product and implementation observations from a local GPL-3.0 Windows RDP manager source checkout for mXterm RDP planning. mXterm may use product behavior and implementation shape as research input, but must not copy GPL code.

Local checkout:

`D:\ai_proj\_refs\rdp\1Remote`

## Key Findings

- The researched RDP support is Windows-native. It does not implement the RDP protocol itself.
- The hosted/in-tab path uses the Windows MSTSC ActiveX control through `mstscax.dll` wrappers.
- The hosted path creates `AxMsRdpClient9NotSafeForScripting` and embeds it in a WPF host.
- It sets connection fields directly on the ActiveX client: server, port, domain, username, password, CredSSP, display, redirection, gateway, and performance settings.
- Local Windows registration can expose both ordinary `MsTscAx.MsTscAx.*` controls and redistributable `MsRDP.MsRDP.*` controls. The embedded path should treat a control as selected only after required properties can be written, because an ordinary registered control may be creatable but still reject configuration in the current host.
- It also supports an explicit external mode, which writes a temporary `.rdp` file and starts `mstsc.exe "<file.rdp>"`.
- External mode is used when the user enables it manually.
- External mode is also chosen for full-screen multi-monitor sessions when displays have different scale factors, because embedded ActiveX has compatibility issues there.
- The `.rdp` file path supports additional raw RDP file settings, letting users access settings that are not exposed by the embedded host.
- RemoteApp also goes through `.rdp` file generation plus `mstsc`.

## Relevant Files

- `Ui\Service\SessionControlService_OpenConnection.cs`
  - `ConnectRdpByMstsc` writes the temp `.rdp` file, launches `mstsc.exe`, and schedules temp file deletion.
  - Connect dispatch chooses the external path when `RDP.IsNeedRunWithMstsc()` returns true.
- `Ui\Model\Protocol\RDP.cs`
  - Stores RDP fields such as domain, display mode, resolution, redirection switches, audio, gateway, and raw additional settings.
  - `ToRdpConfig()` maps the model into `.rdp` file settings.
  - `IsNeedRunWithMstsc()` returns true for explicit external mode and for multi-monitor mixed-scale fullscreen cases.
- `Ui\Utils\RdpFile\RdpConfig.cs`
  - Serializes/deserializes RDP file settings.
  - Uses Windows data protection for the `password 51:b:` field.
  - Merges raw additional settings into the generated `.rdp` content.
- `Ui\View\Host\ProtocolHosts\AxMsRdpClient09Host.xaml.cs`
  - Hosts the ActiveX RDP client, applies connection settings, redirect settings, gateway settings, performance settings, and resizing logic.
- `Ui\Model\ProtocolRunner\RunnerHelper.cs`
  - Routes RDP to the hosted ActiveX runner for the built-in hosted path.

## mXterm Takeaways

- Aggressive v1 should design the final RDP model now: embedded-capable runner abstraction, external fallback, raw `.rdp` extension point, and platform capability probing.
- Windows should target embedded RDP tabs where technically feasible and fall back to `.rdp` + `mstsc.exe` for compatibility cases.
- Linux/macOS should still use the same connection model, resolving to external/custom runners.
- Mixed monitor DPI is a real reason to keep an external fallback even when embedded Windows hosting works.
- Credential handling needs explicit mXterm security boundaries. Avoid plaintext command-line passwords and avoid writing plaintext secrets to `.rdp` files.
