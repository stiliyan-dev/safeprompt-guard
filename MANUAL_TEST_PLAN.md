# SafePrompt Guard Manual Test Plan

Use this checklist after any meaningful code change.

Before starting the manual checklist, run:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ChromeExtension\apps\SafePrompt-Guard\post-change-smoke.ps1
```

Do not skip the ChatGPT checks even if detector-only changes were made. The last regression was caused by page integration, not detector logic.

Pass/Fail field:

- Pass: `___`
- Fail: `___`

## A. Installation

### A1. Load unpacked extension

- Steps:
  Open `chrome://extensions`
  Enable `Developer mode`
  Click `Load unpacked`
  Select `C:\ChromeExtension\apps\SafePrompt-Guard`
- Expected result:
  Extension loads without manifest errors
- Pass: `___`
- Fail: `___`

### A2. Startup sanity

- Steps:
  Open the extension service worker console
  Confirm there are no immediate runtime errors
- Expected result:
  No startup errors
- Pass: `___`
- Fail: `___`

## B. Site Detection

### B1. ChatGPT

- Steps:
  Open `https://chatgpt.com/`
  Focus the prompt box
- Expected result:
  Content script is active, the debug badge shows `Loaded: Yes` and `Editor: Found`, and no console errors occur
- Pass: `___`
- Fail: `___`

### B2. Claude

- Steps:
  Open `claude.ai`
  Focus the prompt box
- Expected result:
  Same as B1
- Pass: `___`
- Fail: `___`

### B3. Gemini

- Steps:
  Open `gemini.google.com`
  Focus the prompt box
- Expected result:
  Same as B1
- Pass: `___`
- Fail: `___`

### B4. Perplexity

- Steps:
  Open `perplexity.ai`
  Focus the prompt box
- Expected result:
  Same as B1
- Pass: `___`
- Fail: `___`

## C. Input Handling

### C1. Typing

- Steps:
  Type a normal safe prompt
  Type a risky prompt
- Expected result:
  No popup until send attempt. No console errors while typing
- Pass: `___`
- Fail: `___`

### C2. Pasting

- Steps:
  Paste a multiline risky prompt
- Expected result:
  No freeze. Prompt remains editable. Debug badge updates and inline warning may appear
- Pass: `___`
- Fail: `___`

### C2a. Minimal ChatGPT repro

- Steps:
  Open `https://chatgpt.com/`
  Paste `Password=ExamplePass!2026`
  Wait one second
- Expected result:
  The inline warning appears near the send area, or findings are clearly logged in the page console
- Pass: `___`
- Fail: `___`

### C3. Editing existing text

- Steps:
  Trigger a popup on send
  Edit the prompt instead of choosing an action
- Expected result:
  Warning flow resets cleanly
- Pass: `___`
- Fail: `___`

### C4. Deleting text

- Steps:
  Trigger a popup
  Delete the risky text
  Send again
- Expected result:
  No stale warning state blocks the next send
- Pass: `___`
- Fail: `___`

### C5. Multiple textareas if present

- Steps:
  Focus one editable field
  Then focus another editable field
  Attempt a risky send
- Expected result:
  Detection targets the active composer only
- Pass: `___`
- Fail: `___`

## D. Detection Flow

### D1. No findings

- Steps:
  Send a safe prompt
- Expected result:
  No popup. No stuck state
- Pass: `___`
- Fail: `___`

### D2. One finding

- Steps:
  Send `ExamplePass!2026`
- Expected result:
  One inline warning appears near the send area
- Pass: `___`
- Fail: `___`

### D3. Multiple findings

- Steps:
  Send a prompt with a password and token
- Expected result:
  One inline warning with compact summary and no duplication
- Pass: `___`
- Fail: `___`

### D3a. Connection string

- Steps:
  Paste `ConnectionString=Server=tcp:demo-sql.example,1433;Initial Catalog=DemoDb;User ID=demo_user;Password=ExamplePass!2026;Encrypt=True;`
  Click `Send`
- Expected result:
  Warning appears and send is intercepted
- Pass: `___`
- Fail: `___`

### D4. Repeated findings

- Steps:
  Send the same risky prompt twice
- Expected result:
  One popup per send attempt. No freeze
- Pass: `___`
- Fail: `___`

### D5. Repeated submissions

- Steps:
  Trigger popup
  Choose an action
  Send another prompt immediately
- Expected result:
  Flow resets correctly between prompts
- Pass: `___`
- Fail: `___`

## E. Popup Actions

### E1. Cancel

- Steps:
  Trigger popup
  Click `Cancel`
- Expected result:
  Popup closes. Prompt remains unchanged. Next send can warn again
- Pass: `___`
- Fail: `___`

### E2. Mask

- Steps:
  Trigger popup
  Click `Mask`
- Expected result:
  Popup closes. Sensitive values are masked. Prompt remains editable
- Pass: `___`
- Fail: `___`

### E3. Send anyway

- Steps:
  Trigger popup
  Click `Send anyway`
- Expected result:
  Popup closes. The next real send attempt is unlocked once. The next prompt is checked normally
- Pass: `___`
- Fail: `___`

### E4. Mask one finding

- Steps:
  Trigger popup with multiple findings
  Click `Mask this` on one row
