# 添加 MIT License

## Goal

用标准 MIT License 明确 mXterm 的公开使用、复制、修改和分发边界，并让 README 与仓库事实一致。

## Dependencies

- 无兄弟任务依赖，可独立实现和验收。
- 不得修改发布 workflow、Cargo/package 元数据或系统签名配置。

## Requirements

- 在仓库根目录新增标准 MIT License 全文。
- 版权行使用 `Copyright (c) 2026 mXterm contributors`。
- 将 README “许可”段落从“尚未加入 LICENSE”改为明确链接和 MIT 说明。

## Acceptance Criteria

- [x] 根目录 `LICENSE` 与标准 MIT 文本一致，年份和版权主体正确。
- [x] README 的许可说明链接到 `LICENSE`，不再声称许可证缺失。
- [x] `git diff --check` 通过且没有改动发布、签名或业务代码。

## Validation Evidence

- 2026-08-01: verified the standard MIT text and `Copyright (c) 2026 mXterm contributors` in the root `LICENSE`.
- 2026-08-01: verified the README license link and passed `git diff --check` plus `npm run test:release` (12/12), with no release or signing workflow changes.
