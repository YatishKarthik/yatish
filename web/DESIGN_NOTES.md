# Design notes

The app is a mission-ops console: a dark bench with instruments on it, where the terrain and the ribbons are the picture and the chrome stays quiet. One oversized clock anchors every page, because time is the control that drives everything else. All other type is small and set in two families, so the eye goes to the data first. Colour is spent only on data and on the two world tags; interactive states are ink on dark. Motion is short and reveals information; nothing loops or glows for decoration.

## Tokens

| Token | Value | Use |
|---|---|---|
| Type, UI | IBM Plex Sans 400 / 600 | body, names, headings |
| Type, numbers and labels | IBM Plex Mono 400 / 500 / 600 | numbers, caps labels, buttons, stamps |
| Sizes | 12 / 13 / 15 / 20 / 28 px | meta / secondary / body / section / key number |
| Clock | 72 px Plex Mono (44 px under 800 px wide) | page anchor |
| Spacing | 4 / 8 / 12 / 20 / 32 / 52 px | all gaps and padding |
| Radius | 2 px; 10 px on permit cards only | instruments vs documents |
| Page / panel / paper / line | `#0e1116` / `#161b22` / `#1a1f27` / `#262d37` | surfaces |
| Ink / dim | `#e6e9ef` / `#9aa4b2` | text, interactive states |
| Earth / Mars tag | `#4f8df7` / `#e0673a` | marks which world a number belongs to |
| Temperature ramp | `#1d2a6b → #3d7ab8 → #e8e2c8 → #e0673a → #8f1c1c` | the only colours that carry temperature |
| Permit | `#3fb950` / `#f2a93b` / `#f85149` | PERMITTED / CONDITIONAL / DENIED, always with the word |
| Mock | dashed `#f2a93b` outline | placeholder data |
| Motion | 100 / 150 / 200 / 300 ms, ease-out | transform and opacity only |

## Effects

| Effect | Purpose |
|---|---|
| Hour crossfade on terrain colour | information: temperature at the clock hour |
| Sun direction on terrain shading | information: local solar time, landform |
| Pixel grid toggle | information: real elevation pixel size |
| Hour cursor across all ribbons | information: same hour on every site |
| Ribbon thickness | information: size of the day–night swing |
| Row rise on load (300 ms, staggered 50 ms) | decorative, capped at 300 ms; off with reduced motion |
| Viewport corner marks | decorative, static |

Later steps of the cinematic pass add to this table.
