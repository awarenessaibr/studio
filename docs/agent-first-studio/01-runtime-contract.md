# Runtime contract

This is what the client actually sends, accepts and persists.

---

## 1. Entry points and state

| Item | Value |
|---|---|
| Page | `pages/agent-first-studio.html` |
| Library index | `/api/library` (`data/library/index.json`) |
| Design detail | `/api/library/designs/:id` |
| Save animation | `POST /api/library/animations` |
| Compose from clips | `POST /api/library/compose` |
| Delete animation | `DELETE /api/library/animations/:id?designId=:id` |
| Source recordings | `/data/library/sources/<design-id>.webm` + `.jpg` |
| Confirmed menu catalogue | `data/library/menu-catalog.json` |
| Menu-enabled designs | `data/library/menu-designs.json` |

At the time of writing: **63 designs**, **61 source recordings**, **12
menu-enabled designs**, **5 Singl-end menus / 128 items**.

The Agent First design set is not filtered to `ready`; review and blocked
designs are visible. The `A` button only controls whether broken animations are
listed.

Relevant localStorage keys:

| Key | Contents |
|---|---|
| `sa.comp` | Composition overrides / generated composition variations |
| `sa.anims` | Locally generated animations by design id |
| `sa.brand` | Brand filter |
| `agentLibrary.admin` | Include broken animations |

---


## 1b. What the user can interact with

| Surface | Behaviour |
|---|---|
| **Designs** | Brand filter, searchless design grid, source poster cards. All 63 designs are listed; review/blocked status is visible on cards. |
| **Admin `A`** | Adds broken animations to the list. It does not hide designs. |
| **Animation rows** | Select a motion; source `Original motion` plays the recording, generated motions play the editable composition. Menu variations carry a `Menu` tag and a delete `×`. |
| **Menu item card** | Only on supported designs. Shows current product, price, menu, section, description and dietary marks; **Change item** opens the confirmed-menu picker. |
| **Formats** | Original, 1:1, 4:5, 9:16, landscape. Preview/export only. |
| **Groups** | Semantic chips select groups for the model; selected groups are sent as `selectedGroups` and visually outlined. |
| **Chat** | Prompt chips: New animation, Change this one, New composition, Review & correct. Last six messages are sent as history. |
| **Attachments** | Image, video (4 frames), canvas snapshot, area crop (bbox + layer ids), paste, drag/drop. |
| **Replay / Space / canvas click** | Replay the selected generated animation. Source playback is browser video. |
| **Export** | Downloads the source recording when Original motion is active; otherwise records the current canvas/animation as WebM. |
| **Model settings** | Local Ollama-style endpoint or OpenAI-compatible DeepSeek endpoint. |

The model does not click these controls; it must understand the state and
respond with the correct JSON channel.

## 2. Selection state

The user can select:

1. **Design** — sets the composition and source poster.
2. **Animation** — generated animations switch to the editable composition;
   `origin === 'original'` switches to the source recording.
3. **Format** — preview/export only (`Original`, `1:1`, `4:5`, `9:16`, `16:9`).
4. **Groups** — selected semantic groups are sent as `selectedGroups`.
5. **Menu variation** — a generated editable composition with product
   overrides.

`state.comp` is the editable composition. `sourceVideo`/`sourcePoster` belong
to the source design and are never mutated by the model.

---

## 3. Context sent to the model

`ctxWithLib()` builds approximately:

```json
{
  "composition": {
    "name": "...",
    "width": 1080,
    "height": 1920,
    "duration": 10000,
    "palette": ["#..."],
    "fonts": ["..."],
    "layers": [
      {
        "id": "m01-text-headline",
        "name": "Headline",
        "type": "text",
        "text": "...",
        "x": 8,
        "y": 20,
        "w": 80,
        "h": 12,
        "z": 4,
        "color": "#ffffff",
        "align": "left",
        "opacity": 1,
        "font": {
          "family": "Anton",
          "weight": 400,
          "sizePct": 8
        }
      }
    ]
  },
  "currentAnimation": {
    "name": "...",
    "duration": 10000,
    "tracks": [
      {
        "layerId": "...",
        "segments": [
          {
            "start": 0,
            "duration": 10000,
            "loop": false,
            "frames": [
              { "t": 0, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1 }
            ]
          }
        ]
      }
    ]
  },
  "library": {
    "brand": "Singl-end",
    "kind": "social-post",
    "groups": [
      { "id": "...", "kind": "text", "label": "...", "layerIds": ["..."], "start": 0, "end": 10000 }
    ],
    "menuItems": [],
    "entities": {}
  },
  "selectedGroups": ["..."],
  "clips": [
    { "id": "clip-...", "effect": "slide-in", "direction": "from-left", "duration": 600, "mode": "in" }
  ]
}
```

