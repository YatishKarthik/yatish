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
| Sun colour, warm at low sun and neutral at noon (satellite layer only) | information: time of day |
| Pixel grid toggle | information: real elevation pixel size |
| Hour cursor across all ribbons | information: same hour on every site |
| Ribbon thickness | information: size of the day–night swing |
| Ribbon hover previews that hour, restores on leave | information |
| Layer change wipes left to right, 300 ms | information: same ground, different reading |
| Row reorder slides (FLIP), 300 ms | information: follow a site when the target changes |
| Seam handle shows the Earth / Mars split while dragging | information |
| Camera presets Survey / Walk / Overhead, 900 ms ease; entry dolly-in | information: three ways to read relief |
| Opening sequence: clock runs 06:00 to 14:00 in 1.8 s, chrome fades in last | decorative, first load only, skippable, off with reduced motion |
| Idle drift: 4° over 30 s after 20 s idle | decorative, capped at 4°, off with reduced motion |
| Fine surface relief by class (satellite layer only) | decorative, capped at strength 0.3; not measured terrain |
| Vignette and 1.5 % grain over the viewport | decorative, CSS only, capped at 30 % edge darkening |
| Permit card lifts 2 px; stamp lands in 150 ms | decorative |
| Director frame 2.39:1 with timecode | decorative, director mode only |
| Sound: site tone, stamp click, slip hiss | decorative, off by default, opt-in |

## System view

The entry screen is deliberately more atmospheric than the working views.

| Effect | Purpose |
|---|---|
| Planet turns to face the chosen target or sites | information |
| Camera zoom to the chosen body, lens tightens | information: focus |
| Coloured dust band, twinkling stars, shooting stars | decorative; off or still with reduced motion |
| Thin atmosphere rim on Earth, faint on Mars, none on the Moon | information: which bodies have air |
| Saturation +25 % on this view's canvas only | decorative; data views are untouched so ramp colours stay exact |
| Slow camera float | decorative; off with reduced motion |

### Console layer on the system view

| Element | Purpose |
|---|---|
| Mission steps 01 / 02 / 03 with the live answer to each | information: tells the directive while you use it |
| Bracket pins with class or closeness readout | information |
| Scan pulse when a body comes into focus, 900 ms once | decorative, finite |
| Orbit arcs behind the three bodies | decorative, fade out when a body is in focus; labelled not to scale |
| Warp cut on each jump, 300 ms | decorative, finite |
| Mouse parallax on the camera | decorative, small; off with reduced motion |
| Pale cyan console accent | this screen only; data views keep the spec palette |
| Earth: city lights on the night side, glossy oceans, relief; a visible sun | information: day and night, where the light comes from |
| Bloom (threshold 0.8, intensity 0.6), vignette, SMAA on the system view | decorative, capped; off on phones and low-core machines |

## Fingerprint and pillars

| Element | Purpose |
|---|---|
| 14-spoke fingerprint, site over target, radius = within-planet percentile | information: a site as one shape; agreement is visible before any number |
| Pillar sectors tinted behind the spokes | information: which spokes belong together |
| Dashed spokes and ghosted labels | information: parameters shown but not scored across planets (radar bands, absolute temperatures) |
| Amber dot on a spoke | information: the value is mock until the pipeline runs |
| Small fingerprint at the head of every site row | information: scan the list by shape |
| Pillar tiles with score and bar; one pillar's table open at a time | information, keeps the rail short |

## Game layer

| Element | Purpose |
|---|---|
| Survey record: XP, four ranks, eleven badges, coverage meters | motivation to explore all targets and sites; points measure exploration only, never analog quality |
| Ops log, bottom left | information: narrates each action; lines fade after 6 to 9 s |
| Blind match: five rounds, pick the closest of three sites from fingerprints | teaches how the method reads a site; answers come from `sites.json` closeness |
| Warp tunnel between the system view and the ground, 600 ms | decorative, finite, off with reduced motion |
| Noise-generated cloud deck on Earth | decorative; not weather data |

Progress is stored in the visitor's browser only (`localStorage`) and can be cleared from the Survey page.

## Analysis and test bench

| Element | Purpose |
|---|---|
| Slope layer on the 3D terrain (grey under 5°, amber at 15°, red from 30°) | information: measured from the terrain surface |
| 3D parameter space with lines from the target to its nearest sites | information: PCA of the comparable parameters |
| Neural map, parameter scatter, correlation matrix | information: how places and parameters relate |
| Solar power and thermal cycling charts | information: simulation output per world; temperatures drawn on separate scales |
| Slow auto-rotation of the parameter space | decorative; pauses on hover, off with reduced motion |

## Left out on purpose

Kept simple, so these parts of the brief are not built: WebGL post-processing (SMAA, bloom), cast shadows and horizon haze, rolling-digit numbers, drag-to-scrub on the canvas, pixel probe, three-way compare (gated on the 38-hour gate), and the closeness terrain layer (the contract has no such tile).
