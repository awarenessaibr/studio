# Layer Studio ↔ Suvi — Full Comparison

**Basis of comparison:** the actual codebase as delivered (`_.js` ~2,400 lines with character rigs, animation director, sprite frames, easing, presets, agent protocol; `server.js` with Ollama proxy, segment organizer, character import, LLM director endpoints; `studio-v2.html` with segment tree UI, canvas zoom, organizer dialog; `composition-generator.js` CLI), cross-referenced against the *Suvi Creative Infrastructure Platform* product mapping document.

**Purpose of this document:** to state precisely what Layer Studio is today, what Suvi claims to be, where those two overlap, where one is materially stronger than the other's description, and where the true gaps are. It is not a critique of the Suvi doc — it is a working comparison so that decisions about how Layer Studio could sit inside the Suvi story are made with accurate information about what already exists.

---

## 1. Executive summary

**Suvi** (per the product document) is a **creative infrastructure platform**: a private brand-trained AI ("The Brain") sitting between brand guidelines and market/channel execution, whose job is to let brands ship many ads while staying on-brand and compliant across 5 channels and multiple markets. It is defined by *scale*, *brand control*, and *multi-market consistency*, and its value prop is *"more ads, all on-brand, everywhere."*

**Layer Studio** (per the code) is an **AI-assisted 2D cutout-scene animation studio**: a browser-based editor for layered PNG scenes, with an optional character rig, a local-LLM animation director, a segment organizer, a template-matching reference-aligner, and a solid export pipeline (PNG / SVG / WebM / MP4 / GIF / JSON / agent-spec). It is defined by *composition quality* and *animation intelligence* for a single creative, not by *scale across formats*.

The relationship is **partial and asymmetric**:

- **Suvi's "Creative Hub"** is roughly where Layer Studio would live — but Layer Studio produces **one** creative, not a format matrix.
- **Suvi's "The Brain"** — the private brand-trained AI — has an architectural *analogue* in Layer Studio (local Ollama, private by default), but the *purpose* is different: Layer Studio's AI animates and organizes; Suvi's AI enforces brand and generates briefs.
- **Suvi's "Creative Infrastructure"** — the layer that locks templates and enforces guidelines — has only a **weak analogue** in Layer Studio: `positionConfirmed` and character rigs are legitimate governance primitives, but there is no template-with-slots, no brand kit, no guardrails.

**The single most important fact** for this comparison: Layer Studio **has no text layers**. Almost every Suvi demo — headlines, taglines, CTAs, proofreading, creative-set copy — is blocked behind that one missing primitive. This single gap makes roughly half of the Suvi document unreachable from where Layer Studio stands today.

The **second most important fact**: Layer Studio has **one canvas per composition**. The Suvi value proposition is *"one design → all formats."* Layer Studio cannot currently do that. This gap makes the other half of the Suvi document (multi-format, channel adaptation, market variation) unreachable.

Everything else — AI animation, character rigs, segment organization, reference alignment, exports — is *additional* to what the Suvi document describes, and in some cases **more advanced** than what Suvi claims.

---

## 2. What Layer Studio actually is (precise inventory)

Before comparison, an accurate inventory, because the Suvi document describes a different kind of product and the reader needs to know what is on the table.

### 2.1 Core editor

- **Layered scene editor** on a canvas. Layers are images with `x/y/w/h` in percent, `opacity`, `rotation`, `z`, `fit` (`contain`/`cover`), `visible`, `locked`, `positionConfirmed`.
- **Direct manipulation**: drag, resize (8 grips), rotate via inspector. Keyframe-aware: if a layer has keyframes, dragging writes a keyframe instead of mutating the base transform.
- **Sprite frames**: `frames[]` array, `spriteFps` (1–30), `spriteMode` (`loop` / `pingpong` / `once`).
- **Effects**: recolour (`feFlood`/`feComposite` on-screen; per-pixel in export) and contour (`feMorphology dilate` on-screen; monotonic-deque dilate in export). Both surface identically in screen, SVG, PNG, GIF, video.
- **Roles**: `background`, `midground`, `ground`, `foreground`, `character`, `character-part`, `prop`, `effect`. Roles drive z-ordering heuristics and the director's proposals.

### 2.2 Animation

- **Keyframes** on `x, y, w, h, rotation, opacity` — with **16 named easings** (`linear`, `easeIn/Out/InOut`, sine/quad/cubic variants, `easeOutBack`, `easeInBack`, `stepStart`, `stepEnd`), applied per keyframe.
- **19 named presets** (`breathe`, `idle`, `sway`, `walk`, `float`, `flicker`, `drift`, `pulse`, `fadeIn`, `parallax`, `fadeOut`, `zoom`, `spin`, `shake`, `hop`, `swing`, `orbit`, `nod`, `blinkIn`). Each preset accepts tuned parameters.
- **Playback** via `requestAnimationFrame` with a modulo loop.
- **Group animation** in the segment tree: apply a preset across all items in a group with per-layer variance.
- **Reset animations** clears all keyframes with confirmation.

