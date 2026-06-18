# 修复 TUI 中文 IME 输入光标错位：接入 xterm unicode11 宽度判定

## Goal

ConPTY 下 TUI 输入中文时光标跑到错误列，英文正常。根因是 xterm 默认 Unicode 6 宽度表与 ConPTY(Windows Unicode 8+)对 CJK/全角字符宽度判定不一致，IME composition 期间光标定位错乱。方案 A：接入 @xterm/addon-unicode11，对齐宽度表。allowProposedApi 已开启。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
