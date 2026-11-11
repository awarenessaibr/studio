# Task plan — Vincent Hovorka: answer, documentation, examples, reel

**Date** 2026-11-11 · **Owner** Leandro · **Status** in progress

## Goal

Answer Vincent's "What did you have in mind?" with a plain, no-friction package
that can be reused with the next ten businesses:

1. a plain-language studio identity and offer;
2. Vincent-specific documentation (what we found, what we'd build, what it costs);
3. a few finished examples in his own brand;
4. a short reel made from the real Agent First Studio UI;
5. a ready-to-send LinkedIn reply and email version.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Working studio name | **House Style** (product: Agent First Studio) | Plain, non-technical, names the method: the brand already has a house style; AI serves it. |
| Positioning line | **Your brand, not the AI's.** | Answers the fear directly: AI makes everyone look the same. |
| Method | **Collect → Document → Lock** | Three verbs, no jargon. |
| Pilot shape | **Founding partner: no fee**, filmed case study + 3 introductions | First case study matters more than the first invoice; paid tiers follow. |
| Reel | 1080×1920, ~35 s, real UI capture, UK voiceover | Vincent lives on LinkedIn; vertical works there and on the site. |
| Send channel | LinkedIn message + one link (HTML page), PDF for email | No friction: one click, no attachments to download. |

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Read brand pack, deliverables, studio surfaces | complete |
| 2 | Run studio, capture real UI, generate one animation | complete |
| 3 | Write strategy + Vincent documentation | complete |
| 4 | Build proposal page and PDF | complete |
| 5 | Build example contact sheet from the 8 designs | complete |
| 6 | Record and edit the demo reel | complete |
| 7 | Draft LinkedIn + email replies and reusable template | complete |
| 8 | Verify package, present | complete |
| 9 | Build material pack 02 from the three-brand designs | complete |
| 10 | Build material pack 01 for Monteleone Group | complete |

## Errors encountered

| Error | Attempt | Resolution |
|---|---|---|
| Playwright bundled browser 1178 missing | 1 | Use system Chrome via `executablePath`. |
| Studio started on 8009, not 8008 | 1 | `PORT` unset in shell; use `http://127.0.0.1:8009`. |
| Agent UI stuck at "Working on it…" | 1 | Waited 20 s — it was a long request, not a failure. |
