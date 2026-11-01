# Polaroid Fanart Gallery — StreamElements Custom Widget

Implementation specification. Version 1.1, 2026-11-01.

Revised in 1.1: customizable credit prefix, version badge removed, random non-overlapping
placement (2×2 grid for four as fallback) with an adjustable max overlap percentage,
random-replacement option, "develop" entry effect removed. Affected decisions: D7, D11,
D16, D20, D21–D24.

This document is the full plan for building an animated polaroid fanart gallery as a
StreamElements custom overlay widget. It is written for the person implementing it (or for
an AI coding agent working from it). Every design decision below was settled in advance;
the "Why" notes explain the reasoning so you can revisit a decision knowingly rather than
by accident.

---

## 1. What is being built

A StreamElements custom widget that shows fan artwork as polaroid photos pinned to a
corkboard. Artwork rotates automatically on a timer. Every polaroid carries the artist's
credit on its white strip. The streamer manages the artwork entirely from the widget's own
fields panel in the StreamElements overlay editor: upload a picture, type the artist's name
and handle, save. There is no separate dashboard, no backend, no external hosting, and no
accounts other than the streamer's existing StreamElements account.

The widget is pasted into StreamElements as four blocks (HTML, CSS, JS, Fields JSON).

### Goals

- Artwork never gets cropped. Artists are credited on every piece, every time.
- A non-developer streamer can add, hide, and replace artwork without touching code.
- Looks good at stream resolution (1920×1080 canvas, polaroid around 300–600 px wide).
- Zero runtime dependencies beyond what StreamElements and Google Fonts provide.

### Non-goals (explicitly out of scope for v1)

- Chat commands (`!art`), channel-point triggers, or any event-driven rotation.
- Artist submission forms, approval queues, or automatic pulls from social media.
- A separate web dashboard of any kind.
- Automated tests.
- Clickable links. A stream overlay is not clickable; only the handle text matters.

---

## 2. Decision record

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Audience | One streamer's channel, maintained by a friend | Keeps every customization as a field, not a code edit, so the streamer never needs the developer for routine changes. |
| D2 | Artwork source | Manual upload through widget fields | Automatic pulls from X/Discord break constantly and lose credits. |
| D3 | Artwork data | Image, artist name, handle (free text incl. platform), optional caption, show flag | Minimal set that still credits correctly. Links are useless on an overlay. |
| D4 | Storage | StreamElements fields only (fixed slots) | No backend, no tokens, no hosting. StreamElements hosts the images on its CDN. |
| D5 | Slot model | 24 fixed numbered slots, each a collapsible field group | StreamElements has no list/repeater field. Index-matched "one multi-upload + one credits text" is fragile: removing one image shifts every credit. Fixed slots cannot mismatch. |
| D6 | Slot count | Hand-written in the fields JSON; widget code never hardcodes the count | Changing the count means editing the JSON and re-pasting the Fields tab. Uploads survive. |
| D7 | Layout | Polaroid count field 1–6. 1 = single polaroid (centered, or a random spot via a checkbox), 2–6 = wall with random, non-overlapping positions | One setting instead of a mode switch plus a count. Random spots look like a real corkboard; no overlap keeps every credit readable. |
| D8 | Aspect handling | Fixed frame width, frame height follows image aspect, capped by a max-height field | Shows the whole artwork; still reads as a polaroid; cap keeps layout predictable. |
| D9 | Credit text | On the white strip. Caption on line 1 (if any), credit on line 2 | Credit must never disappear; a two-line strip is still a polaroid. |
| D10 | Animation | Pure CSS keyframes; no animation library | No CDN dependency at stream time. Plain keyframes (not `linear()` easing) so it works on OBS 30's old Chromium. |
| D11 | Entry | Drop-and-bounce pin settle + random tilt. (1.0 also had a "develop" fade; removed in 1.1 by request.) | Cheap in CSS; the artwork is visible immediately. |
| D12 | Exit | Lift off the board, fall downward out of frame, fading | Matches the pin story; in wall mode makes it obvious which one is being replaced. |
| D13 | Pin decoration | Field: pushpin (with color field) / tape strips / none. Default pushpin | One CSS class switch each. |
| D14 | Rotation trigger | Timer only, interval as a field | Event-driven rotation is a v2 feature. |
| D15 | Ordering | Shuffle without repeats per cycle (default), or slot order | Surprise for viewers, fairness for artists. Manual order = slot order; swapping two slots' contents is the reorder mechanism. |
| D16 | Wall rotation | One polaroid per tick, chosen by a field: oldest first (default) or random (never the same spot twice in a row) | Keeps the board alive without a full wipe; random is less predictable for viewers. |
| D17 | Font | Google Fonts picker field, default **Caveat** | Readable at stream size, has real bold weights. Loaded by StreamElements via the `googleFont` field. |
| D18 | Customization | ~12 style fields (see §4.2), no more | Beyond that the StreamElements side panel becomes unusable. |
| D19 | Dev workflow | A local `preview.html` that fakes the StreamElements runtime | The only sane way to iterate on animation without re-pasting into StreamElements. |
| D20 | Handoff | README with paste blocks, screenshots, "filling a slot" section. Version shown in the debug panel only (the 1.0 corner badge was removed in 1.1 by request) | The streamer installs it themselves. |
| D21 | Credit prefix | Text field, default `art by`; empty = no prefix | Lets the streamer word the credit (or drop the prefix) without a code edit. |
| D22 | Placement | Random centre point per polaroid, rejection-sampled against the other spots; grid as fallback (1 row for 2–3, 2×2 for 4, 2×3 for 5–6) | Scattered look without overlap; the grid guarantees a valid layout when sampling fails. |
| D23 | Sizing for random placement | Polaroids together cover at most 45 % of the box; scaled down uniformly beyond that | Random sampling needs free space to succeed; uniform scale keeps every spot interchangeable. |
| D24 | Overlap limit | Slider `maxOverlap` 0–100 %, default 0: the largest share of a polaroid's footprint area any one other polaroid may cover. Above 0: full size when a random layout within the limit fits, otherwise shrunk step by step until one does; newest on top | A messier corkboard look for streamers who want it, with control over how messy. Default 0 because overlap can hide credits (Goal: artists credited every time). Credit strips are deliberately not protected (decided against in 1.1). |