Important limits:

- `composition.layers` excludes image URLs, `meta`, clip/filter channels and
  some font fields. Do not invent them.
- `currentAnimation.tracks` frames are thinned for context. The model sees the
  shape, not necessarily every 60 fps sample.
- `library.menuItems` comes from the extracted design and is often empty. The
  **authoritative** product list is the Menu item card, backed by
  `menu-catalog.json`.
- `clips` contains presets plus up to 25 extracted clips. Use only listed ids.
- **Current format is not included in context.** If a request depends on
  format-specific safe area, ask the user which format is active.
- Only the last six chat messages are included in history.

The system also receives visual parts for image/canvas/area attachments and up
to four frames for a video, if the selected model supports vision.

---

## 4. Response parsing

The client parses one JSON object from the model. It accepts:

```json
{
  "reply": "string",
  "animation": {},
  "steps": [],
  "composition_fixes": [],
  "new_composition": {},
  "review": []
}
```

Application order:

1. If `new_composition.layers` is an array → create a new design variation.
   Otherwise, if `composition_fixes` is non-empty → apply fixes.
2. If `steps` is non-empty → call `/api/library/compose`.
   Otherwise, if `animation.tracks` is non-empty → save an animation.
3. If `animation.tracks` is empty and fixes exist → announce that motion was
   preserved.
4. `review` is printed independently.

Do not rely on a combined response. Prefer one intent per turn.

---

## 5. Composition fixes

The client validates keys and numeric values:

Allowed keys:

```
x y w h z opacity rotation text color align verticalAlign visible
font.sizePct font.family font.weight font.lineHeight font.letterSpacingEm
font.style font.transform
```

A fix is ignored if the layer id is not found or the key is not allowed.
Numeric fields must be finite. The client writes to `sa.comp` and offers Undo.

Not supported: changing `url`, `type`, adding/removing layers, replacing an
image, changing composition metadata.

---

## 6. Animation save

`POST /api/library/animations` validates:

- design exists;
- layer ids exist;
- segments have positive duration;
- frames are in range;
- no broken structure.

The client’s `saveAnimation()` additionally:

- keeps unlisted tracks only when `keepOthers: true`;
- clamps duration to 1–15 s;
- creates an `origin: "llm"` animation;
- saves to localStorage and, for library designs, the server;
- selects the new animation and opens the panel.

Important: the client’s track mapper currently forwards only
`t, dx, dy, sx, sy, a, e`. Do **not** put `r`, `clip` or `filter` in a generated
track frame. `r` exists in the renderer but is not part of this save path.

---

## 7. Steps / clips

`POST /api/library/compose` accepts:

```json
{
  "designId": "...",
  "name": "Assembled animation",
  "save": true,
  "steps": [
    { "target": "group-or-layer-id", "clip": "clip-id", "start": 0, "duration": 800, "stagger": 100 }
  ]
}
```

Rules:

- Only library designs can use `steps`.
- `target` must be a group id or layer id in the current context.
- `clip` must be present in the current `clips` list.
- `stagger` delays successive layer targets.
- Steps are saved and selected by the client.

---

## 8. New composition

`new_composition` is an advanced client capability:

```json
{
  "new_composition": {
    "name": "Night variant",
    "layers": [ /* complete layer objects */ ]
  }
}
```

The client creates a new design card from the current composition and the
supplied `layers`. There is no schema validation beyond “layers is an array”.
Use only when the user explicitly asks for a new composition/design. Prefer
`composition_fixes` for edits.

---

## 9. Source recording boundary

For 61 designs, selecting the design shows `sourcePoster`, and **Original
motion** plays `sourceVideo`. This is a recording of the HTML source.

- It cannot be edited by `composition_fixes`, `animation`, `steps` or
  `new_composition`.
- Generated animations and menu variations use the editable composition.
- Therefore a generated variation may be visually close but not identical to
  the source recording. Never claim source-level fidelity for a generated
  variation.

---

## 10. Menu boundary

The Menu item card exists only for designs in `menu-designs.json` (12 v1
designs). It is backed by the confirmed brand-pack catalogue.

- The model cannot create/delete menu items.
- The model cannot change the brand menu.
- The model must not fake a product swap in text layers.
- Menu variations are created by the client, one per item, and can be deleted.
- No v1 supported design has a verified product-image slot.

See [04-workflows.md](04-workflows.md#menu-item-workflow).

---

## 11. Persistence

- Animations saved for library designs go to the server and localStorage.
- Composition fixes and generated composition variations go to `sa.comp`.
- Locally generated animations go to `sa.anims`.
- Source recordings and menu catalogues are server data, not model-writable.
- The client immediately previews the result; the server response is the
  persistence record for library animations.
