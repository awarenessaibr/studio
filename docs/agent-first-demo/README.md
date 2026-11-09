# Agent First Studio — DeepSeek demo set

Three animations generated through the **Agent First sidebar** using
**DeepSeek Flash**. They were saved by the normal client flow, not hand-written.

Open [gallery.html](gallery.html) for the visual set and WebM playback, or open
`/agent-first-studio.html`, choose a design below, and select its `Demo — …`
animation under **Animations**.

| Design | Animation | ID | Length |
|---|---|---|---|
| Tartan Guys · Noir — 01 | Demo — Noir editorial reveal | `studio-animation-mw9h0t2z` | 6.5 s |
| Deep Thinkers · cinematic reels — 03 | Demo — Dostoevsky quote reveal | `studio-animation-mw9haend` | 9.0 s |
| Tartan Guys · Brutal — 01 | Demo — Brutal headline swap | `studio-animation-mw9hcd36` | 7.0 s |

All three are `origin: "llm"` and `status: "ok"`. The source `Original motion`
recordings are untouched.

## What each demonstrates

### Noir — editorial reveal
- photo settle `1.03 → 1.0`;
- headline fade/rise;
- cross-fade between the two headline states;
- caption and `01 · Rainfall` stagger.
- File: [videos/noir.webm](videos/noir.webm)

### Dostoevsky — quote reveal
- quote layers `m06`, `m07`, `m09`, `m10`, `m11` are a shared box, so they are
  driven as one quote slot;
- every quote starts at `a=0`, fades in for its beat, then fades back to `0`
  before the next quote;
- no two quote layers are visibly stacked;
- portrait top-left scale compensation.
- File: [videos/thinkers.webm](videos/thinkers.webm)

### Brutal — headline swap
- `EVERY DETAIL` holds, then cross-fades to `YOURS NEXT`;
- duplicate `01` layer stays hidden;
- subtle photo settle.
- File: [videos/brutal.webm](videos/brutal.webm)

## Files

- `overview.png` — one-page visual summary.
- `gallery.html` — playback and frame strips.
- `studio-noir.png`, `studio-thinkers.png`, `studio-brutal.png` — the actual Agent First UI with the generated animation selected.
- `frames/` — 1080×1080 stills at key times.
- `videos/` — 1080×1080 WebM exports from the Studio.

These frames are the Studio's square canvas view. A 9:16 source composition is
letterboxed inside it; the exported WebM uses the same square framing.
