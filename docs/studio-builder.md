# Studio Builder

`/studio-builder` is a capability composer for the documented Studio Suite. It
does not render artwork itself: it arranges the real modules into the five page
regions, validates the rules from the capability map, and embeds the real studio
surface selected by the stage renderer as a live preview.

The page file stays at `pages/Studio Builder.html`; the server maps the clean
URLs `/studio-builder`, `/studio-builder.html`, `/builder` and
`/Studio Builder.html` to it.

---

## 1. What it does

| Area | Behaviour |
|---|---|
| **Capability library** | 28 modules grouped by domain and searchable. Drag onto a region, or press **+** to add it in its default region. |
| **Screen** | Five regions — top bar, left panel, stage, right panel, bottom dock — plus the runtime strip for modules that run behind the screen. Drag to reorder or move; Delete removes a selected block. |
| **Rules** | Two renderers, Scene editor + Template editor, missing requirements and missing core modules are reported with a one-click fix. |
| **Details** | Source files, endpoints, requirements, docs and live server counts for the selected block. |
| **Plan** | Inspect the live stage, click or drag an element, assign it a capability and collect it in a cross-page project plan. Locate, apply to the layout, export/import and deploy the plan. |
| **Brief** | Layout, sizes, load order, sources, endpoints, live preview surface, rules, issues and add-ons. **Copy build brief** writes it to the clipboard; **Download layout** saves the same layout as JSON; **Import layout** loads it back. |
| **Deploy** | Writes a real page under `data/studio-builder/pages/<id>/` and serves it at `/built/<id>` immediately. The page has the composed regions, live module tiles and the selected surface running in the stage. |
| **Agent** | Local rules understand module names, region words and presets. Unknown requests go to the server model through the Agent First proxy. |
| **Live preview** | The stage embeds the real surface selected by its renderer and reports which globals actually loaded. |
| **Persistence** | Layout, panel sizes, theme and preview preference are remembered in `localStorage`. |

Presets: **Agent-first canvas** (`afs`), **Classic studio** (`classic`),
**Template production** (`template`) and **Blank screen** (`blank`). The same
select also lists the 13 studio pages from the admin navigation, with the admin
labels and links (see §2).

---

## 2. Server-owned catalog

The module list is no longer embedded in the page. It lives in
`src/shared/studio-builder-catalog.json` and is served by:

```text
GET /api/studio-builder/catalog
```

The response is the catalog plus live data:

```json
{
  "schema": "studio-builder/catalog/1",
  "source": "server",
  "modules": [{ "id": "D4", "name": "Timeline", "domain": "Editors", "region": "bottom", "requires": ["D3"] }],
  "regions": [{ "id": "stage", "label": "Stage" }],
  "presets": [{ "id": "classic", "label": "Classic studio", "regions": {} }],
  "rules": [{ "id": "single-renderer", "type": "at-most-one", "modules": ["C1", "C2", "C4"] }],
  "surfaces": { "layer-studio": { "url": "/studio-v2.html", "scripts": [] } },
  "rendererSurfaces": { "C1": "layer-studio", "C2": "asset-agent", "C4": "agent-first-canvas" },
  "startPages": [{ "id": "studio-v2", "source": "studio-v2.html", "label": "Studio", "surface": "layer-studio" }],
  "agent": { "endpoint": "/api/agent-first/chat", "mode": "studio-builder" },
  "addOns": [],
  "limitations": [],
  "live": {
    "brandPacks": { "count": 2, "firstBrand": {} },
    "fonts": { "count": 0 },
    "animations": { "count": 8 },
    "assets": { "total": 147, "verified": 44 },
    "library": { "count": 80, "ready": 58, "firstDesign": {} },
    "segments": { "counts": {}, "categories": 12 }
  }
}
```

The page caches the last good catalog in `localStorage["sb.catalog.v1"]`. The
status pill says **Server catalog** or **Cached catalog**, and **Sync** refetches
it. The live data is read from the same stores the studio surfaces use; the
catalog endpoint never calls Ollama or DeepSeek.

### Updating the catalog

`src/shared/studio-builder-catalog.json` is the maintained mirror of the
capability map. When a module is added, removed or renamed in the docs:

1. Edit the JSON entry (id, name, domain, default region, summary, sources,
   endpoints, requirements, aliases, docs).
2. Keep `rendererSurfaces` and `surfaces` in sync if the change affects a live
   preview.
3. Run `node --test tests/studio-builder.test.js`; the schema, dependency and
   preset validation is covered there.

---

### Starting from a documented page

The **Start from** select has two groups: the four presets, and **Pages**. The page list mirrors the admin navigation's studio pages (Management and the
two builder pages are intentionally excluded), with the admin labels and links:

