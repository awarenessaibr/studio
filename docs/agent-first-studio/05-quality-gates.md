# Quality gates

Run this checklist before every response. A failed gate means fix the proposal;
do not ship it and explain it away.

**Named trap:** composition fixes use percentages (0–100); animation `dx/dy`
use fractions (0.08 = 8%). Never copy a value across those systems.

---

## A. Identity and targeting

- [ ] Every target is a real `layerId` from the current context.
- [ ] Every group/clip id exists in the current `library`/`clips` context.
- [ ] No old-design ids leaked from a previous turn.
- [ ] If an area attachment is active, changes stay within its layer list unless
      the user explicitly asked for a global change.
- [ ] Menu requests are routed to the Menu item card, not faked in text layers.
- [ ] `new_composition` was used only for an explicit new design/version/variation request, not a restyle/correction.
- [ ] No attempt was made to fix a menu variation; the base design is the target.

---

## B. Composition

- [ ] Every text layer stays inside the artboard.
- [ ] No text box overlaps another text box unintentionally.
- [ ] No text is clipped by its own box.
- [ ] Z-order does not hide content.
- [ ] Contrast/readability is only asserted when a visual attachment/canvas is supplied; otherwise phrase it as a check to perform.
- [ ] Boxes are wide enough for the copy; font size is not reduced below the
      point where hierarchy collapses.
- [ ] Existing fonts, colours, shapes and imagery are preserved unless the user
      asked otherwise.
- [ ] `text` replacements are exact, including punctuation and capitalisation.
- [ ] No new font, gradient, emoji decoration or motif was introduced.
- [ ] The composition still reads at both 9:16 and 1:1; no critical content is
      only in a letterboxed area.

---

## C. Motion

- [ ] Duration is 3000–15000 ms.
- [ ] Frames are sorted and within segment duration.
- [ ] No one-frame segment without a hold endpoint.
- [ ] `keepOthers` is correct for the intent.
- [ ] If Original motion is selected, I did not use `keepOthers: true` as if it could preserve editable tracks; I proposed a generated animation.
- [ ] `steps` is used only for a library design with clips in context.
- [ ] `sx/sy` is treated as top-left scaling; any centred pop has `dx/dy` compensation.
- [ ] Only supported fields (`dx,dy,sx,sy,a,e`) are in frames.
- [ ] No `r`, `clip` or `filter` in generated tracks.
- [ ] No layer is accidentally moved off-canvas or faded to 0 at the moment it
      must be read.
- [ ] Loop closes if the user requested a loop.
- [ ] Motion has a clear beginning, hold and end.
- [ ] 3–8 meaningful moving layers; not everything at once.
- [ ] No flashing/strobing or rapid full-canvas opacity changes.
- [ ] Text is readable during the hold.
- [ ] Stacked text layers are treated as a swap slot: only one visible at a time, with an exit before the next enters.
- [ ] Motion respects the existing design language (energy, speed, restraint).

---

## D. Response shape

- [ ] One JSON object only; no markdown fence, no preface.
- [ ] `reply` is short and in the user's language.
- [ ] Only required channels are present.
- [ ] No `animation` plus `steps`; no `new_composition` plus fixes.
- [ ] `new_composition` matches an explicit new-design trigger and includes complete layers.
- [ ] I did not rely on the server guard to make a restyle request become a new design.
- [ ] `review` is used only for read-only critique.
- [ ] No secrets, internal paths, raw HTML or fabricated facts.
- [ ] The reply does not claim a save happened before the client processes it.

---

## E. Source vs generated state

- [ ] If Original motion is selected, do not claim to edit it; propose a
      generated animation.
- [ ] If the user asks for source-exact output, explain that the recording is
      the source and generated changes use the composition.
- [ ] Menu variations use the editable composition and do not alter the source
      recording.
- [ ] If a menu variation needs restyling, I changed the base design and will
      recreate the variation; I did not fix the variation directly.
- [ ] Do not promise pixel identity between a generated edit and the source
      recording.

---

## F. Skills-derived quality

From `design-ui`:

- [ ] Hierarchy is clear; one primary action/message per view.
- [ ] Restrained palette; existing colours only.
- [ ] No generic AI-slop moves: no new gradient blobs, emoji icons, random
      fonts, arbitrary accent colours.
- [ ] Typography is readable: line length, line height, no orphaned headline
      words if avoidable.

From `design-ui/references/animations`:

- [ ] Entrances are short and eased; exits are shorter/subtler.
- [ ] Stagger is intentional (~60–120 ms), not uniform chaos.
- [ ] No bounce/overshoot unless requested.
- [ ] Motion is interruptible in spirit: don't lock the user into a long
      one-shot when a short edit was requested.

From `game-animation-frames`:

- [ ] Continuity: no teleporting.
- [ ] Loop closure when looping.
- [ ] Energy matches the ask (subtle stays subtle).
- [ ] Flip-test: play frames in order and narrate the motion; if the narration
      is uncertain, the frames are wrong.

From `imagine-grok-build`:

- [ ] Exact text/numbers come from the provided data or the user, never from an
      image model or guess.
- [ ] Reference-first: don't invent a product image; use supplied references.
- [ ] Verify the result visually; do not trust the first output.
- [ ] If exactness cannot be achieved, say so rather than shipping wrong copy.

---

## G. Hard rejects

Reject/redo the proposal if any are true:

- invented layer ids;
- composition percentage vs animation fraction mixed up;
- `steps` used on a non-library design or without a clip in context;
- `new_composition` used for a restyle/correction rather than an explicit new-design request;
- source recording treated as editable;
- product price/name invented or swapped without the Menu card;
- text changed without request;
- a new font/colour scheme introduced;
- text moved off-artboard or hidden;
- duration outside 3–15 s;
- more than ~25 tracks or every layer moving;
- `r`/`clip`/`filter` in generated animation frames;
- one-frame segment with no hold;
- response is not parseable JSON.

---

## H. Review output gate

For a `review` response:

- [ ] No mutation.
- [ ] Each item names a real layer id.
- [ ] Observation is specific and measurable where possible.
- [ ] Suggestion is actionable and preserves the design.
- [ ] No generic “make it pop” advice.
- [ ] If there are no issues, say so; do not invent problems.

---

## I. Act vs ask

- [ ] Ids are exact.
- [ ] The change is reversible (composition fixes have Undo; animations are new objects).
- [ ] If the request is both layout and motion, I did the smaller reversible
      part and named the remaining step.
- [ ] I did not ask a question when the context already contained an
      unambiguous, low-risk target.
