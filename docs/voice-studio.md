# Voice Studio

**Status:** implemented. Local speech + a two-direction voice-design agent, wired
into the Studio server and the business asset library.

Source review: `/Users/leandrodisconzi/repos/oia/adapter/src/tts-server.mjs` and
`src/server/voice/voice-design-agent.mjs`.

---

## 1. Review: what those two modules are

| Module | What it actually does | What it is not |
|---|---|---|
| `src/server/voice/tts-server.mjs` | Owns the **MLX-Audio lifecycle**: probe `:8771`, reuse an external server or spawn the local venv, link the Hugging Face model cache read-only into a project `HF_HOME`, register a cached Qwen3-TTS VoiceDesign model, and proxy `/v1/models`, `/v1/audio/voices` and speech. | Not a TTS model, not a cloud API, not a UI. |
| `src/server/voice/voice-design-agent.mjs` | Turns one sentence into **exactly two complete, distinct voice recipes** (every form value + the composed `instruct`), retries, enforces enum/range validity, persists per-user sessions and records “applied”. | Not a speech synthesiser; it calls an LLM and returns recipes. |

Two design decisions in the OIA code were kept because they are right:

1. **The model cache is linked, never copied.** The 38 GB cached weights stay
   where the user installed them; the server starts with `HF_HUB_OFFLINE=1` so a
   linked directory cannot be written by a download.
2. **The agent returns two directions, not a form.** `normalizeProposal` validates
   enums/ranges so “Apply” can never write an invalid option, and the agent
   refuses to clone one direction into two.

What changed for Studio Layers:

| OIA | Studio Layers |
|---|---|
| `config.mjs` with Olivia paths | `src/server/voice/tts-config.mjs` with `STUDIO_TTS_*` env and the same read-only cache model |
| `OIA` session dirs | `data/voice-design-agent/<user>/sessions` |
| DSH/OpenAI engine call | local Ollama (`getLlmCatalog` → `callOllama`), with a clearly labelled **curated fallback** when no model is available |
| Full 2,347-line TTS page with models/voices/book/design tabs | focused `voice.html`: Speak + Design + save to the asset library |
| `/api/tts/*` inside the large OIA server | `/api/tts/*` in `server.js`, same shapes |
| No asset memory | generated audio can be saved as a `content` asset in the Business Asset library |

Deliberately **not** in this increment: WhatsApp/Drive/email connectors, auth,
approvals, segmentation, transcription and embedding search. The page says so.

---

## 2. Getting MLX-Audio

The Studio does not install Python packages. It discovers an existing MLX-Audio
environment:

1. `STUDIO_TTS_PYTHON`, if set;
2. `<repo>/.tts-venv/bin/python`;
3. `STUDIO_TTS_VENV` (default `/Users/leandrodisconzi/repos/olivia/.tts-venv`);
4. `python3`, only if `mlx_audio` imports.

The model cache is read from `STUDIO_TTS_MODEL_SOURCE` (default Olivia’s
`.cache/huggingface`) and linked into `data/tts/huggingface` (git-ignored).
The default registered model is the cached
`mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`.

Start it with the **Start MLX-Audio** button, or:

```bash
curl -X POST http://127.0.0.1:8008/api/tts/start
curl -s http://127.0.0.1:8008/api/tts/status
```

The status is honest:

- `external` — a server was already running on `:8771`;
- `ready` — managed or external, models listed;
- `starting` / `registering` — model load in progress (the page polls);
- `failed` / unreachable — the exact reason, never a fake ready state.

If another MLX-Audio is already running, the Studio reuses it and does not kill it.

---

## 3. Voice Studio

`/voice.html` (or `/voice`):

### Speak

- model select from `/v1/models`;
- optional named voice from `/v1/audio/voices?model=…`;
- language, format WAV/MP3, text (20,000 chars), instruct, rate;
- **Generate speech** → audio player + download;
- **Save to asset library** with optional pack/brand binding, class `content`.

The server enforces the same OpenAI-shaped payload allow-list as OIA:
`input/model/instruct/voice/speed/lang_code/ref_audio/ref_text/temperature/
top_p/top_k/repetition_penalty/response_format/stream`. Unknown form fields never
leak into the model. VoiceDesign models get a default instruct if the user leaves
it empty, because the model rejects an empty direction.

### Design

- describe the voice, or pick an example;
- the agent returns **two complete directions** with name, description, sample,
  language, prosody chips, rationale and the composed instruct;
