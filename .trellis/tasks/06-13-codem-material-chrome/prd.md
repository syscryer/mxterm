# Clarify codem material chrome

## Goal

Make the codem-inspired window material visually apparent in mXterm by applying
the material treatment to the desktop chrome: the top titlebar and the left
sidebar surfaces. The settings navigation sidebar must reuse the same sidebar
material model instead of maintaining a separate visual treatment.

## User Value

- Users can see the selected Mica / Acrylic / Mica Alt style in the app chrome,
  especially the titlebar and left navigation/sidebar areas.
- The main work area remains readable and operational instead of being washed
  out by broad glass effects.
- Workspace sidebar and settings menu sidebar feel like the same product
  surface.

## Confirmed Facts

- The previous commit `253d6da` added `appearance.windowMaterial`, native
  `get_supported_window_materials` / `set_window_material` commands, and
  `data-window-material` on `.app-shell`.
- Current styling maps material tokens across many large content panels, while
  `.custom-titlebar`, `.connection-pane`, and `.settings-sidebar` still use
  independent solid or near-solid backgrounds.
- `D:\ai_proj\codem` uses a shared root material layer plus transparent or
  low-opacity titlebar/sidebar surfaces; settings sidebar reuses the app
  sidebar material behavior.

## Requirements

- Add a shared material background layer to the mXterm app root so titlebar and
  sidebar chrome have a visible material source.
- Make `.custom-titlebar`, the connection left sidebar, and the settings menu
  sidebar use the same chrome/sidebar material treatment.
- Keep settings content panels and main workspace content clear and readable;
  do not turn every card or table into a separate material panel.
- Remove or override the previous broad material panel styling where it hides
  the intended chrome-focused effect.
- Preserve existing settings behavior, terminal color schemes, connection/file
  functionality, and the current window material settings UI.
- Do not introduce a separate settings-sidebar skin. Settings navigation should
  share the same sidebar tokens and interaction colors as the main left sidebar.

## Acceptance Criteria

- [ ] Switching window material changes the visible treatment of the titlebar
      and left sidebar areas.
- [ ] The settings menu sidebar and the main left sidebar share the same
      material/background tokens and hover/active interaction language.
- [ ] Main content surfaces remain visually stable and readable, without the
      prior all-over washed-out material look.
- [ ] Theme mode and accent color still apply through existing settings.
- [ ] `npm run check -- --pretty false` passes.

## Out Of Scope

- Redesigning the settings page layout or connection repository behavior.
- Reworking native window material commands unless a blocking issue is found.
- Replacing the existing mXterm component system with codem components.

## Notes

- Lightweight PRD-only task. Implementation should load frontend specs with
  `trellis-before-dev` before editing.