| Start page | Label | Stage |
|---|---|---|
| `studio-v2.html` | Studio | Scene renderer / Studio surface |
| `agent-first-studio.html` | Agent-first | Agent-first page |
| `studio-agent.html` | Studio Agent | Brand template renderer |
| `studio.html` | Classic | Classic page |
| `studio-bkup.html` | Studio backup | Classic backup page |
| `studio-import.html` | Import | Import page |
| `asset-studio.html` | Asset Studio | Asset Studio page |
| `crawler.html` | Brand intake | Brand intake page |
| `library.html` | Library | Library page |
| `segments.html` | Segments | Segments page |
| `voice.html` | Voice | Voice page |
| `social.html` | Social | Social page |
| `afs.html` | AFS | AFS page |

The canonical list is `pages` in the catalog. Each entry declares a layout
strategy: `source` (modules whose source files name the page), `surface`
(modules mounted by that page), `modules` (an explicit list), or `classic`
(the classic preset for the backup page). Core and `all pages` modules are
always included. The studio-page part of the admin nav and the catalog are checked against each
other by `tests/studio-builder.test.js`, so a rename or a missing page fails
the suite.

Choosing a start page sets the base page for Deploy and makes the live preview
show that page's own surface. It also maximizes the stage and opens the Agent
panel, so the page can be inspected while continuing to work with the agent.
Use **Restore** to return to the Builder layout. Choosing a preset clears the
page preview and falls back to the renderer surface.

## 3. Live preview

The preview map is data-driven:

| Renderer | Surface | URL |
|---|---|---|
| `C1` Scene renderer | Studio (Layer Studio v2) | `/studio-v2.html` |
| `C2` Brand template renderer | Studio Agent (clean canvas) | `/studio-agent.html?clean=1` |
| `C3` Element capture | Studio Agent (clean canvas) | `/studio-agent.html?clean=1` |
| `C4` Agent-first canvas | AFS | `/afs.html` |
| `G2` Source-exact playback | AFS | `/afs.html` |

When a start page is active, its page surface wins over the renderer mapping. That is what lets Asset Studio, Library, Voice, Social and Brand intake preview their own real pages even though the capability map has no renderer for them. Without a start page the renderer mapping below is used.

The iframe is same-origin. A 1440×900 surface is scaled to fit the stage frame.
On load the builder inspects the iframe and reports the real globals it found
(`StudioCore`, `StudioBrand`, `LayerStudio`, `AssetEngine`,
`AssetStudioAnimation`, …) plus the canvas count. For the Agent First surface it
uses the page's `window.__agentFirstQA.select(id)` seam to open the first ready
library design, so the preview is not an empty canvas. **Expand** maximizes
the stage in the Builder, hides the capability library and keeps the Agent
panel open for inspection and follow-up; **Restore** returns to the layout.
**Open** opens the surface in a new tab.

The preview is deliberately a real page rather than a per-module mount. It
proves that `studio-core.js`, `brand-pack.js` and the surface's own scripts load
and run against real brand and library data. It does not yet mount one
capability into an arbitrary region; that needs a mount contract on each studio
page (see §8).

---

## 4. Agent

The local engine in `src/client/studio-builder/builder.js` handles requests
built on module names, aliases, region words and preset names. It also handles
`what's missing?`, explanations, undo/redo and preview toggles.

If the local engine cannot parse a request it posts to the Agent First proxy:

```http
POST /api/agent-first/chat
Content-Type: application/json

{
  "mode": "studio-builder",
  "message": "make this feel like a publishing desk",
  "layout": { "stage": ["C1"], "right": ["E1"], "runtime": ["A1"] },
  "history": [{ "role": "user", "text": "..." }]
}
```

The same handler is available at `POST /api/studio-builder/agent` as a clear
alias. The server:

1. reads the same catalog,
2. normalises the layout and drops unknown ids,
3. builds a builder-specific system prompt (catalog, regions, presets, rules,
   current layout and current issues),
4. calls DeepSeek or Ollama with the existing provider/credential rules,
5. parses one JSON object and **validates every action** against the catalog,
6. returns:

```json
{
  "ok": true,
  "provider": "deepseek",
  "model": "deepseek-flash",
  "reply": "Moved the timeline to the bottom and added guardrails.",
  "actions": [
    { "type": "move", "moduleId": "D4", "region": "bottom" },
    { "type": "add", "moduleId": "I1", "region": "right" }
  ]
}
```

Allowed actions are `add`, `move`, `remove`, `preset` and `explain`. Unknown
modules, regions, presets, action types and malformed payloads are dropped or
rejected. The browser applies the valid actions as one undoable layout change.
If no provider is configured the page reports the reason and keeps the local
rules working. API keys never reach the browser.

