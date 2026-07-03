# 修复终端目录定位 prompt 纠偏

## Goal

Improve remote folder locating when `OSC 7` is absent by reading a
high-confidence shell prompt path from already-rendered xterm content only when
the user clicks the locate action.

## Requirements

- Keep `OSC 7` as the most trusted current-directory signal.
- Add a passive prompt parser for common shell prompt lines such as
  `root@host:/opt/app#` and `user@host:/var/www$`.
- Use prompt-derived paths only as a locate-time snapshot fallback so the
  remote-file locate action can reveal the actual folder after a failed or
  successful `cd`.
- Do not write probe commands to the terminal, modify remote shell startup, hide
  output, filter banner text, or otherwise change PTY semantics.
- Do not subscribe extra prompt parsing work to the live terminal output path;
  locating should inspect only a small xterm buffer snapshot on demand.
- Keep parsing conservative: ignore non-absolute paths other than `~` and only
  accept prompt-like lines with a trailing prompt marker.

## Acceptance Criteria

- [x] A prompt line like `root@orangepi4pro:/opt/ccr#` updates the recorded
      terminal directory to `/opt/ccr`.
- [x] A root-home prompt like `root@host:~#` resolves to `/root` when the
      connection username is `root`.
- [x] Ordinary command output and failed `cd` error text are ignored.
- [x] Existing `OSC 7` parsing and conservative typed-`cd` fallback continue to
      pass their current checks.
- [x] Clicking the file-panel locate action may inspect a few already-rendered
      xterm rows for a prompt path, but idle terminal rendering does not gain a
      new prompt-output parsing pass.
- [x] The file-panel boundary check still proves the implementation does not
      inject current-directory probe commands.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
