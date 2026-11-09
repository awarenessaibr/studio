# Agent Canvas (clean canvas mode)

`/studio-agent-canvas` is the focused, canvas-only version of the Agent Studio.
It reuses the existing Agent Studio renderer, brand-template loader and animation
engine, but removes the navigation, inspector, timeline and side panels.

The existing `/studio-agent` page is unchanged so its tests and links keep
working. `/studio-agent-canvas.html` and `/studio-agent.html?clean=1` open the
same clean mode.

## Surface

- **Designs** (top-left): opens the design drawer. The feed contains every
  saved/published template for the active brand: the brand-template catalog plus
  templates published through the brand-template dialog.
- **Brand selector** in the drawer switches the source brand without leaving the
  canvas.
- **Animations** appear under the selected design:
  - **Original animation** — the motion embedded in the template's composition
    (layer `animation`, `animations` or `keyframes`).
  - **Saved** — generated animations stored for that specific template.
  - **Shared animation library** — entries from `/api/animation-library`, matched
    to the current design's layers by id, name, role and box.
  - **No animation** clears the timeline.
- **Groups** lists the semantic groups for the selected HTML composition
  (background, photography, menu items, prices, badges, body copy, contact,
  CTA). Clicking a group toggles it into the agent context. The group's layer
  ids and assets are sent to the model so it can assemble new motion from
  existing elements.
- **Compatibility filter**: shared-library animations are shown only when every
  track matches a layer in the current design. Saved generated animations are
  filtered the same way. Original motion is shown only when the composition
  actually has keyframes.
- **Formats** is a collapsible section. Selecting a format closes the list and
  returns to the animations.
- **Replay** is always visible at the bottom. Its label and tooltip show the
  selected animation, and it replays from zero.
- **Ask** opens a compact agent drawer for design changes, new/modified
  animations and reviews.

The stage is a fixed square viewport. The complete design is always fitted
inside it, so the full canvas remains visible while the surrounding chrome is
removed.

## Agent

`POST /api/agent-canvas` takes:

```json
{
  "prompt": "Review the animation and fix the headline",
  "composition": { "version": 3, "layers": [] },
  "animation": { "schema": "agent-studio/animation/2", "tracks": [] },
  "provider": "ollama",
  "model": "optional",
  "templateId": "…",
  "designName": "…"
}
```

The server strips inline image/video data before sending the JSON to the model.
It prompts the model to return JSON only:

```json
{
  "reply": "…",
  "observations": ["…"],
  "composition": null,
  "animation": null
}
```

- `composition` is a complete corrected composition, applied to the current
  design. Existing image URLs are restored by layer id when the model omits
  them.
- `animation` is a complete `agent-studio/animation/2` document, applied to the
  design and then **automatically saved** for that template. The chat confirms
  that it is saved and the animation appears in the design's animation list.
- `observations` are rendered as review notes.
- `reply` is the assistant summary.

Providers:

- **Ollama** (local): uses the configured text model from `/api/llm/models`.
  Start Ollama and install a text model (for example `qwen3.5:9b`).
- **DeepSeek**: set `STUDIO_DEEPSEEK_API_KEY` and
  `STUDIO_DEEPSEEK_MODEL` on the server. `STUDIO_DEEPSEEK_BASE_URL` defaults to
  `https://api.deepseek.com/v1`.

The provider selector shows auto/local/API options and disables unavailable
providers.

## Provider catalog

`GET /api/agent-canvas/providers` returns the text-capable providers for the
selector (Ollama availability is based on any installed model, not only vision
models) plus `defaultProvider`.

## Generated animation storage

Generated animations are stored per template in:

`data/settings/agent-canvas-animations.json`

API:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent-animations?templateId=…` | List saved animations for a template |
| `POST` | `/api/agent-animations` | Save a generated/modified animation |
| `DELETE` | `/api/agent-animations/:id` | Delete a saved animation |

Each record contains the full animation, template id/name, provider/model,
prompt and timestamps. This is why every generated motion remains selectable
for that design later.

## Agent library

The canvas uses the HTML-derived agent library for business/menu matching,
grouped layers and compatible animations. The library is rebuilt automatically
after new `*.composition.json` files appear under `data/projects`; it can also
be rebuilt manually with `npm run build:agent-library` or
`POST /api/agent-library/rebuild`. See
[agent-library.md](agent-library.md) for the index schema, build command and
API.

## Notes

- Applying an animation replaces the current timeline, matching the existing
  Agent Studio import behaviour.
- Original composition keyframes are converted to centre-based transform
  deltas so resizing layers (`sx`/`sy`) keeps their edges aligned.
- Clip-path motion is preserved when the source provides clip keyframes or
  frames.
