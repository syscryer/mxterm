# Terminal Theme Source Research

## Decision

Use `mbadolato/iTerm2-Color-Schemes` as the primary source for built-in terminal color schemes.

## Evidence

- Repository: `https://github.com/mbadolato/iTerm2-Color-Schemes`
- The repository describes itself as a collection of 450+ terminal color schemes and includes ports for many terminal applications, including Microsoft's Windows Terminal.
- The repository includes a `windowsterminal/` export directory, which is a good practical source for mXterm because the Windows Terminal color scheme shape maps cleanly to xterm.js theme fields.
- The repository license is MIT for the collection, but the license file notes that each individual theme's copyright/license belongs to that theme's author.

## mXterm Application

- Do not import the full theme collection in the first version.
- Curate a small built-in set and record theme names/sources in code comments or docs.
- Normalize each selected scheme into an internal schema:
  - `name`
  - `background`
  - `foreground`
  - `cursor`
  - `selectionBackground`
  - ANSI colors: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and bright variants.
- Render the settings UI as Windows Terminal-style scheme cards: background sample, 16-color swatch matrix, and scheme name.

## Initial Candidate Set

- mXterm Default
- Campbell
- One Half Dark
- One Half Light
- Solarized Dark
- Dracula
- Tokyo Night
- Gruvbox Dark

## Follow-Up

If future versions support importing user themes, prefer Windows Terminal JSON first, then consider iTerm2 `.itermcolors` or Gogh YAML import.
