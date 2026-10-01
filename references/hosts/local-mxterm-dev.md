name: "local-mxterm-dev"
status: running
last_verified: "2026-10-01 23:25 Asia/Singapore"
source: "terminal/UI"
owner_or_scope: "local/private"

host:
  address: "127.0.0.1"
  hostname: "localhost"
  os: "Windows"
  ssh:
    connection_name: ""
    username: ""
    password: ""
    verified: false

runtime:
  deployment_type: "bare-metal"
  container: ""
  image: ""
  version: "0.1.20"
  workdir: "D:/ai_proj/mXterm/m-xterm"
  mount_or_data_paths: []

endpoints:
  - name: "Vite dev server"
    address: "http://localhost"
    port: "5520"
    protocol: "http"
    purpose: "Tauri frontend development server"

authentication: []

services:
  - name: "mXterm Tauri dev"
    dependency_order: 1
    status: "running"
    start_command: "npm run tauri:dev"
    stop_command: "Ctrl+C in the dev terminal"
    health_check: "Get-Process -Name m-xterm; Get-NetTCPConnection -LocalPort 5520"

operations:
  install: "npm install"
  start: "npm run tauri:dev"
  stop: "Ctrl+C in the dev terminal"
  restart: "Ctrl+C, then npm run tauri:dev"
  upgrade: "unknown"
  backup_before_change: "not applicable"

validation:
  command: "Get-Process -Name m-xterm; Get-NetTCPConnection -State Listen -LocalPort 5520"
  expected_result: "MXterm window process and localhost:5520 listener are present"
  last_result: "passed; restarted dev PID 47244 from src-tauri/target/debug/m-xterm.exe, Vite PID 49484 listening on localhost:5520"

known_failures: []

notes:
  - "An older installed m-xterm.exe instance may also be running; the verified dev instance is the executable under src-tauri/target/debug."
