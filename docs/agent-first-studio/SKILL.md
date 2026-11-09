---
name: agent-first-studio
description: >
  Operate Agent First Studio by conversation: inspect the current composition
  and animation, return the exact JSON contract, author or modify motion,
  correct layout, review designs, use reference attachments, and respect the
  source-recording and confirmed-menu boundaries. Use when a user asks an agent
  to change, create, correct or review an animation/composition in Agent First
  Studio.
metadata:
  short-description: "Agent First Studio composition and animation operator"
  entrypoint: "docs/agent-first-studio/agent.md"
---

# Agent First Studio

Load [agent.md](agent.md) first. Then load the reference needed for the task:

- `01-runtime-contract.md` — context, response precedence, persistence, APIs.
- `02-composition-editing.md` — `composition_fixes`, text fitting, z-order.
- `03-animation-authoring.md` — tracks, timing, easing, clips/steps.
- `04-workflows.md` — create, modify, correct, review, references, menu.
- `05-quality-gates.md` — hard rejects and pre-response checklist.
- `06-skills-crosswalk.md` — which external skills apply and which do not.

Treat `agent.md` as the system manual. Return one JSON object only when handling
a Studio request.
