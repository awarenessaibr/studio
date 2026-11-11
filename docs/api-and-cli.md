# API, CLI and briefs

Everything the backend exposes, the command-line generator, and the table →
creatives flow.

---

## 1. Running the server

```bash
node server.js                 # or: npm start
PORT=8010 HOST=127.0.0.1 node server.js
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8008` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `STUDIO_VISION_MODEL` | `granite3.2-vision:2b` | Director vision model |
| `STUDIO_TEXT_MODEL` | `qwen3.5:9b` | Director writing model |
| `STUDIO_OLLAMA_URL` / `OLLAMA_HOST` | auto-detect `127.0.0.1:11434`, `:11436` | Ollama endpoint |
| `STUDIO_OPENAI_API_KEY` | — | Enables the remote vision provider for *Organize with AI* |
| `STUDIO_OPENAI_MODEL` | — | That provider's vision model |
| `STUDIO_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `STUDIO_DEEPSEEK_API_KEY` | — | Server-side API key for DeepSeek animation ideas |
| `STUDIO_DEEPSEEK_MODEL` | — | DeepSeek model id (for example `deepseek-flash`) |
| `STUDIO_DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | DeepSeek-compatible chat-completions endpoint |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI server used by segment texture generation |
| `STUDIO_PYTHON` | `.venv/bin/python` → `python3` | Interpreter used by the intake crawler |

The server serves the pages and the repository-project asset route, and
handles `/api/*`. The raw `data/` tree is **not** static: it also holds
imports, brand packs and secrets. Requests are JSON unless stated. Binary
payloads travel as **base64 data URLs**. Errors are `{ "error": "…" }` with
400/404/413/415/500 as appropriate.

`/` serves `studio-v2.html`; `/studio.html` (classic) and
`/asset-studio.html` remain reachable.

---

## 2. Endpoints

### Health and models

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/health` | `{ ok: true }` |
| `GET` | `/api/llm/models` | `{ available, url, models: [{id,size,parameterSize,vision}], defaults: {vision,text}, error }` |
| `GET` | `/api/llm/organizer-models` | Local + configured remote vision models for segment organisation |

### Imports and projects

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/api/projects` | `{ projects }` — repository and saved projects with their compositions |
| `GET` | `/api/projects/:project/compositions/:composition` | One repository composition |
| `GET` | `/api/projects/:project/assets/*` | A file under `data/projects/:project/assets/` — the only way a repository composition's own PNGs/JSON are served. `..` and dotfiles are rejected. |
| `POST` | `/api/imports` | `{ name, zip, zipName?, reference, referenceName? }` → `{ project, composition }` |
| `GET` | `/api/imports` | `{ projects }` — saved imports |
| `GET` | `/api/imports/:id/composition.json` | The saved composition |
| `PUT` | `/api/imports/:id/composition.json` | `{ composition, meta? }` → saved document |
| `POST` | `/api/imports/copy` | `{ sourceProjectId: "repo-…", sourceCompositionId, composition }` → an editable copy |
| `POST` | `/api/imports/character` | `{ bundle }` (ZIP with `character.json`) → a rigged character project |
| `GET` | `/api/imports/:id/animations` | The saved animation library |
| `PUT` | `/api/imports/:id/animations` | Replace the animation library |

`zip` and `reference` are base64 **data URLs**. Importing extracts the ZIP,
creates one layer per image plus a locked reference layer, and saves the
composition. Limits: 220 MB ZIP, 60 MB reference, 500 layers, reference
≤ 10000 px.

### Segmentation imports

An image-to-layers `<project>-segmented` export is imported, not rendered.

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/api/segmentation/exports` | `{ exports: [{ id, targetProjectId, parts, groups, width, height }] }` — provisional exports still waiting |
| `POST` | `/api/segmentation/wire` | `{ segmentedProjectId, targetProjectId?, imagePath?, layerId?, keepSource?, check? }` → the import report (parts, groups, z, pack, composition, archivedTo, urls) |

`check: true` validates and returns the plan without writing or moving
anything. The same contract is available as
`npm run wire:segmentation -- <project>-segmented`; see
[segmentation-automation.md](segmentation-automation.md).

Repository compositions can point their layers at their own files with
`/api/projects/:project/assets/<path>`. The route resolves under
`data/projects/<project>/assets/`, passes through `safeRelativePath()`, and
returns 403 for a path that would escape. It exists because `/data/…` is
deliberately not served statically; a project that hard-codes `/data/…` will
404 even though the file exists. See
[`data/projects/the-physician-snake/README.md`](../data/projects/the-physician-snake/README.md)
for a worked example.

### Animation director

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/api/llm/animation-director` | Available animation-ideas providers and local model defaults; API keys are never returned |
| `GET` | `/api/imports/:id/proposals` | `{ context, generatedAt, models, analysis, proposals }` |
| `POST` | `/api/imports/:id/proposals` | `{ provider: "ollama"|"deepseek", context, visionModel?, textModel?, count, image? }` → generated ideas |
| `PUT` | `/api/imports/:id/context` | `{ context, director }` → saved on the composition meta |

