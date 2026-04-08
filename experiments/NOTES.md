# NOTES

## Week 1 internal dry run

- What confused users:
  - Some testers expected the extension to automatically redact the value, not just warn.
  - “Send anyway” felt clear, but the source of the warning was not always obvious on dense AI UIs.
- What broke:
  - Send interception depends on heuristic button detection and may miss site-specific composer controls.
  - Credit card detection only works when the number passes Luhn validation.
- What was slow:
  - No major latency during typing in the internal dry run.
- What users expected:
  - File upload scanning.
  - Team policy rules and allow-lists.
  - Better visibility into exactly which detector fired.
- What they ignored:
  - Popup stats were rarely opened after the first test.
- Monday build focus:
  - Real-time scanning and send interception.
- Thursday friction fix queue:
  - Improve per-site send targeting and add inline detector labels.
