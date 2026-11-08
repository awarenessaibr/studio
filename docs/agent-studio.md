# Agent Studio — `pages/studio.html`

Brand-wired, single-page layer composer with a rule-based agent, guardrails,
a 10-second animation timeline and a bridge into the Asset Studio drawing
engine.

| | |
|---|---|
| **URL** | `/studio.html` (`/pages/studio.html` 302-redirects to it) |
| **Source** | `pages/studio.html` — ~950 lines / 96 KB, one inline `<style>`, one inline IIFE |
| **Page title** | `Agent Studio`, then `<Brand> · Agent Studio` after a brand loads |
| **Served by** | `server.js` → `PAGE_ROUTES['/studio.html']` (`server.js:5324-5331`, served at `server.js:5413`), `Cache-Control: no-store` |
| **Runtime** | Browser only. No framework, no build step, no ES modules, no server-side save. |
| **Models** | None. The “agent” is a deterministic rule engine (`suggest()/concepts()`); there is no LLM call on this page. |
| **Primary storage** | `localStorage` (scene per brand+format) + URL query (`pack`, `brand`) |
| **Verified** | Local server on `:8008`, Chromium via Playwright, 1440×900 and 1500×950; clean console; boot, brand switch, agent apply, engine design, guardrails, timeline scrub, panels, offline demo and reload behaviour were exercised. |

> **Reading this document.** `path:line` references point at the current
> working tree (HEAD `6816dab` plus uncommitted changes to `pages/studio.html`).
> The page is 949 newline-terminated lines; the inline IIFE starts at line 179.

> **Documentation status.** Some docs still describe `/studio.html` as the
> old “classic studio” that loads `studio-core.js` + `_.js`. That page was
> replaced by the Agent Studio in commit `0d3161a`; this document describes
> what actually ships now. The references corrected here, and the ones still
> stale, are listed in §19.

**Contents**

