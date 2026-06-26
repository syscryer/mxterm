# 修复终端 resize 拖动鬼影：fit 防抖与前后端尺寸同步

## Goal

拖动窗口时 xterm 出现重复字符/鬼影。codex 只防抖了后端 IPC，fit() 仍逐帧同步调用导致画布错位。修复：fit() 与后端同步共用同一防抖节拍，消除前后端 240ms 尺寸不一致窗口。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