- **Audition** synthesises that proposal through the same proxy;
- **Apply to form** fills the Speak panel and marks the proposal applied;
- **History** lists persisted sessions; **New session** starts a fresh thread.

If no local LLM is available, the response is explicitly `curated-fallback`: two
hand-built, complete directions. This is a starting point, not a claim that a
model wrote them. With Ollama and a text model, `generateProposals` runs the full
prompt/retry/validation path.

Sessions are local and per `x-oia-user` (default `local`), mirroring OIA’s
pre-auth persistence. Real auth is not part of this increment.

### Asset library

Saving audio calls the existing `POST /api/assets/ingest` with
`class: content`, `rights: brand-owned`, optional pack/brand. The audio appears
in `/library.html` with an audio preview, can be reviewed, and is indexed by the
same store as everything else. This is the integration point — not a second
asset store, and not freeform placement in Asset Studio.

---

## 4. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tts/status` | lifecycle, models, cache, error |
| POST | `/api/tts/start` | probe → reuse or spawn → register cached voice model |
| POST | `/api/tts/stop` | stop only the server this process owns |
| GET | `/api/tts/models` | proxied `/v1/models` |
| GET | `/api/tts/voices?model=…` | proxied `/v1/audio/voices` |
| POST | `/api/tts/speech` | binary WAV/MP3 |
| GET | `/api/tts/design/sessions` | per-user session list |
| POST | `/api/tts/design/sessions` | create a session |
| GET/DELETE | `/api/tts/design/sessions/:id` | read/delete |
| POST | `/api/tts/design/suggest` | two proposals + persisted turn |
| POST | `/api/tts/design/proposals/:id/preview` | audition audio |
| POST | `/api/tts/design/proposals/:id/applied` | mark applied |

Speech errors return JSON `{error}` with 400/413/502/503. The audio response is
`audio/wav` or `audio/mpeg`, `Cache-Control: no-store`, with
`X-Studio-TTS-Engine: mlx-audio`.

---

## 5. Agent contract (kept from OIA)

- exactly **two** proposals;
- every field valid for the form, every slider in range;
- distinct by direction and settings, never a clone;
- `instruct` composed from language/locale/accent, presentation, age, delivery,
  description and the refine controls;
- max 60 sessions, 80 messages, 120 proposals, 2,000 message chars;
- applied flag persisted;
- no reference transcript is invented.

`tests/voice-design.test.js` covers the two-direction contract, clone refusal and
the preview payload.

---

## 6. Honest limits

- **MLX-Audio is Apple-silicon/local and optional.** Without a working venv and
  cached model, the page correctly says it cannot speak.
- **No auth.** The per-user header is a seam, not security. Do not expose this
  server beyond localhost.
- **No connectors.** WhatsApp/Drive/email, approvals, segmentation,
  transcription and embedding search are not implemented. Audio can be uploaded
  separately if a user has a file.
- **No freeform Asset Studio placement.** Audio becomes a `content` library
  asset; it is not a visual layer and Asset Studio has no audio slot.
- **The curated fallback is not a language model.** It is labelled as such and
  should be treated as a starting point.
- **Model downloads are out of scope.** The service reuses a cache; it will not
  fetch new weights while offline.

---

## 7. Verification

```bash
npm test                         # includes tests/voice-design.test.js
curl -s http://127.0.0.1:8008/api/tts/status
curl -X POST http://127.0.0.1:8008/api/tts/start
```

Manual acceptance:

1. `/voice.html` shows `external`/`ready` and a model.
2. Generate a line; audio plays and downloads.
3. Save audio; it appears in `/library.html` as a `content` asset with an audio
   preview.
4. Ask for a voice; exactly two cards appear; Audition plays; Apply fills the
   form.
5. Reload; History still lists the session.
6. Stop the server (when managed); status returns to unreachable and speech
   reports the reason.

---

## 8. Files

| File | Role |
|---|---|
| `src/server/voice/tts-server.mjs` | MLX-Audio discovery/lifecycle/proxy (ported from OIA) |
| `src/server/voice/voice-design-agent.mjs` | two-direction contract + per-user sessions (ported) |
| `src/server/voice/tts-config.mjs` | `STUDIO_TTS_*` configuration and cache paths |
| `voice.html/.js/.css` | Voice Studio |
| `server.js` | `/api/tts/*`, local LLM bridge, curated fallback, audio proxy |
| `src/server/asset-store.js` / `src/client/library/library.js` | audio MIME and library preview |
| `tests/voice-design.test.js` | agent contract tests |
