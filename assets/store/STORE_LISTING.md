# SafePrompt Guard Chrome Web Store Listing

## Short Description
Detect passwords, tokens, and internal-only values before you send prompts to AI tools.

## Long Description
SafePrompt Guard helps teams catch risky prompt content before it leaves the browser.

The extension scans prompts locally on supported AI tools and flags likely passwords, tokens, API keys, private connection details, internal references, learned exact-match values from your Local DB, and curated common/default passwords from its embedded local source pack. When risky content is found, SafePrompt Guard shows a compact inline warning near the send area so the user can review, mask, or manually learn additional values without breaking the writing flow.

SafePrompt Guard is designed for technical teams that work with migrations, infrastructure notes, support handovers, and customer-specific operational data. The detector is tuned to stay useful in developer-heavy environments by balancing secret detection with false-positive reduction.

Everything runs locally in the extension. There is no backend, no account system, and no external data upload required for the Local DB workflow.

## Feature Bullets
- Detect likely passwords, tokens, API keys, connection strings, internal URLs, hosts, and private IPs before send
- Catch common and default passwords from a curated local-only static pack
- Show compact inline warning UI directly in the page instead of relying only on the toolbar popup
- Mask risky values selectively or in one pass before sending
- Maintain a local exact-match DB for custom secrets and internal references
- Search, filter, edit, bulk-delete, import, and export Local DB entries from the admin console
- Keep learned values on the current device with `chrome.storage.local`

## Supported Sites
- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`
- `perplexity.ai`

## Privacy Summary
- Local-first processing only
- No backend service
- No account or authentication
- No external API calls for detection
- No online breach-password checks in the default release
- Learned values are stored on the device in Chrome extension local storage

## Recommended Store Highlights
- Local-first prompt security
- Curated offline common/default password coverage
- Compact inline warning flow
- Developer-aware false-positive controls
- Interactive Local DB for exact-match custom values

## Support / Contact Text
Support URL:
`https://github.com/stiliyan-dev/safeprompt-guard/issues`

Suggested contact line:
`For support, deployment questions, or release feedback, use the GitHub Issues page at https://github.com/stiliyan-dev/safeprompt-guard/issues.`

## Public Website URLs
- Homepage: `https://stiliyan-dev.github.io/safeprompt-guard/`
- Privacy policy: `https://stiliyan-dev.github.io/safeprompt-guard/privacy-policy.html`

## Asset Inventory
- Icon: `assets/brand/icons/icon-128.png`
- Screenshots:
  - `assets/store/screenshots/screenshot-01-warning.png`
  - `assets/store/screenshots/screenshot-02-mask-and-review.png`
  - `assets/store/screenshots/screenshot-03-local-db-console.png`
  - `assets/store/screenshots/screenshot-04-import-export.png`
  - `assets/store/screenshots/screenshot-05-local-first.png`
- Small promo: `assets/store/small-promo-440x280.png`
- Marquee: `assets/store/marquee-1400x560.png`
- Video thumbnail: `assets/store/video-thumbnail-1280x720.png`
