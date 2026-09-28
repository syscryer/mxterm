; mxterm-mcp.exe 会被外部 MCP 客户端（ZCode 等）长期驻留，导致安装/更新/卸载
; 写入文件时报 "Error opening file for writing"。在复制/删除文件前先强制结束
; 这些进程；taskkill 在进程不存在时返回非零码，此处不视为安装失败。
; 与应用内 mcp_prepare_for_update 的 terminate_external_mcp_processes 行为保持一致。

!macro MXTERM_STOP_MCP_PROCESSES
  nsExec::ExecToLog 'taskkill /F /T /IM mxterm-mcp.exe'
  Sleep 300
  nsExec::ExecToLog 'taskkill /F /T /IM mxterm-mcp.exe'
  Sleep 200
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MXTERM_STOP_MCP_PROCESSES
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MXTERM_STOP_MCP_PROCESSES
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
