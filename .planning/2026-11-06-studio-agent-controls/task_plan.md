# Studio Agent Controls Port

## Goal
Bring the six Asset Studio control capabilities (Colours, Type, Image, Text, Size, Saved) into `studio-agent.html` while retaining Agent-specific editing and preview behavior.

## Phases
- [x] Inspect existing controls and Agent state/render APIs.
- [ ] Implement missing control tabs and state adapters. (in progress)
- [ ] Add focused browser coverage for all six control areas.
- [ ] Run focused validation and inspect final diff.

## Decisions
- Reuse shared Asset Studio control behavior where compatible; avoid replacing the Agent workflow.

## Errors Encountered
| Error | Attempt | Resolution |
| Planning update targeted the wrong task directory | 1 | Corrected path to `.planning/2026-11-06-studio-agent-controls/` |
| Findings patch used an unmatched context block | 1 | Read the current findings file and appended after its actual final bullet |

## Implementation Checklist
- Colours: role controls, presets, brand swatches, custom picker.
- Type: display/editorial/text family selectors and font upload.
- Image: brand photos, library assets, image-slot selection, image upload.
- Text: existing template copy editor plus reset.
- Size: active design's available export sizes.
- Saved: save, restore, delete snapshots in local storage.
