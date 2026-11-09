# Agent First Studio documentation pack

A model-facing pack for operating Agent First Studio precisely: modify a
composition, create motion, correct layout, review a design, use references,
and respect the source-menu boundaries.

## Read order

| File | Use |
|---|---|
| [SKILL.md](SKILL.md) | Loadable skill wrapper with the read order. |
| [agent.md](agent.md) | Role, response contract, decision rules. Treat as the system manual. |
| [01-runtime-contract.md](01-runtime-contract.md) | What the UI actually sends and accepts; persistence and limits. |
| [02-composition-editing.md](02-composition-editing.md) | Exact layer fields, `composition_fixes`, text fitting, z-order. |
| [03-animation-authoring.md](03-animation-authoring.md) | Animation schema, timing, easing, clips/steps, validation. |
| [04-workflows.md](04-workflows.md) | Create, modify, correct, review, reference, menu, composition variation. |
| [05-quality-gates.md](05-quality-gates.md) | Pre-response checklist and hard failure modes. |
| [07-glossary.md](07-glossary.md) | Six-term vocabulary and the two unit systems. |
| [local-system-prompt.md](local-system-prompt.md) | Compact prompt used for local Ollama models. |
| [examples/](examples/) | Machine-readable response examples. |
| [06-skills-crosswalk.md](06-skills-crosswalk.md) | Optional provenance; load only when needed. |

## Quick facts

- Page: `pages/agent-first-studio.html`
- Library index: `/api/library` → `data/library/index.json`
- Design detail: `/api/library/designs/:id`
- Agent providers: `GET /api/agent-first/providers`
- Agent chat proxy: `POST /api/agent-first/chat`
- Save animation: `POST /api/library/animations`
- Compose from clips: `POST /api/library/compose`
- Delete animation: `DELETE /api/library/animations/:id?designId=:id`
- Brand menus: `data/library/menu-catalog.json`
- Menu-enabled designs: `data/library/menu-designs.json`
- Source recordings: `data/library/sources/<design-id>.webm`

At the time of writing: 63 designs, 61 source-derived recordings, 12
menu-enabled designs, 5 confirmed Singl-end menus (128 items).

All artifacts listed in `pack.json` are supplied. Run
`npm run check:agent-pack` to lint links and examples.

## How to use the pack

If you can only inject one file, inject [agent.md](agent.md). If you can inject
a system prompt plus references, use `agent.md` + `01` + `02` + `03` + the one
workflow needed. Keep `05` in context for review/correction tasks.

The sidebar proxy now loads this pack as the system prompt. Ollama uses the
compact `local-system-prompt.md`; DeepSeek uses the full pack. The direct browser
fallback still carries the older internal prompt, but the preferred path is the
server proxy.