---

## 5. Layout, sizes and imports

- Layout key: `localStorage["sb.layout.v1"]` (the same key the first page used,
  so an existing layout still opens).
- Sizes key: `localStorage["sb.sizes.v1"]`.
- Preview preference: `localStorage["sb.preview.v1"]`.
- Base page for Deploy: `localStorage["sb.basePage.v1"]`.
- Project plan: `localStorage["sb.plan.v1"]`.
- Theme: `localStorage["sb.theme"]`.

Dragging the separators resizes the left, right, top and bottom regions. Each
separator is also a keyboard control: focus it and use the arrow keys (Shift for
a larger step). **Reset panels** restores the defaults. Sizes are included in
the downloaded layout and restored on import.

**Download layout** writes `studio-layout.json`:

```json
{
  "schema": "studio-builder/layout/1",
  "version": 1,
  "catalog": { "schema": "studio-builder/catalog/1", "version": 1, "source": "server" },
  "regions": { "top": [], "left": ["F1"], "stage": ["C1"], "right": ["E1"], "bottom": ["D4"], "runtime": ["A1"] },
  "basePage": "/studio-v2.html",
  "sizes": { "left": 190, "right": 190, "top": 72, "bottom": 96 },
  "plan": [],
  "preview": { "enabled": true, "surface": "layer-studio" }
}
```

---

## 6. Deployment

**Deploy** is in the top bar and in its own tab. It writes a real page on this
server and returns a URL immediately, so the built page can be opened as soon as
the request finishes.

### Request and response

```http
POST /api/studio-builder/deploy
Content-Type: application/json

{
  "name": "Classic studio page",
  "basePage": "/studio-v2.html",
  "layout": { "top": ["G1"], "left": ["F1"], "stage": ["C1"], "right": ["E1", "I1"], "bottom": ["D4"], "runtime": ["A1", "A2", "A3", "B1", "B3", "D3"] },
  "sizes": { "left": 190, "right": 190, "top": 72, "bottom": 96 },
  "preview": true
}
```

The server normalises the layout and sizes, validates the base page against the
catalog, uses the base page's surface for the stage (falling back to the
renderer's surface only when the page has none), and writes:

- `data/studio-builder/pages/<id>/index.html` — the deployed page.
- `data/studio-builder/pages/<id>/surface.html` — a redirect to the full surface.
- `data/studio-builder/pages/<id>/page.json` — the layout, sizes and metadata.

The response is the page summary:

```json
{
  "ok": true,
  "page": {
    "id": "classic-studio-page-20261111024500-ab12",
    "name": "Classic studio page",
    "url": "/built/classic-studio-page-20261111024500-ab12",
    "surfaceUrl": "/built/classic-studio-page-20261111024500-ab12/surface",
    "basePage": "/studio-v2.html",
    "surface": "/studio-v2.html",
    "moduleCount": 12
  }
}
```

### What the deployed page is

- The five composed regions are rendered server-side. Each capability is a tile
  with its name, id, summary and a live count badge where the module has a
  server store.
- The stage is an iframe of the selected **real studio surface**. For the
  template renderer it uses `/studio-agent.html?clean=1`; for the Agent First
  canvas it uses `/afs.html`; for the scene renderer it uses
  `/studio-v2.html`.
- `deployed.css` and `deployed.js` are the same server assets the builder uses;
  `deployed.js` fetches `/api/studio-builder/catalog` to hydrate the counts and
  adds a stage reload button.
- The stage header links to the full surface, and the top bar links to the base
  page, the layout JSON and Studio Builder.
- `/built/<id>` serves the page; `/built/<id>/surface` redirects to the full
  surface (including the clean-canvas query and a `deployed` marker).

### Managing deployments

```text
GET    /api/studio-builder/pages        list deployments
GET    /api/studio-builder/pages/:id    read one deployment record
DELETE /api/studio-builder/pages/:id    delete the page folder
```

The Deploy tab lists existing pages with Open, Full surface, JSON and Delete
actions. Deployment files are local to the Studio server; this is not a remote
hosting integration.

## 7. Stage picking and the project plan

The live stage is also a picker. This is how a user walks the real pages and
collects the building blocks they want in a project:

1. Choose a page in **Start from**. The page's real surface is loaded in the
   stage.
2. Press **Inspect** in the preview toolbar. A picker overlay covers only the
   scaled surface.
3. **Click** an element to pick it, or **drag** a rectangle to pick a region.
   Coordinates are mapped from the scaled parent overlay back into the iframe's
   1440×900 CSS pixels.
