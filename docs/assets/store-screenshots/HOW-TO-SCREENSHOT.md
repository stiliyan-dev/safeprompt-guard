# How to take Chrome Web Store screenshots

Chrome Web Store requires screenshots at **exactly 1280×800 px** (PNG or JPEG).

## Steps

1. Open Chrome (not Edge)
2. Open each HTML file: `File → Open File…` or drag into Chrome
3. Make sure zoom is **100%** (Ctrl+0)
4. Open DevTools → Device toolbar (Ctrl+Shift+M)
5. Set dimensions to **1280 × 800**, device pixel ratio **1**
6. Click "Capture screenshot" from the DevTools 3-dot menu → "Capture screenshot"
7. Save each PNG

## Files in order

| File | What it shows |
|------|--------------|
| `01-warning-popup.html` | Warning popup on ChatGPT — password + token + URL detected |
| `02-findings-detail.html` | Warning on Claude — per-finding Mask buttons with severity badges |
| `03-local-db-console.html` | Local DB Console with 8 learned values |
| `04-extension-popup.html` | Extension toolbar popup open on Gemini |
| `05-after-masking.html` | Prompt text after masking — ******** and [MASKED_TOKEN] |

## Upload order in Chrome Web Store

Chrome Web Store shows screenshots in the order uploaded. Recommended order:
1. `01` — Most important: shows the core value proposition
2. `05` — Shows the result of masking (before/after concept)
3. `02` — Shows severity and per-finding control
4. `03` — Shows the Local DB feature
5. `04` — Shows the popup UI

## Tips

- Use **Chrome**, not Edge or Firefox, to match the browser chrome appearance
- Zoom must be exactly 100% — `Ctrl+0` to reset
- DevTools device toolbar gives the most consistent capture
