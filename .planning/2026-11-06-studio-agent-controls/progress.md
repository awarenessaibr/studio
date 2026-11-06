# Progress

- 2026-11-06: Started the control-capability port. Next: inspect both control implementations and current local edits.
- Confirmed controls are not shared: Asset Studio's implementation is private to `app.js`; Agent has an independent `buildControls()` and partial control state.
- Compared current tabs: Agent Content/Style/Layout cover only part of Asset Studio's Colours/Type/Image/Text/Size/Saved capabilities. Next: map the Asset Studio control actions to Agent's state and renderer.
- Mapped adapters: palette/font/text state can flow through existing renderers; size uses existing commands; image needs engine-photo and brand-image-variable paths; saved UI can restore persisted snapshots.
- A planning-file update used an incorrect directory once; corrected without affecting source files.
- Confirmed existing upload routes (`/api/assets/ingest`, `/api/fonts`) and Agent save snapshots (`assetStudioAgent.saved.v1`); next inspect renderer image-variable handling and restore path details.
- Confirmed both image paths: brand template image variables use `S.t` plus `BRAND_TEMPLATE_IMAGES`; engine photos can use a persisted URL and the existing `IMG` cache. Saved entries are raw Agent state snapshots.
- Confirmed brand composition image layers are drawn by URL from the existing image cache after variable resolution.
- Confirmed no current photo/font input elements in the Agent page; add them and use its existing `stackFor`, `loadImg`, upload endpoints, and separate category navigation.
- Implementation scope: six tabs with color presets/custom swatches, font controls/upload, photos/library/upload and brand image slots, copy/reset, size choices, and saved snapshot management.
- Browser validation exposed and fixed a missing Agent toast helper; all 44 checks then passed. Follow-up parity check: Saved must list/restore across brands as Asset Studio does.
