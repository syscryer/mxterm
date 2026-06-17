# SFTP file transfer resume and cancellation

## Goal

把远程文件上传/下载从 exec 管道和 tar 临时归档为主的实现，改为基于 SFTP 的流式传输。大文件和目录传输必须有准确总大小、稳定进度、可取消，并支持通过 `.mxpart` 临时文件断点续传。

## Requirements

- 单文件上传和下载使用 SFTP 流式读写，不把大文件整体读入内存。
- 目录上传和下载使用 SFTP 文件队列逐文件传输，保留目录结构，整体进度以全部文件字节数计算。
- 每个传输任务用 `transfer_id` 关联后端进度事件，事件包含已传输字节和总字节数。
- 运行中的上传/下载可以取消；取消后保留可续传的 `.mxpart` 临时文件。
- 再次传输同一目标时，如果存在有效 `.mxpart`，从已有字节位置继续。
- 冲突策略继续支持 ask/skip/overwrite/rename，前端预检和后端最终落点保持一致。
- 浏览器预览逻辑可以保留模拟行为，但 Tauri 真实路径必须使用后端真实进度。
- 不自动提交或推送，所有改动等待人工审核。

## Acceptance Criteria

- [ ] 1.3G 级别单文件下载显示总大小，进度不虚高，内存不随文件大小线性暴涨。
- [ ] 单文件上传进度只由真实 SFTP 事件驱动，不再出现 pulse 和真实进度互相覆盖。
- [ ] 目录上传/下载显示整体总大小和稳定进度，不依赖远端 tar 解压或本地 tar 解包。
- [ ] 运行中传输面板显示取消按钮，取消后后端传输停止，UI 状态变为已取消。
- [ ] 取消后的同一路径再次传输可以从 `.mxpart` 续传。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml remote_files --lib` 通过。
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- [ ] `pnpm check` 通过，或明确记录现有非本任务阻塞。

## Notes

- 优先借鉴 WinSCP 的稳定思路：传输到临时 part 文件，完成后原子 rename 到最终文件；取消和失败不删除 part 文件，便于续传。