- Expected result:
  Only that finding is masked, the popup stays open if more findings remain, and the prompt remains editable
- Pass: `___`
- Fail: `___`

## F. Recovery

### F1. Dismiss popup flow

- Steps:
  Trigger popup
  Use `Cancel`
  Retry with the same message
- Expected result:
  Warning can appear again on a fresh send attempt
- Pass: `___`
- Fail: `___`

## G. Learned Local DB

### G1. Manual add from warning popup

- Steps:
  Trigger a warning popup
  Highlight text in the composer if you want to use selection
  Click `Add manually`
- Expected result:
  Clicking `Add manually` opens an inline `Add to local DB` form inside the warning popup with `Use selected`, type selector, `Cancel`, and `Add`
- Pass: `___`
- Fail: `___`

### G2. Add learned password

- Steps:
  Highlight an undetected password
  Choose `Password`
  Click `Add`
- Expected result:
  Success notice appears and the same value becomes detectable immediately on the page
- Pass: `___`
- Fail: `___`

### G3. Case-sensitive learned match

- Steps:
  Save `ManualPass2026` to the local DB
  Test `manualpass2026`
- Expected result:
  The lowercase variant is not matched
- Pass: `___`
- Fail: `___`

### G4. Popup local DB list

- Steps:
  Open the toolbar popup after adding learned items
- Expected result:
  The popup shows `Add manually`, saved item count, masked previews, type labels, an `Open DB` button, delete buttons, and `Clear all`
- Pass: `___`
- Fail: `___`

### G4b. Manual add from toolbar popup

- Steps:
  Open the toolbar popup
  Click `Add manually`
  Type or paste a value, or use `Use selected`
  Click `Add`
- Expected result:
  The value is saved to the local DB and appears in the popup list
- Pass: `___`
- Fail: `___`

### G4a. Full local DB page

- Steps:
  Open the toolbar popup
  Click `Open DB`
- Expected result:
  A separate extension page opens and shows the full local DB with raw saved values, newest first
- Pass: `___`
- Fail: `___`

### G5. Edit from DB page

- Steps:
  Open `Open DB`
  Click `Edit` on any row
  Change the raw value or type
  Click `Save`
- Expected result:
  The drawer stays stable, the row updates immediately, and future exact matches use the new value and type
- Pass: `___`
- Fail: `___`

### G6. Bulk delete from DB page

- Steps:
  Open `Open DB`
  Select at least two rows
  Click `Delete selected`
  Confirm the action
- Expected result:
  The selected rows are removed, the selection count resets, and popup/DB page stay in sync
- Pass: `___`
- Fail: `___`

### G7. Import and export

- Steps:
  Open `Open DB`
  Click `Export JSON`
  Click `Export CSV`
  Click `Import`
  Choose a valid JSON or CSV file
  Review the preview
  Import in `Merge / upsert exact values`
- Expected result:
  Exported files use the filtered rows only, and the import preview shows parsed, skipped, added, updated, and duplicate counts before import
- Pass: `___`
- Fail: `___`

### G8. Replace-all import safety

- Steps:
  Open `Open DB`
  Click `Import`
  Choose a valid file
  Switch to `Replace all`
  Click `Import`
- Expected result:
  A destructive-action confirmation appears before existing rows are replaced
- Pass: `___`
- Fail: `___`

### G5. Delete learned item

- Steps:
  Delete one learned item from the popup
  Retry the same prompt
- Expected result:
  Detection for that exact value stops
- Pass: `___`
- Fail: `___`

### G6. Clear learned items

- Steps:
  Click `Clear all` in the popup
  Retry previously learned values
- Expected result:
  All learned detections stop
- Pass: `___`
- Fail: `___`

### F2. Action click twice

- Steps:
  Trigger popup
  Double-click one action quickly
- Expected result:
  Action runs once. No duplicate state or freeze
- Pass: `___`
- Fail: `___`

### F3. Submit again after action

- Steps:
  Use `Mask`
  Send again
- Expected result:
  Prompt is re-evaluated correctly
- Pass: `___`
- Fail: `___`

### F4. Refresh page and retry

- Steps:
  Trigger popup
  Refresh page
  Retry the same scenario
- Expected result:
  Clean initialization. No stale warning state
- Pass: `___`
- Fail: `___`

### F5. Unsupported site behavior

- Steps:
  Open a non-supported site with a textarea
- Expected result:
  No extension UI is injected
- Pass: `___`
- Fail: `___`

## G. Stress Tests

### G1. Long prompt

- Steps:
  Paste a very long mixed technical prompt with one secret near the end
- Expected result:
  No freeze. Popup appears on send attempt only
- Pass: `___`
- Fail: `___`

### G2. Rapid repeated clicks

- Steps:
  Click send repeatedly on a risky prompt
- Expected result:
  Single stable popup flow. No duplicate popups
- Pass: `___`
- Fail: `___`

### G3. Repeated copy/paste

- Steps:
  Paste, edit, paste again, then send
- Expected result:
  Detection still works and state remains stable
- Pass: `___`
- Fail: `___`

### G4. Very large mixed technical text

- Steps:
  Paste a large migration/support email containing ports, servers, versions, and one real secret
- Expected result:
  Infrastructure terms are ignored. Real secret is still detected
- Pass: `___`
- Fail: `___`
