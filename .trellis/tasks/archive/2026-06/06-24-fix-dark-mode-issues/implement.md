# 修复暗色模式视觉问题执行计划

## Checklist

1. Read pre-development specs with `trellis-before-dev`.
2. Inspect current dark-mode CSS around monitor, settings and command sender.
3. Add focused regression coverage where practical:
   - Prefer a style/source guard script if existing test harness has no visual tests.
   - At minimum, create a small check that flags known light-only monitor backgrounds in dark-sensitive selectors.
4. Fix monitor panel styles:
   - Replace light-only tile/card/chart/search/progress backgrounds with token-driven variables.
   - Add dark/system-dark variable values for chart, bar, warning and alert surfaces.
5. Fix settings page visible dark-mode gaps:
   - Content background, appearance preview file pane, setting controls, inputs, active/hover states and toggle thumb contrast.
6. Fix command sender visible dark-mode gaps:
   - Panel, target cards, input textarea, footer buttons, selected state, disabled state and close action.
7. Run targeted checks:
   - Source guard/test added in step 3.
   - `npm run check` if available and not equivalent to a full compile.
8. Do a visual pass in dark mode if a local dev server can run without a full build.
9. Update Trellis task notes with verification results.

## Validation Commands

- `npm run check`
- Optional visual QA if app/dev server is already runnable without production compile.

## Non-Goals

- Do not run a production build unless the user explicitly asks or existing project workflow requires it for verification.
- Do not commit or push.
- Do not refactor unrelated feature structure.

## Rollback Points

- If monitor CSS changes cause light-mode regression, revert only `src/features/monitor/monitor.css` and reintroduce semantic variables more narrowly.
- If shared `app.css` dark overrides affect unrelated panels, split the change into narrower selectors for settings and command sender.
