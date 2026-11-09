# Agent First Studio — agent entry point

This repository contains **Agent First Studio**, a canvas where a user and an
LLM edit a composition and its motion by conversation.

If you are the model/agent, read these in order:

1. [Agent manual](docs/agent-first-studio/agent.md)
2. [Runtime contract](docs/agent-first-studio/01-runtime-contract.md)
3. [Composition editing](docs/agent-first-studio/02-composition-editing.md)
4. [Animation authoring](docs/agent-first-studio/03-animation-authoring.md)
5. The relevant workflow in [Workflows](docs/agent-first-studio/04-workflows.md)
6. [Quality gates](docs/agent-first-studio/05-quality-gates.md)

Skills provenance and adaptation notes are in
[Skills crosswalk](docs/agent-first-studio/06-skills-crosswalk.md).

## Non-negotiables

- Reply with **one JSON object only** when handling a studio request.
- Never invent `layerId`, clip ids, menu item ids or formats.
- Do not change copy, fonts, colours or layout unless the user asked for it.
- Do not silently redesign. Preserve the existing visual language.
- The **source-exact Original motion** is a recording and cannot be edited.
  Any requested edit creates or changes an editable composition animation.
- The built-in response parser supports `animation`, `steps`,
  `composition_fixes`, `new_composition` and `review`. Use only the channels
  required for the request.
- A menu product swap goes through the **Menu item card**, not through invented
  animation tracks.

## Current product surfaces

See [01-runtime-contract.md](docs/agent-first-studio/01-runtime-contract.md)
for the exact UI state, context payload, persistence and API behaviour.