---

## 3. How a StreamElements custom widget works (what you need to know)

See Appendix A for sources.

- The overlay editor gives the widget four tabs: **HTML**, **CSS**, **JS**, **FIELDS**.
  A fifth **DATA** tab shows the current saved field values as JSON (useful for debugging).
- Field values are delivered to JS by a `CustomEvent` named `onWidgetLoad`:
  ```js
  window.addEventListener('onWidgetLoad', (obj) => {
    const fieldData = obj.detail.fieldData; // { fieldKey: value, ... }
  });
  ```
  HTML and CSS tabs can also reference field values with `{{fieldKey}}` placeholders,
  which StreamElements substitutes before rendering. Use this for CSS custom properties.
- Field types used by this widget: `text`, `checkbox`, `colorpicker`, `number`, `slider`,
  `dropdown`, `image-input`, `googleFont`. A field with a `"group": "Name"` key is rendered
  inside a collapsible section with that name.
- `image-input` opens the streamer's media library / upload dialog and stores a stable CDN
  URL (`https://cdn.streamelements.com/uploads/<uuid>.png`). Reported per-file cap: 30 MB.
  PNG, JPG, GIF are safe. WebP is unconfirmed; the README must say "use PNG or JPG".
- When the streamer saves the overlay, StreamElements pushes the update to the live
  overlay in OBS automatically. If it does not land, the OBS fallback is the browser
  source's **Refresh cache of current page** button. The README must mention this.
- **The overlay iframe has no `console.*`, no cookies, no IndexedDB.** `localStorage` is
  unconfirmed and must not be relied on. Do not debug with `console.log`; use the on-screen
  debug panel described in §5.8.
- `SE_API.getOverlayStatus()` returns a promise resolving to an object with `isEditorMode`,
  which tells you whether the widget is rendering inside the editor (use it to show the
  "No artwork" message there, §5.1). Treat as optional: wrap in try/catch and default to `false`.
- There is no official export/import for a single custom widget. Distribution is "paste
  the four blocks". Keep each block as a separate file in the repo so the README can point
  at them.

---

## 4. Data model and fields

### 4.1 Artwork slots

24 slots. Slot keys are zero-padded two-digit numbers so they sort correctly and so the
code can discover them by pattern. Each slot is one collapsible group named
`Artwork 01` … `Artwork 24`.

| Field key | Type | Label | Default | Notes |
|-----------|------|-------|---------|-------|
| `slot01_image` | `image-input` | Image | (empty) | Empty = slot is skipped entirely. |
| `slot01_artist` | `text` | Artist name | `""` | Display name. |
| `slot01_handle` | `text` | Handle (e.g. @name on X) | `""` | Free text. The streamer writes the platform however they like. |
| `slot01_caption` | `text` | Caption (optional) | `""` | Goes on line 1 of the strip when present. |
| `slot01_show` | `checkbox` | Show this artwork | `true` | Hide without deleting the upload. |

Rules for a slot to be **active**: `image` is a non-empty string AND `show` is `true`.
An active slot with both `artist` and `handle` empty is still shown, with the credit line
reading `art by ?` (or `?` with an empty prefix) so the omission is visible on stream and
gets fixed.

**Discovery in code:** do not hardcode 24. Scan `fieldData` for keys matching
`/^slot(\d{2})_image$/`, collect the slot numbers, sort numerically, and build the artwork
list from them. This way the streamer (or you) can add slots 25–48 by copy-pasting groups
in the Fields JSON with no code change.

### 4.2 Style and behavior fields

All in one group named `Look & behavior`. Keep the labels exactly this friendly; the
streamer reads them, not the code.