0. [At a glance](#0-at-a-glance)
1. [What the page is — and is not](#1-what-the-page-is--and-is-not)
2. [Page anatomy](#2-page-anatomy)
3. [Boot sequence](#3-boot-sequence)
4. [State model](#4-state-model)
5. [Data flow maps](#5-data-flow-maps)
6. [Rendering pipeline](#6-rendering-pipeline)
7. [Brand system](#7-brand-system)
8. [Asset panel, drag-and-drop and the engine bridge](#8-asset-panel-drag-and-drop-and-the-engine-bridge)
9. [The Studio agent](#9-the-studio-agent)
10. [Guardrails](#10-guardrails)
11. [Timeline and animation](#11-timeline-and-animation)
12. [Persistence and URL state](#12-persistence-and-url-state)
13. [Input, keyboard and accessibility](#13-input-keyboard-and-accessibility)
14. [Dependency index](#14-dependency-index)
15. [Feature wiring matrix](#15-feature-wiring-matrix)
16. [Known bugs, dead code and constraints](#16-known-bugs-dead-code-and-constraints)
17. [Extension recipes](#17-extension-recipes)
18. [Verification log](#18-verification-log)
19. [Related documentation and stale claims](#19-related-documentation-and-stale-claims)
**Appendices:** [A — geometry](#appendix-a--default-geometry-geo-rects-are-xywhfontsize) · [B — defaults](#appendix-b--defaults-and-fixed-values) · [C — source map](#appendix-c--source-map)

---

## 0. At a glance

**What it does, in one paragraph.** The page loads brand groups from the
brand-pack API, lets you pick a group → brand → format, derives a theme
(ink / bone / accent / palette / fonts) from the brand’s own identity, and
builds an editable layer scene. You can select, drag, hide, recolour, resize
and delete layers; ask the right-hand “Studio agent” for rule-based changes;
drop brand logos, pack photography, library assets and simple elements onto
the canvas; import a design from the Asset Studio engine as artwork + live
text layers; run a guardrail report (safe zone, overflow, contrast, reading
order, minimum size, palette); and retime CSS animations on a 10-second
timeline. Scene edits are undoable in memory (history resets on brand, format
and engine-design switches) and persisted per brand + format in `localStorage`.

**Dependency summary**

| Kind | Count | Items |
|---|---|---|
| External scripts | 4 | `qrcode.min.js` (**loaded but unused**), `brand-pack.js`, `engine.js`, `categories.js` |
| Globals consumed | 3 | `window.StudioBrand`, `window.AssetEngine`, `window.AssetCategories` |
| JSON endpoints | 5 | brand-pack list, brand-pack detail, font list, asset list, asset usage |
| File URL families | 2 | `/api/brand-packs/:pack/files/…`, `/api/assets/:id/file/:variant` |
| Font file fetches | 22 | every file in `data/fonts`, eagerly loaded at boot |
| DOM ids | 35 static + 20 dynamic | §14.4–14.5 |
| `localStorage` keys | 5 | panels, collapsed sections, scene, last selection, last brand per pack |
| URL params | 5 read, 2 written | `pack`, `packId`, `brand`, `brandId`, `format` / writes `pack`, `brand` |
| Outbound pages | 4 | Asset Studio, Library, Brand intake, Studio V2 |
| CSS keyframes | 4 | `fadeIn`, `zoom`, `parallax`, `pulse` |
| CSS custom properties | 12 | §14.9 |
| Network calls for agent/guardrails | 0 | both are local, synchronous logic |

---

## 1. What the page is — and is not

| It is | It is not |
|---|---|
| A brand-aware layer editor for one composition at a time | A multi-format document editor (format switching UI is effectively dead in the shipped build — §16) |
| An agent **proposer**: cards preview a command batch, then you apply it | An autonomous agent; it never calls a model and never edits without a click |
| A guardrail checker with one-click fixes | A hard export gate; guardrails are advisory |
| An Asset Studio design importer that splits artwork and text | A full Asset Studio replacement (no PNG/PDF export here) |
| A CSS-animation timeline (presets only) | A keyframe editor; timing is `start`/`duration` per layer |
| A client-side editor saved in `localStorage` | A server-persisted project; clearing browser storage loses edits |

**Business position.** It is the “compose and tweak a brand scene” surface
between Asset Studio (finished artwork) and Layer Studio v2 (`/`, full
composition/animation/export). The header links to both.

---

## 2. Page anatomy

### 2.1 Wireframe

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ A  Agent Studio  [Brand group ▾]  [● La Casa][● Le Bistrot] …   Asset Studio │ 48 px
│                                                   Library  Brand intake  V2   │
│                                                   ↶ Undo   Reset scene        │
├───────────────┬─┬────────────────────────────────────────────┬─┬──────────────┤
│ Brand Library │ │ ▶ Replay   ☐ Safe zone   ✓ Guardrails      │ │ ● Studio     │
│ Templates El. │ │                                    status  │ │   agent      │
│               │ │            ┌──────────────────┐            │ │ [Clear chat] │
│ LOGOS         │ │            │                  │            │ │              │
│ [ ][ ][ ]     │ │            │      STAGE       │            │ │ messages     │
│ PHOTOGRAPHY   │◀│            │  (FMT aspect)    │            │▶│ + cards      │
│ [ ][ ][ ]     │ │            │                  │            │ │              │
│               │ │            └──────────────────┘            │ │ quick        │
│ BRAND PALETTE │ │                                            │ │ prompts      │
│ ● ● ● ● ● ●   │ │ ▶ Play  [======●==========] 10.00/10.00 s  │ │ context      │
│ LAYERS        │ │ ┌────────┬───────────────────────────────┐ │ │ [ask…][Send] │
│ ▸ Headline    │ │ │ ruler  │ 0s 1s 2s … 10s               │ │ │              │
│ ▸ …           │ │ │ rows   │ bars for animated layers      │ │ │              │
│               │ │ └────────┴───────────────────────────────┘ │ │              │
└───────────────┴─┴────────────────────────────────────────────┴─┴──────────────┘
  270 px (200–420)        main (1fr)                        10 px   390 px (280–560)
```

### 2.2 Regions

| Region | DOM | CSS | Contents | Notes |
|---|---|---|---|---|
| Boot overlay | `#boot` → `#bootMsg`, `#bootActs` | 129–131 | status text + action buttons | `role=status`, covers page until hidden |
| Toast | `#toast` | 132–133 | transient message | 3.2 s timer, `.err` red |
| Header | `header` | 32–41 | logo, group `<select>`, brand pills, offline badge, 4 links, undo/reset | 48 px row, wraps on mobile |
| Left sidebar | `aside` | 42–80 | asset tabs/panel, palette, type line, layers | independent scroll |
| Resize handles | `.resize-handle[data-resize]` | 17–25 | left and right splitters | 10 px; role=separator; collapsible |
| Main toolbar | `.tb` | 82–83 | Replay, Safe zone, Guardrails, status | wraps |
| Canvas | `#wrap` → `#stage` | 84–92 | the composition | stage keeps format aspect ratio |
| Timeline | `.tl` → `.tlh`, `#tlb` | 116–127 | play, scrub, time, ruler, layer rows | 178 px tall |
| Agent panel | `section.agent` | 93–115 | header, `#chat`, `#ctxMenu`, `#qp`, `#ctx`, form | 390 px default |
| Floating menu | `#ctxMenu` | 99–102 | “Delete layer” | effectively unreachable — §16 |

### 2.3 Grid and responsive rules

```css
#app{--left-panel:270px;--right-panel:390px;height:100%;
  display:grid;
  grid-template-columns:var(--left-panel) 10px 1fr 10px var(--right-panel);
  grid-template-rows:48px 1fr}
```

- Left panel: min 200, max 420, default 270 (`PANEL.left`, line 196).
- Right panel: min 280, max 560, default 390 (`PANEL.right`).
- Dragging a handle more than 40 px past its minimum collapses that panel to
  `0px` and leaves only the 10 px handle (`onResizeHandleMove`, 206–211).
- Double-click, Enter/Space or drag-back reopens at the last width.
- Arrow keys resize by 16 px when the separator has focus.
- Panel widths persist in `agentStudio.panels.v1`; a stored `0` reopens collapsed.
- At `max-width:980px` the handles are hidden, the grid becomes one column,
  `aside` is capped at 300 px, `.wrap` becomes 80vh and `.agent` 70vh
  (line 134). Collapse classes are forced back to `visible`.

**Collapsible sections.** Every `<h3>` inside the sidebar (and every `<h3>`
in a re-rendered asset panel) is turned into a disclosure button by
`wrapSections()` (238–247): it wraps the following siblings in `.sec-body`,
adds `role=button`, `tabIndex=0`, `aria-expanded`, a rotating `▾`, and
persists the collapsed set under `agentStudio.collapsed.v1`. The key is the
first text node of the heading, lowercased — e.g. `brand palette`, `layers`,
`design type`, `designs`, `motif`, `text size`.

---

## 3. Boot sequence

### 3.1 Load order

1. `#boot` markup is visible immediately; the page body is otherwise empty of content.
2. Four classic scripts load in `<head>` (136–139), **before** the inline app:
   - `/src/client/asset-studio/vendor/qrcode.min.js`
   - `/src/shared/brand-pack.js` → `window.StudioBrand`
   - `/src/client/asset-studio/engine.js` → `window.AssetEngine`
   - `/src/client/asset-studio/categories.js` → `window.AssetCategories`
3. `const DEMO_PHOTO="__PHOTO__"` is defined (177). **This literal is never
   replaced by the server**; see §16.
4. The IIFE (179–949) runs to the end, binds all handlers, then calls
   `boot()` (948).

### 3.2 `boot()` (932–945)

```
FMT = FMTS[0]  (A4 portrait)
buildFormats()  (no-op-ish before a panel exists; null-guarded)
bootMsg('Agent Studio / Loading brand groups…')
Promise.all([
  GET api/brand-packs        → d
  loadFonts()                → GET api/fonts, then every font binary
])
  ├─ error → boot failure screen (§3.4)
  └─ PACKS = d.packs
       if empty → throw 'No brand packs are available.'
       resolve pack:
         1. a pack containing ?brand / ?brandId
         2. ?pack / ?packId if it exists
         3. last pack from agentStudio.last.v1
         4. first pack
       optional ?format / last.fmt if it matches FMTS
       P = GET api/brand-packs/:id   (packFull, cache)
       buildGroupSelect(); buildBrandPills()
       resolve brand:
         1. ?brand / ?brandId
         2. last brand for this pack (last.v1)
         3. lastBrands.v1[packId]
         4. first brand
       await selectBrand(brandId)
       #boot.hidden = true
```

`loadFonts()` (354–355) registers **all** uploaded fonts before any brand is
selected:

```js
const ff = new FontFace(f.family, `url("${f.url}")`, { weight: '100 1000' });
await ff.load();
document.fonts.add(ff);
UF.push(f);
```

Failure per font is swallowed; a font that cannot load simply never matches
`stackFor()`. In the verified run this produced 1 font-list request + 22 font
binary requests.

### 3.3 `selectBrand()` (900–912)

```
token = ++selTok                       (guards against fast brand switching)
saveScene()                            (save the outgoing brand under its old key)
disable all #brands buttons
B = brand; deriveTheme(B); BF = brandFonts(B)
hist=[]; sel=null; seen=new Set(); stopP(); T=DUR
await Promise.all([
  brandLogos(B),                       (wordmark + mark → canvases)
  engMedia(B),                         (up to 9 photos for the engine)
  document.fonts.ready
]).catch(noop)
if (token !== selTok) return            (a newer click won)
ensurePx(first photography URL)         (140 px pixel sample for contrast)
fitStage(); sizeProbe()
saved = loadScene()
scene = saved || (FMT.eng && hasEngine() ? engBuild() : fitScene(buildScene('classic')))
enable brand buttons
chrome(); render(); layers(); assets(); greet(); remember(); loadLibrary(B)
#status = `${B.name} · ${FMT.n}`
```

Ordering matters: `chrome()` fills the palette/type/links, `render()` paints
the stage, `layers()` triggers the guardrail debounce and the 400 ms save,
`assets()` fills the sidebar, `greet()` resets the chat, `remember()` writes
the URL, and `loadLibrary()` fetches the business asset library.

### 3.4 Failure and offline demo

If `boot()` throws, `bootMsg()` replaces the overlay with a message and two
buttons (923, 944–945):

- If the error text matches `/fetch|network|failed|load/i`:
  “Start the local studio server with `node server.js`, then reload.”
- Otherwise the raw message is shown (HTML-escaped).
- **Reload** → `location.reload()`
- **Open offline demo** → `startDemo()`

`startDemo()` (930–931) builds one in-memory pack (`demoPack`, 924–929) with
“The Physician”, 6 palette entries, Georgia/Helvetica, no logos, one
photography entry whose URL is the literal `__PHOTO__`, and an address /
website. It sets `demo=true`, shows `#net` (“Offline demo”), skips
`loadFonts()`, builds the UI, and selects the demo brand. Scenes are **not**
saved or loaded while `demo` is true.

**Verified offline run:** aborting `api/brand-packs` produced the server hint,
the two buttons, then a working demo with 7 palette swatches and a photo layer
styled `url("__PHOTO__")` (a broken image — §16).

---

## 4. State model

### 4.1 Globals

| Symbol | Line | Type | Meaning |
|---|---|---|---|
| `API` | 189 | `'api'` | relative API prefix; every fetch is same-origin |
| `stage`, `wrapEl`, `chat`, `appEl` | 189–190 | elements | cached nodes |
| `clone` | 191 | fn | JSON deep clone for history/commands |
| `esc` | 192 | fn | HTML-escapes `& < > "` |
| `clamp` | 193 | fn | numeric clamp |
| `LS` | 194 | object | localStorage JSON wrapper (`get/set/del`, all failures caught) |
| `jget` | 195 | async fn | fetch JSON, `cache:'no-store'`, throws `{error}` or status |
| `PACKS` | 262 | array | pack summaries from `api/brand-packs` |
| `P` | 262 | object/null | full selected pack (`brands[]`) |
| `B` | 262 | object/null | selected brand |
| `FMT` | 262 | object/null | active format (`{id,group,n,w,h,eng?}`) |
| `TH` | 262 | object | theme `{ink,bone,accent,chalk}` |
| `PAL` | 262 | object | palette name → hex |
| `BF` | 262 | object | brand fonts `{display,body,dW,bW,dName,bName}` |
| `scene` | 263 | array | current layer list |
| `sel` | 263 | string/null | selected layer id |
| `hist` | 263 | array | undo stack of cloned scenes |
| `uid` | 263 | number | per-session id suffix for new layers |
| `demo` | 263 | boolean | offline demo mode |
| `selTok` | 263 | number | brand-switch race token |
| `UF` | 263 | array | uploaded font descriptors |
| `packCache` | 264 | Map | packId → full pack |
| `IMG` | 264 | Map | URL → `Promise<Image>` |
| `PXC` | 264 | Map | URL → `{w,h,d:Uint8ClampedArray}` 140 px sample |
| `TINT` | 264 | Map | `brand / which / colour` → tinted logo data URL |
| `AS` | 265 | object | asset panel state `{tab, lib:{status,items,cls,verified,err}}` |
| `ENG` | 518 | object | engine bridge state (§8.4) |
| `cur` | 800 | array | last guardrail issues |
| `seen` | 800 | Set | issue keys already announced |
| `T` | 834 | number | playhead ms (0…10000) |
| `playing` | 834 | boolean | rAF loop active |
| `raf` | 834 | number | rAF handle |
| `wt`, `st` | 470 | numbers | guardrail save debounce timers |
| `toastT` | 248 | number | toast timer |

Guardrail labels and constants:

- `LABEL` (801): `SAFE_ZONE`, `OVERFLOW`, `HIERARCHY`, `CONTRAST`, `MIN_SIZE`,
  `BRAND_COLOR`.
- `DUR = 10000` (834).
- `MASTER_IDS` (319): `ground, photo, logo, headline, subhead, body, cta, footer`.

### 4.2 Layer schema

All geometry is **percent of the page**: `x/w` against canvas width, `y/h`
against canvas height. `font.sizePct` is percent of canvas **height**
(`cqh` in CSS).

| Field | Type | Used by | Notes |
|---|---|---|---|
| `id` | string | all | master ids or `kind-<uid>` / `t1…tN` |
| `name` | string | list, timeline, chat, guardrails | display name |
| `type` | `fill` \| `gradient` \| `shape` \| `image` \| `logo` \| `text` | render | selects style branch |
| `x,y,w,h` | number (%) | render, drag, guardrails | bounding box |
| `z` | number | render, timeline order | higher = in front |
| `opacity` | 0…1 | render, contrast | multiplies layer opacity |
| `hidden` | boolean | render/list/timeline | hidden layers are skipped |
| `color` | hex/rgba | fill, shape, text | text colour for text |
| `from`, `to` | rgba | gradient | CSS `linear-gradient(from,to)` (top → bottom) |
| `radius` | number (cqh) | shape/text bg | border radius |
| `src` | URL/data URL | image | photo or rendered art |
| `fit` | `cover` \| `contain` | image | background sizing |
| `fx`, `fy` | 0…100 | image | background-position percentages |
| `which` | `wordmark` \| `mark` | logo | logo cut |
| `tone` | `white` \| `ink` \| `accent` | logo | tint colour |
| `text` | string | text | literal copy |
| `font` | object | text | `{family,weight,sizePct,lineHeight,letterSpacingEm,transform}` |
| `bg` | colour | text | badge/box background |
| `align` | `left` \| `center` \| `right` | text | horizontal alignment |
| `nowrap` | boolean | text | `white-space:pre`; engine text uses it |
| `anim` | object | render/timeline | `{preset,start,duration}` in ms |
| `assetId` | `ast_…` | library assets | stored but only used for usage logging |
| `pal` | object | engine art | palette override saved for variants |

Example:

```js
{
  id: 'headline', name: 'Headline', type: 'text',
  x: 8, y: 53, w: 84, h: 16, z: 12, opacity: 1,
  text: 'Spanish tapas, Greek mezze, made for sharing.',
  font: { family: '"Playfair Display",serif', weight: 400,
          sizePct: 6.2, lineHeight: 1.04, letterSpacingEm: 0, transform: 'none' },
  color: '#2b2b2b'
}
```

### 4.3 Command schema

Commands are plain objects consumed by `run(scene, cmds)` (426–433). They are
a **lightweight subset** of `improvements/layer-studio-agent-commands.schema.json`
(no `sceneId`, `baseRevision`, validation, or rejection semantics).

| `type` | Payload | Effect |
|---|---|---|
| `set-layer` | `{layerId, patch}` | assign fields; a `font` patch is merged into the existing font object |
| `add-layer` | `{layer}` | push a complete layer |
| `remove-layer` | `{layerId}` | splice it out |
| `swap-asset` | `{layerId, asset}` | sets `layer.tone` (logo tone swap) |
| `variant` | `{variant}` | rebuild the whole scene (`night`/`accent`/`framed`/`classic`) |
| `set-animation` | `{layerId, preset, startMs, durationMs}` | `anim = {preset, start, duration}` |
| `clear-animation` | `{layerId}` | delete `anim` |

Helpers: `S(id, patch)` and `A(id, preset, start, duration)` (767).
`commit(cmds)` (434) clones the scene into `hist`, runs the commands, clears a
stale selection, re-renders, refreshes panels, and auto-plays when the batch
contains a `set-animation`.

### 4.4 Engine state (`ENG`, 518)

| Key | Default | Meaning |
|---|---|---|
| `cat` | `flyer` | key in `AssetCategories` |
| `tpl` | `0` | template index in the category |
| `size` | `0` | index in `engSizes()` |
| `wired` | `false` | true after the first `engApply()`; only affects the selected-card outline |
| `motif` | `auto` | `auto`, `logo`, a `VECTORS` id, or `none` |
| `motifOn` | `true` | false when `motif === 'none'` |
| `motifScale` | `1` | 0.3…2.5 |
| `motifX`, `motifY` | `0` | −0.45…0.45 (percent /100) |
| `textScale` | `1` | “All text” multiplier |
| `flat` | `false` | true for multi-side / die-cut designs; text baked into art |
| `palTmp` | undefined | temporary palette override during variant rendering |

`ENG_TPL_IDS` (519) maps categories to brand-pack template ids for
`StudioBrand.paletteRoles`:
`flyer→flyer, menu→menu, voucher→voucher, bizcard→business-card-front,
tablecard→table-card, social→social-post, signage→flyer, guest→table-card,
stationery→flyer, packaging→voucher, compliance→menu`.

### 4.5 Asset-panel state (`AS`, 265)

```js
AS = { tab: 'brand', lib: { status:'idle', items:[], cls:'', verified:false, err:'' } }
```

`status` is `idle | loading | ok | error`. `items` are API summaries (never
more than 100 requested, 60 shown). `cls` and `verified` are filters. Panel
tab state is **not** persisted.

---

## 5. Data flow maps

### 5.1 Boot and brand ingestion

```
data/brand-packs/*/pack.json ──┐
data/settings/groups.json ─────┤ server filters hidden groups
                               ▼
GET api/brand-packs ──► PACKS ──► #grp options
GET api/fonts + binaries ──► FontFace + UF
URL ?brand/?pack + LS last ──► chosen ids
GET api/brand-packs/:id ──► P (cached) ──► #brands pills

B.palette     ──► deriveTheme ──► TH + PAL ──► #sw, scene colours, readable()
B.typography  ──► brandFonts  ──► BF        ──► #ty, every text layer
B.logos       ──► brandLogos  ──► _logos    ──► logoSrc() tint ──► logo layer
B.photography ──► engMedia / ensurePx        ──► engine state, contrast sampling
B.guidelines  ──► contact/siteOf/copyFor    ──► headline, sub, body, CTA, footer
                                                    │
                                                    ▼
                        buildScene() / fitScene() / engBuild()
                                                    ▼
                                              scene[] ──► render() ──► #stage
```

### 5.2 Render loop

```
interaction (select, drag, palette, drop, chat apply, timeline, slider, undo…)
        │
        ▼
  mutate scene[] or ENG
        │
        ▼
  render(scene, stage)                 # rebuilds .L nodes from scratch
        │
        ▼
  layers()                             # 471
    ├─ list()        → #layers rows
    ├─ ctx()         → #ctx + quick prompts
    ├─ engSyncSel()  → #engSel slider
    ├─ tl()          → timeline rows + playhead
    ├─ 30 ms → watch() → check(scene) → #gc + chat flags
    └─ 400 ms → saveScene() → localStorage
```

### 5.3 Agent → command → scene

```
user types / clicks a quick prompt
        ▼
ask(text) ──► say('user', text)
        └─ 300 ms later:
             no selection → concepts() subset (cards)
             selection    → suggest(layer, text) (cards)
                                │
               card hover ──────┤ run(clone(scene), cmds) → render(temp)
                                │   check diff → “introduces …” or clean
                                │   mouseleave → render(scene)
               card JSON ───────┤ <pre>JSON.stringify(cmds)</pre>
               card Apply ──────┘ commit(cmds)
                                    ├─ hist.push(clone(scene))
                                    ├─ run(scene, cmds)
                                    ├─ render(); layers()
                                    └─ if animation → play(0) after 60 ms
```

### 5.4 Guardrails

```
layers() ──30 ms──► watch()
                      ├─ cur = check(scene)
                      │    ├─ sizeProbe(); render(scene, probe)
                      │    ├─ Range rects for every visible text layer
                      │    ├─ bgAt() background compositing (pixel samples)
                      │    └─ rule checks → issues[{code,id,key,msg,fix}]
                      ├─ list()            (⚠ markers)
                      ├─ #gc label          (✓ clear / ⚠ N issues)
                      └─ new issue keys → flag(new, 'I noticed') → chat cards
                                                    │
                                              Apply / Fix all
                                                    ▼
                                             commit(fix commands)
```

### 5.5 Timeline

```
#tpl / #play ──► play(from)
                   └─ rAF loop → seek(now - start)
#scrub ─────────► stopP(); seek(value)
ruler drag ─────► seek(pointer position)
bar drag ───────► anim.start / anim.duration
                   ├─ pxb() moves the bar
                   ├─ render() + seek(T)
                   └─ on release: tl(), chat note, saveScene()

seek(t):
  T = clamp(0…10000)
  for each stage [data-an]:
      animationDelay = anim.start - T   # CSS animation is already paused
  #scrub.value = T
  #tt = "T/1000 / 10.00 s"
  #tlb --p = T / DUR                 # moves .ph playhead
```

### 5.6 Asset drop

```
dragstart on .asset[data-k] → dataTransfer.setData('k', payload)
drop on #wrap → stage-relative px% → addAsset(kind, a, b, px, py)
   ├─ build layer geometry (box()/at())
   ├─ hist.push(clone(scene))
   ├─ scene.push(layer)
   ├─ say('agent', 'Added <name>…')
   └─ select(layer.id) → render + layers
```

### 5.7 Persistence

```
scene mutation ──► layers() ──400 ms──► saveScene()
                                          └─ LS.set('agentStudio.scene.v2:B:FMT', {v:2,scene})

brand switch ──► saveScene() before B/FMT changes
format switch ─► saveScene() before FMT changes
engine apply ──► saveScene() before FMT becomes the engine key
reset ─────────► LS.del(sceneKey()) then build classic scene

boot ──► last/URL ──► selectPack ──► selectBrand ──► loadScene()
                                                        └─ validate v2 + ground/photo/headline
```

### 5.8 Engine bridge

```
AssetCategories (11 categories)
   └─ engPanel() → selects, design thumbnails, motif grid, sliders
AssetEngine
   ├─ renderThumb()        → design cards
   ├─ drawVectorPreview()  → motif cards
   ├─ templateUsesMotif()  → show “Auto”
   ├─ VECTORS              → motif list
   └─ render()             → thumbnails, art, variants

click design / size / category
   └─ engApply()
        ├─ SAEng.saveScene()
        ├─ FMT = { id:`eng:cat:tpl:size`, eng:true, w,h from size }
        ├─ engBuild()
        │    ├─ pass 1: boxes proxy captures text runs (font/colour/pos)
        │    ├─ pass 2: fillText disabled → artwork JPEG
        │    └─ layers: ground + art + grouped text (t1…tN)
        └─ render/layers/assets/greet/remember

motif / motif sliders → engRefreshArt()  (re-render art only, keep text)
all-text / one-text   → engSizeLayer()   (scale font + box, keep alignment)
variant command       → engVariant()     (repalette, keep text edits)
```

---

## 6. Rendering pipeline

### 6.1 `render(sc = scene, tgt = stage)` — 437–456

1. `tgt.innerHTML = ''`.
2. Copy and sort by `z` ascending (stable, so equal-`z` text keeps insertion order).
3. Skip `l.hidden`.
4. Create `div.L`, set `left/top/width/height` as `%`, `zIndex`, `opacity`,
   `data-id`, and a pointerdown handler.
5. Type-specific styling:

| Type | Styling |
|---|---|
| `fill` | `background: color` |
| `gradient` | `background: linear-gradient(from, to)` (top → bottom) |
| `shape` | `background: color`, `border-radius: radius cqh` |
| `image` | if `src`: `url(src) fx% fy%/cover` or `center/contain`; if no `src`: `linear-gradient(135deg, TH.ink, TH.accent)`; calls `ensurePx(src)` |
| `logo` | `.T` flex; tinted data URL from `logoSrc(which, tone)` in an `<img object-fit:contain>` aligned left/center/right by x position; without a logo file, the brand wordmark/name in display type |
| `text` | `.T` flex; `justify-content` from `align`; `fontFamily/Weight/Size(cqh)/LineHeight/LetterSpacing/Transform`; optional `bg` + `radius` + centre; `nowrap` → `white-space:pre`; `textContent` |

6. Animation (if `l.anim`):
   ```js
   e.dataset.an = 1;
   e.style.animation =
     `${preset} ${duration}ms ${preset==='pulse'?'ease-in-out infinite':'ease-out'} ` +
     `${start - (tgt===stage ? T : DUR)}ms both paused`;
   ```
   The animation is **always paused**; scrubbing only changes the delay
   (negative delay seeks into the animation, positive delay holds the start).
7. Selection: only when rendering the live scene to the stage
   (`sc===scene && tgt===stage && l.id===sel`) add `.sel` and a `.chip` with
   the layer name.
8. Append.

Because `font-size` is in `cqh` and `.stage{container-type:size}`, `1cqh` is
1 % of the stage height — so a `sizePct` of 6.2 is exactly 6.2 % of the canvas
height at any stage pixel size.

### 6.2 Stage fitting

`fitStage()` (464–465) reads the wrap’s content box (minus padding) and sets
the stage to the largest size that fits `FMT.w / FMT.h`:

```js
const ratio = FMT.w / FMT.h;
const w = Math.min(pw, ph * ratio);
stage.style.width  = Math.floor(w) + 'px';
stage.style.height = Math.floor(w / ratio) + 'px';
```

A `ResizeObserver` on `#wrap` re-fits and reruns guardrails 60 ms after a
resize (946). On browsers without `ResizeObserver`, a `resize` listener is used.

### 6.3 Off-screen probe

`probe` (466) is a fixed, off-screen `.stage` clone (`left:-99999px`,
`aria-hidden`). `sizeProbe()` copies the live stage’s client size into it.
It is used to:

- fit text (`fitScene`),
- measure text overflow and contrast boxes (`check`),
- measure the guardrail diff for a proposed command batch (`say` cards); the
  batch itself is previewed on the live stage, then reverted on mouseleave.

### 6.4 Text fitting (`fitScene`, 418–423)

`fitScene(sc)` renders the scene into the probe and shrinks each visible text
layer until its Range no longer exceeds the element box:

```js
while (overflow && sizePct > 1 && n++ < 16) {
  sizePct = +(sizePct * 0.92).toFixed(2);
}
```

- Overflow = Range width > `clientWidth + 1.5` **or** height > `clientHeight + 1.5`.
- At most 16 iterations (≈ −74 % size), floor 1 % of height.
- It mutates the layer objects and returns the scene.
- Used for the classic brand scene; engine scenes rely on the engine’s own
  layout and are not auto-fitted.

### 6.5 Selection and dragging (`down`, 457–461)

- Pointerdown selects (if not already), then returns immediately for `fill`.
- On the first pointer move it pushes a history snapshot.
- Position is `(origin + delta / stageRect) * 100`, rounded to 0.1 %.
- The element’s style is updated live; `layers()` runs on pointerup (which
  re-renders, refreshes rows, saves, and re-checks guardrails).
- A chat note reports the final x/y.
- No clamping: a layer can be dragged off-canvas; the guardrail will flag it.

### 6.6 Logos, images, pixel sampling

- `loadImg` (358) caches a promise per URL, rejects after 9 s.
- `trimImg` (359–364) crops transparent padding by scanning alpha > 8.
- `brandLogos` (365–372) chooses a non-presentation wordmark/logo and a mark,
  trims both, stores `{canvas, aspect}` on `brand._logos` (idempotent).
- `logoSrc` (373–376) tints the trimmed canvas by drawing it and filling with
  `source-in`, caches the PNG data URL per brand/cut/colour.
- `ensurePx` (377–380) draws each image to a 140 px-wide canvas and stores
  `ImageData` in `PXC`; it calls `layers()` when the sample is ready so
  contrast checks can refine.
- Engine photos: `engMedia` loads up to 9 `B.photography` URLs into
  `B._engPhotos`; failures are filtered out.

### 6.7 Copy is never invented

`copyFor()` (386–389) only rearranges brand fields:

| Slot | Source |
|---|---|
| Headline | `B.tagline` → first sentence of `guidelines.positioning` → `B.name` |
| Sub-headline | first sentence of positioning (if different from tagline) → `B.name` |
| Body | full positioning if it differs from head/sub, capped at 220 chars |
| CTA | `Visit <site>` → `Find out more` |
| Footer | `Address · site` |

`siteOf()` strips the protocol and trailing slash from `Website` or `B.url`.
`contact(field)` matches `guidelines.contact[].field` case-insensitively.
`copyOptions()` exposes unique alternative strings for the agent’s rewrite
cards (headline/subhead/CTA/body), still derived only from brand fields.

---

## 7. Brand system

### 7.1 What the page reads from a brand

| Field | Use |
|---|---|
| `id`, `name` | keys, labels, title, fallback wordmark |
| `wordmark`, `tagline`, `url` | logo fallback, copy, CTA site |
| `palette[].name`, `.hex` | theme + `PAL` swatches |
| `typography.families[]`, `.scale[].family` | display/body font selection |
| `logos[]` (`url,name,kind,variant,format,presentation,width,height`) | logo layers, engine logo |
| `photography[]` (`url,name,width,height`) | hero photo, engine photos, library-like panel |
| `guidelines.positioning` | headline/sub/body copy |
| `guidelines.contact[]` (`field,value`) | address, website, Instagram, email |
| `templates[]` (optional) | template fallback catalogue (not present in current packs) |
| `_logos`, `_engPhotos` | page-added caches |

`packFull()` requires `{pack:{brands:[…]}}` and at least one visible brand;
otherwise it throws “The brand group contains no brands.”

### 7.2 Theme derivation (`deriveTheme`, 322–333)

1. Read `B.palette`, normalise 3-/6-digit hex (`hx`), drop invalid and duplicate hex.
2. Sort by relative luminance ascending.
3. `ink` = darkest colour **iff** its luminance < 0.2, else `#17162e`.
4. `bone` = lightest colour **iff** its luminance > 0.6, else `#f4f1ec`.
5. `accent` = the most saturated colour that is not ink/bone, **iff**
   saturation > 0.25, else `#e1543a`.
6. `TH = {ink, bone, accent, chalk:'#ffffff'}`.
7. `PAL` = brand entries in original order (unique hex), then `Ink`, `Bone`,
   `Accent`, `Chalk` if their hex is still unused; duplicate names get ` 2`.

The `role` field in a palette entry is ignored; the algorithm uses luminance
and saturation, then `readable()` / `engPal()` make per-placement choices.

`readable(c, bg)` (334) returns `c` when contrast ≥ 4.5:1, otherwise the best
of `TH.ink`, `TH.bone`, `TH.chalk` against `bg`. It is used for the accent
suggestion, logo fallback, badge text and readable highlights.

### 7.3 Fonts (`brandFonts`, 349–353)

1. Collect `typography.families` plus every `typography.scale[].family`.
2. Drop names matching `wordmark|artwork|logo`.
3. Prefer families that match an uploaded font (`UF`), normalized (strip case,
   spaces, punctuation) against either the full name or the base name.
4. `display` = first preferred/first family → `Georgia`.
   `body` = second preferred/second family/first family → `Helvetica Neue`.
5. Weight is inferred from the name: thin/hairline 200, light 300,
   medium 500, semibold 600, bold 700, black/heavy 800, default 400.
6. `stackFor` maps a family to a CSS stack: uploaded font first; known
   Helvetica/Georgia shortcuts; otherwise `"Family", serif|sans-serif`.
7. `dName`/`bName` (base names) feed the “Display: … · Body: …” line.

`loadFonts()` runs once at boot. If it fails, the page still works with the
fallback stacks; engine thumbnails use the engine’s own SERIF/SANS stacks for
previews.

### 7.4 Formats and geometry

`FMTS` (307–312):

| id | group | label | px |
|---|---|---|---|
| `a4` | Flyer | A4 portrait | 1748 × 2480 |
| `portrait-45` | Flyer | Portrait 4:5 | 1080 × 1350 |
| `sq` | Social | Square | 1080 × 1080 |
| `story` | Story | 9:16 | 1080 × 1920 |
| `land` | Banner | Landscape | 1920 × 1080 |

`GEO` (314–318) holds master rects `[x, y, w, h, fontSize%]` for `a4`,
`story`, `sq`, `land` (see Appendix A). `buildScene` falls back to `GEO.a4`
for any format without an entry, so `portrait-45` currently uses A4 geometry.

### 7.5 Default scene (`buildScene`, 397–417)

Variants:

| Variant | Ground | Base type | Key type |
|---|---|---|---|
| `classic` | `TH.bone` | `TH.ink` | `TH.ink` |
| `night` | `TH.ink` | `TH.bone` | `TH.accent` |
| `accent` | `TH.accent` | whichever of chalk/ink has more contrast on accent | same as base |
| `framed` | classic | `TH.ink` | `TH.ink` |

- Photo rect: from `GEO`; for `framed`, inset to 8 % margins
  (`[8,8,84,84]` when full-bleed).
- Logo tone: `white` when the format overlays text on the photo (`over`),
  otherwise white on dark grounds and ink on light grounds.
- Text layers all use `z:12`; body opacity 0.82, footer 0.7.
- CTA uses uppercase + 0.16em tracking; sub-headline uses 0.04em.
- `carry` (used by variants) preserves text by id, photo `src/fx/fy/fit`, logo
  `which`, and appends any non-master layers (scrims, added elements) unchanged.
- `fitScene` then shrinks text to fit its box.

---

## 8. Asset panel, drag-and-drop and the engine bridge

### 8.1 Tabs (`assets`, 678–736)

| Tab | Label | Content |
|---|---|---|
| `brand` | Brand | logo cuts × 3 tones, pack photography |
| `menu` | `Menus (n)` | the brand's structured menus, sections, dishes and venue offers (only when the brand has menus) |
| `lib` | Library or `Library (n)` | business asset library with filters |
| `tmpl` | Templates | engine panel if `hasEngine()`, otherwise the fallback catalogue |
| `el` | Elements | scrim, rule, badge, text block |

The **Menus** tab is a projection of the brand pack, not a second source of
truth: `StudioBrand.contentAssets(brand, {branch})` returns the menus a branch
may use, their sections, every dish and the venue's offers, each with a stable
id. A **Branch** selector filters the list, so a menu written for Garnethill
disappears when Merchant City is chosen. See [menus.md](menus.md) for the data
model and the one-line dish format.

Dragging a row creates an *ordinary text layer* with `format` set, so text
editing, geometry, animation and export all keep working:

| Dropped | `format` | Default box | Drawn as |
|---|---|---|---|
| dish | `menu-item` | 48 % × 9.5 % | dish + price flush right + description |
| section | `menu-list` | 52 % × 32 % | heading, dishes, prices, section note |
| whole menu | `menu-list` | 54 % × 64 % | every section |
| venue offer | `offer` | 46 % × 11 % | title + accent price + detail |

`paintMenuBlock` paints the block for the canvas/export and `menuBlockHTML`
builds the same block in CSS for the DOM preview; both shrink the type to the
layer and drop the descriptions below ~55 % of the requested size. The layer's
`text` stays `Name | Description | Price` with `#` headings, so the inspector's
text field remains the place to retype a dish.

`assets()` rebuilds the tab strip and panel HTML on every call, re-wraps
sections, then:
- `engBind(p)` when the engine panel is shown,
- `buildFormats()` / `bindFormatSelectors()` (null-safe, mostly dead — §16),
- wires choice cards (click → toast) and draggable assets,
- wires library filters.

### 8.2 Drag payload grammar

`dataTransfer` type `k`:

| Payload | Created in | Meaning |
|---|---|---|
| `logo:<wordmark\|mark>:<white\|ink\|accent>` | Brand tab | camera-ready logo cut |
| `photo:<index>` | Brand tab | `B.photography[index]`; drag adds it to the stage |
| `lib:<ast_id>` | Library tab | library asset record |
| `ma:<content_asset_id>` | Menus tab | dish (`menu-<menu>-s<i>-i<j>`), section (`…-s<i>`), menu (`menu-<menu>`) or offer (`venue-<id>`) |
| `template:<id>` | fallback Templates | template card (text layer) |
| `size:<id>` | fallback Templates | switch format |
| `format:<id>` | fallback Templates | switch format (`FMTS` id) |
| `motif:<id>` | fallback Templates | glyph text layer |
| `el:<scrim\|rule\|badge\|text>` | Elements | simple element |

Choices in the fallback grid are click-only (`data-choice`), not draggable;
the engine design/motif cards are click-only too.

Photography cards also open a larger preview on click or keyboard activation.
The preview action replaces the selected image layer; otherwise it uses the
hero image layer, then the first image layer. If the scene has no image layer,
the photo is added to the canvas. Replacement keeps the target layer's
geometry and resets its crop to the centre.

### 8.3 `addAsset` (746–764)

| Kind | Geometry | Result |
|---|---|---|
| `photo` | width 60 %, aspect from image, max height 80 % | image layer, `src` pack URL |
| `logo` | width 24 %, aspect from `_logos` | logo layer `which`, `tone` |
| `lib` | width 50 %, aspect from item or image | image layer; `assetId`; `fit:contain` for logo/icon/mark/badge, else cover; `recordUsage()` |
| `template` | 52 × 18 %, centred at drop | text card: uppercase label, accent 14 % background, radius 1 |
| `size` | — | maps catalogue id → `FMTS` id and calls `setFormat()` (dead path) |
| `format` | — | `setFormat()` (dead path) |
| `motif` | 18 × 12 % | glyph text in display type |
| `el:scrim` | full width, 30 % height, y from drop | gradient `rgba(ink,0) → ink` |
| `el:rule` | 30 × 0.5 % | accent shape |
| `el:badge` | 10 × 4 % | text `NEW`, accent bg, radius 2, readable text |
| fallback | 40 × 6 % | text “Your text here” |

New ids are `<kind>-<uid++>`; z is `20 + uid`. `at()` clamps x/y to keep the
box on the page. Every successful add pushes history, appends, says “Added …”
in chat, and selects the layer.

`box(aspect, widthPct)` keeps the image aspect inside the page: if the
computed height exceeds 80 %, it caps height and recomputes width. A photo
preview's replace action reuses the existing image layer instead of creating
a new one; it adds a layer when the scene has no image.

### 8.6 Layer multi-selection

Single-clicking a layer row keeps the existing one-layer selection behavior.
Double-clicking a row toggles it into or out of a multi-selection; selected
layers can be dragged together from the stage, and Delete removes the selected
layers. Dragging from empty space in the canvas workspace draws a marquee and
selects every visible non-background layer it intersects. Hold Shift while
marquee-selecting to add those layers to the current selection. The primary
selection remains the layer used by the agent and inspector.

### 8.4 Library (`loadLibrary`, 739–744)

- `GET api/assets?brandId=<id>&limit=100` (server caps 200).
- Keeps only items that are **not** `business-document` / `content` and whose
  `format` is missing or matches `png|jpe?g|webp|gif|svg|avif`.
- Ignores stale responses if `B` changed while loading.
- On error sets `status='error'` and shows the message.
- Filters: asset class (`a.class`) and verified-only (`state` in
  `verified|approved`); shows at most 60.
- Thumbnails use `a.thumb || a.sourceUrl`.

### 8.5 Usage recording

`recordUsage(asset)` (745) POSTs one event:

```json
{ "events": [{
  "assetId": "ast_…", "action": "design", "designId": "agent-studio",
  "size": "A4 portrait", "profile": "print"
}]}
```

`profile` is `print` when `FMT.w >= 1700`, else `screen`. Fire-and-forget
(`keepalive:true`, `.catch(noop)`). Skipped in demo mode. Only library assets
record usage; pack photography/logo drops do not.

### 8.6 Engine panel (`engPanel`, 551–564)

Sections, in order:

1. **Design type** `<select id="engCat">` — 11 categories from
   `Object.keys(AssetCategories)`.
2. **Size** `<select id="engSize">` — `engSizes()` (template `sizes` filter,
   otherwise all category sizes).
3. **Designs** grid of `.eng-card` buttons, one `<canvas data-th>` + name per
   category template; selected only after `ENG.wired`.
4. **Motif** grid (`.eng-mt`) — `auto` (if the template uses a motif slot),
   `logo`, every `AssetEngine.VECTORS` id, `none`; each has an 80×68 preview
   canvas. `auto`/`none`/`logo` draw a glyph; vectors use
   `drawVectorPreview`.
5. **Motif size / horizontal / vertical** sliders (`30–250 %`, `−45…45 %`),
   updating `ENG` and debouncing `engRefreshArt` by 70 ms.
6. **Text size** “All text” `50–200 %`, plus a per-selected-text block
   (`#engSel`) with a `0.8–20 %` slider and `A−` / `A+` buttons.
7. A note: “Same designs, sizes and drawing engine as Asset Studio. Picking
   one turns it into editable layers.”

`engBind` (565–582) renders the thumbnails and wires all controls.
Category change resets template/size to 0; size change keeps the template;
design click applies immediately.

### 8.7 The two-pass text split (`engBuildInner`, 630–660)

To turn a canvas design into editable layers:

1. **Pass 1 — capture text geometry.**
   - Build a state via `engState(engText(tpl))`.
   - Replace `state.boxes` with an accessor whose `push` inspects every text
     box on the front side (`side === 'f'`).
   - For each text draw, read the current 2D context font (`xx px … weight
     family`), `fillStyle`, width/height/x/y, and estimate letter spacing from
     the difference between the drawn width and `measureText` width.
   - Push `{text,x,y,w,h,size,font,fam,weight,color,ls}` into `runs`.
2. **Pass 2 — artwork without text.**
   - Render a second canvas with `fillText` replaced by a no-op.
   - Encode JPEG quality 0.92 (PNG fallback) → `src`.
3. **Layers.**
   - `ground` fill (`pal.paper`).
   - `art` image: the text-free raster, z=2, cover.
   - If multi-side/die-cut (`size.sides > 1 || size.shape`): return only
     ground + art, but re-render **with** text so it is baked in; `ENG.flat`
     is true and text is not editable.
   - Otherwise group runs (`engGroupText`) and create `t1…tN`: text layers
     with `nowrap:true`, `z:12+i`, percent geometry, font size as % of canvas
     height, line-height from the measured step or 1.18, letter-spacing, and
     colour from the canvas.
   - Layer name = `Text · <first 22 chars of the first line>`.

`engGroupText` merges consecutive runs with the same font, colour and x
(within 2 %), where the vertical gap is between 0.7 and 1.9 × font size.
Merged layers store multiple lines (`text` joined with `\n`).

### 8.8 Applying an engine design (`engApply`, 661–673)

```
saveScene()                     # old FMT key
ENG.wired = true
ENG.motif='auto'; motifOn=true; motifScale=1; motifX=0; motifY=0; textScale=1
FMT = { id:`eng:${cat}:${tpl}:${size}`, group:catLabel, n:`${cat} · ${size.n}`,
        w:size.w, h:size.h, eng:true }
hist=[]; sel=null; seen=new Set(); stopP(); T=DUR
fitStage(); sizeProbe()
scene = engBuild()
render(); layers(); assets(); greet(); remember()
#status = `${B.name} · ${tpl.n} · ${size.n}`
```

- The engine format id is **not** in `FMTS`, so the format selectors cannot
  represent it.
- History is cleared, so a design switch cannot be undone.
- Motif/scale/text customisation is reset on every design/size/category change.
- `assets()` rebuilds the Templates panel with `ENG.wired` true, so the chosen
  design card is outlined.

### 8.9 Motif and text updates

- `engRefreshArt` (601–609): re-renders only the `art` layer with the current
  motif settings, palette override (`l.pal`), template text and size; replaces
  `l.src`; toast on failure.
- `engSizeLayer` (583–589): scales `font.sizePct` and the box by the same
  factor, keeps the visual centre, switches alignment to centre/right when the
  layer sits there, clamps within the page. Used by the “All text” slider
  (relative factor), the selected-text slider (absolute size) and A−/A+.
- `engSyncSel` (590–600): shows the per-layer control only when a text layer
  is selected and `#engSel` exists.

### 8.10 Engine variants (`engVariant`, 618–629)

`variant` commands on an engine scene rebuild with a palette override:

| Variant | `paper` | `ink` | `accent` |
|---|---|---|---|
| `night` | `TH.ink` | `TH.bone` | `TH.accent` |
| `accent` | `TH.accent` | whichever of chalk/ink contrasts more | same as ink |
| `framed` | `TH.chalk` | `TH.ink` | base accent |

It then restores text, position, size, line-height and hidden state by layer
id, and keeps non-engine layers (anything not `ground`, `art`, `t\d+`) such as
scrims.

### 8.11 Brand-string substitution (`engBrandify`, 534–541)

Template copy was authored for the Dalton venues. Before rendering, every
template text value is rewritten:

| Pattern (case-insensitive unless noted) | Replacement |
|---|---|
| `the adamson \| THE PHYSICIAN` | `B.name` |
| `THE PHYSICIAN` | `B.name.toUpperCase()` |
| `The Physician` / `the physician` | `B.name` |
| `www.thephysician.bar`, `www.theadamson.com`, `www.hatchstandrews.com` | `siteOf()` |
| `@thephysician_standrews`, `@theadamsonstandrews`, `@hatch_standrews` | Instagram contact |
| `12[79] South Street, St Andrews(, KY16 9UH)?` | `Address` (only when not already present) |
| `reservations@theadamson.com` | email contact |
| repeated ` · ` / leading/trailing ` · ` | collapsed/trimmed |

This is a **source-brand leak**: for any brand not in the Dalton family the
patterns simply do not match, but copy such as “the adamson | THE PHYSICIAN”
inside a new template would still be substituted with the current brand name.
The address regex is St Andrews-specific.

---

## 9. The Studio agent

### 9.1 Shape

- Chat lives in `#chat`; each message is `.m` (`.u` for user).
- Cards are `.card` blocks with title, why, “N commands · hover to preview”,
  `JSON` and `Apply` buttons.
- The agent has **no memory, no model, no streaming**; it computes
  deterministic cards from the selected layer and the message string.
- `greet()` (877) clears the chat and posts the intro plus the first three
  global concepts.
- `select(id)` (480) posts “Looking at **name**” plus `suggest(l, '')`.
- Quick prompts (`ctx()`, 476–479) depend on selection type:

| Selection | Prompts |
|---|---|
| none | Layout concepts · Fix hierarchy · Animate it |
| text | Rewrite it · Make it stand out · Animate it |
| image | Crop ideas · Add a scrim · Animate it |
| other | Options · Animate it |

### 9.2 `ask(text)` (864–867)

1. Echo the user message (escaped).
2. Capture the currently selected layer.
3. After 300 ms:
   - **No selection:** pick concepts — `Fix hierarchy` if the text contains
     `hier`, `Staggered entrance` if it contains `anim`, otherwise the first
     three.
   - **Selection:** `suggest(layer, text)`; if it returns nothing, say
     “I can’t do that to **name** yet. Try bigger, accent colour, animate it
     or move up.”

### 9.3 `suggest(layer, message)` (768–791)

The message is lowercased and matched against rules; each match appends a
card. Multiple rules can fire in one response.

| Trigger (substring) | Card | Commands |
|---|---|---|
| a `PAL` name, layer not image/logo | `Colour → <name>` | `set-layer {color: PAL[name]}` |
| `bigger`, `larger`, `increase` | `Scale up 20%` | text: `font.sizePct × 1.2`; else `w,h × 1.2` |
| `smaller`, `reduce` | `Scale down 20%` | text: `font.sizePct × 0.8`; else `w,h × 0.8` |
| `move` + (`up`/`higher`) | `Move up 4%` | `y − 4` |
| `move` + (`down`/`lower`) | `Move down 4%` | `y + 4` |
| `center`, `centre` | `Centre horizontally` | `x = (100−w)/2`; text also `align:center` |
| `hide`, `remove`, `delete` | `Remove layer` | `remove-layer` |
| `uppercase`, `caps` (text) | `Uppercase + tracking` | `transform:uppercase`, `letterSpacingEm:0.14` |
| `animat`, `motion`, `fade`, `pulse`, `zoom`, `parallax`, or exactly `Animate it` | `Animate: fadeIn`, `Animate: pulse`; images also `zoom`, `parallax` | `set-animation` |
| `rewrite`, `alternative`, `copy`, `wording`, or exactly `Rewrite it` | up to 3 quoted copy alternatives | `set-layer {text, hidden:false}` |
| fallback: no cards, or `stand out`, `options`, `ideas`, `crop`, `scrim`, `what`, or the exact quick prompts | type-specific cards below | |

Animation cards:

| Preset | Timing | Applies to |
|---|---|---|
| `fadeIn` | start 300 ms, 900 ms | all |
| `pulse` | start 2000 ms, 2400 ms | all |
| `zoom` | start 0, 10000 ms | images |
| `parallax` | start 0, 10000 ms | images |

If the message names a preset, only that preset card is offered.

Type-specific fallback cards:

| Type | Cards | Commands |
|---|---|---|
| text | Make it stand out | `font.sizePct × 1.25`, weight ≥ 400, opacity 1 |
| text | Accent colour | `readable(TH.accent, ground.color)` |
| text | Rewrite it | `ask:'Rewrite it'` (no commands) |
| image (tall: `FMT.h >= FMT.w*0.95`) | Full-bleed with scrim | ground → `TH.ink`; photo `h:66`; add scrim gradient `y:36,h:30.2,z:6` |
| image | Inset, framed | `x:8,y:8`; `w:84` if full-bleed, else `min(w,84)`; height adjusted to content |
| image | Shift focus left | `fx:25` |
| image | Animate: parallax | `parallax`, 0/10000 |
| logo | White/Ink/Accent logo | `swap-asset` tone (except current) |
| logo | Use the wordmark / mark | `which` swap when both exist |
| logo | Enlarge 25% | `w,h × 1.25` |
| other | Fade to 50% | `opacity:0.5` |
| other | Send to back | `z:1` |

`copyOptions()` keyed by layer id drives the rewrite cards:
`headline`, `subhead`, `body`, `cta`, `footer`; alternatives exclude the
current text and are sliced to 3.

### 9.4 Global concepts (`concepts`, 792–797)

| Card | Why (chat copy) | Commands |
|---|---|---|
| Dark night | Brand ink ground, light type, accent where contrast allows, pulsing CTA | `variant night` + `pulse` on `cta` at 3000/2400 |
| Framed editorial | Photo inset in the margins; text and copy kept | `variant framed` |
| Accent poster | Accent-colour ground with the highest-contrast type | `variant accent` |
| Fix hierarchy | CTA should read before the address | `cta.y = GEO.cta[1]`, `footer.y = GEO.foot[1]` |
| Staggered entrance | Headline, subhead, body fade in; photo drifts; CTA pulses | photo parallax 0/10000; headline 400/900; subhead 900/900; body 1300/900; CTA pulse 3000/2400 |

For engine scenes the concept geometry uses `GEO.a4` and the `cta`/`footer`
ids do not exist, so “Fix hierarchy” is a no-op there.

### 9.5 Cards (`say`, 854–863)

```js
say(who, html, cards = [{ title, why, cmds, ask? }])
```

- `mouseenter` (unless the card is `done` or has no commands): run the batch
  on a **clone** of the scene, render it to the stage, compute guardrails on
  the clone, compare with the current issue keys, and show either
  “⚠ introduces N: …” or “✓ guardrails clean”. `mouseleave` re-renders the
  real scene.
- `JSON` toggles a `<pre>` with `JSON.stringify(cmds, null, 1)`.
- `Apply`:
  - if `c.ask` is set, it calls `ask(c.ask)` instead (the “Rewrite it” link),
  - otherwise `commit(cmds)`, marks the card `.done`, disables the button,
    changes its label to `Applied ✓`, and sets `#status`.
- Messages scroll to the bottom after every append.
- `Clear chat` empties `#chat` and sets `#status` to “Chat cleared.”

### 9.6 Command execution and undo

`run(scene, cmds)` mutates the array in place; `commit` snapshots first.
Undo pops the previous clone; if the selected layer no longer exists,
selection is cleared. History is memory-only, unbounded, and reset on brand,
format and engine-design changes. `Reset scene` pushes history, deletes the
saved key, and rebuilds the classic scene.

---

## 10. Guardrails

### 10.1 Rules (`check`, 809–825)

`check(scene)` renders a probe copy at the stage size and inspects every
visible layer. Issues are `{code, id, key, msg, fix}`; `key` is `code + ':' + id`
and is used to announce only new issues.

| Code | Applies to | Trigger | Suggested fix |
|---|---|---|---|
| `SAFE_ZONE` | everything except `fill`, `gradient`, `image` | `x < 7.99` or `y < 7.99` or `x+w > 92.01` or `y+h > 92.01` | clamp x/y into the 8 % margin |
| `OVERFLOW` | text | Range height > `clientHeight + 1.5` | grow `h` by the measured ratio + 0.3 |
| `OVERFLOW` | text | else Range width > `clientWidth + 1.5` | shrink `font.sizePct` by `clientWidth/width*0.97` |
| `MIN_SIZE` | text | `font.sizePct < 0.9` | set 0.9 |
| `BRAND_COLOR` | text, non-engine scenes | colour not present in `PAL` values | set `TH.ink` |
| `CONTRAST` | text | worst sampled contrast < 3:1 (size ≥ 2.2 %) or < 4.5:1 | set the best of ink/bone/chalk at opacity 1 |
| `HIERARCHY` | `footer` + `cta` | footer above CTA and x within 5 | move CTA to footer’s y, footer below it |

Notes:

- Safe-zone coordinates are layer percentages, not rendered pixels.
- The overflow check measures the text Range, not the declared box, so it
  catches wrapping and clipping.
- `BRAND_COLOR` is deliberately skipped for engine scenes because canvas text
  colours are often computed `rgb(...)` values not present in `PAL`.
- `HIERARCHY` only fires for the two master ids; engine text (`t1…`) never
  triggers it.
- Fixes are command arrays; multiple issues can target the same layer.

### 10.2 Background compositing (`bgAt`, 802–808)

For a point behind a text layer, `bgAt` finds the topmost visible
`fill|shape|gradient|image` layer with `z < text.z` that contains the point,
then recursively resolves what is behind it:

- no layer → mid-grey `[128,128,128]`;
- gradient → interpolate `from → to` by vertical position, multiply alpha by
  layer opacity, composite over the layer behind;
- image → if no `src`, mix ink/accent 50/50; if no 140 px sample yet, return
  `[90,70,50]`; otherwise map the point through cover-fit + `fx/fy` into the
  sample;
- solid → mix the layer colour over the background by opacity.

Contrast sampling: 3 x-positions (10/50/90 % of the text Range) × 2 y-positions
(20/80 %), six samples. The worst contrast wins. Text ≥ 2.2 % height needs
3:1; smaller text needs 4.5:1.

If the background is a text layer’s own `bg`, the check uses that colour
directly (badge/box case).

### 10.3 Watch and flag (`watch`, 826–827; `flag`, 828–830)

- `layers()` schedules `watch()` 30 ms after the last change; the
  `ResizeObserver` schedules it 60 ms after a resize.
- `watch` sets `cur`, re-renders the layer rows (⚠ marker), updates `#gc`
  (`✓ Guardrails clear` or `⚠ N guardrail issue(s)`), and announces only
  issue keys not in `seen`. `seen` is reset on brand/format/engine changes.
- The first watch after a brand load therefore announces every current issue.
- `flag` builds one card per issue (`LABEL[code] · layer name`, the message,
  and its fixes) and, when there is more than one, a **Fix all** card that
  concatenates every fix.
- Clicking `#gc` reports all current issues, or the all-clear message.

### 10.4 What guardrails do not cover

- Logo contrast, image cropping/quality, copy tone, factual accuracy.
- Assets outside the canvas after dragging (safe zone only checks declared
  boxes of text/logo/shape, not images).
- Overlaps/occlusion, z-order except the footer/CTA hint.
- Palette check for engine scenes.
- Pixel contrast for images that have not yet been sampled (falls back to a
  brown approximation until `ensurePx` completes).

---

## 11. Timeline and animation

### 11.1 Model

- Fixed duration `DUR = 10000` ms (line 834).
- `T` is the playhead in ms; initial value `DUR` (finished state).
- Each layer may have `anim = {preset, start, duration}`.
- Presets are CSS keyframe names; the timeline does not store keyframes.

| Preset | CSS effect | Typical timings created by the agent |
|---|---|---|
| `fadeIn` | opacity 0 → 1, `translateY(2cqh)` → 0 | 300/900 (layer), 400/900–1300/900 (concept) |
| `zoom` | `transform:scale(1.08)` at the end | 0/10000 (image card) |
| `parallax` | `scale(1.08)` → `translateY(-2.5cqh) scale(1.08)` | 0/10000 |
| `pulse` | opacity 0.35 at 50 %, infinite | 2000/2400 (layer), 3000/2400 (concept) |

```css
@keyframes fadeIn{from{opacity:0;transform:translateY(2cqh)}to{opacity:1}}
@keyframes zoom{to{transform:scale(1.08)}}
@keyframes parallax{from{transform:scale(1.08)}to{transform:translateY(-2.5cqh) scale(1.08)}}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.L[data-an]{animation:none!important}}
```

CSS shorthand per animated layer:

```
<preset> <duration>ms <ease> <delay>ms both paused
ease  = ease-in-out infinite  (pulse)  |  ease-out
delay = anim.start - T
```

`both` keeps the end state; `paused` makes scrubbing deterministic. There is
no Web Animations API and no JS ticker per layer — only the rAF loop that
changes `T`.

### 11.2 Playback (`seek`/`play`/`stopP`, 835–838)

- `seek(t)` clamps to `0…DUR`, updates every stage `[data-an]` delay, writes
  the scrub value, the `"x.xx / 10.00 s"` output, and the `--p` variable on
  `#tlb` (playhead position).
- `play(from = T)` stops any loop; if `from >= DUR` it restarts at 0; stores
  `start = performance.now() - from`; each rAF frame calls `seek(now - start)`;
  stops at `DUR` or when `playing` becomes false.
- `stopP()` cancels the rAF and resets the button label to “▶ Play”.
- `#tpl` toggles play/pause from the current `T`; `#play` (toolbar “Replay”)
  always starts at 0; `#scrub` pauses and seeks.
- `commit()` auto-plays from 0, 60 ms after applying any `set-animation`
  command.

### 11.3 Timeline DOM (`tl`, 846–851)

- Rebuilt from scratch on every `layers()`.
- First row: blank name column + ruler track with 11 labels (`0s`…`10s` at
  10 % steps). Pointerdown/drag on the ruler seeks.
- One 20 px row per visible layer, sorted by `z` descending; the name column
  selects the layer.
- Animated layers get a `.bar` inside the track:
  - `left = start/DUR*100 %`
  - `width = max(0.6, duration/DUR*100) %`
  - label = preset name
- Bar drag (`bd`, 841–845):
  - within 8 px of the right edge → resize duration;
  - elsewhere → move start;
  - deltas snap to 100 ms (`round(dx/trackWidth*DUR/100)*100`);
  - start clamps to `0…DUR−duration`, duration to `100…DUR−start`;
  - on release: rebuild timeline, post a chat note with the new timing,
    `saveScene()`.
- Playhead `.ph` is a 2 px white line positioned with
  `left: calc(116px + (100% − 116px) * var(--p, 1))`; `--p` is set on `#tlb`.

### 11.4 Persistence and reset

`anim` is part of the saved layer object, so timing survives reload with the
scene. Brand changes reset `T` and stop playback; engine design changes also
reset `T` and clear history. Format switches do not stop playback (bug #14).
`#reset` does not remove animations from the new classic scene (it builds a
fresh one without them).

---

## 12. Persistence and URL state

### 12.1 Keys

| Key | Value | Written by | Read by | Notes |
|---|---|---|---|---|
| `agentStudio.panels.v1` | `{left:number,right:number}` | `setPanel` | `bindResizeHandles` | `0` means collapsed |
| `agentStudio.collapsed.v1` | `string[]` section keys | `setSection` | module init (`COLL`) | lowercased first heading text |
| `agentStudio.scene.v2:<brandId>:<fmtId>` | `{v:2,scene:Layer[]}` | `saveScene` | `loadScene` | engine formats use `eng:cat:tpl:size` in the key |
| `agentStudio.last.v1` | `{packId,brandId,fmt}` | `remember` | `boot` | last selection |
| `agentStudio.lastBrands.v1` | `{packId:brandId}` | `remember` | `boot`, `selectPack` | per-pack memory |

`LS` wraps every access in `try/catch`; a failed `set` deletes the scene key
instead of throwing.

### 12.2 Save triggers

- `layers()` → `saveScene()` after 400 ms (covers nearly every mutation path).
- Bar drag release, `setFormat`, `selectBrand` (old key), `engApply` (old key).
- `#reset` deletes the key before rebuilding; the subsequent `layers()` saves
  the reset scene again.
- Demo mode never saves.

### 12.3 Load validation (`loadScene`, 891)

```js
d && d.v === 2 && Array.isArray(d.scene) &&
MASTER_IDS.size &&
['ground','photo','headline'].every(id => d.scene.some(l => l.id === id))
```

`MASTER_IDS.size` is always 8 (dead condition). The page does not validate
individual layer fields; an old/hand-edited store can inject arbitrary values
into `render()`.

### 12.4 URL state

**Read at boot** (`?` params):

| Param | Used for | Precedence |
|---|---|---|
| `brand` / `brandId` | find the pack containing the brand, then the brand | 1 |
| `pack` / `packId` | pack id if it exists | 2 |
| `format` | `FMTS` id (e.g. `?format=story`) | overrides last format |

`brand` is checked first, so a URL with only a brand selects the right pack.
If the format is unknown, the page stays on the last/default A4.

**Written by `remember()`** via `history.replaceState`:

```
?pack=<P.id>&brand=<B.id>
```

The format is **not** written to the URL; it is remembered only in
`agentStudio.last.v1`. This is why engine formats cannot be restored — the
stored format id is not in `FMTS` (§16).

Cross-page links (`chrome`, 487–488) carry the brand:

- `asset-studio.html?brand=<id>&pack=<packId>`
- `library.html?brandId=<id>&packId=<packId>`

Static header links: `asset-studio.html`, `library.html`, `crawler.html`,
`studio-v2.html`.

---

## 13. Input, keyboard and accessibility

### 13.1 Pointer and other events

| Event | Target | Handler | Effect |
|---|---|---|---|
| `pointerdown` | every `.L` | `down` | select + drag move |
| `pointerdown` | empty canvas workspace / background | `beginMarquee` | draw a selection rectangle; visible intersecting layers become selected |
| `pointerdown` | `.resize-handle` | `bindResizeHandles` | begin panel drag |
| `dblclick` | handle | inline | toggle collapse |
| `pointerdown` | timeline bar | `bd` | move/resize animation |
| `pointerdown`/move | ruler | `tl` | seek |
| `input` | `#scrub` | inline | pause + seek |
| `input` | motif sliders | `engBind` | update ENG, debounce art |
| `input` | text sliders | `engBind`/`engSyncSel` | resize layers, render |
| `change` | `#sz` | inline | toggle `.safe` on `#app` |
| `change` | `#grp` | inline | `selectPack` |
| `change` | library filters | `assets` | re-render filtered grid |
| `dragstart` | `.asset[data-k]` | inline | set `dataTransfer 'k'` |
| `click` / `keydown` | brand photography card | `assets` | open a large preview; Enter and Space activate it |
| `dragover` / `drop` | `#wrap` | inline | add asset at drop point |
| `click` | `#undo`, `#reset`, `#play`, `#tpl`, `#clearChat`, `#gc` | inline | toolbar actions |
| `click` | palette swatch | `chrome` | recolour selected text/fill/shape |
| `click` / `dblclick` | layer row | `list` | select one / toggle multi-selection |
| `click` | layer eye | `list` | toggle hidden |
| `click` | `#cx` | `ctx` | clear selection |
| `click` | quick prompt | `ctx` | `ask(prompt)` |
| `submit` | `#f` | inline | `ask(input)` |
| `contextmenu` | stage layer | `showContextMenu` | delete menu (broken, §16) |
| `click`/`contextmenu` | document | inline | close context menu |
| `keydown` | document | inline | Delete/Backspace deletes selection (ignores inputs/selects/contenteditable) |
| `keydown` | focused layer row | `list` | Enter selects; Space toggles multi-selection |
| `keydown` | handle | inline | arrows ±16 px, Enter/Space collapse |
| `keydown` | `h3[data-sec]` | `wrapSections` | Enter/Space collapse |
| `pointermove`/`up` | window | drag helpers | finish drags |

### 13.2 Accessibility features present

- `#boot` and `#toast`: `role=status`, `aria-live=polite`.
- `#atabs`: `role=tablist`; tabs `role=tab`, `aria-selected`.
- `#apanel`: `role=tabpanel`.
- `#ctxMenu`: `role=menu`; items `role=menuitem`.
- Resize handles: `role=separator`, `aria-orientation=vertical`,
  `aria-expanded`, `tabIndex=0`, keyboard resize.
- Section headings: `role=button`, `aria-expanded`, `tabIndex=0`.
- Brand pills: `aria-pressed`; group select has a label; sliders have labels.
- Focus-visible outlines on buttons/selects/inputs/links/handles/sections.
- The chat is `aria-live=polite`; the timeline scrub has `aria-label`.
- `prefers-reduced-motion` disables layer animations.

### 13.3 Accessibility gaps

- Layer rows (`.lrow`) are clickable `div`s, not buttons; they are not
  keyboard-focusable.
- Chat cards are hover-only for preview; the preview is not keyboard-exposed.
- No `aria-controls` between section buttons and their bodies; no
  `aria-valuenow` on separators.
- Selected-layer state is visual only (`.sel` outline + chip), not announced.
- Colour swatches have `aria-label="Apply <name>"` but no visible text.
- The right panel and canvas rely on pointer drag; no keyboard nudge.
- `#ctxMenu` is not reachable (see §16), so its role/menu semantics are moot.

---

## 14. Dependency index

### 14.1 Script dependencies

Load order is `qrcode → brand-pack → engine → categories` (136–139).
All are classic scripts that attach globals; none are ES modules.

| # | File | Global | Symbols this page uses | Purpose | Notes |
|---|---|---|---|---|---|
| 1 | `src/client/asset-studio/vendor/qrcode.min.js` | `QRCode` (unused) | — | parity with Asset Studio | **No reference in `pages/studio.html`.** The engine state sets `qr:''`; templates never draw a QR code. Dead weight (~20 KB). |
| 2 | `src/shared/brand-pack.js` | `window.StudioBrand` | `paletteRoles(brand, templateId)`, `templateCatalog(brand)` | engine palette roles; template fallback catalogue | UMD, also `require()`-able in Node. `paletteRoles` is called through a `try/catch` in `engPal`; `templateCatalog` only in the no-engine fallback. |
| 3 | `src/client/asset-studio/engine.js` | `window.AssetEngine` | `render(canvas,size,tpl,state,target)`, `renderThumb(canvas,size,tpl,state,160)`, `templateUsesMotif(tpl)`, `VECTORS`, `drawVectorPreview(canvas,id,palette,40,34)` | design thumbnails, artwork, motifs, variants | `render` sets `state.boxes`, draws sides sequentially, returns `{width,height,shape,motif,logo}`; the page ignores the return and reads the canvas. |
| 4 | `src/client/asset-studio/categories.js` | `window.AssetCategories` | category `title`, `sizes[]`, `tpls[]` (`n`, `t`, `sizes`, `draw`), `size` fields (`n,w,h,d,side,sides,shape`) | design type/size/design catalogs | 11 categories: flyer, menu, voucher, bizcard, tablecard, social, signage, guest, stationery, packaging, compliance. |

`hasEngine()` (520) is true when both `AssetEngine` and a non-empty
`AssetCategories` exist. In the shipped page it is always true; the fallback
panel is therefore unreachable (§16).

### 14.2 HTTP API dependencies

`API = 'api'` (relative, line 189). `jget` uses `cache:'no-store'` and parses
JSON; non-2xx throws.

| # | Method & path | Caller | Request | Response (used fields) | Server | Data source |
|---|---|---|---|---|---|---|
| 1 | `GET api/brand-packs` | `boot` (935) | — | `{packs:[{id,name,brands:[{id,name}]}], hiddenCount}` | `server.js:4897` | `data/brand-packs/*/pack.json`, filtered by `data/settings/groups.json` |
| 2 | `GET api/brand-packs/:id` | `packFull` (913) | path id | `{pack:{id,name,brands:[brand…]}}` | `server.js:5030` | same pack JSON, normalised by `StudioBrand.normalizeBrandPack`, hidden brands removed |
| 3 | `GET api/fonts` | `loadFonts` (355) | — | `{fonts:[{id,family,url,format}]}` | `server.js:5113` | `data/fonts/` directory listing |
| 4 | `GET api/fonts/<file>` | each `FontFace` | — | binary `font/woff2`, `woff`, `ttf`, `otf` | `server.js:5118` | `data/fonts/<file>` |
| 5 | `GET api/assets?brandId=<id>&limit=100` | `loadLibrary` (741) | brand id | `{total, assets:[summary]}` where summary has `id,name,class,role,tags,state,status,width,height,format,thumb,sourceUrl,…` | `server.js:4703` → `AssetStore.listAssets` | `data/assets/<id>/metadata.json` (+ usage) |
| 6 | `POST api/assets/usage` | `recordUsage` (745) | `{events:[{assetId,action,designId,size,profile}]}` | `{recorded}` | `server.js:4733` → `AssetStore.recordUsage` | `data/assets/usage.json` + each asset’s `usageLog` |
| 7 | `GET api/assets/:id/file/:variant` | **not called by JS**; produced as `thumb`/`sourceUrl` and fetched by `<img>`/CSS | path id + variant | image bytes | `server.js:4838` | `data/assets/<id>/…` |
| 8 | `GET api/brand-packs/:packId/files/<…>` | **not called by JS**; pack `logos[].url` / `photography[].url` are fetched by `<img>`/CSS | path | image bytes | `server.js:4921` | `data/brand-packs/<pack>/files/…` |

Server-side endpoints that exist but are **not used by this page**:
`/api/assets/:id` CRUD/verify/master/classify/operations, `/api/assets/ingest`,
`/api/assets/index-pack`, `/api/brand-packs/import`, `/api/brand-packs/:id/templates`,
`/api/fonts` POST, `/api/brand-kits`, `/api/briefs/parse`, `/api/projects/...`.

### 14.3 Data files read indirectly

| Path | Via | Used for |
|---|---|---|
| `data/brand-packs/<pack>/pack.json` | endpoints 1–2 | brands, palette, type, logos, photos, guidelines |
| `data/brand-packs/<pack>/files/**` | endpoint 8 | logo and photography bytes |
| `data/fonts/*.{ttf,otf,woff,woff2}` | endpoints 3–4 | `FontFace` registration |
| `data/assets/<ast_id>/**` | endpoint 5, 7 | library metadata and bytes |
| `data/assets/usage.json` | endpoint 6 | usage events |
| `data/settings/groups.json` | endpoints 1–2 | hidden groups/brands/order |

The page never reads `data/` directly; `server.js` blocks static access to it.

### 14.4 Static DOM id index (35)

| Id | Element | Used by | Purpose |
|---|---|---|---|
| `boot` | overlay | `boot`, `bootMsg`, `startDemo` | blocking load state / error |
| `bootMsg` | `<p>` | `bootMsg` | status/error HTML |
| `bootActs` | `<div>` | `bootMsg` | Reload / Demo buttons |
| `toast` | `<div>` | `toast` | transient messages |
| `app` | grid | `setPanel`, `#sz` | panel CSS vars/classes, safe zone |
| `grp` | `<select>` | `buildGroupSelect`, `selectPack` | brand group |
| `brands` | `<div>` | `buildBrandPills`, `chrome`, `selectBrand` | brand pills |
| `net` | `<span>` | `startDemo` | “Offline demo” badge |
| `lnkAsset` | `<a>` | `chrome` | Asset Studio deep link |
| `lnkLib` | `<a>` | `chrome` | Library deep link |
| `undo` | button | toolbar | pop history |
| `reset` | button | toolbar | delete saved scene + rebuild |
| `atabs` | tablist | `assets` | Brand/Menus/Library/Templates/Elements |
| `apanel` | tabpanel | `assets` | panel body |
| `swh` | `<small>` | — | palette heading hint (static) |
| `sw` | `<div>` | `chrome` | palette swatches |
| `ty` | `<div>` | `chrome` | display/body font line |
| `layers` | `<div>` | `list` | layer rows |
| `play` | button | toolbar | replay from 0 |
| `sz` | checkbox | toolbar | safe-zone overlay |
| `gc` | button | `watch`, click | guardrail report |
| `status` | `<span>` | many | one-line action feedback |
| `wrap` | `<div>` | fit/drop/click | canvas viewport |
| `stage` | `<div>` | `render` | composition surface |
| `tpl` | button | timeline | play/pause |
| `scrub` | range | timeline | seek 0–10000 |
| `tt` | `<output>` | `seek` | time readout |
| `tlb` | `<div>` | `tl`, `seek` | timeline rows + playhead |
| `clearChat` | button | agent header | empty chat |
| `chat` | `<div>` | `say`, `greet` | messages |
| `ctxMenu` | `<div>` | context menu | layer actions |
| `qp` | `<div>` | `ctx` | quick prompts |
| `ctx` | `<div>` | `ctx` | selection context line |
| `f` | `<form>` | submit | chat input form |
| `in` | `<input>` | form | chat text |

`swh` is static and never written by JS.

### 14.5 Dynamic DOM id index (20 ids, grouped)

| Id | Created by | Purpose |
|---|---|---|
| `cx` | `ctx` | clear selection (✕) |
| `engCat` | `engPanel` | design type select |
| `engSize` | `engPanel` | size select |
| `engAll` | `engPanel` | “All text” slider |
| `engAllOut` | `engPanel` | all-text output |
| `engSel` | `engPanel` | wrapper for per-layer text control |
| `engOne` | `engSyncSel` | per-layer text slider |
| `engOneOut` | `engSyncSel` | per-layer output |
| `engDn` / `engUp` | `engSyncSel` | A− / A+ |
| `engM-scale` | `engPanel` | motif size slider |
| `engM-x` | `engPanel` | motif horizontal slider |
| `engM-y` | `engPanel` | motif vertical slider |
| `engMo-scale` | `engPanel` | motif size output |
| `engMo-x` | `engPanel` | motif horizontal output |
| `engMo-y` | `engPanel` | motif vertical output |
| `fmtKind` | fallback Templates | template type select (unreachable when engine loads) |
| `fmt` | fallback Templates | template choice select (unreachable) |
| `libCls` | Library tab | asset class filter |
| `libVer` | Library tab | verified checkbox |
| `menuBranch` | Menus tab | branch filter (`AS.menuBranch`) |

### 14.6 `localStorage` index

| Key | Shape | Writer | Reader | Lifetime |
|---|---|---|---|---|
| `agentStudio.panels.v1` | `{left,right}` | `setPanel` | `bindResizeHandles` | persistent |
| `agentStudio.collapsed.v1` | `["layers",…]` | `setSection` | `COLL` init | persistent |
| `agentStudio.scene.v2:<brandId>:<fmtId>` | `{v:2,scene:[…]}` | `saveScene` | `loadScene` | per brand+format; deleted by reset, not written in demo mode |
| `agentStudio.last.v1` | `{packId,brandId,fmt}` | `remember` | `boot` | persistent |
| `agentStudio.lastBrands.v1` | `{packId:brandId}` | `remember` | `boot`, `selectPack` | persistent |

No `sessionStorage`, IndexedDB, cookies or service worker are used.

### 14.7 URL parameters and navigation

| Param | Direction | Meaning |
|---|---|---|
| `brand` | read | brand id; selects the pack that contains it |
| `brandId` | read | alias for `brand` |
| `pack` | read + written | pack id |
| `packId` | read | alias for `pack` |
| `format` | read | `FMTS` id; not written |

Outbound links: `asset-studio.html?brand=…&pack=…`,
`library.html?brandId=…&packId=…`, `crawler.html`, `studio-v2.html`.
Inbound: `studio-v2.html` header “Classic studio”; any bookmark with
`?pack=…&brand=…`.

### 14.8 Browser/platform APIs

| API | Used in | Purpose |
|---|---|---|
| `fetch` | `jget`, `recordUsage` | API calls, no-store JSON |
| `localStorage` | `LS` | panels, sections, scenes, last selection |
| `URLSearchParams` | `boot` | query parsing |
| `URL` + `history.replaceState` | `remember` | rewrite `?pack&brand` without navigation |
| `FontFace` + `document.fonts` | `loadFonts`, `selectBrand` | uploaded brand fonts |
| `Image` | `loadImg` | photos/logos, 9 s timeout |
| Canvas 2D | `trimImg`, `logoSrc`, `ensurePx`, engine build | alpha trim, tinting, 140 px sampling, artwork |
| `CanvasRenderingContext2D.getImageData` / `toDataURL` | sampling / export | contrast background, engine art data URLs |
| `Range` + `getBoundingClientRect` | `fitScene`, `check` | text overflow/contrast measurement |
| `ResizeObserver` | 946 | stage re-fit + re-check |
| `requestAnimationFrame` + `performance.now` | `play` | timeline clock |
| `DataTransfer` | drag/drop | asset payload |
| Pointer Events | drags, timeline | `pointerdown/move/up` |
| `JSON` | `clone`, `LS`, command JSON | deep clone/serialise |

No `IntersectionObserver`, `MutationObserver`, `WebAnimations`, `Worker`,
`WebSocket`, `EventSource`, `IndexedDB`, or `BroadcastChannel`.

### 14.9 CSS index

**Custom properties** (12): `--bg`, `--pan`, `--rai`, `--line`, `--hi`, `--tx`,
`--mu`, `--ac`, `--ok` (root, 6–8); `--left-panel`, `--right-panel` (`#app`,
16); `--p` (`#tlb`, set by `seek`).

**Structural selectors** (line numbers):

| Selector | Line | Role |
|---|---|---|
| `:root` | 6–8 | colours; safe-area padding (bug: declared on `:root`) |
| light-scheme override | 8 | light palette unless `[data-theme="dark"]` |
| `#app` | 16 | 5-column grid |
| `.resize-handle` | 17–25 | splitters, collapse arrows |
| `.l-collapsed`/`.r-collapsed` | 26 | hide panel content |
| `h3[data-sec]` / `.sec-body` | 27–31 | disclosure headings |
| `header` / `.logo` / `.bsw` / `#net` | 32–41 | chrome |
| `aside` / `h3` | 42–44 | sidebar |
| `.atabs` / `.sub` | 45–47 | tabs / helper text |
| `.assets` / `.asset` / `.th` / `.st` | 48–55 | asset grid, status dots |
| `.eng-*` | 56–69 | engine cards, motif grid, sliders |
| `.template-list` / `.mini-grid` | 70–73 | fallback template/size/motif grids |
| `.flt` / `.note` / `.sw` | 74–76 | filters, notes, palette |
| `.lrow` | 77–80 | layer rows |
| `main` / `.tb` | 81–83 | main column / toolbar |
| `.wrap` / `.stage` / `.L` / `.T` / `.sel` / `.chip` | 84–88 | canvas and layers |
| `.safe .stage::after` | 89 | 8 % dashed guide |
| `@keyframes` | 90–91 | `fadeIn`, `zoom`, `parallax`, `pulse` |
| `prefers-reduced-motion` | 92 | disables `.L[data-an]` |
| `.agent` / `.dot` / `#chat` | 93–98 | agent panel |
| `#ctxMenu` | 99–102 | context menu |
| `.m` / `.cards` / `.card` | 103–110 | messages/cards |
| `.ctx` | 111–112 | context bar |
| `.qp` / `form` / input | 113–115 | quick prompts / composer |
| `.tl` / `.tlh` / `.tlb` / `.tr` / `.tk` / `.bar` / `.ph` | 116–127 | timeline |
| `.warn` / `#gc` | 128 | warning colour |
| `#boot` | 129–131 | boot overlay |
| `#toast` | 132–133 | toast |
| `@media (max-width:980px)` | 134 | mobile stacking |

**State classes/attributes**: `.is-selected` (asset/engine card), `.sel`
(stage layer), `.safe` (app), `.l-collapsed`/`.r-collapsed` (app),
`.visible` (ctx menu), `.done` (card), `.err` (toast), `.warn`,
`[data-collapsed]` (handle), `[data-s="1"]` (selected row), `[data-an]`
(animated layer), `[aria-expanded="false"]` (rotated caret),
`[aria-pressed="true"]`, `[aria-selected="true"]`.

### 14.10 Event-binding index

| Line | Binding |
|---|---|
| 456 | per-layer `onpointerdown` → `down` |
| 475 | layer row click + eye toggle |
| 477 | `#cx` clear selection |
| 479 | quick-prompt click |
| 485 | palette swatch click |
| 496 | brand pill click |
| 509–510 | fallback format selects |
| 569–571 | engine category/size/design |
| 575 | motif button |
| 576–578 | motif sliders |
| 580–581 | all-text slider |
| 596–600 | per-text slider + A−/A+ |
| 680 | asset tabs |
| 734 | dragstart + click prevention |
| 736 | library filters |
| 737–738 | wrap dragover/drop |
| 831 | `#gc` |
| 839 | `#tpl`, `#scrub` |
| 848–850 | ruler/bar/row-name |
| 860–861 | card JSON/Apply |
| 871–876 | chat form, clear, keyboard, context menus |
| 880–885 | undo, reset, replay, safe zone, wrap click, group change |
| 946 | `ResizeObserver` |

### 14.11 Function index

| Line | Symbol | Role | Main callers |
|---|---|---|---|
| 189–200 | `API`, `$`, `clone`, `esc`, `clamp`, `LS`, `jget`, `PANEL`, `resizeState`, `lastW`, `handleEl`, `panelW` | utilities/shell | everywhere |
| 201 | `setPanel` | set/collapse a sidebar width | handles, restore |
| 206 | `onResizeHandleMove` | pointer drag | handle pointermove |
| 212 | `stopResizeHandle` | finish/collapse/restore | pointerup |
| 217 | `bindResizeHandles` | init handles + persistence | module init |
| 233–247 | `COLL`, `secKey`, `setSection`, `wrapSections` | disclosure sections | init, `assets` |
| 248 | `toast` | transient message | many |
| 253–259 | `hx`, `rgb`, `lum`, `cr`, `mix`, `sat`, `rgba` | colour math | theme, guardrails |
| 262–265 | globals, `packCache`, `IMG`, `PXC`, `TINT`, `AS` | state | — |
| 266–304 | fallback catalogs + `get*Catalog` | fallback data | fallback only |
| 307–319 | `FMTS`, `GEO`, `MASTER_IDS` | formats/geometry | scene/render |
| 322 | `deriveTheme` | palette → theme | `selectBrand` |
| 334–335 | `readable`, `toneHex` | contrast-aware colour | scene, agent, logos |
| 338–355 | font helpers, `stackFor`, `brandFonts`, `loadFonts` | font pipeline | `selectBrand`, boot |
| 358–380 | `loadImg`, `trimImg`, `brandLogos`, `logoSrc`, `ensurePx` | image/logo pipeline | render, assets |
| 383–393 | `contact`, `siteOf`, `firstSentence`, `copyFor`, `copyOptions` | copy extraction | scene, agent |
| 396 | `F` | font object factory | scene, assets |
| 397 | `buildScene` | classic scene | brand/format/variant |
| 418 | `fitScene` | shrink text to fit | brand/format/variant |
| 426 | `run` | apply command batch | commit, preview |
| 434 | `commit` | history + apply + render | cards, palette, fixes |
| 437 | `render` | scene → DOM | everything |
| 457 | `down` | select + drag | layer pointerdown |
| 464–467 | `fitStage`, `probe`, `sizeProbe` | stage sizing/measurement | boot, resize |
| 471 | `layers` | refresh all panels + debounces | mutations |
| 472 | `list` | layer rows | `layers` |
| 476 | `ctx` | context bar + prompts | `layers` |
| 480 | `select` | select + agent intro | rows, stage, add |
| 483 | `chrome` | palette/type/links/title | `selectBrand` |
| 492–496 | `buildGroupSelect`, `buildBrandPills` | header controls | boot/pack |
| 497–511 | `fmtGroupFor`, `buildFormats`, `bindFormatSelectors` | legacy format UI | boot, `assets` (dead) |
| 518–564 | `ENG`, `ENG_TPL_IDS`, engine helpers, `engPanel` | engine catalog/panel | Templates tab |
| 565 | `engBind` | wire engine panel | `assets` |
| 583 | `engSizeLayer` | scale one text layer | sliders, A± |
| 590 | `engSyncSel` | per-layer text control | `layers` |
| 601 | `engRefreshArt` | re-render art only | motif |
| 610 | `engGroupText` | merge text runs | `engBuildInner` |
| 617–629 | `engBuild`, `engVariant` | build/repalette | `engApply`, commands |
| 630 | `engBuildInner` | two-pass design → layers | `engBuild` |
| 661 | `engApply` | commit a design | design/size/category |
| 676 | `ELS` | elements catalogue | Elements tab |
| 678 | `assets` | render asset panel | tabs, brand load |
| 739 | `loadLibrary` | fetch library | `selectBrand` |
| 745 | `recordUsage` | POST usage | library drops |
| 746 | `addAsset` | drop → layer | `#wrap` drop |
| 767 | `S`, `A` | command builders | agent |
| 768 | `suggest` | per-layer cards | `ask`, `select` |
| 792 | `concepts` | global directions | `greet`, `ask` |
| 800–801 | `cur`, `seen`, `LABEL` | guardrail state | `watch`/`flag` |
| 802 | `bgAt` | background compositing | `check` |
| 809 | `check` | run rules | `watch`, card preview, `#gc` |
| 826 | `watch` | report + announce | `layers`, resize |
| 828 | `flag` | issue cards | `watch`, `#gc` |
| 834–851 | timeline state, `seek`, `stopP`, `play`, `pxb`, `bd`, `tl` | playback/timeline | controls, `layers` |
| 854 | `say` | message/card renderer | agent |
| 864 | `ask` | user message → cards | submit, prompts |
| 868–870 | `deleteSelection`, `closeContextMenu`, `showContextMenu` | delete/menu | keyboard, right-click |
| 877 | `greet` | intro chat | brand load |
| 889–892 | `sceneKey`, `saveScene`, `loadScene`, `remember` | persistence | `layers`, flow |
| 896 | `setFormat` | format switch (legacy) | dead UI, URL |
| 900 | `selectBrand` | brand switch pipeline | boot, pills |
| 913 | `packFull` | cached pack fetch | `boot`, `selectPack` |
| 914 | `selectPack` | group switch pipeline | `#grp` |
| 923–930 | `bootMsg`, `demoPack`, `startDemo` | boot UI/demo | boot |
| 932 | `boot` | startup | line 948 |

### 14.12 Dependency graph

```
                    ┌──────────────────────────────┐
                    │ pages/studio.html (IIFE)     │
                    └──────────────┬───────────────┘
        ┌──────────────┬───────────┼────────────┬──────────────┐
        ▼              ▼           ▼            ▼              ▼
  StudioBrand      AssetEngine  AssetCategories  fetch       DOM/localStorage
  (brand-pack.js)  (engine.js)  (categories.js)   │              │
        │              │           │             │              │
        │              └─────┬─────┘             │              │
        ▼                    ▼                   ▼              ▼
  paletteRoles()       render/renderThumb   5 JSON endpoints   #app/#stage/#chat
  templateCatalog()    vectors/motifs       + 2 file families  agentStudio.* keys
        │                    │                   │
        └────────────┬───────┘                   │
                     ▼                           ▼
             scene layers / art            server.js → data/
                     │                    brand-packs, fonts,
                     ▼                    assets, settings
                #stage DOM
```

### 14.13 Counts

- 4 scripts, 3 globals, 5 engine entry points (+ category data), 2 brand-pack symbols.
- 4 JSON GETs per boot (5 endpoints available; the usage POST only fires on a
  library drop) + 22 font binaries + N logos/photos + 1 asset list.
- 35 static ids, 20 dynamic ids, 5 storage keys, 5 query params, 4 outbound links.
- 12 CSS variables, 4 keyframes, 3 media queries.
- 0 agent/guardrail network calls.

---

## 15. Feature wiring matrix

| Feature | Trigger | Handler | State mutated | Rendered/emitted | External dependency |
|---|---|---|---|---|---|
| Boot brands | page load | `boot` | `PACKS`, `P`, `B`, `FMT` | header pills/select, stage | `GET api/brand-packs` |
| Brand switch | pill click | `selectBrand` | `B`, `TH`, `PAL`, `BF`, `scene` | palette, type line, layers, chat | pack files, fonts, `GET api/assets` |
| Group switch | `#grp` change | `selectPack` | `P` | pills/select | `GET api/brand-packs/:id` |
| Format switch | URL `?format` / legacy selects | `setFormat` | `FMT`, `scene` | stage size, layers | none (local) |
| Select layer | row/stage/quick | `select` | `sel` | outline, chip, context, prompts, chat | none |
| Drag layer | stage pointer | `down` | layer x/y, `hist` | live style, rows, chat | none |
| Hide layer | eye button | `list` | `hidden`, `hist` | stage, rows | none |
| Recolour | palette swatch | `chrome` | layer color, `hist` | stage, status | none |
| Undo | button | inline | `scene`, `sel` | stage, rows | none |
| Reset | button | inline | `scene`, storage | stage, toast | `localStorage` |
| Safe zone | checkbox | inline | `#app.safe` | dashed 8 % guide | none |
| Guardrail report | tool button/auto | `watch`/`flag` | `cur`, `seen` | `#gc`, chat cards | none |
| Apply fix | card Apply | `commit` | `scene`, `hist` | stage, rows | none |
| Quick prompt | chip click | `ask` | none | user msg + cards | none |
| Card preview | hover | inline | none | temporary stage render | none |
| Card JSON | JSON button | inline | none | `<pre>` | none |
| Card apply | Apply button | `commit` | `scene`, `hist` | stage, status | none |
| Animate | card | `commit` | `anim`, `hist` | CSS animation, timeline bar, autoplay | none |
| Play/pause | `#tpl` | `play`/`stopP` | `playing`, `T` | delays, playhead, time | none |
| Scrub | `#scrub` | inline | `T` | delays, playhead, time | none |
| Retime | bar drag | `bd` | `anim.start/duration` | bar, delays, chat | none |
| Drop asset | drop | `addAsset` | `scene`, `hist`, `uid` | stage, rows, chat | pack/library URLs |
| Library filter | selects | `assets` | `AS.lib.cls/verified` | grid | cached API data |
| Library usage | library drop | `recordUsage` | server usage log | none | `POST api/assets/usage` |
| Engine panel | Templates tab | `assets`/`engPanel`/`engBind` | `ENG` | selects, thumbs, motifs | engine/categories/brand-pack |
| Engine design | card click | `engApply` | `FMT`, `scene`, `hist` | stage, rows, chat, template count | engine render |
| Motif | motif click | `engRefreshArt` | `ENG.motif`, `art.src`, `hist` | stage, rows | engine render |
| Motif sliders | range input | `engRefreshArt` | `ENG.motifScale/X/Y` | stage | engine render |
| Text scale | range input | `engSizeLayer` | layer font/box | stage | none |
| Panel resize | handle drag | `setPanel` | CSS var, storage | layout | `localStorage` |
| Section collapse | h3 click | `setSection` | `COLL`, storage | sidebar | `localStorage` |
| Clear chat | button | inline | `#chat` | empty chat, status | none |
| Offline demo | boot button | `startDemo` | `demo`, `PACKS`, `B` | full UI, badge | none (all local) |
| Persist scene | any change | `saveScene` | storage | none | `localStorage` |
| Reload scene | brand/format load | `loadScene` | `scene` | stage | `localStorage` |

---

## 16. Known bugs, dead code and constraints

### 16.1 Verified bugs

| # | Severity | Issue | Evidence | Effect |
|---|---|---|---|---|
| 1 | **High** | Engine designs do **not** survive reload | Scene is saved under `agentStudio.scene.v2:<brand>:eng:flyer:1:0`, but `loadScene()` requires `ground`, `photo`, `headline`; `boot()` also cannot find the composite format id in `FMTS`, so it falls back to A4 and loads the A4 scene. Verified: reload after “Christmas · photo” returned the classic 8-layer A4 scene. | Engine work is effectively session-only; the saved key becomes orphaned. |
| 2 | **High** | Right-click layer menu closes immediately | `stage`’s `contextmenu` handler shows the menu; the document-level `contextmenu` closer (registered earlier, runs after bubbling) immediately calls `closeContextMenu()`. Verified: after right-click, `#ctxMenu` was empty/closed. | “Delete layer” menu is unreachable; Delete/Backspace still works. |
| 3 | **High** | Offline demo hero image is broken | `DEMO_PHOTO = "__PHOTO__"` (177) is never substituted; the demo photo layer renders `url("__PHOTO__")`. Verified. | Demo shows an empty photo area (no error toast). |
| 4 | Medium | New layer ids can collide after reload | `uid` restarts at 1 each session; `addAsset` creates `kind-1`, `kind-2`… while saved scenes may already contain those ids. | `scene.find`/selection/guardrails can target the wrong layer; duplicate ids in DOM. |
| 5 | Medium | Format/template fallback UI is dead in the shipped build | `hasEngine()` is true (both scripts load), so `assets()` always renders `engPanel()`; the fallback `#fmtKind`/`#fmt` selects and `template:`/`size:`/`format:`/`motif:` cards are never created. `setFormat` is only reachable from those cards; the `?format=` boot param sets `FMT` directly. | No in-session UI to switch among the five `FMTS` formats; only `?format=` at boot or an engine design changes the canvas. |
| 6 | Medium | `engBrandify` hard-codes the source brand | Lines 534–541 replace “The Physician / The Adamson / HATCH” strings, old URLs, handles, the St Andrews address and `reservations@theadamson.com`. | Template copy from other brands can be silently rewritten; new templates inherit Dalton-specific assumptions. |
| 7 | Medium | Portrait 4:5 uses A4 geometry | `GEO` has no `portrait-45`; `buildScene`/`concepts` use `GEO[FMT.id]` with a `GEO.a4` fallback. | Text/photo placement is proportionally wrong for 4:5. |
| 8 | Medium | Engine design change discards customisation | `engApply` resets motif, scale, offsets and text scale on every design/size/category change. | Motif choice and nudges are lost when browsing designs. |
| 9 | Medium | Scene key includes a colon-rich engine id | `eng:flyer:1:0` is a valid key but cannot be parsed back into `FMTS`. | Ties into #1; no migration path. |
| 10 | Low | `qrcode.min.js` is loaded but unused | `grep QRCode pages/studio.html` → 0; `qr:''` in `engState`. | ~20 KB dead download. |
| 11 | Low | Guardrail button starts as “Checking…” | Static markup (164) until the first `watch()`. | Brief misleading state on slow boots. |
| 12 | Low | Safe-area padding is declared on `:root`, not `body` | Lines 6–7 put `box-sizing/padding-top/padding-bottom` inside the `:root` rule. | iOS safe-area inset may not apply as intended. |
| 13 | Low | `loadScene` validation has a dead condition | `MASTER_IDS.size` is always 8; only 3 ids are checked. | Corrupt/partial scenes can load and render odd values. |
| 14 | Low | Format switch does not stop playback | `setFormat` (896) does not call `stopP()` or reset `T`, unlike `selectBrand`. | Animation state can carry across a format change. |
| 15 | Low | Timeline playhead may drift when `.tlb` scrolls | `.ph` is absolutely positioned inside the scroll container. | Playhead line can misalign with rows after vertical scroll. |
| 16 | Low | Card preview flashes | Hover renders a temporary scene to the live stage; mouseleave restores it. | Brief visual jump; no timeline/selection update during preview. |
| 17 | Low | `ask` captures selection before its 300 ms delay | `const l = scene.find(...)` runs immediately. | If selection changes during the delay, cards target the old layer (apply still targets its id). |
| 18 | Low | No keyboard nudge for layers | Only pointer drag; arrow keys are used by the separators. | Accessibility gap. |
| 19 | Low | “Not found” contact values are treated as real | `contact()` returns the raw value; packs such as Cat Claw store `Phone/Email: "Not found"`. | `engBrandify` can substitute “Not found” for an Instagram/email handle; copy may read oddly. |

### 16.2 Dead or unreachable code

| Code | Why it is dead |
|---|---|
| `getTemplateCatalog`, `getSizeCatalog`, `getFormatCatalog`, `getMotifCatalog` | only used by the non-engine Templates branch and `addAsset` `template/size/format/motif` kinds; those payloads can only originate there |
| `templateFallback`, `motifFallback` | fallback data |
| `fmtGroupFor`, `buildFormats`, `bindFormatSelectors` | null-safe but no matching DOM when the engine loads; only `buildFormats` runs harmlessly |
| `setFormat` | only the unreachable fallback cards call it; boot sets `FMT` directly from `?format` |
| `template:`, `size:`, `format:`, `motif:` branches in `addAsset` | unreachable from the shipped panel |
| `qrcode.min.js` | no references |
| `getTemplateCatalog`’s `B.templates` / `P.templates` sources | current packs have no `templates` array |
| `engGroupText`’s `ctxFont` parameter | never read |

### 16.3 Constraints

- One composition at a time; no multi-format document.
- No export (PNG/PDF/SVG/MP4/GIF) on this page — that is Asset Studio / v2.
- No server save; storage is per browser profile.
- No LLM; suggestions reflect the rule table in §9.3.
- Font matching is name-based; weight ranges depend on the uploaded file.
- Engine designs are rasterised for artwork, so text is the only editable
  element after import (and not at all for die-cut/two-sided designs).
- Background pixel sampling is a 140 px thumbnail; contrast for photos is an
  estimate.
- `hist` is unbounded and memory-only; very long sessions can grow memory.
- Guardrails render a full off-screen copy on every debounce, so complex
  engine art + frequent drags can cost frames.

---

## 17. Extension recipes

### 17.1 Add an animation preset

1. Add a `@keyframes <name>` block (90–91) and, if needed, a reduced-motion
   exception (the blanket rule already disables all `[data-an]`).
2. Offer it in `suggest()` (768) and/or `concepts()` (792) with
   `A(layerId, '<name>', startMs, durationMs)`.
3. If it should be infinite, extend the shorthand condition in `render`
   (454) beyond `pulse`.
4. Timeline bars and persistence need no change; `anim.preset` is just stored.

### 17.2 Add a guardrail rule

1. Add a `LABEL` entry (801).
2. In `check()` (809), push
   `{code, id, key: code+':'+id, msg, fix:[S(...)]}`.
3. If the rule needs measurement, use the probe Range pattern
   (`probe.querySelector('[data-id="…"]')`).
4. No other wiring: `watch`, `flag`, `#gc` and the chat cards all consume the
   array generically.

### 17.3 Replace `suggest()` with an LLM

The page is deliberately structured for this (“swap suggest() for an LLM
call”, line 766). Keep the card contract:

```ts
type Card = {
  title: string;      // escaped by say()
  why: string;        // rationale shown under the title
  cmds: Command[];    // §4.3
  ask?: string;       // optional follow-up prompt instead of commands
};
```

- Input: selected layer + current scene + `TH/PAL/BF` + brand guidelines.
- Output: one or more cards; validate `type` against the seven commands and
  clamp numbers before `commit`.
- `commit()` already snapshots history, renders, re-checks guardrails and
  auto-plays animations.
- The existing `improvements/layer-studio-agent-commands.schema.json` is a
  stricter contract (`sceneId`, `baseRevision`, atomic batches) if you need
  multi-turn safety; this page does not implement it.

### 17.4 Add an asset kind

1. Create the payload in `assets()` (e.g. `data-k="shape:<id>"`).
2. Add a branch in `addAsset()` (746) that builds `Ly` using `at()`/`box()`.
3. Push history, append, `say`, `select` — copy the existing pattern.
4. If it comes from the library, call `recordUsage()`.

### 17.5 Add an engine category mapping

1. Add the category in `src/client/asset-studio/categories.js`
   (`window.AssetCategories[id] = { title, sizes, tpls }`).
2. Add `ENG_TPL_IDS[id]` (519) so `paletteRoles` gets the right template id.
3. If the category has multi-side/die-cut sizes, the flat-artwork path
   (`ENG.flat`) handles it automatically; text will not be editable.

### 17.6 Add a format

1. Add to `FMTS` (307) and `GEO` (314) with a rect set.
2. Add a `GEO` entry for every id you intend `buildScene` to handle; otherwise
   it silently uses A4 geometry.
3. Restore a format UI if needed: the fallback selects are dead, so a new
   control should call `setFormat(id)` and/or set `FMT` + `fitStage()`.
4. Engine formats are separate (`eng:*`) and cannot be expressed in `FMTS`.

### 17.7 Change theme behaviour

`deriveTheme` (322) is the only place that turns a palette into
`TH`/`PAL`. Keep `readable()` and `toneHex()` in sync; guardrail `CONTRAST`
depends on `TH.ink/bone/chalk` as candidate fixes.

---

## 18. Verification log

**Reproduce**

```bash
node server.js          # no build step; serves pages and /api
# open http://127.0.0.1:8008/studio.html
```

Opening the file over `file://` cannot work: every relative `api/...` fetch and
the page routes assume the local server.

**Static checks**

- Extracted both inline scripts and ran `node --check` — both pass.
- `grep` confirms no `QRCode` reference and no `studio-core.js` / `_.js`
  dependency.

**Chromium boot (1440×900, server `:8008`)**

- Title: `La Casa · Agent Studio`; boot hidden; `#net` hidden.
- Status: `La Casa · A4 portrait`; stage 418×594.
- 8 layers; 9 timeline rows (ruler + 8); 0 bars before applying.
- Guardrails: `✓ Guardrails clear`.
- Tabs: Brand, `Library (15)`, Templates, Elements.
- API calls: `brand-packs`, `fonts` + 22 binaries, `brand-packs/:id`,
  9 pack photos + 1 logo, `assets?brandId=…&limit=100`.
- No console errors or page errors.

**Interaction**

- Selecting Headline: context `Headline · text · x8 y53`, prompts
  `Rewrite it / Make it stand out / Animate it`, chat cards.
- Applying “Dark night”: status `Applied: Dark night`, timeline bar
  `pulse` at 30 % left / 24 % width, autoplay, stage animation
  `2400ms ease-in-out … both paused pulse`.
- Templates: 11 design types, 4 flyer sizes, 5 designs, 14 motif buttons,
  19 canvases.
- Engine design “Christmas · type”: status
  `La Casa · Christmas · type · A4 portrait`; 10 layers (8 `t*` text +
  `art` + `background`); art is a JPEG data URL; 8 guardrail issues reported;
  `#gc` shows `⚠ 8 guardrail issues`.
- Safe zone: `#app.safe`, dashed `::after`.
- Scrub 5000: `5.00 / 10.00 s`, `--p:0.5`, playhead moved.
- Double-click panel collapse: `#app.l-collapsed`, `--left-panel:0px`,
  localStorage `{"left":0,"right":390}`.

**Failure/demo**

- Aborting `api/brand-packs`: boot message + `Reload` / `Open offline demo`.
- Demo: `Offline demo` badge, `The Physician · A4 portrait`, 7 swatches,
  `Display: Georgia · Body: Helvetica Neue`, photo background
  `url("__PHOTO__")` (broken), no console errors.

**Persistence**

- Classic scene saved under `agentStudio.scene.v2:la-casa-restaurant:a4`.
- Engine scene saved under `…:eng:flyer:1:0`; reload fell back to the A4
  classic scene and `agentStudio.last.v1.fmt` reverted to `a4`.
- Context menu: right-click on the photo layer produced no visible menu.

> The probes ran in isolated Playwright browser contexts. They wrote only
> browser `localStorage` in those contexts, not repository data.

---

## 19. Related documentation and stale claims

**Related**

- [`docs/asset-studio.md`](asset-studio.md) — the engine, categories, print
  pipeline and the Asset Studio surface this page borrows.
- [`docs/brand-packs.md`](brand-packs.md) — pack structure, palette/type
  extraction, logos and guidelines.
- [`docs/asset-library.md`](asset-library.md) — the library the Library tab
  reads, including states and usage rules.
- [`docs/layer-studio.md`](layer-studio.md) — Layer Studio v2 (the `/` page).
- [`docs/architecture.md`](architecture.md) — module/server layout.
- [`docs/api-and-cli.md`](api-and-cli.md) — endpoint reference.

**Corrected as part of this documentation**

| File | Change |
|---|---|
| `README.md` | The entry-point paragraph, page tree and docs table now describe and link the Agent Studio |
| `docs/layer-studio.md` §12 | Replaced the retired “classic studio” section with a pointer to this document |
| `docs/architecture.md` load order | `pages/studio.html` now lists its actual four scripts |
| `docs/architecture.md` §9 | The “frozen with a banner” bullet now describes the Agent Studio |

**Still stale elsewhere**

| File | Claim | Reality |
|---|---|---|
| `docs/capabilities.md` §8 | The capability matrix still has a “Classic studio” column claiming keyframes, sprite frames, character rigs, ZIP import and agent commands | Those features belong to the retired page; this page has none of them |
| `docs/api-and-cli.md` | Calls `/studio.html` “(classic)” | Reachable, but it is the Agent Studio |

This document is the current reference for `/studio.html`.

---

## Appendix A — default geometry (`GEO`, rects are `[x,y,w,h,fontSize%]`)

| Format | photo | logo | head | sub | body | cta | foot | over photo |
|---|---|---|---|---|---|---|---|---|
| `a4` | `[0,0,100,48]` | `[37,9,26,8]` | `[8,53,84,16,6.2]` | `[8,69.5,84,5.5,2.4]` | `[8,76,84,8.5,1.6]` | `[8,85.4,84,3.1,1.7]` | `[8,89.2,84,2.2,1.05]` | yes |
| `story` | `[0,0,100,50]` | `[30,10,40,6]` | `[8,55,84,14,4.6]` | `[8,70,84,4,2.2]` | `[8,75,84,8,1.5]` | `[8,85,84,3,1.6]` | `[8,89,84,2.4,.95]` | yes |
| `sq` | `[0,0,100,50]` | `[8,9,24,8]` | `[8,54,84,15,5.2]` | `[8,69.5,84,5,2.4]` | `[8,75,84,9,1.9]` | `[8,85.6,84,3.4,2.1]` | `[8,89.2,84,2.6,1.2]` | yes |
| `land` | `[0,0,46,100]` | `[52,9,22,9]` | `[52,22,40,30,8]` | `[52,53,40,8,3.6]` | `[52,62,40,17,2.6]` | `[52,80,40,5,2.6]` | `[52,86.5,40,5.5,1.7]` | no |
| `portrait-45` | — | — | — | — | — | — | — | falls back to `a4` |

`fontSize%` is a percentage of canvas height. For `framed`, the photo becomes
`[8,8,84,84]` when it was full-bleed, and the logo drops 3 % when it overlays
the photo.

## Appendix B — defaults and fixed values

| Constant | Value |
|---|---|
| Timeline duration | 10 000 ms |
| Scrub range | 0–10 000, step 50 |
| Panel left | 200–420, default 270 |
| Panel right | 280–560, default 390 |
| Collapse threshold | `min − 40` px |
| 8 % safe margin | 7.99 / 92.01 |
| Minimum text size | 0.9 % of height |
| Contrast thresholds | 3:1 at ≥ 2.2 % height, else 4.5:1 |
| Contrast samples | 3 × 2 = 6 |
| Pixel sample width | 140 px |
| Logo timeout | 9 000 ms |
| Toast | 3 200 ms |
| Guardrail debounce | 30 ms |
| Save debounce | 400 ms |
| Resize re-check | 60 ms |
| Chat reply delay | 300 ms |
| Animation autoplay delay | 60 ms |
| Default theme | ink `#17162e`, bone `#ebe6e0`, accent `#eb5b3c`, chalk `#ffffff` |
| Accent fallback | `#e1543a` |
| Bone fallback | `#f4f1ec` |
| Engine target width | `min(size.w, 1400)` |
| Art JPEG quality | 0.92 |
| Engine text group threshold | Δx < 2 %, gap 0.7–1.9 × size |
| Library request | `limit=100`, show ≤ 60 |
| Engine photos | ≤ 9 |

## Appendix C — source map

| Lines | Contents |
|---|---|
| 1–135 | `<head>`, CSS (tokens, layout, components, keyframes, responsive) |
| 136–139 | external scripts |
| 140–176 | boot/toast/app markup, header, sidebar, handles, canvas, timeline, agent |
| 177 | `DEMO_PHOTO` |
| 178–949 | second `<script>`; IIFE at 179–949 |
| 180–199 | utilities, panel constants |
| 200–230 | panel resizing |
| 232–250 | collapsible sections, toast, init calls |
| 252–259 | colour math |
| 261–304 | state, fallback catalogs |
| 306–319 | formats and geometry |
| 321–335 | theme |
| 337–355 | fonts |
| 357–380 | images/logos/pixel sampling |
| 382–393 | copy |
| 395–423 | scene builder/fitting |
| 425–434 | command engine/commit |
| 436–461 | render/drag |
| 463–467 | stage sizing/probe |
| 469–512 | layers/panels/chrome/format UI |
| 514–673 | Asset Studio engine bridge |
| 675–764 | asset panel/library/drop/usage |
| 766–797 | agent suggestions/concepts |
| 799–831 | guardrails |
| 833–851 | timeline |
| 853–877 | chat/delete/context menu/greet |
| 879–886 | toolbar bindings |
| 888–893 | persistence |
| 895–920 | selection flow |
| 922–948 | boot/demo/ResizeObserver/start |