### 2.3 Character rig v3

A genuinely deep feature not present in the Suvi document:

- **18 part slots**: `face`, `eyes`, `pupils`, `highlights`, `eyelids`, `brows`, `mouth`, `jaw`, `teeth`, `tongue`, `mustache`, `beard`, `head`, `body`, `hands`, `ears`, `neck`, `fx`.
- **5 expressions**: `neutral`, `happy`, `sad`, `surprised`, `angry`.
- **13 visemes**: `rest, a, e, i, o, u, mbp, fv, l, wq, smile, frown, open`.
- **Blink** with variant eyelid layers (`half`, `closed`) crossfaded; Poisson-like blink distribution with occasional double blinks.
- **Gaze** with micro-saccades, and **eye wanders**.
- **Head sway**, **breathe**, **eye+beard pulse**, all phase-lagged.
- **Speech-to-viseme lip sync** from English graphemes (`textToVisemes`) with hold durations per viseme, and a viseme-fade envelope.
- **10 baked character animations** (`talk-well-met`, `talk-entao-ta-neh`, `idle`, `happy`, `sad`, `surprised`, `angry`, `blink-test`, `talk-loop`, `mouth-a-qa`).
- **Auto-detection**: server-side detection by filename + geometry + union-find grouping of touching parts.
- **Character bundle export/import**: ZIP with `character.json`, parts, and a preview — a portable character format.

### 2.4 AI features (all local-first)

- **Animation director**: two-stage local pipeline. Vision model analyzes the final image + context; writer model proposes **4 distinct schemes** as `{commands[], characters[]}`. Each scheme can be **applied with one click**. Context is saved per project. Models selectable per project.
- **Segment organizer**: vision model inspects each segment thumbnail + final image and proposes **name**, **group**, **role** per segment. Editable review list; **Apply** commits.
- **Remote option** for organizer: OpenAI-compatible endpoint, key stays server-side, HTTPS enforced for non-loopback.
- **Local Ollama** detection on two ports, model caching, vision-model detection by family.
- **Validation layer**: LLM commands are validated against real layer IDs and the preset vocabulary before application — the model cannot animate a layer that does not exist.

### 2.5 Reference alignment (from prior version, still present)

Multi-scale template matcher: 12 scales × up to 6 seeds per scale × 5 refinement ratios, with color error + gradient error + alpha penalty, background estimation, ambiguity detection. Accepts as `matched`, `ambiguous`, or `unmatched`. Rotations are flagged `unsupported-rotation`.

### 2.6 Exports

- **PNG** (`export-image`): all layers, alpha-capable, excludes the reference.
- **SVG**: static at base layer values, `preserveAspectRatio` per layer, embedded filter defs.
- **WebM/MP4** via `MediaRecorder`, codec negotiated (mp4 > webm/vp9 > webm/vp8 > webm), 30 fps, 8 Mbps.
- **GIF**: hand-written variable-width LZW, fixed 3-3-2 + neutral + skin/beard/skirt-cavity palette, 10 fps, 480 px, round-trip validated.
- **JSON**: the composition.
- **Agent spec**: `layer-studio/agent/v1` — schema, layer inventory with aliases, preset/character/viseme vocabularies.

### 2.7 Agent protocol

- `exportAgentSpec()` returns a structured document describing the composition, layer inventory with **short aliases** (`L01`, `L02`), and the full vocabulary the model may use.
- `applyAgentCommands(commands)` accepts `{commands: [...]}` where each entry targets a layer preset, a character setting, or a `speak` object.
- Server-side director uses the same vocabulary; the model cannot hallucinate layer IDs.

### 2.8 Persistence & backend (`server.js`)

- **Zero-dependency Node server**, serves the studio at `:8008`.
- **ZIP import**: extracts archives, validates image formats by magic bytes, generates a composition scaffold, auto-aligns.
- **Character bundle import**: `character.json` + parts → a rigged character ready to animate.
- **LLM proxy**: Ollama and OpenAI-compatible; keys stay server-side; loopback-only HTTP.
- **Segment organizer API**: accepts base64 thumbnails, returns suggestions.
- **Director API**: accepts vision + text model IDs, returns proposals.
- **Animations library**: per-project named performances.
- **Repository projects**: compositions under `data/projects/<project>/compositions/`.
- **Safety**: `safeRelativePath`, magic-byte format detection, size caps, path escapes blocked.

### 2.9 Tooling

- `composition-generator.js`: folder walker, filename classification, role assignment, sprite grouping, reference detection, emit `.composition.json`.
- `studio-v2.html`: segment tree with grouping, filter, expand/collapse, group animate, group download (transparent + with-final PNGs), canvas zoom.
- `studio.html`: classic studio (per README).

