# Composition editing

Use this reference for layout, text, colour, z-order and small visual fixes.
Motion belongs in [03-animation-authoring.md](03-animation-authoring.md).

---

## 1. Coordinate model

- Artboard coordinates are **percentages**: `x`, `y`, `w`, `h` are 0–100.
- `x/y` are the top-left corner.
- `w/h` are the box size; text is laid out inside the box.
- `rotation` is degrees; `opacity` is 0–1.
- `z` is paint order; higher paints later.
- The exported format may letterbox the composition, but its internal
  coordinates stay unchanged.

A layer at `x: 10, y: 50, w: 80, h: 10` occupies the middle lower half of the
artboard, regardless of whether the user previews 9:16 or 1:1.

---

## 2. Layer fields the model can change

`composition_fixes` accepts:

| Field | Type | Notes |
|---|---|---|
| `x y w h` | number | Percent of artboard |
| `z` | number | Paint order |
| `opacity` | 0–1 | Layer-level |
| `rotation` | degrees | Composition-level rotation only |
| `text` | string | Exact replacement; preserve line breaks intentionally |
| `color` | `#rrggbb` or valid CSS colour | Text/fill colour |
| `align` | `left`, `center`, `right` | Text alignment |
| `verticalAlign` | `top`, `middle`, `bottom` | Text vertical placement |
| `visible` | boolean | Hide/show |
| `font.sizePct` | number | Font size as % of artboard width |
| `font.family` | string | Prefer existing family; a new family changes the design |
| `font.weight` | number | 400/500/600/700 etc. |
| `font.lineHeight` | number | Multiplier |
| `font.letterSpacingEm` | number | em |
| `font.style` | `normal`/`italic` | |
| `font.transform` | `none`/`uppercase` | |

Cannot change: `url`, `type`, adding/removing layers, composition width/height,
image replacement.

---

## 3. Text fitting

Before changing a font size, check:

1. **Box width** — is the text allowed to use the full design width?
2. **Line count** — how many lines does the current text produce?
3. **Vertical slot** — is the next element starting below the last line?
4. **Character count** — product descriptions and legal copy are the usual
   overflow sources.
5. **Type style** — condensed/display fonts can be reduced less than body text
   before losing the design.

Safe approach:

- Prefer **more width** or **more height** first.
- If neither is available, reduce `font.sizePct` in small steps.
- Do not reduce below the point where the design loses hierarchy (typically
  below ~55–60% of the original size).
- Keep `lineHeight` at or above the design’s existing ratio.
- Do not allow text into the next element’s vertical slot.

The client’s menu auto-fit uses a shrink-to-fit rule, but the model should not
assume every generated or edited text box was auto-fitted. Check the box.

---

## 4. Detecting overlap

Two text layers overlap when their rectangles intersect:

```
a.x < b.x + b.w &&
a.x + a.w > b.x &&
a.y < b.y + b.h &&
a.y + a.h > b.y
```

Resolve in this order:

1. Move the higher-priority element to its own vertical band.
2. Increase the band height if the artboard permits.
3. Reduce the font only after the geometry is sane.
4. If the design is intentionally layered (e.g. title over a card), ensure the
   overlap is **contained** and the foreground text remains legible.

Do not “fix” a deliberate overlap by separating layers that belong together.

---

## 5. Z-order

Typical order:

```
background image/fill → photography → gradients/decoration → text → badges/controls
```

Rules:

- A badge behind its card is a bug; move it above the card.
- Do not place a title behind its own banner.
- Do not move the background above content.
- `z` changes are global to the composition; verify all affected overlaps, not
  only the target.

---

## 6. Typography rules adapted from `design-ui`

Use these when the user asks for layout/typography correction:

- **Hierarchy first**: one dominant headline, supporting body, no equal-weight
  competition.
- **Line length**: keep body copy readable; do not stretch a paragraph to the
  full artboard if the design has a column.
- **Line height**: body 1.4–1.6; display tighter (1.0–1.2) if the design does.
- **Balance/pretty wrapping** are CSS concepts; the canvas wraps by box width.
  Achieve the same result by choosing a box width that avoids orphans.
- **Tabular numbers** only when numbers change at runtime; most poster prices
  are static and should use the design’s existing numerals.
- Do not introduce a new font pairing to fix a layout. Use the existing family.

---

## 7. `composition_fixes` examples

### Overlap correction only

```json
{
  "reply": "I separated the title and price into their own vertical bands without touching the motion.",
  "composition_fixes": [
    {
      "layerId": "m11-text-the-meaty",
      "set": { "y": 56.5, "h": 4.2, "font.sizePct": 7.6 }
    },
    {
      "layerId": "m12-text-description",
      "set": { "y": 61.5, "h": 8.0 }
    },
    {
      "layerId": "m14-text-price",
      "set": { "y": 71.0, "h": 3.4 }
    },
    {
      "layerId": "m13-shape-badge",
      "set": { "z": 6, "y": 70.4 }
    }
  ]
}
```

### Copy correction

```json
{
  "reply": "I updated the headline exactly as supplied.",
  "composition_fixes": [
    {
      "layerId": "m10-text-headline",
      "set": { "text": "Dirty Chai takes Glasgow by storm" }
    }
  ]
}
```

### Badge behind card → above it

```json
{
  "reply": "The Regola badge is now above the card.",
  "composition_fixes": [
    { "layerId": "m06-badge", "set": { "z": 20 } }
  ]
}
```

---

## 8. New composition variation (advanced)

`new_composition` creates a **new design card**, not an animation. Use only when
the user explicitly asks for a new version/design.

```json
{
  "reply": "I created a darker composition variation.",
  "new_composition": {
    "name": "Night variant",
    "layers": [ /* complete layer objects, same schema */ ]
  }
}
```

Rules:

- Include the complete layer list; do not send a partial patch.
- Preserve width/height/duration unless the user asked otherwise.
- Keep ids stable where possible.
- A new composition has no source recording and no menu mapping.
- Prefer `composition_fixes` for a small change; prefer `animation` for motion.

Do not combine `new_composition` with `composition_fixes` or `animation` in the
same response.

---

## 9. When composition fixes are the wrong tool

- **Motion** → animation or steps.
- **Product/menu item** → Menu item card; not text fixes.
- **Image/photo replacement** → not supported by fixes; ask the user to use the
  appropriate image control or state the limitation.
- **Menu variation** → do not fix it; its overrides reapply on render.
- **Source original** → cannot be edited; create a generated variation instead.
