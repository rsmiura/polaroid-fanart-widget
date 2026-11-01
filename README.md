# Polaroid Fanart Gallery

A StreamElements overlay widget that shows fan art as polaroid photos pinned to a
corkboard. Pictures rotate on a timer and drop onto the board with a little bounce. Every
polaroid credits the artist on its white strip. You
manage all the art from the widget's own settings panel in StreamElements. There's no
separate website and no accounts to set up.

<!-- TODO: screenshot or GIF of the widget on stream: docs/screenshots/result.gif -->

Version **1.0.0**. The full design spec is in
[polaroid-fanart-widget-spec.md](polaroid-fanart-widget-spec.md).

---

## Install

1. In StreamElements, go to **Streaming tools → Overlays**. Open your overlay (or create one).
2. Click **+ (Add widget) → Static / Custom → Custom widget**.
3. Select the new widget and click **Open editor**.
4. The editor has tabs called **HTML**, **CSS**, **JS** and **FIELDS**. For each one, open
   the matching file from this repo, select everything, copy it, and paste it into the tab
   in place of what's already there:

   | Editor tab | File |
   |------------|------|
   | HTML   | [widget/widget.html](widget/widget.html) |
   | CSS    | [widget/widget.css](widget/widget.css) |
   | JS     | [widget/widget.js](widget/widget.js) |
   | FIELDS | [widget/fields.json](widget/fields.json) |

   <!-- TODO: one screenshot per tab in docs/screenshots/ -->
5. Click **Done**, then **Save** the overlay.

## Position and size

Drag the widget box to where the polaroids should go, and resize it.

- With **1 polaroid**, it sits centered in the box. Tick **Single polaroid: land in a
  random spot** to make each new artwork land somewhere new in the box instead.
- With **2–6 polaroids**, each new polaroid lands in a random free spot in the box and
  never covers another one. Make the box big enough: the polaroids shrink so there's
  always room to scatter them.
- Raise **Max overlap between polaroids (%)** for a messier corkboard: polaroids keep their
  full size, and any one polaroid may cover up to that share of another (newest on top).
  They can then partly cover each other's credits. If the box is too small to scatter
  them within the limit at full size, they shrink just enough to fit.

## Filling a slot (adding art)

The settings panel has 24 sections called **Artwork 01** to **Artwork 24**. Each one holds
one piece of art.

1. Expand **Artwork 01** (or the next empty one).
2. Click **Image** and upload the picture. Use **PNG or JPG**, under 30 MB. A long side of
   1000–2000 px is plenty.
3. Type the **Artist name**.
4. Type their **Handle** however you like it to appear, e.g. `@name on X` or
   `name.bsky.social`.
5. Optionally add a **Caption**. It goes on the first line of the strip.
6. Leave **Show this artwork** ticked.
7. Click **Save**.

Repeat for each piece of art. Empty slots are ignored.

Emoji are fine in names, handles and captions. They show as simple one-color symbols in
the caption text color, to match the handwritten look. When the name and handle don't fit
on one line, the handle moves to its own line, and very long ones get smaller rather than
cut off.

- **Hide a piece** without deleting it: untick **Show this artwork**.
- **Replace a piece**: upload a new image into the same slot and update the credit.
- **Change the order** (in "Slot order" mode): swap the contents of two slots.

If both name and handle are empty, the polaroid says `art by ?` (or just `?`) on stream so
the missing credit gets noticed and fixed.

## Look & behavior settings

| Setting | What it does |
|---------|--------------|
| Polaroids on screen | 1 = a single polaroid. 2–6 = a scattered wall that swaps out one polaroid each time. |
| Single polaroid: land in a random spot | With 1 polaroid, each new artwork lands in a random spot instead of the center. |
| Max overlap between polaroids (%) | With 2–6 polaroids: 0 = they never cover each other (and shrink to make room). Above 0 = full size when there's room, and one polaroid may cover up to this share of another, newest on top. 100 = no limit. |
| Polaroid width (px) | How wide each polaroid is. Everything else (text, pin, frame) scales with it. |
| Max photo height (px) | Tallest the photo part can be. Very tall art gets frame-colored bars at the sides instead of being cut off. |
| Seconds per artwork | How often the art changes. |
| Transition length (seconds) | How long the drop-in and fall-away animations take. |
| Order | **Shuffle** shows every piece once, in random order, before repeating. **Slot order** goes 01, 02, 03… |
| Which polaroid changes | With 2–6 polaroids: **Oldest first** swaps the one that's been up longest. **Random** swaps any one, but never the same spot twice in a row. |
| Max tilt (degrees) | How crooked the polaroids can hang. 0 = perfectly straight. |
| Frame color | Color of the polaroid paper. |
| Caption font | Font for the caption and credit (any Google Font). |
| Caption text color | Color of the caption and credit text. |
| Show artist handle | Untick to show only the artist's name. |
| Text before artist name | The words in front of the credit, `art by` by default. Change it (e.g. `drawn by`) or clear it to show just the name. |
| Pin style | Pushpin, two strips of tape, or nothing. |
| Pushpin color | Color of the pushpin (only used with the Pushpin style). |
| Shadow strength | How strong the drop shadow under each polaroid is. |
| Show debug panel | Shows a troubleshooting box on the widget. Leave it off on stream. |

## If the stream doesn't update

Saving the overlay normally updates OBS by itself. If it doesn't:

1. In OBS, select the browser source for the overlay, then click
   **Refresh cache of current page** (in the source's properties).
2. Still stuck? In the StreamElements editor, tick **Show debug panel** and save. The box
   lists the active slots, recent events (for example images that failed to load) and any
   warnings.

## Adding more slots

1. Open [widget/fields.json](widget/fields.json) and find the five lines for `Artwork 24`
   (`slot24_image` … `slot24_show`).
2. Copy them and paste them right below, adding a comma after the previous last line.
3. In the pasted lines, change every `24` to `25`, both in the keys (`slot25_image`) and
   in the group name (`"Artwork 25"`).
4. Check the file with any JSON validator. One stray comma makes StreamElements show an
   empty panel.
5. Paste the whole file into the FIELDS tab again. Your existing uploads stay.

The widget picks up the new slots automatically. Slot numbers go up to 99.

## Version and changelog

The version is listed on the first line of the debug panel. It matches `WIDGET_VERSION`
at the top of [widget/widget.js](widget/widget.js).

- **1.0.0**: first release.

---

## For developers

No build step: the four files in [widget/](widget/) are pasted as-is.

To iterate locally, serve the repo root with any static server and open the preview
harness, which fakes the StreamElements runtime:

```sh
py -m http.server 8000
# then open http://localhost:8000/preview/preview.html
```

The side panel mirrors the style fields and re-dispatches `onWidgetLoad` on every change.
**Next** fires a rotation on demand. Field values can also be set from the URL, for example
`preview.html?polaroidCount=6&pinStyle=tape`. Sample data lives in
[preview/sample-fielddata.json](preview/sample-fielddata.json). It deliberately includes a
hidden slot (09) and a broken image URL (10). Opening the page as a `file://` URL won't
work, because the browser blocks the JSON fetch.

The overlay has no `console`. Use the debug panel (`debugPanel` field) instead.