---

## 3. Full cross-reference against the Suvi document

Status: ✅ matches Suvi's requirement · ⚠️ partial/analogue · ❌ absent · 🔌 belongs in a different layer (backend/Brain/platform).

### §1 — Market context & problem statement

| Item | Layer Studio |
|---|---|
| Brand drift | Not modelled. No cross-artifact consistency check. |
| Scale complexity (60+ versions) | **No.** One canvas per composition. |
| AI proliferation | Layer Studio *is* AI-amplifying (director, organizer, character rig). |
| Trust gap | **Partial** — `positionConfirmed` review gate + director validation are governance primitives. |
| Guideline enforcement | **No.** No guideline registry. |

**Read:** §1 describes the market Layer Studio is entering, not what Layer Studio does. The *direction* is aligned; the *evidence* is not.

### §2 — Three-layer architecture

| Layer | Suvi | Layer Studio today | Verdict |
|---|---|---|---|
| **Creative Hub** | All formats produced automatically | One canvas; exports PNG/SVG/MP4/GIF/JSON | ⚠️ **produces one creative well, not a format matrix** |
| **The Brain** | Private AI trained on brand, guidelines, history | Local Ollama — private, on-device — used for animation ideas and segment organization | ⚠️ **same privacy principle, different purpose** |
| **Creative Infrastructure** | Locks templates + guidelines across markets | `positionConfirmed` gate, character rigs (a brand-controlled asset format), reference alignment | ⚠️ **~20%** — governance primitives exist, infrastructure does not |

### §3 — The Brain

| Suvi item | Layer Studio today | Verdict |
|---|---|---|
| Privacy first | ✅ — models run locally; Ollama by default; remote path is opt-in and key stays server-side | ✅ **direct match** |
| Brand-specific training | ❌ — no fine-tuning; models are general | ❌ |
| Continuous learning | ❌ | ❌ |
| Agent integration | ✅ — `exportAgentSpec` + `applyAgentCommands` two-tier protocol | ✅ **exceeded** (Suvi only says "connects to agents") |
| Universal control | ❌ | ❌ |
| **ANALYZE** — brand analyser | ❌ — no color/font/logo/tone analysis against guidelines | ❌ |
| **AUTOMATE** — templates + versioning + multi-language | Animation director proposes animations; no format adaptation; no locale | ⚠️ **half covered** |
| **ACT** — attention prediction | ❌ | 🔌 |

**Read:** Layer Studio's local AI is a legitimate **implementation of Suvi's privacy principle**, but it is doing a **different job** — animation and organization, not brand analysis and generation. The infrastructure exists; the purpose is orthogonal. The Gartner recommendation (*"spend 2x more on reducing AI risk"*) is *well served* by Layer Studio's on-device architecture; but the *product* Suvi describes is not built.

### §4.1 — Template creation from static image

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| Single PNG → separated layers | **No.** Requires pre-segmented ZIP + final image. | ❌ **direct miss** |
| AI reads layout | ✅ — segment organizer proposes name/group/role per segment | ⚠️ **reads, does not create** |
| Creates layers | ✅ (from ZIP) | ⚠️ from pre-cut assets only |
| Adds animations | ✅ — animation director proposes 4 schemes from the assembled image | ✅ |
| Saves as template | Save-as-project, character export/import | ⚠️ no slot schema |
| Generates formats | ❌ | ❌ |

**§4.1 verdict: ⚠️ ~55%.** The *tail* of the pipeline (organize → animate → save → export) is real and credible. The *head* (single image → segmentation) is missing entirely. The *tail-end* (format generation) is missing.

### §4.2 — Creative set from brief

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| Ingest Excel / PDF / Email / client feedback | ❌ | ❌ |
| Content table → production per row | ❌ — but `composition-generator.js` walks a folder and emits a composition; the *shape* of batch→JSON exists | ⚠️ **shape exists, input is folder** |
| Variable mapping (logos, images, URLs, hex) | ❌ | ❌ |
| Complete creative set | ❌ | ❌ |

**§4.2 verdict: ❌.** The CLI is a useful **batch scaffold**, but it reads filesystem folders, not briefs.

### §4.3 — AI headline generation

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| Analyze context → on-brand headlines | LLM infrastructure present (Ollama proxy, prompt engineering, validation); writer model already produces text | ⚠️ **capability present, no destination** |
| Apply across formats | ❌ | ❌ |

**§4.3 verdict: ❌ — but one primitive (text) away from ⚠️.**

### §4.4 — Comment resolution & approval

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| Comments / threads | ❌ | ❌ |
| Change previews | ❌ | ❌ |
| Batch approve | ✅ — `positionConfirmed` + `confirm-all` with pending count | ⚠️ **approval without comments** |
| Real-time status | ❌ | ❌ |