Proposals are validated against real layer ids and the preset vocabulary,
deduplicated per layer, and parameter-normalised per preset; invalid output is
retried once, then fails with a reason.

### Segment organiser

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/segments/organize` | `{ provider?, model, layers: [{ id, name, image }], reference? }` → suggested name/group/role per segment |

Thumbnails are capped at 220 KB each; the request body at 32 MB.

### Segment texture generation

| Method | Path | Body / result |
|---|---|---|
| `POST` | `/api/segments/texture` | `{ segmentImage, textureImage, textureName, prompt? }` → `{ image }` |

`segmentImage` and `textureImage` are PNG, JPEG, or WebP base64 data URLs.
The server uploads both to ComfyUI, fills the checked-in Qwen Image Edit
workflow, waits up to 15 minutes, and returns the generated PNG as a data URL.
Each input and output image is limited to 80 MB. The Studio adds the result as
a new layer in the source segment's group, retaining its transform and sizing.

### Briefs

| Method | Path | Body / result |
|---|---|---|
| `POST` | `/api/briefs/parse` | `{ name, dataUrl, sheet? }` → `{ source, sheet, sheets, headers, rows }` |

The `.xlsx` reader is built on the ZIP reader and a small sheet-XML parser:
shared strings, inline strings, booleans, numbers and formula results are
read; `workbook.xml.rels` finds the right worksheet. Legacy `.xls` is
rejected with a clear message. Limit: 8 MB.

### Fonts

| Method | Path | Body / result |
|---|---|---|
| `POST` | `/api/fonts` | `{ name, dataUrl }` → `{ id, family, url, format, bytes, weights }` |
| `GET` | `/api/fonts` | `{ fonts: [{ id, family, url, format }] }` |
| `GET` | `/api/fonts/<file>` | Font bytes with the right `Content-Type`, immutable cache |

WOFF2, WOFF, TTF and OTF; ≤ 2 MB; validated by magic bytes. Fonts are global,
not per project.

### Brand packs and kits

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/api/brand-packs` | `{ packs: [{ id, name, description, brandCount, brands, createdAt, storage }] }` |
| `POST` | `/api/brand-packs/import` | `{ zip, zipName?, name? }` → `{ pack, summary }` |
| `GET` | `/api/brand-packs/:id` | `{ pack, updatedAt }` |
| `DELETE` | `/api/brand-packs/:id` | `{ deleted: true }` |
| `GET` | `/api/brand-packs/:id/files/:brand/*` | An asset or guide with its content type |
| `POST` | `/api/brand-packs/:id/templates` | `{ brandId, templateId, name? }` → `{ project, composition }` (Create) |
| `GET` | `/api/brand-packs/:id/templates?brandId=…` | `{ templates, projects }` (published + in-progress) |
| `POST` | `/api/brand-packs/:id/templates/save` | `{ brandId, name?, composition?, projectId? }` → `{ template, composition }` |
| `POST` | `/api/brand-packs/:id/templates/:brand/:template/open` | `{ name? }` → `{ project, composition }` |
| `DELETE` | `/api/brand-packs/:id/templates/:brand/:template` | `{ deleted: true }` |
| `GET` | `/api/brand-packs/:id/templates/:brand/:template/files/*` | Copied template image/video |
| `POST` | `/api/video/transcode` | Raw video → H.264 MP4 (`501` without ffmpeg) |
| `GET` | `/api/brand-kits` | `{ kits }` |
| `GET`/`PUT`/`DELETE` | `/api/brand-kits/:id` | Read / save / delete a shared kit |

See [brand-packs.md](brand-packs.md) for structure, inference and limits.

---

