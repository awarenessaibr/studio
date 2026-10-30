the intention is to use the ui/project we have to simplify the userability and create a studio-layer to be able to granularly be able to have the agent to change specific asset or a group, a layer,. so the focus in in this case more editing the image itself, and to animate there can be one or two choices so the agent decides the animation. but focus on the granular image editing through the agent. The goal is to follow the style, structure, user process flow from the attached page

Screenshot 2026-10-18 at 23.52.31.png
Screenshot 2026-10-18 at 23.53.05.png
Screenshot 2026-10-18 at 23.53.26.png
using the instructions, files attached and added in the project, can you create a new UI to satisfy the intended outcomes as described

Read a file, created a file, shared files
I built studio-v2.html, a new UI that follows the Grok segment panel in your screenshots. I haven’t opened it in a browser, so none of it is tested. The AGENT.md acceptance checks (console clean, Task 7 smoke test) still need a real run.

Drop it in the project root next to _.js and _.css, then run node server.js and open http://127.0.0.1:8008/studio-v2.html. It uses _.js and _.css unchanged, per the “additive only” rule. Your original studio.html stays untouched.

What changed from studio.html

Segment tree. The flat layer list is replaced by a tree grouped by name stem, so flying birds-1…7 becomes one “flying birds” group, as in your screenshots.
Selection. Each row has a radio-style dot.
Row actions. Rows show eye, download and delete on hover. Group headers have an expand arrow, an eye that toggles the whole group, and an Animate… dropdown.
Group animation. The dropdown applies a preset to every segment in the group, with a small per-segment variation so they don’t move in lockstep.
Canvas highlight. Hovering a row draws the white box and name chip on the canvas. Hovering a segment on the canvas highlights its row.

Canvas presets and custom dimensions resize the frame without changing the layers' pixel-space positions or sizes, and leave position confirmations intact. The Scale character control scales every non-reference layer and its keyframes together around the canvas center. Move character offsets all non-reference layers and their keyframes together by the entered pixel amount, while leaving position confirmations intact.
Search and bulk actions. There is a search box, Expand/Collapse all, and Download all.
Final image row. It is pinned at the top so you can still select it for Use as final image and align layers.
All the toolbar actions are kept: play, keyframes, Export JSON / agent spec / SVG / video / GIF, project and composition pickers, ZIP import, saved projects, and the Animation ideas panel.

What I dropped: the Animation director dialog (story context and model pickers). The Suggest animations button still runs with the default models, but you can’t set story context in this version.

Possible mismatches

Grouping uses the layer name with the trailing number removed. If your segment names don’t follow the name-1, name-2 pattern, groups will come out differently.
Per-segment download saves whatever image the layer holds, named after the layer.
I couldn’t check whether the _.js you attached matches the patched version in _dev/, because that folder wasn’t included. It already contains the sprite, preset and agent-spec code, so I treated it as patched.

Studio v2
Code·HTML 
