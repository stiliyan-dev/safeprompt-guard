# SafePrompt Guard GitHub Publish Guide

## Target Repo

- Repo: `https://github.com/stiliyan-dev/safeprompt-guard`
- Pages home: `https://stiliyan-dev.github.io/safeprompt-guard/`
- Privacy policy: `https://stiliyan-dev.github.io/safeprompt-guard/privacy-policy.html`
- Support: `https://github.com/stiliyan-dev/safeprompt-guard/issues`

## Local Folder To Push

Use this folder as the repo root:

- `C:\ChromeExtension\apps\SafePrompt-Guard`

## First Push

```powershell
cd C:\ChromeExtension\apps\SafePrompt-Guard
git init
git branch -M main
git remote add origin https://github.com/stiliyan-dev/safeprompt-guard.git
git add .
git commit -m "Initial SafePrompt Guard release"
git push -u origin main
```

If the remote already exists, use:

```powershell
git remote set-url origin https://github.com/stiliyan-dev/safeprompt-guard.git
```

## Enable GitHub Pages

In GitHub:

1. Open the repo settings.
2. Open `Pages`.
3. Under `Build and deployment`, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/docs`
4. Save.

## Create The First Release

Create a GitHub Release such as `v1.0.0`, then upload:

- `C:\ChromeExtension\release\SafePrompt-Guard-1.0.0-store-upload-20260408-055534\SafePrompt-Guard-1.0.0-extension-upload.zip`

Optional additional upload:

- `C:\ChromeExtension\release\SafePrompt-Guard-1.0.0-store-upload-20260408-055534\SafePrompt-Guard-1.0.0-listing-assets.zip`

## Chrome Web Store URLs

Use these fields in the store:

- Homepage URL: `https://stiliyan-dev.github.io/safeprompt-guard/`
- Privacy policy URL: `https://stiliyan-dev.github.io/safeprompt-guard/privacy-policy.html`
- Support URL: `https://github.com/stiliyan-dev/safeprompt-guard/issues`

## Repo Notes

- The GitHub Pages website lives under `docs/`.
- The extension source stays at repo root.
- The website download button points to the latest GitHub Release asset.