### Crawler / brand intake

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/crawler/status` | Python/Playwright/PDF readiness |
| POST | `/api/crawler/search` | business-name search (`{query, city}`) |
| POST | `/api/crawler/discover` | website + social profile discovery |
| POST | `/api/crawler/runs` | start a managed crawl from `{target}` or `{targets:[...]}` (max two concurrent; group max 12) |
| GET | `/api/crawler/runs` | recent runs |
| GET | `/api/crawler/runs/:id` | state, phase, targets/currentIndex, log tail, ZIP |
| POST | `/api/crawler/runs/:id/cancel` | cancel the process group |
| GET | `/api/crawler/runs/:id/zip` | download the finished pack |
| POST | `/api/crawler/runs/:id/import` | import the ZIP into Asset Studio (idempotent) |

The full behaviour, UI flow, output contract and limits are documented in
[crawler.md](crawler.md).

### Business Asset Intelligence

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/assets/status` | Pillow/OCR/PDF/vision readiness + health |
| GET | `/api/assets/taxonomy` | classes, operations and rule codes |
| GET | `/api/assets` | filterable asset summaries |
| GET | `/api/assets/health` | counts, duplicates, orphaned, palette drift |
| POST | `/api/assets/ingest` | base64 file uploads (60 files / 200 MB per request) |
| POST | `/api/assets/index-pack` | index a pack's assets (idempotent) |
| GET/PATCH/DELETE | `/api/assets/:id` | read, edit/archive, purge uploads |
| POST | `/api/assets/:id/verify` | verified / rejected |
| POST | `/api/assets/:id/classify` | Pillow analysis + optional local vision |
| POST | `/api/assets/:id/operations/:op` | resize, crop, recolour, extract |
| GET | `/api/assets/:id/file/:variant` | original, thumb or variant bytes |
| POST | `/api/assets/usage` | best-effort usage events |
| GET | `/api/assets/:id/usage` | counts and recent events |

See [asset-library.md](asset-library.md) for the record contract and rules.

### Social intelligence

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/social/sources` | indexed social profiles + health (`?refresh=1`) |
| GET | `/api/social/by-brand?brandId=&name=` | best match for a brand pack |
| GET | `/api/social/:id` | full normalised social dataset |

The index is read-only; the crawler remains the only writer. See
[social-intelligence.md](social-intelligence.md).

### Voice / TTS

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tts/status` | MLX-Audio lifecycle, models, cache and error |
| POST | `/api/tts/start` | reuse or spawn MLX-Audio and register the cached voice model |
| POST | `/api/tts/stop` | stop a server owned by this process |
| GET | `/api/tts/models` | proxied `/v1/models` |
| GET | `/api/tts/voices?model=…` | proxied voice list |
| POST | `/api/tts/speech` | WAV/MP3 speech bytes |
| GET/POST | `/api/tts/design/sessions` | per-user voice-design sessions |
| GET/DELETE | `/api/tts/design/sessions/:id` | read/delete a session |
| POST | `/api/tts/design/suggest` | two voice proposals + persisted turn |
| POST | `/api/tts/design/proposals/:id/preview` | audition |
| POST | `/api/tts/design/proposals/:id/applied` | mark applied |

See [voice-studio.md](voice-studio.md) for the port, setup and limits.

## 3. Limits

| Area | Limit |
|---|---|
| Request body | 320 MB |
| Layers per composition | 500 |
| Formats per composition | 24 |
| Variables per composition | 60 |
| Sprite frames per layer | 60 |
| Text length (per value) | 4,000 characters |
| Segment ZIP / reference | 220 MB / 60 MB |
| Reference dimensions | ≤ 10,000 px each side |
| Brief file | 8 MB, 500 rows, 64 columns |
| Font upload | 2 MB |
| Brand kit | 512 KB, 200 kits |
| Brand pack ZIP / extracted | 160 MB / 480 MB |
| Brand pack files / assets | 4,000 files, 240 assets per brand, 40 MB per asset, 50 packs |
| Organizer body / thumbnail | 32 MB / 220 KB |

---

## 4. CLI — `src/server/composition-generator.js`

Zero dependencies; parses PNG/JPEG/GIF headers itself. Exits non-zero and
prints usage on bad input.

### Scaffold from a folder

```bash
node src/server/composition-generator.js <folder> "<Scene Name>" [options]
```

| Flag | Meaning |
|---|---|
| `--reference <file>` | Reference image (else auto-detect by name, then largest image) |
| `--width`, `--height` | Canvas size in px (else reference size, else 1080²) |
| `--duration <ms>` | Composition duration (default 10000) |
| `--text "Headline"` | Adds a headline text layer on top |
| `--locale <tag>` | Default locale (default `en`) |
| `--out <file>` | Output path (default `<id>.composition.json`) |

What it does:

