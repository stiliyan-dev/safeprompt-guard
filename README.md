# SafePrompt Guard

SafePrompt Guard is a local Chrome Manifest V3 proof of concept that detects sensitive prompt content before it is sent to supported AI tools.

## What It Does

- Detects likely passwords, tokens, API keys, JWTs, private keys, connection strings, internal URLs, hosts, and private IPs.
- Uses a curated local static password source pack for common and default credentials.
- Applies organization-specific rules from `org_rules.json`.
- Supports exact-match learned values in a local-only Local DB stored in `chrome.storage.local`.
- Shows a compact inline warning near the send area instead of a large modal.
- Supports `Cancel`, `Mask`, `Add manually`, and `Send anyway` in the warning flow.
- Provides a widened toolbar popup for quick status and masked Local DB review.
- Provides a full Local DB admin console with add, edit, delete, bulk delete, search, filter, import, and export.
- Ships with a Chrome Web Store asset package under `assets/store/` and a reusable brand set under `assets/brand/`.

## Supported Sites

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`
- `perplexity.ai`

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `C:\ChromeExtension\apps\SafePrompt-Guard`.
5. Reload the extension after changes.

## Debug Mode

Debug mode is off by default.

Enable:

```js
chrome.storage.local.set({ debug: true });
```

Disable:

```js
chrome.storage.local.set({ debug: false });
```

When debug mode is on, the content script and service worker log:

- initialization
- supported site detection
- editor discovery
- paste/input/send checkpoints
- detector start and completion
- findings count
- warning UI rendering
- popup/manual-add actions
- timeout recovery and unexpected errors

## Local DB Console

Open the extension popup, then click `Open DB`.

The full console now supports:

- add
- edit
- delete
- bulk delete
- search across value and type
- type filter
- sort by newest, oldest, or type
- export filtered rows to JSON
- export filtered rows to CSV
- import JSON or CSV with `Merge / upsert exact values` or `Replace all`

Manual learned values remain:

- local only
- exact-match
- case-sensitive

## Local Static Password Pack

The extension also ships with a curated local-only baseline in:

- `password-sources.js`

This baseline is intentionally compact and high-confidence. It focuses on:

- common passwords
- default credential passwords
- known username/password default pairs

It does not include:

- full breach corpora
- online breach lookups
- external API calls

## org_rules.json

`org_rules.json` provides organization-aware context:

- `customerNames`
- `projectNames`
- `internalCodeNames`
- `productNames`
- `internalOnlyPhrases`
- `allowlistedTerms`
- `riskyContextWords`

Expected behavior:

- names alone stay `LOW` or are ignored
- names plus risky context become `MEDIUM`
- names plus actual secrets become `HIGH`
- learned Local DB values match exact substrings using the saved type

## Brand And Store Assets

Brand assets live in:

- `assets/brand/`
- `assets/brand/icons/`

Chrome Web Store assets live in:

- `assets/store/screenshots/`
- `assets/store/small-promo-440x280.png`
- `assets/store/marquee-1400x560.png`
- `assets/store/video-thumbnail-1280x720.png`
- `assets/store/STORE_LISTING.md`
- `assets/store/VIDEO_STORYBOARD.md`
- `assets/store/RELEASE_CHECKLIST.md`

GitHub Pages site files live in:

- `docs/index.html`
- `docs/privacy-policy.html`
- `docs/styles.css`

Planned public URLs:

- `https://stiliyan-dev.github.io/safeprompt-guard/`
- `https://stiliyan-dev.github.io/safeprompt-guard/privacy-policy.html`
- `https://github.com/stiliyan-dev/safeprompt-guard/issues`

Repo publish steps live in:

- `GITHUB_PUBLISH.md`

Regenerate the raster assets with:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ChromeExtension\apps\SafePrompt-Guard\assets\generate-brand-assets.ps1
```

## Sanity Checks

Run the detector and learned-store regression harness:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ChromeExtension\apps\SafePrompt-Guard\run-detector-tests.ps1
```

Run the full post-change smoke gate:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ChromeExtension\apps\SafePrompt-Guard\post-change-smoke.ps1
```

The smoke gate now checks:

- supported manifest matches, including `chatgpt.com`
- core ChatGPT interception hooks
- inline warning markers
- popup widening and Local DB control row
- interactive DB files
- manifest icon set
- Chrome Web Store asset package presence

Additional manual coverage lives in:

- `TEST_CASES.md`
- `MANUAL_TEST_PLAN.md`

## Quick Manual Test Flow

Paste this into a supported prompt composer:

```text
Project: DemoSales
Customer: Demo Corporation
Password: admin
Please rotate Password123 after cutover.
webhook_token=wh_123456789abcdef
```

Expected:

1. The inline warning appears before send.
2. `Mask` replaces only the selected risky value.
3. `Add manually` opens the inline Local DB form.
4. The toolbar popup shows the widened one-row Local DB actions.
5. `Open DB` opens the interactive console.
6. Saving a value in the console or popup makes later exact matches detectable.
7. JSON and CSV export use the currently filtered table rows.

## How To Inspect Logs

- Service worker logs:
  Open the extension service worker console from `chrome://extensions`
- Page logs:
  Open DevTools on the supported AI site
- Detector console harness:
  Run `SafePromptDetector.runConsoleTestHarness()`

## Known Limitations

- Send button discovery remains heuristic-based.
- Supported site DOM structures can change.
- This POC scans text only, not file attachments.
- Learned matching is exact and case-sensitive by design.
- The embedded static password pack is intentionally curated and not a full breached-password corpus.
- Rich editors can still need site-specific adapters for perfect selection and framework-state behavior.
- Unsupported sites show no detection because the content script is not injected there.

## Common Failure Scenarios

- No inline warning:
  Confirm the page is on a supported domain, the extension is enabled, and `post-change-smoke.ps1` passes.
- Popup summary looks stale:
  Refresh the page and trigger a fresh warning.
- Mask does not visibly update the prompt:
  Check page logs and confirm the current editor accepts programmatic value changes.
- Import looks wrong:
  Confirm the input rows include `value` and `type`, and use one of the supported types.
- Store assets feel outdated after UI changes:
  Regenerate them with `assets\generate-brand-assets.ps1`.

## Future Improvements

- Per-site composer adapters
- richer org-rule editing
- attachment scanning
- rule tagging
- optional online breach-password checks as an explicit opt-in mode
- sync/export presets for larger Local DB deployments
