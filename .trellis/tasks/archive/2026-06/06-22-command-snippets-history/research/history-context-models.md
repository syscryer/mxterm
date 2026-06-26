# External command history models

## Scope

This note reviews permissively licensed command-history tools for product and data-model signals only. No external source code is copied.

## Atuin

- License: MIT.
- Shape: shell history replacement with SQLite-backed local history and optional encrypted sync.
- Useful data signals:
  - command text
  - working directory
  - host / machine context
  - session context
  - exit status
  - duration
  - timestamp
- Product signals:
  - `Ctrl+R` style history search is the primary interaction.
  - History is useful because it has context, not only because it has recent commands.
  - Filtering sensitive commands is part of the model rather than only a UI concern.

## McFly

- License: MIT.
- Shape: shell history search with ranking that considers context.
- Useful data signals:
  - command text
  - current directory
  - recency
  - frequency
  - previous execution result
- Product signals:
  - Search ranking should favor what is likely useful now, not only newest-first.
  - Exact command dedupe is reasonable, but frequency and recent use both need to survive.

## Fit for mXterm

Current mXterm history records only Command Sender deliveries. That remains safe and clear for this task, but it is intentionally thin compared with shell-history tools.

Recommended next step is not to inject shell hooks yet. For an SSH client, automatic remote shell integration is intrusive and can break across bash, zsh, fish, PowerShell, busybox shells, sudo prompts, and TUI programs.

If mXterm expands beyond active-send history, prefer a two-tier model:

1. Active send history
   - Source: Command Sender and command snippets.
   - Trust level: high.
   - Record after at least one terminal write succeeds.
   - Current implementation already matches this.

2. Terminal input history
   - Source: user input captured at Enter in xterm.
   - Trust level: medium.
   - Default: disabled or clearly separated until accuracy is proven.
   - Record only completed printable lines.
   - Drop the current line when control sequences, function keys, cursor navigation, TUI-like input, or suspicious password prompts are detected.
   - Mark source as `terminal_input`.

## Suggested data-model evolution

Keep `command_history.command` unique for now, but add context fields before trying advanced ranking:

- `source`: `command_sender` | `snippet` | `terminal_input`
- `use_count`
- `last_used_at`
- `created_at`
- `target_count`
- `append_enter`
- later optional fields:
  - `connection_id`
  - `connection_name_snapshot`
  - `remote_host_snapshot`
  - `remote_username_snapshot`
  - `cwd`
  - `exit_code`
  - `duration_ms`
  - `sensitive`

Do not add `exit_code` / `duration_ms` until there is a reliable shell integration path. Guessing from terminal output would be fragile.

## UI implication

The current right-pane history can stay compact. If terminal input history is added:

- show a small source badge, for example `发送` / `终端`
- keep newest-first as the first version
- add search over command text only
- avoid a card layout
- keep delete single and clear all

Atuin/McFly-like ranking can be a later step after context fields exist.

## Sources

- Atuin repository: https://github.com/atuinsh/atuin
- Atuin documentation: https://docs.atuin.sh/
- McFly repository: https://github.com/cantino/mcfly