| Field key | Type | Label | Default | Range / options |
|-----------|------|-------|---------|-----------------|
| `polaroidCount` | `slider` | Polaroids on screen | `1` | 1–6, step 1. 1 = single; 2–6 = wall. |
| `randomSinglePosition` | `checkbox` | Single polaroid: land in a random spot | `false` | Off = centered. Ignored in wall mode (always random). |
| `maxOverlap` | `slider` | Max overlap between polaroids (%) | `0` | 0–100, step 5. Wall mode only. See §5.5. |
| `polaroidWidth` | `number` | Polaroid width (px) | `360` | 200–800 |
| `maxPhotoHeight` | `number` | Max photo height (px) | `480` | 200–1000. Photo area only, excludes the frame and strip. |
| `rotationSeconds` | `number` | Seconds per artwork | `20` | 5–600 |
| `transitionSeconds` | `number` | Transition length (seconds) | `1.2` | 0.3–4, step 0.1. Drives both entry and exit durations. |
| `orderMode` | `dropdown` | Order | `shuffle` | `shuffle`: "Shuffle (no repeats per cycle)", `slots`: "Slot order" |
| `replaceMode` | `dropdown` | Which polaroid changes | `oldest` | `oldest`: "Oldest first", `random`: "Random" |
| `maxTilt` | `slider` | Max tilt (degrees) | `6` | 0–20 |
| `frameColor` | `colorpicker` | Frame color | `#fdfdf8` | |
| `captionFont` | `googleFont` | Caption font | `Caveat` | |
| `captionColor` | `colorpicker` | Caption text color | `#2b2b2b` | |
| `showHandle` | `checkbox` | Show artist handle | `true` | Off = credit shows artist name only. |
| `creditPrefix` | `text` | Text before artist name (empty = none) | `art by` | Empty string is meaningful: no prefix. |
| `pinStyle` | `dropdown` | Pin style | `pushpin` | `pushpin`: "Pushpin", `tape`: "Tape", `none`: "None" |
| `pinColor` | `colorpicker` | Pushpin color | `#d7263d` | Ignored unless `pinStyle` = pushpin. |
| `shadowStrength` | `slider` | Shadow strength | `60` | 0–100 |
| `debugPanel` | `checkbox` | Show debug panel (for troubleshooting) | `false` | See §5.8. |

### 4.3 Fields JSON skeleton

Written out once with the style group and **one** slot. Replicate the slot block 24
times, changing `01` → `02` … `24` in both the keys and the group name. Order in the file
is the order in the side panel: style group first, then slots.

```json
{
  "polaroidCount":     { "type": "slider",      "label": "Polaroids on screen",       "value": 1,   "min": 1,   "max": 6,    "step": 1,   "group": "Look & behavior" },
  "randomSinglePosition": { "type": "checkbox", "label": "Single polaroid: land in a random spot", "value": false, "group": "Look & behavior" },
  "maxOverlap":        { "type": "slider",      "label": "Max overlap between polaroids (%)", "value": 0, "min": 0, "max": 100, "step": 5, "group": "Look & behavior" },
  "polaroidWidth":     { "type": "number",      "label": "Polaroid width (px)",       "value": 360, "min": 200, "max": 800,  "step": 10,  "group": "Look & behavior" },
  "maxPhotoHeight":    { "type": "number",      "label": "Max photo height (px)",     "value": 480, "min": 200, "max": 1000, "step": 10,  "group": "Look & behavior" },
  "rotationSeconds":   { "type": "number",      "label": "Seconds per artwork",       "value": 20,  "min": 5,   "max": 600,  "step": 1,   "group": "Look & behavior" },
  "transitionSeconds": { "type": "number",      "label": "Transition length (seconds)","value": 1.2, "min": 0.3, "max": 4,    "step": 0.1, "group": "Look & behavior" },
  "orderMode":         { "type": "dropdown",    "label": "Order",                     "value": "shuffle", "options": { "shuffle": "Shuffle (no repeats per cycle)", "slots": "Slot order" }, "group": "Look & behavior" },
  "replaceMode":       { "type": "dropdown",    "label": "Which polaroid changes",    "value": "oldest", "options": { "oldest": "Oldest first", "random": "Random" }, "group": "Look & behavior" },
  "maxTilt":           { "type": "slider",      "label": "Max tilt (degrees)",        "value": 6,   "min": 0,   "max": 20,   "step": 1,   "group": "Look & behavior" },
  "frameColor":        { "type": "colorpicker", "label": "Frame color",               "value": "#fdfdf8", "group": "Look & behavior" },
  "captionFont":       { "type": "googleFont",  "label": "Caption font",              "value": "Caveat",  "group": "Look & behavior" },
  "captionColor":      { "type": "colorpicker", "label": "Caption text color",        "value": "#2b2b2b", "group": "Look & behavior" },
  "showHandle":        { "type": "checkbox",    "label": "Show artist handle",        "value": true,      "group": "Look & behavior" },
  "creditPrefix":      { "type": "text",        "label": "Text before artist name (empty = none)", "value": "art by", "group": "Look & behavior" },
  "pinStyle":          { "type": "dropdown",    "label": "Pin style",                 "value": "pushpin", "options": { "pushpin": "Pushpin", "tape": "Tape", "none": "None" }, "group": "Look & behavior" },
  "pinColor":          { "type": "colorpicker", "label": "Pushpin color",             "value": "#d7263d", "group": "Look & behavior" },
  "shadowStrength":    { "type": "slider",      "label": "Shadow strength",           "value": 60,  "min": 0,   "max": 100,  "step": 5,   "group": "Look & behavior" },
  "debugPanel":        { "type": "checkbox",    "label": "Show debug panel (for troubleshooting)", "value": false, "group": "Look & behavior" },

  "slot01_image":   { "type": "image-input", "label": "Image",                     "group": "Artwork 01" },
  "slot01_artist":  { "type": "text",        "label": "Artist name",               "value": "", "group": "Artwork 01" },
  "slot01_handle":  { "type": "text",        "label": "Handle (e.g. @name on X)",  "value": "", "group": "Artwork 01" },
  "slot01_caption": { "type": "text",        "label": "Caption (optional)",        "value": "", "group": "Artwork 01" },
  "slot01_show":    { "type": "checkbox",    "label": "Show this artwork",         "value": true, "group": "Artwork 01" }
}
```

