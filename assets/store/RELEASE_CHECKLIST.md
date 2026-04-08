# SafePrompt Guard Chrome Web Store Release Checklist

## Final Product Checks
- Reload the unpacked extension and confirm `Version 1.0.0` (or the intended release version) is shown in the popup
- Run `post-change-smoke.ps1`
- Manually test ChatGPT warning flow with at least one password and one token
- Manually test Local DB add, edit, delete, bulk delete, import, export JSON, and export CSV
- Confirm no floating page-level `Add manually` button appears

## Listing Asset Checks
- Icon set present:
  - `assets/brand/icons/icon-16.png`
  - `assets/brand/icons/icon-32.png`
  - `assets/brand/icons/icon-48.png`
  - `assets/brand/icons/icon-128.png`
- Five screenshots present in `assets/store/screenshots/`
- Small promo image present
- Marquee image present
- Video thumbnail present

## Store Metadata Checks
- Short description added
- Long description added
- Support URL set to `https://github.com/stiliyan-dev/safeprompt-guard/issues`
- Privacy policy URL set to `https://stiliyan-dev.github.io/safeprompt-guard/privacy-policy.html`
- Homepage URL set to `https://stiliyan-dev.github.io/safeprompt-guard/`
- Privacy practices reviewed and accurate
- Supported site list matches the current manifest
- Screenshots match the current product flow

## GitHub Pages Checks
- `docs/index.html` is pushed to the public repo
- `docs/privacy-policy.html` is pushed to the public repo
- GitHub Pages is enabled from `main /docs`
- Privacy policy page loads publicly without login
- Support link points to the GitHub Issues page

## Packaging Checks
- Manifest icon paths resolve correctly
- Popup and DB page load the brand assets correctly
- No stale mirrored copy remains unsynced
- Release version updated in the manifest before upload

## Publish Gate
- If any detection or UI regression appears during manual smoke testing, stop and fix before store submission