1. Walks the folder recursively for PNG/JPEG/GIF/WebP.
2. Classifies each by filename into a semantic `role`, groups numbered
   variants into sprite sequences.
3. Places layers, assigns z-order, detects the reference.
4. Emits a **v3** composition: layers, one master format, variables and
   `activeFormatId` already present, so the studio loads it without a silent
   upgrade.

Example:

```bash
node src/server/composition-generator.js ./scene-cutouts "Scene 4 — The lake" \
    --reference ./scene-cutouts/final.png \
    --text "Master the night" \
    --out data/projects/My-Film/compositions/scene-4.composition.json
```

To appear in the studio's project picker, save under
`data/projects/<project>/compositions/`.

### Brief mode

```bash
# Fill an existing template from a table
node src/server/composition-generator.js --brief rows.csv --template scene.composition.json [--out-dir out]

# Scaffold from a folder and fill it in one go
node src/server/composition-generator.js ./scene-cutouts "Winter campaign" --brief rows.xlsx --out-dir out
```

- One row → one `<row-label>.composition.json`.
- The label prefers a `Name`/`Title`/`Label`/`Key`/`Slug` column, then the
  first mapped value, then `row N`.
- Row values become the derived composition's **variable defaults** (cleared
  from per-format values), so a `locked` variable still takes the row value
  and every format inherits it.
- The template is never modified.
- Invalid rows are skipped with a message naming the column; the rest are
  written. If no row survives, the process exits non-zero.
- No `--out-dir` writes to the current directory.

---

## 5. Briefs in detail

A brief is a table: **one row per creative, one column per template
variable**.

| Step | Studio | CLI |
|---|---|---|
| Choose the file | Tools → Brief… | `--brief` |
| Map columns | automatic by name, adjustable | automatic by name |
| Check | *Preview* one row (reversible, never saved) | — |
| Produce | *Export all rows* → ZIP of formats × locales × outputs | one JSON per row |

**Coercion is per cell:**

| Kind | Accepts |
|---|---|
| `text` | Any string, capped at 4,000 characters |
| `color` | `#rgb`, `#rrggbb`, bare `rrggbb` |
| `url` / `image` | https, relative or data image URLs |

Unmatched columns are ignored; unmatched variables keep the template value.

```bash
# Parse a brief without generating anything
curl -s localhost:8008/api/briefs/parse \
  -H 'content-type: application/json' \
  -d "{\"name\":\"rows.xlsx\",\"dataUrl\":\"data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,$(base64 -i rows.xlsx)\"}"
```

---

## 6. `tools/` — one-off pipelines

These built the Beards character reference implementation and are useful as
examples, not part of the app:

| Script | Purpose |
|---|---|
| `tools/build-beards-assets.py` | Rebuild the placeholder asset pack from the final image |
| `tools/build-beards-sheets.py` | Build contact sheets for QA |
| `tools/apply-beards-rig.js` | Wire the pack into the composition and agent spec |
| `tools/render-beards-preview.js` | Render previews through the studio export renderer |
| `tools/export-beards-animations.js` | Re-bake the ten named animations |
| `tools/place-character.js` | Place a rigged character into a new scene |

```bash
python3 tools/build-beards-assets.py --preview   # optional placeholders
node tools/apply-beards-rig.js                   # wire / re-wire
PORT=8123 node server.js &
node tools/render-beards-preview.js --server-port 8123
node tools/export-beards-animations.js           # bake the Beards animations
```

They are not required to run the studio.

---

## 7. Recipes with `curl`

### Import a ZIP + reference

```bash
node -e '
const fs = require("fs");
const b64 = (p) => fs.readFileSync(p).toString("base64");
const body = {
  name: "Lake scene",
  zipName: "segments.zip",
  zip: "data:application/zip;base64," + b64("segments.zip"),
  reference: "data:image/png;base64," + b64("final.png"),
};
fs.writeFileSync("/tmp/import.json", JSON.stringify(body));
'
curl -s localhost:8008/api/imports -H 'content-type: application/json' --data-binary @/tmp/import.json
```

### Read a composition

```bash
curl -s localhost:8008/api/projects/repo-Giovanni-Senza-Paura/compositions/scene-1-road-at-dusk
```

### Create a brand template

```bash
curl -s localhost:8008/api/brand-packs/<packId>/templates \
  -H 'content-type: application/json' \
  -d '{"brandId":"the-physician","templateId":"menu","name":"Physician winter menu"}'
```

### Detect what the local LLM offers

```bash
curl -s localhost:8008/api/llm/models
```

If `available` is false, start `ollama serve` and pull the models; `error`
says why.
