# Glossary

| Term | Meaning |
|---|---|
| **Source recording** | The recorded `.webm` of the original HTML stage. Selecting **Original motion** plays this. It cannot be edited. |
| **Original motion** | The UI label/state for the source recording. |
| **Editable composition** | The extracted layer stack. Generated animations, fixes and menu variations render this. |
| **Generated animation** | A new animation authored against the editable composition. Close to the source, never pixel-identical. |
| **Menu variation** | A client-created product swap on a menu-enabled design. Its text overrides are re-applied on every render. |
| **Composition variation** | A new design card created by `new_composition`; it has no source recording or menu mapping. |
| **Steps** | A clip-based animation recipe sent to `/api/library/compose`; library designs only. |
| **Clip** | A reusable extracted motion event in the library context. |
| **Group** | A semantic selection of layers, usable as a `steps.target` and sent in `selectedGroups`. |
| **Format** | Preview/export framing (`Original`, `1:1`, `4:5`, `9:16`, landscape). It does not change composition coordinates. |

## Two unit systems

- Composition fixes: `x/y/w/h` are **percentages 0–100**.
- Animation frames: `dx/dy` are **fractions of the artboard** — `0.08` = 8%.

Never mix them. This is the highest-frequency unit error in the system.