4. The **Plan** tab opens the picked element: tag/id/classes, selector, text,
   rectangle, the page, and capability suggestions. The suggestion list uses
   element/ancestor words plus DOM hints (timeline, inspector, agent, export,
   guardrails, assets, …). The select lets the user choose any of the 28
   capabilities; the page's own capabilities are listed first.
5. **+ Add … to project plan** saves the entry. It keeps the capability, page
   label/source/URL, selector, element text and location rectangle.

The plan is stored in `localStorage["sb.plan.v1"]` and survives page changes and
reloads. Entries group by page in the Plan tab, with **Locate**, **+ Layout** and
**Remove** actions:

- **Locate** reopens the source page’s start layout and highlights the stored rectangle.
- **+ Layout** adds that capability to the screen.
- **Apply to layout** adds every planned capability that is not already placed.
- **Deploy plan** deploys immediately with the plan (a plan-only page is valid);
  the deployed page renders a **Project plan** section grouped by page.
- **Download plan** / **Import plan** move the draft as
  `studio-builder/plan/1` JSON. The downloaded layout also carries `plan`.

The plan entry shape:

```json
{
  "id": "pick-1760000000000",
  "capabilityId": "D4",
  "capabilityName": "Timeline",
  "pageSource": "studio-v2.html",
  "pageLabel": "Studio",
  "pageUrl": "/studio-v2.html",
  "rect": { "x": 24, "y": 640, "width": 420, "height": 90 },
  "element": {
    "tag": "div",
    "id": "layerTimeline",
    "classes": "layer-timeline",
    "role": "",
    "label": "",
    "text": "Timeline",
    "selector": "#layerTimeline > .layer-timeline"
  },
  "pickedAt": "2026-11-11T00:00:00.000Z"
}
```

The server validates plan entries (known capability and start page, bounded
rectangle/strings) before writing them into the deployed page. It accepts a
deployment with an empty layout when the plan contains at least one valid
pick, so a plan can be rendered before the regions are composed.

## 8. Add-ons and remaining limits

Implemented in this pass:

| Add-on | Where |
|---|---|
| Live module preview | Stage embed, module detection, stage focus mode with Agent access, reload/open. |
| Server-owned catalog | `/api/studio-builder/catalog`, cache, sync, live counts. |
| Free-form agent fallback | `mode: "studio-builder"` on the Agent First proxy plus the alias endpoint. |
| Resizable regions | Four pointer/keyboard separators with persisted sizes. |
| Layout import | Brief tab file picker reading the downloaded layout. |
| Deploy as a running page | Deploy tab → `/api/studio-builder/deploy`, served at `/built/<id>`. |
| Stage picking + project plan | Preview **Inspect** → Plan tab; saved in `sb.plan.v1` and included in deploys. |

The Add-ons tab in the page shows the same descriptions and the live wiring
status. The remaining limits are deliberate:

- The preview embeds a whole surface, not an arbitrary module mounted into a
  region. A real per-module mount contract on each studio page is the next step.
- The catalog is a maintained JSON mirror. The docs are not parsed at runtime.
- The model fallback needs `STUDIO_DEEPSEEK_API_KEY` + `STUDIO_DEEPSEEK_MODEL`
  or a running local Ollama model.
- Layouts and project plans are browser-local; deployments are written under `data/studio-builder/pages` but there is no remote hosting or multi-user project store. Plans travel as JSON and are embedded in a deployment.

---

## 9. Files

| File | Purpose |
|---|---|
| `pages/Studio Builder.html` | The shell and tab structure. |
| `src/client/studio-builder/builder.js` | Catalog loading, layout, rules, preview, agent, brief, resize. |
| `src/client/studio-builder/builder.css` | Page, region and preview styles. |
| `src/client/studio-builder/deployed.css` | Styles for deployed pages. |
| `src/client/studio-builder/deployed.js` | Live counts and stage reload for deployed pages. |
| `src/shared/studio-builder-catalog.json` | Server-owned capability map. |
| `src/server/studio-builder.js` | Catalog validation, layout rules, agent contract, start pages and the deployed-page template. |
| `tests/studio-builder.test.js` | Node unit tests (catalog, rules, agent contract). |
| `tests/studio-builder.js` | Chromium checks for the page, live preview and deploy. |

Run the focused checks:

```bash
node --test tests/studio-builder.test.js
node tests/studio-builder.js
```

The browser check covers start pages, the live surfaces, stage picking and the
project plan, local agent commands, the rule fixes, separators,
brief/clipboard, layout download and an end-to-end deploy/list/delete round
trip.

Or through the package scripts:

```bash
npm run test:studio-builder
```
