# Skills crosswalk

The source skills live in
`/Users/leandrodisconzi/Downloads/html-parse/skills/`.

They are **general doctrine**, not this Studio’s API. The Studio contract in
this pack wins whenever the two disagree. Do not import code, dependencies or
product assumptions from a skill.

## What to use

| Skill / reference | Use in Agent First | Do not use |
|---|---|---|
| `design-ui/SKILL.md` | Hierarchy, restrained palette, anti-AI-slop, matching the existing language | Tailwind/shadcn implementation details; this is a canvas, not a React page |
| `design-ui/references/animations.md` | Enter/exit durations, stagger 60–120 ms, subtle exits, no bounce by default | Framer Motion/CSS code; translate the principles into keyframes |
| `design-ui/references/typography.md` | Line length, line height, balance, tabular numbers when dynamic | CSS `text-wrap` properties; achieve the effect through box width/font size |
| `design-ui/references/refined-ui.md` | Restraint, one accent, quiet surfaces, no purple/gradient/emoji slop | Re-theming the design; the design has its own brand system |
| `design-ui/references/performance.md` | Prefer transform/opacity; avoid expensive layout animation; few layers | GPU/browser implementation details |
| `game-animation-frames/SKILL.md` | Continuity, loop closure, energy matching, flip-test review | Sprite sheets, ffmpeg, magenta/chroma pipelines |
| `imagine-grok-build/SKILL.md` | Reference-first handling; exact text/numbers must be code/data, never guessed; verify visually | Calling Imagine tools; this Studio uses its own attachments/canvas |

## What to ignore

These are unrelated to composition/animation authoring here:

- `auth`, `neon`, `xai-api`, `multiplayer-p2p`
- `building-games`, `controls`, `threejs`, `game-tilesets`,
  `game-ui-icons`, `game-asset-core`, `generate2dmap`, `generate2dsprite`,
  `video2dsprite`
- `og`

Do **not** load the game-control skill: it governs WASD/flight signs, not
canvas motion.

## How the skills map

### design-ui → visual judgement

Use it when the user asks for polish, hierarchy or layout correction:

- one primary message;
- restrained colour (use the design’s palette);
- consistent type hierarchy;
- no gradient-blob/emoji-icon/AI-slop additions;
- match the existing surface, don’t introduce a second language.

Do not restyle the whole artboard to satisfy a small request.

### design-ui/references/animations → timing grammar

Borrow the intent, not the code:

- entrance 180–320 ms for UI-like motion; 500–900 ms for editorial reveals;
- exits shorter than entrances and less dramatic;
- stagger ~60–120 ms;
- state changes should feel interruptible;
- no default bounce.

In the canvas these become `duration`, `start`, `stagger`, `e` and small
`dx/dy/sx/sy/a` changes. There is no CSS transition; motion is keyframes.

### design-ui/references/typography → text fitting

- Prefer a wider box over shrinking type.
- Avoid orphans by choosing the box width.
- Keep body line-height readable; display type can be tighter.
- Tabular numerals only for changing numbers; static poster prices use the
  design’s existing numerals.

### game-animation-frames → motion laws

Apply:

- continuity (no teleports);
- one clear motion idea;
- loop closure;
- anticipation/settle;
- flip-test: view frames in order and narrate; if the narration is uncertain,
  the motion is wrong.

Do not apply the video/sprite pipeline to this Studio.

### imagine-grok-build → exactness and references

Apply:

- exact text, numbers and menu data come from context/user, not from a generated
  image;
- use references for mood/layout, not as a source of unverified copy;
- inspect the visual result; don’t trust the first attempt;
- if exactness cannot be achieved, say so.


## Folder inventory decision

Reviewed every skill in the supplied folder. Decision:

| Skill | Decision |
|---|---|
| `design-ui` | **Use principles** — hierarchy, restraint, typography, motion |
| `game-animation-frames` | **Use motion laws** — continuity, loop closure, flip test; not the sprite pipeline |
| `imagine-grok-build` | **Use exactness/reference doctrine** — not the Imagine tools |
| `auth` | Exclude — unrelated |
| `building-games` | Exclude — game runtime, not composition authoring |
| `controls` | Exclude — game input signs |
| `game-asset-core` | Exclude — sprite asset pipeline |
| `game-character-consistency` | Exclude — character art |
| `game-tilesets` | Exclude — tilesets |
| `game-ui-icons` | Exclude — icon generation |
| `generate2dmap` | Exclude — map generation |
| `generate2dsprite` | Exclude — sprite sheets |
| `multiplayer-p2p` | Exclude — networking |
| `neon` | Exclude — database |
| `og` | Exclude — social cards |
| `threejs` | Exclude — 3D runtime |
| `video2dsprite` | Exclude — video-to-sprite pipeline |
| `xai-api` | Exclude — API integration |

Only the first three inform this pack. The rest are deliberately out of scope
and should not be loaded into a composition request.

## Loading order for an external agent

1. `agent.md`
2. `01-runtime-contract.md`
3. `02-composition-editing.md`
4. `03-animation-authoring.md`
5. the relevant section of `04-workflows.md`
6. `05-quality-gates.md`
7. `06-skills-crosswalk.md` only if you need the provenance or the doctrine
   behind a rule.

Do not paste large skill files into the Studio request. Extract the applicable
principles; the context window is for the actual composition and user intent.