**§4.4 verdict: ⚠️ ~20%.** The approval primitive is real and well-designed (accessibility, status flags, invalidation on geometry change). It is not a comment workflow.

### §4.5 — Proofreading & QA

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| Typos, missing elements, inconsistencies | ❌ | ❌ |
| Auto-fix | ❌ | ❌ |

**§4.5 verdict: ❌.** Blocked on text layers.

### §4.6 — Animation generation

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| Motion AI adds animations based on brand style | ✅ — vision+writer pipeline proposes 4 schemes; user applies with one click | ✅ **direct hit** |
| Contextual animation suggestions | ✅ — `context` field, saved per project | ✅ |
| Free creative mode | ✅ — "Suggest animations" works without context | ✅ |
| Automatic application to all formats | ❌ — one canvas | ❌ |

**§4.6 verdict: ✅ ~75%.** This is Layer Studio's **strongest single match** to the Suvi document. The one missing piece — multi-format fan-out — is a platform gap, not a director gap.

### §4.7 — Export & distribution

| Suvi requirement | Layer Studio today | Verdict |
|---|---|---|
| **PNG** | ✅ `export-image` with alpha | ✅ |
| MP4 / WebM | ✅ `export-webm` (real-time, codec-negotiated) | ✅ |
| GIF | ✅ hand-written LZW | ✅ |
| DSP push | ❌ | 🔌 |
| Preview link sharing | ❌ — download only | ❌ |
| Campaign Manager | ❌ | 🔌 |

**§4.7 verdict: ⚠️.** Export side is real and in some cases (GIF, SVG) more thorough than Suvi describes. Distribution side is absent.

### §5.1 — Channels