Validate the finished file with any JSON linter before pasting; a single trailing comma
makes StreamElements silently fall back to an empty panel.

---

## 5. Widget behavior

### 5.1 Startup

1. On `onWidgetLoad`, read `fieldData`.
2. Build the **artwork list** from active slots (§4.1), in slot order. Each item:
   `{ slot, imageUrl, artist, handle, caption }`.
3. Read style fields into a `settings` object with sane fallbacks for any missing key
   (the streamer may be running an older Fields JSON).
4. Apply CSS custom properties on the root element: `--polaroid-width`,
   `--max-photo-height`, `--frame-color`, `--caption-color`, `--caption-font`,
   `--shadow-alpha` (0–1 from `shadowStrength`), `--transition-seconds`.
5. Effective polaroid count = `min(polaroidCount, artworkList.length)`. If the list is
   empty, render nothing (the overlay stays transparent) and show the debug panel message
   "No artwork: fill at least one Artwork slot" **only if** `debugPanel` is on or the widget
   is in editor mode.
6. Build the play queue (§5.3), place the initial polaroids (§5.4), start the timer (§5.2).

### 5.2 Timer

- One `setInterval` at `rotationSeconds × 1000` ms. Each tick: pick the next artwork from
  the queue, preload it (§5.7), then replace one polaroid (§5.4 / §5.5).
- In wall mode, each tick replaces exactly one polaroid, chosen by `replaceMode`:
  - `oldest`: the one that has been on the board longest. Keep a `placedAt` timestamp per polaroid.
  - `random`: any polaroid except the spot replaced on the previous tick.
  - Either way, an empty spot (left by failed image loads) is filled first.
- Never let two transitions overlap. If a tick fires while a transition is still running
  (e.g. transition longer than interval after a settings change), skip that tick.

### 5.3 Play queue

- `orderMode = slots`: cycle through the artwork list in slot order, wrapping around.
- `orderMode = shuffle`: Fisher–Yates shuffle the list into a cycle; draw from the front
  until empty; then reshuffle. To avoid a visible repeat at the cycle boundary, if the new
  cycle's first item equals the previous cycle's last item **and** the list has more than
  one entry, swap it with another position.
- Wall mode additional rule: an artwork already visible on the board is never drawn
  again while it is still on the board. Draw the next queue item that is not currently
  visible; if every remaining item is visible (only possible when effective count equals
  list length), reshuffle and keep going. Since effective count ≤ list length, the board
  always has enough distinct artworks.

### 5.4 Single mode (count = 1)

- One polaroid, centered in the widget's box. The widget box is positioned and sized by
  the streamer in the overlay editor; the polaroid is centered within it. With
  `randomSinglePosition` on, each new polaroid instead lands at a random point where it
  fits inside the box.
- If the box is smaller than the polaroid's footprint (§5.5), scale down as in wall mode.
- On a tick: play the exit animation on the current polaroid, then (after the exit
  duration) insert the new one and play the entry animation. The exit and entry do not
  overlap in single mode, so the credit of the leaving piece is never half-visible under
  the new one.

### 5.5 Wall mode (count 2–6)

- Each polaroid on the board owns a **spot**: a centre point in the widget box. Every spot
  reserves the polaroid's **footprint**: its bounding box at `maxPhotoHeight` and rotated
  by `maxTilt` (pin allowance included). All spots share one footprint size, so any
  spot can hold any artwork.
- **Random placement:** a spot is a uniformly random centre point where the footprint
  fits inside the box and respects the overlap limit against every other spot (rejection
  sampling, 200 tries). With `maxOverlap` = 0 the limit is "at least 8 px clear"; above 0
  it is "the footprint intersection with any one other spot is at most `maxOverlap` % of
  the footprint area". Pairwise only: several neighbours together may cover more. The initial board is built spot by spot; if a full board can't be
  placed in 20 attempts, fall back to the **grid**.
- **Grid (fallback and sizing):** 1 row for 2–3 polaroids, 2×2 for 4, 2 rows of 3 for 5–6
  (a short last row is centered). Spot = cell centre.
