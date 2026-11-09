# Interaction workflows

Use the smallest workflow that satisfies the user. One intent per turn.

---

## 0. Before answering

Mentally answer:

1. Is a design selected?
2. Is the current animation the **source-exact Original motion**, a generated
   animation, or a **menu variation**?
3. Did the user ask for motion, layout, both, or only a review?
4. Are there references (image/video/canvas/area) and do they narrow the target
   layers?
5. Do I have exact ids for every target?

If any answer is missing, ask one short question in `reply` and do not mutate.

---

## 1. Create a new animation

User examples:

> “Make a 7-second reel where the headline reveals first, then the cards stagger in.”

Steps:

1. Pick 3–8 semantic layers/groups.
2. If clips fit, use `steps`; otherwise use `animation`.
3. Build a readable timeline:
   - entrance 400–800 ms for editorial content;
   - stagger 60–120 ms;
   - hold long enough to read;
   - end with a deliberate final state.
4. Set `keepOthers: false` (or omit) only if this is a complete new animation.
5. Return `animation` or `steps`, not both.
6. Reply with what moves and when.

Do not change copy/colour/layout unless the motion requires a composition fix;
if it does, make that a separate turn or include justified fixes with a clear
reply.

---

## 2. Modify an existing animation

User examples:

> “Make the headline slower.”
> “Keep everything but change the price to a pop.”
> “Remove the card movement.”

Steps:

1. Read `currentAnimation` and identify the existing tracks.
2. Include only the tracks you are changing.
3. Set `keepOthers: true`.
4. Preserve other tracks exactly.
5. If the user asks to remove one layer’s motion, return a one-frame hold or a
   `steps` composition that excludes it; do not delete other tracks.

Never rebuild the whole animation for a small change.

---

## 3. Correct the composition

User examples:

> “The title overlaps the price.”
> “The badge is behind the card.”
> “Move the description down and make it fit.”

Steps:

1. Use `composition_fixes` only; no animation.
2. Diagnose by rectangle:
   - overlap: compare `y..y+h`;
   - clipping: text box height vs line count;
   - z-order: badge z vs card z.
3. Prefer geometry first; font size only when necessary.
4. Keep copy exact unless the user supplied new copy.
5. Reply with the layers changed and why.

Do not use composition fixes on a menu variation or source recording.

---

## 4. Review

User examples:

> “Review this composition.”
> “Why does this look off?”
> “Check the animation.”

Steps:

1. Do not mutate.
2. Return `reply` + `review`.
3. For each finding, name the layer id, observation and concrete suggestion.
4. Check:
   - text overlap/clipping/artboard overflow;
   - z-order;
   - contrast;
   - motion continuity/loop;
   - source vs generated state;
   - hierarchy (is the main message clear?).
5. Do not invent a redesign; review against the design’s own language.

If the user then says “fix it”, use the appropriate workflow in a new turn.

---

## 5. Use a reference

User attaches image/video/canvas/area.

- **Image** — use for mood/layout/typography/colour relationships; don’t copy
  exact text unless confirmed.
- **Video** — four frames are sent; infer motion direction, pacing, energy.
- **Canvas** — current render; useful for “what I see”.
- **Area** — crop + bbox + layer ids; restrict changes to those layers.

Acknowledge the reference in `reply` (“I used the attached area around the
headline…”). If the model cannot see images, say so and ask for text.

When an area is attached, do not modify layers outside its `layers` list unless
the user explicitly asks for a global correction.

---

## 6. Menu item workflow

This is UI-driven; do not fabricate it as animation.

1. Confirm the selected design is menu-enabled (Menu card visible).
2. Tell the user:
   - **Menu item → Change item**;
   - search the confirmed menu;
   - choose the item.
3. The client creates `Menu variation — <item>` with exact name/description/
   price, keeps the design’s layout/fonts, and adds one variation per item.
4. The user can delete the variation from the animation list.
5. The source recording is untouched.

If asked “What item is this?”, read the card/current item from context if
available; otherwise ask the user to look at the Menu card.

Do not return text-layer fixes for a product swap.

---

## 7. Create a composition variation

Only when the user explicitly asks for a **new design/version**, not a motion
change.

Steps:

1. Preserve width/height/duration.
2. Copy the full layer list, change only the requested properties.
3. Return `new_composition` with a complete `layers` array.
4. Warn that it creates a new Designs card and has no source recording/menu
   mapping.
5. Do not combine with animation/fixes in the same response.

---

## 8. Multiple turns

- The client keeps six messages of chat history plus the current context.
- Do not rely on a layer id from an older design/animation if it is no longer
  in context.
- After a save, the client selects the new animation; the next turn’s
  `currentAnimation` is the new one.
- If the user changes design, discard old ids and re-read context.
- If the user undoes a composition fix, the next context reflects the restored
  composition.

---

## 9. Prompt patterns

Good user requests are concrete. The model may restate the interpretation in
`reply` before applying. Useful patterns:

**Timing**
> “Reveal the headline in 600 ms, hold 1.5 s, then stagger the three cards at
> 100 ms each.”

**Selective modification**
> “Keep the current motion. Only slow the price pop to 500 ms.”

**Layout**
> “Move the description below the title with a 1% gap and keep the price in its
> current slot.”

**Reference**
> “Use the attached area as the focus; keep the rest of the composition still.”

**Review**
> “Review the type hierarchy and tell me what to fix; don’t change anything.”

**Menu**
> “Change this post from Granola to The Everything.” → guide to Menu card.

---

## 10. When not to act

Return a reply-only response when:

- the request is a question;
- the user is choosing a menu item/format/animation via UI;
- the target ids are absent;
- the request would require changing the source recording;
- the user hasn’t specified enough to avoid a destructive change.

A question is cheaper than an unwanted animation.