| Suvi channel | Layer Studio |
|---|---|
| Social (Facebook, LinkedIn, Meta) | No channel concept. A single canvas, no per-channel sizes. |
| Display | — |
| Video | — (there's video export, but no channel size model) |
| Digital screens (in-store) | — |
| Print | — |

**§5.1 verdict: ❌ — completely absent.**

### §5.2 — Geographic coverage (Nordics, Europe, US, LATAM)

**§5.2 verdict: ❌.** No locale, no market dimension. (The character rig doesn't have a locale field either — speech is English graphemes only.)

### §5.3 — Format support

| Suvi requirement | Layer Studio |
|---|---|
| Multiple sizes (e.g., 930×600) | Presets in dropdown: 1080², 1080×1350, 1920×1080, 1080×1920, custom. **One active at a time.** |
| Multi-format from single source | ❌ |
| Automatic adaptation per channel | ❌ |

**§5.3 verdict: ❌.**

### §5.4 — Integration points

| Suvi integration | Layer Studio |
|---|---|
| Existing AI agents | ✅ `exportAgentSpec` + `applyAgentCommands` — **inbound** agent protocol. |
| DSP platforms | ❌ |
| Campaign Manager | ❌ |
| Studio | (Layer Studio *is* the studio) |
| Automations | ❌ |
| Manager | ❌ |

**§5.4 verdict: ⚠️.** One integration is not only present but *well-designed* — the agent protocol with validations. Everything else absent.

### §5.5 — Coming features

| Suvi roadmap | Layer Studio |
|---|---|
| Safe Zones | ❌ |
| Enhanced Brand Kits | ⚠️ character bundles are a portable brand-controlled asset format; no palette/typography |
| Guardrails | ❌ |

**§5.5 verdict: ❌ — no groundwork.**

### §6 — Use case flow (winter jacket campaign)

| Step | Layer Studio |
|---|---|
| 1. Data aggregation (product feed, reviews, weather) | ❌ |
| 2. AI processing → brief | ⚠️ director produces animation suggestions from context, not full briefs |
| 3. Content creation (copywriter agent, per-audience) | ❌ (no text) |
| 4. Brand compliance | ⚠️ `positionConfirmed` is QA, not compliance |
| 5. Production (auto-generate formats, review, distribute) | ⚠️ one format; approval yes; distribute no |
| 6. Deployment | ❌ |

**§6 verdict: ⚠️ ~20%.** Steps 4–5 partially. The rest absent.

### §7 — Business value & metrics

Platform-level. **§7 verdict: 🔌.** Layer Studio cannot be measured on 86%/6x/9x metrics until it participates in a multi-format pipeline.

### §8 — Differentiation

| Suvi claim | Layer Studio |
|---|---|
| Private AI | ✅ local Ollama, on-device | ✅ **exact** |
| Brand control | `positionConfirmed`, character rigs | ⚠️ |
| Full-stack | brief ❌, formats ❌, distribution ❌ | ❌ |
| Multi-market native | — | ❌ |
| Existing tool integration | — | 🔌 |
| Continuous learning | — | 🔌 |

**§8 verdict: ⚠️ on two claims, ❌ on four.**

### §9 — Roadmap

| Suvi item | Layer Studio today |
|---|---|
| The Brain (Nov 9) | ⚠️ *a* private AI, but different purpose |
| Safe Zones (2025) | ❌ |
| Enhanced Brand Kits (2025) | ⚠️ substrate (character bundles) |
| Guardrails (2025) | ❌ |

### §10 — Target users

| Role | Suvi pain | Layer Studio |
|---|---|---|
| Marketing Manager | More ads, more formats | ❌ one format |
| Designer | Resize, version, repeat | ⚠️ one scene at a time, plus a CLI scaffold |
| CMO | Efficiency at scale | ⚠️ director saves time per scene; no scale story |
| CEO | "Can't AI do it?" | ⚠️ director + organizer + character rig are AI; but per-scene |
| Brand Manager | Consistency | ⚠️ `positionConfirmed` only |

**§10 verdict: ⚠️ — Layer Studio addresses the *designer's* per-scene pain well; the others only marginally.**

### §11 — Terminology

See §9 of this document.

### §12 — Contact & next steps

Not applicable.

---

## 4. Coverage scorecard

| Suvi section | Layer Studio coverage | Weight in Suvi doc |
|---|---|---|
| §1 Market context | N/A (context) | — |
| §2 Three-layer architecture | ~10% | High |
| §3 The Brain (principles + functions) | Principles ✅; functions ❌ | Very high |
| §4.1 Template from static image | ~55% | High |
| §4.2 Creative set from brief | ~5% | High |
| §4.3 Headline generation | ~15% | Medium |
| §4.4 Comments / approval | ~20% | Medium |
| §4.5 Proofreading | 0% | Low |
| §4.6 Animation generation | **~75%** | **Very high** |
| §4.7 Export & distribution | Export ✅, distribution ❌ | High |
| §5.1–5.3 Channels / geo / formats | ~0% | Very high |
| §5.4 Integrations | AI agents ✅; rest ❌ | Medium |
| §5.5 Coming features | ~10% | Low |
| §6 End-to-end use case | ~20% | High |
| §7 Metrics | 0% (by nature) | — |
| §8 Differentiation | 2 of 6 ✅ | High |
| §9 Roadmap | 1 of 4 partial | Medium |
| §10 Target users | ~25% (designer) | High |

**By area of the Suvi doc, weighting each section roughly by its importance in the source:**

- **Creative Hub** (the production surface): **~40% covered.** Strong single-creative, no format matrix.
- **The Brain** (the AI): **~15% covered** on *function*; **~80% covered** on *principle*. Different purpose, same privacy posture.
- **Creative Infrastructure** (templates + governance): **~20% covered.** Good `positionConfirmed` primitive, no template schema, no guardrails.

**Overall: ~30% of the Suvi document is reachable from Layer Studio today.**

That is a **much higher number than the previous (wrong-codebase) review**, and it is higher because of the AI work. But the remaining 70% is not spread thin — it is concentrated in three concrete missing primitives:

1. **Text layers.**
2. **Multi-format generation.**
3. **Brand-kit / template-slot model.**

Add those three, and Layer Studio reaches **~75–80%** of the Suvi document — because the AI and the exports are already there.

---

## 5. Capabilities Layer Studio has that the Suvi document does *not* describe

These are not gaps to be closed; they are **existing strengths** that the Suvi narrative does not currently tell. They matter because they could reframe Suvi's story around *creative quality*, not just compliance.

### 5.1 Character rig v3 (18 parts, 13 visemes, 5 expressions)

The Suvi document's animation coverage (§4.6) is *"Motion AI adds animations based on brand style."* Layer Studio does that **and** provides an articulated character rig with **lip-synced speech from typed text**, **micro-saccades**, **phase-lagged secondary motion**, **expression variants**, and **rendered exports**. This is genuine animation depth — not template animation.

**Strategic read:** character animation is a *creative quality* story Suvi doesn't currently own. It is also directly aligned with the "premium vs. party tone" example in the Carlsberg case (§3.2 ANALYZE) — the rig can *perform* tone, not just detect it.

### 5.2 Animation director (local vision + writer pipeline)

§4.6 describes what this does. The Suvi document does not describe:
- **Two-stage** analysis (vision pass → writing pass) with distinct models.
- **Model selection per project**, saved.
- **Four distinct proposals** per request (not one).
- **Story context** field, saved per project.
- **Proposal validation** against real layer IDs before application.
- **Local-first** by default.

The director is **more sophisticated** than §4.6's three-line description implies.

### 5.3 Segment organizer

This is the *"AI reads layout"* step of §4.1, working end-to-end today. The Suvi doc says *"AI reads layout → separates elements."* Layer Studio **organizes** elements (name, group, role) with a local or remote vision model, and the output is **editable**, **reviewable**, and **non-destructive** until applied. Only the *separation* step is missing.

### 5.4 Agent protocol

§5.4 lists *"existing AI agents"* as an integration point. Layer Studio provides an **inbound** protocol — a structured spec the agent consumes, a validated command language the agent writes. This is a stronger agent story than Suvi's one-line description.

### 5.5 Reference alignment as brand-consistency verifier

The multi-scale template matcher was built to *"align my layers to a reference"*. Read it sideways and it is *"verify an exported creative matches the approved reference within tolerance"* — which is the **§1.1 Brand Drift problem** stated as a function. This is not in the Suvi doc, but it is one naming decision away from being a Suvi feature.

### 5.6 `positionConfirmed` review gate

Per-layer confirmed state, pending count, `confirm-all`, invalidation on any geometric change, accessibility (aria), and review status flags. Well-built, and the substrate for both §4.4 (comments/approval) and §3.2 ANALYZE (compliance).

### 5.7 Fully client-side pixel pipeline

`dilateAlpha` (O(n) separable max filter), hand-written LZW, `GifEncoder`, and identical SVG/canvas screen-export parity. **Privacy-preserving by construction.** This aligns with Suvi's *"data never leaves the customer"* principle in a way no server-side render pipeline would.

### 5.8 Sprite frames with `loop` / `pingpong` / `once`

A small but real capability the Suvi doc doesn't mention. Multi-frame cutouts work with the same pipeline as single frames.

### 5.9 Easing + 19 presets

Animation quality is materially higher than the "automatic animations" Suvi describes. Per-keyframe easing is a designer-grade primitive.

### 5.10 Character bundle export/import

`character.json` + parts + preview, ZIP-packaged — a **portable character format** — is a brand asset format the Suvi document's "Enhanced Brand Kits" roadmap does not anticipate. It is *more* specific than a brand kit and *more* useful for animation-heavy content.

### 5.11 Composition generator CLI

`composition-generator.js` already scaffolds compositions in batch. The Suvi doc's §4.2 *"one brief → N rows → N compositions"* shape **exists**, just with the wrong input. This is a smaller conversion than it looks — swap folder walk for brief parse, and the CLI becomes the production engine.

---

## 6. Gaps Suvi requires that Layer Studio lacks (full register)

### S1 — Blocks the Suvi story (build or integrate before any Suvi demo)

| # | Gap | Blocks |
|---|---|---|
| 1 | **Text layers** — no primitive for headlines, taglines, CTAs, body, locale-keyed text | §4.3, §4.5, §4.2, §C of prior analysis, and any "ad" the Suvi doc imagines |
| 2 | **Multi-format generation** — one canvas, N formats, per-format overrides | §1.1, §4.1 last line, §4.6 last line, §5.1–5.3, §6, §7 (metrics), and the entire value prop |
| 3 | **Template model with slots** — a composition is a `template` if it carries typed slots (`text`, `color`, `url`, `image`) with locked/override flags | §4.1 "saves as template", §4.2 "content table → rows", §3.2 AUTOMATE |
| 4 | **Brand kit / palette / typography registry** — palette, fonts, logo assets as first-class objects; enforce at fill time | §3.1, §5.5, §8 (brand control) |
| 5 | **Brief ingestion** — Excel/CSV/email/feedback → rows → compositions | §4.2 |
| 6 | **Comments / approval workflow** — threads, previews, batch approve; `positionConfirmed` becomes the *gate*, not the *workflow* | §4.4 |
| 7 | **Locale dimension** — text and image variants per locale; per-market overrides | §5.2 |
| 8 | **Distribution** — DSP push, preview link sharing, campaign handoff | §4.7, §5.4 |
| 9 | **The Brain (ANALYZE/ACT)** — brand-trained model, guideline compliance | §3.2, §8 |
| 10 | **Safe zones / guardrails** — channel-specific geometry; rules engine | §5.5 |

### S2 — Degrades the story once S1 lands

| # | Gap | Impact |
|---|---|---|
| 1 | **Per-format batch export** | Multi-format is the value prop; single-file exports slow it |
| 2 | **ZIP packaging for batch export** | 5 formats × 5 sizes × 2 locales = 50 files; download-one-at-a-time is a UX failure |
| 3 | **Real-time video export** (`MediaRecorder`, codec-gated) | Reliability under load; WebCodecs or server-side render is the fix |
| 4 | **Single global save slot per import** vs. proper project model | Already improved (multi-project) but versioning absent |
| 5 | **SVG export at base values** (no animation) | Suvi export formats include SVG; static is likely fine |
| 6 | **Proofreading hooks** | Needs text first |
| 7 | **Cross-artifact brand consistency** | Reference alignment gives a seed; needs a server-side verifier |

### S3 — Nice-to-have

- Attention prediction (§3.2 ACT).
- Continuous learning (§3.1).
- "Free creative mode" toggles.
- Collaboration / presence.
- Campaign Manager / Automations integrations.

---

## 7. Where Layer Studio is materially *stronger* than the Suvi document describes

These are the places where the actual code exceeds what the Suvi narrative implies. Worth stating clearly because they change the strategic picture.

### 7.1 Animation generation is *two AI passes*, not one suggestion

The Suvi doc says *"Motion AI adds animations based on brand style."* The code does:
1. Vision pass: analyze the final image, extract `subject`, `setting`, `mood`, `palette`, `keyElements`, `motionCues`, `depthNotes`.
2. Writer pass: given the analysis + layer inventory + context, produce **4 distinct schemes** with validated commands.

That is **not** a single-suggestion feature; it is a **creative direction system**.

### 7.2 The character rig is more sophisticated than any animation tool the Suvi doc imagines

18 parts, 13 visemes, phase-lagged secondary motion, saccades, blink variants, speech lip-sync. This is *animation authoring* — not template animation.

### 7.3 The agent protocol is a real integration surface, not a bullet point

`layer-studio/agent/v1` is a **documented schema with vocabularies and validation**. The Suvi doc says *"Existing AI agents"*; Layer Studio delivers the *contract*.

### 7.4 The exports are hand-built and portable

Hand-written LZW, canvas-based GIF; identical screen/export SVG filter parity; alpha-capable PNG; portable character bundles. This is unusual for a zero-build web app and directly supports the "privacy by construction" claim.

### 7.5 The private-AI architecture is a genuine asset

Local Ollama by default, remote **opt-in** only, keys server-side, loopback-only HTTP. This is the **Gartner recommendation** (§1.3) *implemented*, not just cited.

### 7.6 The `positionConfirmed` gate is well-designed

aria, status flags, `confirm-all` with pending count, invalidation on geometry change. This is exactly the kind of governance surface the Suvi doc *needs* and *does not describe*.

### 7.7 The segment organizer already reads layout

§4.1 says *"AI reads layout → separates elements."* Layer Studio reads the layout — the separation step is the missing one, not the understanding step.

---

## 8. Where Layer Studio is aligned *in principle* but not *in practice*

These are cases where the philosophy matches but the implementation does not.

| Suvi principle | Layer Studio aligns... | ...but does not |
|---|---|---|
| Privacy first | Local AI by default; assets stay in browser | Have a documented data-flow (where do models run? where does context live? what is exported?) |
| Brand-specific | Character rigs are brand-controlled assets | Train on the brand; there is no fine-tuning loop |
| Continuous learning | Animations library is per-project and saved | Learn across campaigns; no feedback loop |
| Agent integration | Inbound agent protocol is well-designed | Integrate with Suvi's actual agents; no outbound |
| Universal control | One Studio surface | One platform — Studio, Manager, Automations not connected |

These are **posture** matches, not **product** matches. They are honest; they are not the Suvi story.

---

## 9. Terminology mapping

| Suvi term | Nearest Layer Studio equivalent | Fidelity |
|---|---|---|
| **Brief** | — | **None** |
| **Creative Set** | — (composition = one artifact) | **Wrong container** |
| **Template** | Composition with `locked` layers; character bundle | **Weak analogue** — no slots, no typed fields |
| **Brand Drift** | — (not modelled) | **None** |
| **Creative Infrastructure** | `positionConfirmed` + character rig + reference alignment | **~20%** |
| **The Brain** | Local Ollama + director + organizer | **Different purpose** |
| **Safe Zones** | — | **None** |
| **Guardrails** | — | **None** |
| — | **Reference layer** (`referenceLayerId`) | **Novel** — no Suvi equivalent |
| — | **`positionConfirmed`** | **Novel** — no Suvi equivalent |
| — | **Character bundle** (`.zip` with `character.json`) | **Novel** — Suvi's "Enhanced Brand Kits" doesn't anticipate this |
| — | **Agent spec** (`layer-studio/agent/v1`) | **Novel** — more concrete than Suvi's "AI agents" line |
| — | **Animation director proposals** (4 schemes) | **Beyond** §4.6 |

---

## 10. Architectural read — how the pieces could fit

If the strategic decision is to *bring Layer Studio into the Suvi story*, here is how the existing pieces map to the missing pieces, honestly.

### 10.1 Layer Studio already fits as "Creative Hub" — for a single creative

The Hub claim is *"All formats produced automatically."* Layer Studio produces *one* format, well. The Hub claim requires **the multi-format pipeline** as a schema-level change.

The shape of the change is well-understood from the earlier plan:
- A `Format` object: `{ id, isMaster, channel, label, width, height, variableValues, layerOverrides }`.
- `resolveLayer(layer, { composition, format, locale })` — the single render path for DOM, canvas, SVG.
- Batch export iterates formats and locales.

Once done, Layer Studio's *Creative Hub* coverage jumps from ~40% to ~85%.

### 10.2 The Brain's privacy claim is already satisfied; the brand claim is not

Suvi's "The Brain" has two separable claims:
- **Privacy**: ✅ Layer Studio already satisfies this (local Ollama, on-device pixel pipeline, keys server-side).
- **Brand-specific**: ❌ Not implemented.

The gap is not architectural — it's *training* and *brand data*. The right place for that is a **server-side Brain service** consuming Layer Studio's agent protocol and segment organizer API. Layer Studio's *validation layer* (commands checked against real layer IDs and vocabularies) is the contract the Brain needs to satisfy.

### 10.3 Creative Infrastructure needs the template-slot model

`positionConfirmed` is a governance primitive. But it is *not* the Suvi-doc infrastructure, which is *"locks templates & guidelines in every market"*. That requires:
- A **template schema** with typed slots.
- A **brand kit** with palette, fonts, logo assets.
- **Validation at fill time** (a slot can only be filled with a color from the palette, a font from the kit, etc.).

These are additive to the layer schema; none of them require replacing the existing editor. The character bundle format is a useful precedent for a "brand-controlled asset" — a slot-backed variant of it would be a reasonable brand-kit-adjacent primitive.

### 10.4 Distribution stays outside Layer Studio

DSP push, preview links, Campaign Manager — these are platform services. Layer Studio's role in the Suvi story is **producing the artifact**; distribution is a separate surface.

### 10.5 The three missing primitives, in order of leverage

1. **Text layers.** Unlocks ~40% of the Suvi document (headlines, proofreading, comment copy, CTA). It is also what transforms `composition-generator.js` from a folder-scanner into a brief-driven engine.
2. **Multi-format generation.** Unlocks the literal value proposition. It is a schema change, not a code change — the renderer is already single-path-ready if `resolveLayer` is introduced.
3. **Template-slot model + brand kit.** Unlocks the *"Creative Infrastructure"* claim and the roadmap items (safe zones, guardrails, enhanced brand kits).

Add these three and Layer Studio reaches **~75–80% of the Suvi document**, with the AI and exports already done.

---

## 11. Bottom line

### What Layer Studio *is*

A **credible, technically deep AI-assisted 2D cutout-scene animation studio** — with a character rig, a two-stage local animation director, a segment organizer, a sophisticated reference aligner, and a mature export pipeline. It is more capable than what the Suvi document's animation section implies.

### What Suvi *is*

A **creative infrastructure platform** for *scale* — private brand AI, multi-format, multi-market, guardrailed, distributed.

### The comparison, stated plainly

| Suvi layer | What Suvi claims | What Layer Studio delivers | Coverage |
|---|---|---|---|
| **Creative Hub** | All formats automatically | One format, done well, with a strong animation engine | **~40%** |
| **The Brain** | Private brand-trained AI (ANALYZE/AUTOMATE/ACT) | Local private AI for animation + organization (different purpose) | **~15% functional / ~80% principled** |
| **Creative Infrastructure** | Locks templates + guidelines | `positionConfirmed` + character rigs + reference alignment | **~20%** |

### The three highest-leverage moves

1. **Add text layers.** One primitive. Unlocks half of Suvi.
2. **Add multi-format with per-format overrides.** One schema change. Unlocks the value prop.
3. **Add template slots + brand kit.** One new object model. Unlocks Creative Infrastructure.

None of these require replacing what exists. All three are additive to the layer schema and to the render path. The AI work — director, organizer, agent protocol, character rig — is already done and is in some places **stronger than the Suvi description**.

### The most honest sentence

**Layer Studio is roughly 30% of the Suvi document today — but it is 30% of the *right* 30%, and the remaining 70% is concentrated in three additive changes, not scattered across the codebase.**

The previous assessment (against the wrong codebase) said Layer Studio had ~10% coverage and no AI. **That assessment was wrong.** Layer Studio has a working private AI, a working animation director, a working segment organizer, a working character rig, and a real agent protocol. The Suvi document describes a *platform*; Layer Studio is a *studio* — and the studio is genuinely deep.

### The one caution

Layer Studio is also a **much more specific tool** than the Suvi document imagines. It is *cutout-scene animation*, not *brand ad production*. The character rig, the sprite frames, the reference aligner, the segment organizer — these are all assets for *one kind of content*. Bringing them into the Suvi story requires acknowledging that Layer Studio has already made a *genre* choice. That is not a weakness; it is a fact that should be reflected in the Suvi narrative — *"Suvi's Studio is built for animated storybook content, and it is better at that than any generic ad tool would be."* That is a stronger claim than the one the Suvi doc currently makes.