- **Scale:** uniform for all polaroids (CSS `transform: scale()` on the polaroid's mount),
  the smallest of: 1, the factor that fits the footprint into a grid cell, and the factor
  at which all footprints together cover at most 45 % of the box (so random sampling has
  room). Show a one-line warning in the debug panel when scale < 1.
- **`maxOverlap` above 0:** the newest polaroid is on top (appended last). Scale starts at
  `min(1, box / footprint)` (full size unless one alone doesn't fit) and ignores the
  coverage cap. If no random layout within the limit is found, multiply the scale by 0.92
  and retry, down to the grid-cell scale. At that scale the grid cells don't overlap, so
  the grid fallback always respects the limit and stays inside the box.
- Each polaroid gets a random tilt in `[-maxTilt, +maxTilt]`.
- On a tick, the replaced spot gets a new random position that respects the overlap limit
  against every other spot. If none is found, it keeps its old position.
- On resize, the whole board is re-laid out (new scale and positions).
- Exit and entry of one spot may overlap by up to 30 % of the transition time; everything
  else stays still.

### 5.6 The polaroid element

```
.polaroid                    (frame: background = --frame-color, padding, shadow, tilt)
  .pin                       (pushpin | tape | none, see §6.3)
  .photo                     (width 100%, max-height --max-photo-height, overflow hidden)
    img                      (width 100%, height auto, object-fit contain, display block)
  .strip
    .caption                 (line 1, only when caption is non-empty)
    .credit                  (line 2, always)
```

- Frame padding: ~4 % of polaroid width on the sides and top, strip is ~18 % of the width
  tall (grows to fit two lines). Use `em`-relative sizing from the polaroid width so one
  field scales everything.
- Image: never crop. `width: 100%; height: auto; max-height: var(--max-photo-height);
  object-fit: contain;`. For an image taller than the cap this letterboxes inside the
  photo area with the frame color showing — acceptable and honest.
- Credit line text is `{creditPrefix} {name}`, or just `{name}` when `creditPrefix` is
  empty, where `{name}` is:
  - `showHandle` on and handle non-empty: `{artist} · {handle}`
  - `showHandle` off or handle empty: `{artist}`
  - artist empty: the handle alone (even with `showHandle` off); both empty: `?`
  - Render with `textContent`, never `innerHTML`; slot text is streamer input.
- Caption line: present only when non-empty. Slightly larger than the credit line.
- Text wrapping: the caption, and a credit that is only a name or only a handle, use
  `overflow-wrap: anywhere` with a 2-line clamp so long text cannot push the strip off the
  frame. Line height 1.35, so descenders (g, y, p) of handwriting fonts aren't clipped.
- Credit with both name and handle: shown on one line with the ` · ` when it fits.
  Otherwise it splits: `{creditPrefix} {artist}` on line 1, `{handle}` whole on line 2,
  and no dot. A line that is still too wide gets a smaller font size until it fits, with
  4 % margin, so names and handles are never cut off. Measured in JS after placement and
  re-measured whenever a font finishes loading, since the Google Font changes text widths.
- Emoji render monochrome in the caption color. The strip's font stack is
  `caption font, 'Caveat', cursive, 'Noto Emoji'`. Noto Emoji is a monochrome Google Font,
  loaded with `@import` in `widget.css`. It must come **last**, after the generic
  `cursive`, because it also has digits, `#` and `*` as wide emoji-width glyphs. Placed
  earlier, it supplied the digits whenever the caption font wasn't loaded (yet), and the
  numbers came out widely spaced. U+FE0F (the "color emoji" selector) is stripped from slot text,
  because it would make the browser pick the system's color emoji font. A CSS-only
  `font-variant-emoji: text` isn't used: OBS 30–32 Chromium is too old for it.

### 5.7 Image preloading and failures

- Before showing an artwork, create `new Image()` with its URL and wait for `load`, with a
  5-second timeout. On `error` or timeout: skip the artwork for this tick, record the
  failure in the debug state (`failedSlots`), and immediately try the next queue item (max
  3 attempts per tick, then just wait for the next tick).
- Do not permanently blacklist a slot; a CDN hiccup should not hide an artist for the
  whole stream.

### 5.8 Debug panel and version

Because `console.*` does not exist inside the overlay, the widget carries its own
diagnostics:

- `const WIDGET_VERSION = '1.0.0';` at the top of the JS. Bump it on every release and in
  the README. The version appears only in the debug panel; there is no on-screen badge
  (removed in spec 1.1).
- The **debug panel** (`debugPanel = true`): a semi-transparent box listing version,
  active slot count, effective polaroid count, current queue position, last 5 events
  (placed / replaced / skipped-failed-load), and any warnings (scaled-down wall, missing
  fields). Plain text, monospace, no interaction.

---

## 6. Animation specification (pure CSS)

All animations are CSS keyframes triggered by adding a class. Durations come from
`--transition-seconds`. **Do not use `linear()` easing** (unsupported on OBS 30). Use
`cubic-bezier` and multi-step keyframes for the bounce.

### 6.1 Entry: pin-drop

On insert, `.polaroid.entering` plays the **pin drop** (duration = transition time):
```
0%   { transform: translateY(-40px) rotate(var(--tilt)) scale(1.04); opacity: 0; }
55%  { transform: translateY(8px)   rotate(var(--tilt)) scale(0.985); opacity: 1; }
75%  { transform: translateY(-4px)  rotate(var(--tilt)); }
90%  { transform: translateY(2px)   rotate(var(--tilt)); }
100% { transform: translateY(0)     rotate(var(--tilt)) scale(1); }
```
Easing `cubic-bezier(.2,.8,.2,1)`. The `.pin` element fades in during the last 30 %.
The artwork is fully visible from the start. (Spec 1.0 also had a "develop" fade from
white; it was removed in 1.1.)

`--tilt` is set per polaroid as an inline custom property (`style="--tilt: 4.3deg"`) so
every keyframe keeps the same rotation.

### 6.2 Exit: lift and fall

On `.polaroid.leaving` (duration = transition time, easing `cubic-bezier(.5,0,.9,.4)`):
```
0%   { transform: translateY(0)     rotate(var(--tilt)); opacity: 1; }
18%  { transform: translateY(-14px) rotate(var(--tilt)) scale(1.02); }   /* pin pulled */
100% { transform: translateY(130vh) rotate(calc(var(--tilt) + 28deg)); opacity: 0; }
```
The `.pin` fades out in the first 18 %. Remove the element on `animationend`, with a
`setTimeout` fallback of duration + 100 ms in case the event is lost.

### 6.3 Pin styles

- **pushpin**: a 22 px circle (`radial-gradient` for a highlight, color `--pin-color`)
  centered on the top edge, plus a 2 px darker "needle" pseudo-element below it, plus a
  small soft shadow. Pure CSS, no image.
- **tape**: two `::before`/`::after` strips (~34 % width, 10 % height of the polaroid),
  semi-transparent warm beige (`rgba(235, 222, 180, .75)`), rotated −8° and +8° across the
  top-left and top-right corners, with a faint inner shadow for the paper edge.
- **none**: nothing; the shadow alone holds it.

### 6.4 Shadow

`box-shadow: 0 10px 24px rgba(0,0,0, var(--shadow-alpha)), 0 2px 4px rgba(0,0,0, calc(var(--shadow-alpha) * .5));`
with `--shadow-alpha = shadowStrength / 100 × 0.6`.

---

## 7. Files and repository layout (recommended)

```
polaroid-fanart-widget/
├── README.md                 install guide for the streamer (see §9)
├── widget/
│   ├── widget.html           paste into HTML tab
│   ├── widget.css            paste into CSS tab
│   ├── widget.js             paste into JS tab
│   └── fields.json           paste into FIELDS tab
├── preview/
│   ├── preview.html          local dev harness (see §8)
│   ├── sample-fielddata.json fake fieldData with ~8 filled slots using local sample images
│   └── samples/              a few royalty-free portrait/landscape/square test images
└── docs/
    └── screenshots/          editor screenshots referenced by the README
```

- `widget.html` contains only the root container (`<div id="gallery"></div>`) and the
  debug panel container. Keep the HTML tab tiny; all structure
  is built in JS so the preview harness and the real widget share one code path.
- `widget.css` uses `{{captionFont}}` and the other field placeholders **only** where a
  CSS custom property cannot be set from JS (in practice: the font-family, because
  StreamElements loads the Google Font for a `googleFont` field when its `{{key}}` is
  referenced). Everything else is a custom property set in JS, so the preview harness
  behaves identically.
- No build step. The four files are pasted as-is.

---

## 8. Preview harness (`preview/preview.html`)

A plain HTML page that:

1. Loads `widget.css` via `<link>` and `widget.js` via `<script>`, and reproduces the
   contents of `widget.html` inline.
2. Replaces `{{captionFont}}` by loading the Google Font itself with a `<link>` to
   `fonts.googleapis.com` for the font named in the sample data.
3. Defines a minimal fake `SE_API` with `getOverlayStatus()` resolving to
   `{ isEditorMode: true }`.
4. Loads `sample-fielddata.json`, then dispatches
   `new CustomEvent('onWidgetLoad', { detail: { fieldData } })` on `window`.
5. Renders a side panel of controls mirroring the style fields (count, width, interval,
   tilt, pin style, order mode, debug panel). Changing a control re-dispatches
   `onWidgetLoad` with the modified data, which must fully reset the widget (clear timers,
   remove elements) — so **the widget's load handler must be idempotent**.
6. Has a "Next" button that fires one rotation tick on demand, and a "Resize box" control
   so wall-mode placement and scaling can be checked at different widget box sizes.

Serve it with any static server (for example `py -m http.server` from the repo root) and
open `http://localhost:8000/preview/preview.html`. Opening it as a `file://` URL will
block the JSON fetch in most browsers.

---

## 9. README requirements (for the streamer)

The README is the install and operations guide. It must contain:

1. **What it is**, one paragraph, with a screenshot or GIF of the result.
2. **Install**: in StreamElements → Overlays → open/create an overlay → Add widget →
   Static/Custom → Custom widget → Open editor. Then for each of the four tabs: "open
   `widget/<file>`, select all, copy, paste into the tab, replacing what's there". A
   screenshot per tab, stored in `docs/screenshots/`.
3. **Position and size**: drag the widget box where the polaroid should live; in wall mode
   make the box large enough to scatter the polaroids (§5.5).
4. **Filling a slot**: expand `Artwork 01`, click the image field, upload (PNG or JPG,
   under 30 MB, longest side 1000–2000 px is plenty), type artist name, handle, optional
   caption, keep "Show" ticked, **Save**. Repeat per artwork. Hiding a piece = untick
   Show. Replacing = upload a new image into the same slot.
5. **Look & behavior fields**: one line per field saying what it does.
6. **If the stream doesn't update**: in OBS, select the browser source → Refresh cache of
   current page. If still stuck, tick "Show debug panel" in the editor and read the panel.
7. **Adding more slots**: copy the five lines of `Artwork 24` in `fields.json`, paste
   below, change every `24` to `25` (keys and group name), re-paste the FIELDS tab. Existing
   uploads survive.
8. **Version**: the version shown in the debug panel, matching `WIDGET_VERSION`. A short
   changelog section.

---

## 10. Milestones and verification

Work in this order. Each milestone ends with its checklist green in the preview harness,
and milestones 1, 3 and 5 additionally in the real StreamElements editor.

### M1 — Skeleton, fields, one static polaroid
- Write `fields.json` with the style group and 24 slots; validate JSON.
- Write `widget.html`, `widget.css` base styles, `widget.js` with: load handler, slot
  discovery, settings parsing with fallbacks, single polaroid rendered without animation.
- Build `preview.html` with sample data and the fake `onWidgetLoad` dispatch.

Verify:
- [ ] Fields JSON pastes into StreamElements without error; the panel shows `Look & behavior` and `Artwork 01`–`Artwork 24` as collapsible groups.
- [ ] Preview shows one polaroid with the first active slot: image uncropped, frame color applied, credit text correct for all four artist/handle combinations (§5.6).
- [ ] Portrait, landscape and square sample images all render with the frame following the aspect; a very tall image is capped at `maxPhotoHeight`.
- [ ] A slot with an image but `show = false` is skipped; a slot with no image is skipped; zero active slots renders nothing.
- [ ] In the real editor, uploading an image into `Artwork 01` and saving shows it in the editor preview.

### M2 — Rotation and ordering
- Timer, play queue, slot-order and shuffle modes, cycle-boundary repeat guard.
- Image preloading with timeout and skip-on-failure.

Verify:
- [ ] Slot order cycles 1→N→1 at the configured interval.
- [ ] Shuffle shows every artwork exactly once before any repeat (check with the debug panel event log over two full cycles).
- [ ] With a deliberately broken image URL in the sample data, that artwork is skipped, logged in the debug panel, and the rotation continues.
- [ ] Re-dispatching `onWidgetLoad` from the preview controls fully resets the widget (no doubled timers: the event log shows one tick per interval).

### M3 — Animations
- Entry (pin-drop), exit (lift-and-fall), pin styles, shadow, tilt.

Verify:
- [ ] Entry and exit durations follow `transitionSeconds`; the artwork is fully visible throughout the entry (no fade from white).
- [ ] Tilt is random within `±maxTilt` and stays constant through entry, idle, and exit (no snap).
- [ ] Each pin style renders correctly; `pinColor` affects only the pushpin.
- [ ] In the real StreamElements editor the animation plays identically to the preview. Then in OBS (browser source) the animation plays smoothly at 1080p; test on the oldest OBS the streamer might use (OBS 30 ships an old Chromium).
- [ ] Exited elements are removed from the DOM (inspect in the preview; no growth over 50 ticks).

### M4 — Wall mode
- Random non-overlapping placement with grid fallback, oldest/random replacement, no-duplicate-on-board rule, down-scaling (grid fit and 45 % coverage cap).

Verify:
- [ ] Counts 2–6 scatter polaroids at random positions inside the box; no polaroid overlaps another, over at least 25 ticks per count.
- [ ] With `maxOverlap` above 0, the newest is on top and no pair's footprint overlap exceeds the limit over 25 ticks. Polaroids stay full size when there's room; in a tight box (e.g. 6 at 10 % in 1280×720) they shrink instead, and settled polaroids stay inside the box.
- [ ] The grid fallback (forced with a tight box) produces 1 row for 2–3, 2×2 for 4, 2×3 for 5–6.
- [ ] `replaceMode = oldest`: each tick replaces the oldest polaroid only. `random`: the replaced spot varies and is never the same twice in a row. Either way, the others do not move.
- [ ] `randomSinglePosition` off keeps a single polaroid centered; on, each new polaroid lands somewhere new.
- [ ] The same artwork never appears twice on the board at once.
- [ ] With fewer active artworks than `polaroidCount`, the effective count drops to the artwork count and the debug panel says so.
- [ ] Shrinking the preview box below the required size scales the polaroids down instead of overflowing, and the debug panel shows the warning.

### M5 — Customization pass and handoff
- Every field in §4.2 wired and tested; debug panel final; README with screenshots.

Verify:
- [ ] Changing each style field in the real editor and saving changes the editor preview accordingly.
- [ ] Changing `captionFont` to another Google Font loads it (no fallback serif).
- [ ] No version number or other diagnostics visible in the editor or on the live overlay with `debugPanel` off (except the "No artwork" message in the editor when every slot is empty).
- [ ] `creditPrefix` changes the credit wording; clearing it shows the name with no prefix.
- [ ] The streamer (or someone who has never seen the code) can install the widget from the README alone, fill two slots, and see them rotate in OBS.
- [ ] Saving the overlay updates the OBS browser source without a manual refresh; the README's refresh-cache fallback is tested once by deliberately caching.

---

## 11. Future work (not in v1)

- `!art` chat command via the `message` event: show the current artist's credit in chat, or skip to the next artwork.
- Artist submission flow (form or Discord) with an approval step, which would require a backend and therefore a different storage decision than D4.
- More than 48 slots, which would justify revisiting D5 in favor of an external JSON source.

---

## Appendix A — Verified platform constraints (2026-10-14)

Facts gathered from official StreamElements docs, the official widgets repository, and
community sources during planning. Confidence noted where it is not high.

**StreamElements custom widgets**
- Four editor tabs HTML / CSS / JS / FIELDS; the DATA tab (current field values) is reported by third-party guides, not official docs.
  https://docs.streamelements.com/overlays/widget-structure
- Widgets may load external scripts and stylesheets and call external HTTPS APIs; only the target's CORS applies. This widget does not use that capability.
  https://docs.streamelements.com/overlays/getting-started
- Sandbox: no `console.*`, no cookies, no IndexedDB inside the overlay. `localStorage` unconfirmed (low confidence) — do not rely on it.
  https://docs.streamelements.com/overlays/widget-structure
- Field types: `text`, `checkbox`, `colorpicker`, `number` (min/max/step), `slider`, `dropdown` (options map), `image-input`, `video-input`, `sound-input`, `googleFont`, `button`, `hidden`. Unknown types fall back to `text`. Multi-line text is `"type": "text", "mode": "textarea"` (confirmed by StreamElements staff and community widgets).
  https://docs.streamelements.com/overlays/widget-structure ; https://github.com/StreamElements/widgets/issues/36
- `"group": "Name"` on a field places it in a collapsible section. The official AwesomeShoutout widget has 566 fields across 44 groups including 41 image inputs, so 24 slot groups are well within practice.
  https://github.com/StreamElements/widgets/blob/master/AwesomeShoutout/widget.json
- No list/repeater field type exists. `image-input` with `"multiple": true` returns an array of URLs, but single-item removal and order preservation are undocumented — which is why fixed slots were chosen.
- `image-input` uploads are stored on `https://cdn.streamelements.com/uploads/<uuid>.<ext>` with stable URLs. Per-file cap reported as 30 MB (medium confidence); account storage 2 GB (community source). PNG/JPG/GIF accepted; WebP unconfirmed.
  https://support.streamelements.com/hc/en-us/articles/10474663165586
- `onWidgetLoad` delivers `detail.fieldData`, `detail.session`, `detail.channel`. `onEventReceived` events include `message`, `follower-latest`, `subscriber-latest`, `tip-latest`, `cheer-latest`, `raid-latest`, `widget-button`, `kvstore:update`. There is **no channel-points redemption event** for custom widgets (open since 2020).
  https://docs.streamelements.com/overlays/events ; https://github.com/StreamElements/widgets/issues/6
- `SE_API.setField()` works only inside the editor and does not persist; JS cannot write field values. `SE_API.store` is a key-value store shared by all custom widgets on the account (keys cannot be deleted; not used by this widget). `SE_API.getOverlayStatus()` exists.
  https://docs.streamelements.com/overlays/custom-widget
- Saving an overlay pushes the update to OBS automatically (official blog, 2017; medium confidence that this is still exact); the community fallback is OBS "Refresh cache of current page".
  https://blog.streamelements.com/1-minute-twitch-stream-setup-89a6c73c85b9
- No official per-widget export/import; sharing is paste-per-tab or whole-overlay sharing.
  https://github.com/StreamElements/widgets

**OBS browser source (CEF) and CSS**
- OBS 30 ships Chromium 103; OBS 31 and 32 ship Chromium 127; OBS 33 (RC, Oct 2026) moves to CEF 150.
  https://github.com/obsproject/obs-studio/discussions/3853 ; https://github.com/obsproject/obs-studio/releases
- CSS `linear()` easing needs Chromium 113+, so it fails on OBS 30. Use `cubic-bezier` and multi-step keyframes instead.
  https://caniuse.com/mdn-css_types_easing-function_linear-function

**Animation libraries (evaluated, not used)**
- anime.js 4.5.0, MIT, built-in spring easing, UMD on cdnjs. Would be the pick if a library were wanted.
  https://animejs.com/documentation/easings/spring/
- GSAP 3.15, free for commercial use since 3.13 but under a proprietary "no charge" license, not OSI open source.
  https://gsap.com/standard-license/
- Motion 14.2, MIT, springs, jsDelivr only.
  https://motion.dev/docs/quick-start
- No maintained open-source "polaroid" or "corkboard" animation library exists; the closest hits are abandoned or GPL.
