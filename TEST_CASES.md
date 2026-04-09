# SafePrompt Guard Sanity Test Cases

## Scope

This suite is for stability and sanity testing of the existing extension behavior:

- detection correctness
- false-positive control
- popup behavior
- action reliability
- repeated use
- recovery after cancel, mask, and send anyway
- post-change integration regressions
- learned local DB behavior
- local static common/default password coverage

## Post-Change Gate

Run this after every code change before calling the build stable:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ChromeExtension\apps\SafePrompt-Guard\post-change-smoke.ps1
```

This gate must pass before manual checks begin.

Then run the detector regression suite:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ChromeExtension\apps\SafePrompt-Guard\run-detector-tests.ps1
```

## Critical Integration Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| G1 | `manifest.json` no longer includes `https://chatgpt.com/*` | Gate fails |
| G2 | `content.js` no longer contains paste interception | Gate fails |
| G3 | `content.js` no longer contains submit interception | Gate fails |
| G4 | `content.js` no longer contains the inline warning render path | Gate fails |
| G5 | `styles.css` no longer contains the page debug badge style | Gate fails |
| G6 | Manual ChatGPT smoke with `Password=ExamplePass!2026` | Warning appears near the send area |

## Detector Cases

| ID | Input | Expected Result |
| --- | --- | --- |
| D1 | `ExamplePass!2026` | Detect `HIGH` password |
| D2 | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` | Detect `HIGH` token |
| D3 | `Port 1433` | Ignore |
| D4 | `project ProjectRed` | `LOW` or ignore |
| D5 | `ProjectRed internal migration document` | Detect `MEDIUM` |
| D6 | `ProjectRed password: ExamplePass!2026` | Detect `HIGH` |
| D7 | `192.168.1.10` | Ignore |
| D8 | `Customer Alpha token 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` | Detect `HIGH` |
| D9 | `Please contact john.doe@example.com` | Detect email if email detection is enabled. Current expected behavior: detect `MEDIUM` email |
| D10 | Long migration email with ports, server names, environments, and one embedded token near the end | Ignore infra terms. Detect only the token and any related risky context |
| D11 | Demo environment access email with `Customer: Demo Corporation`, `Project: DemoSales`, `Environment: demo-sales-prod`, `Username: demo_admin`, `Password: ExampleAccess2026`, internal URL, two hosts, and two private IPs | Detect and sanitize all listed sensitive items, including the labeled username and password |
| D12 | `Password: ExampleAccess2026` | Detect `HIGH` password even without a special character because the field label is explicit |
| D13 | `DB_PASSWORD=OrionSecure2026` | Detect `HIGH` password and mask only the value |
| D14 | `client_secret=DemoClientSecret!2026` | Detect `HIGH` secret without treating the full assignment as a password |
| D15 | `mongodb://admin:DemoMongoPass!2026@172.20.7.12:27017` | Detect connection string and internal IP without treating the full URI as a password |
| D16 | `Please rotate Password123 after cutover.` | Detect `HIGH` password from the curated local common-password pack |
| D17 | `Username: admin` + `Password: admin` | Detect `HIGH` password and identify the default credential pair |

## Masking Cases

| ID | Input | Action | Expected Output |
| --- | --- | --- | --- |
| R1 | `ProjectRed password: ExamplePass!2026` | Mask | `ProjectRed password: ********` while keeping surrounding text intact |
| R2 | `Customer Alpha token 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` | Mask | `Customer Alpha token [MASKED]` |
| R3 | `Please contact john.doe@example.com` | Mask | `Please contact [MASKED]` |
| R4 | `ExamplePass!2026` | Mask | `********` |
| R5 | `project ProjectRed` | Mask | No required change if finding is ignored or `LOW` only |

## Learned Local DB Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| L1 | Highlight an undetected password and add it as `password` | The same exact value is detected as `HIGH` immediately after save |
| L2 | Highlight an undetected token and add it as `token` | The same exact value is detected as `HIGH` token on the next scan |
| L3 | Highlight an internal-only phrase and add it as `internal_reference` | The same exact value is detected as `MEDIUM` unless nearby secrets raise it |
| L4 | Save `ManualPass2026`, then scan `manualpass2026` | No match because learned matching is case-sensitive |
| L5 | Save the same exact value twice with different types | Only one stored item remains and the latest type wins |
| L6 | Delete a saved item from the popup | Future detections for that value stop |
| L7 | Clear all saved items | No learned detections remain |

## False Positive Control

| ID | Input | Expected Result |
| --- | --- | --- |
| F1 | `Port 1433 is required for migration.` | Ignore |
| F2 | `The ProductOne 4 environment is currently stopped.` | Ignore |
| F3 | `project ProjectRed` | Do not block send |
| F4 | `server coll-dock sql backup cluster` | Ignore |
| F5 | `ProductThree migration for environment 4` | Ignore unless risky context or a real secret is present |
| F6 | `C:\\temp\\migration\\notes.txt` | Ignore |
| F7 | `https://internal.example.com/migration` | Ignore |
| F8 | `v4.7.1` | Ignore |
| F9 | `admin user should verify the dashboard` | Ignore unless it is used as an actual credential value |

## Popup And Action Flow

| ID | Scenario | Expected Result |
| --- | --- | --- |
| P1 | One secret, first send attempt | One compact popup appears |
| P2 | Multiple secrets, first send attempt | One popup shows compact summary and at most two listed items |
| P3 | Cancel | Popup closes, state resets, next real send attempt can warn again |
| P4 | Mask | Popup closes, content is sanitized, next send attempt is allowed to re-evaluate sanitized text |
| P5 | Send anyway | Popup closes, the next real send attempt is unlocked once, next new prompt is evaluated normally |
| P6 | Click action button twice quickly | No duplicate action execution. No frozen UI |
| P7 | Wait past timeout without choosing an action | Flow resets and a small fallback notice appears |
| P8 | Highlight text in the composer with no current warning | Nothing opens automatically |
| P9 | Trigger a warning, then click `Add manually` | An inline `Add to local DB` form appears inside the warning popup |
| P10 | Open the toolbar popup and click `Add manually` | A compact manual-add form appears inside the extension popup |

## Repeated Use Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| U1 | Same risky message submitted twice | Popup appears once per send attempt |
| U2 | Cancel, then retry same message | Popup appears again on the next send attempt |
| U3 | Mask, then retry | If sanitized text is safe, no popup. If still risky, popup reappears correctly |
| U4 | Send anyway, then create a new prompt | New prompt is evaluated normally. Old bypass state is not reused |
| U5 | Add an item to the local DB, refresh, and retry | Learned detection still works after page reload |
| U6 | Switch between supported sites | State does not leak across tabs/sites |
| U7 | Open popup after several detections | Last warning summary matches stored background state |
| U8 | Open popup after adding or deleting learned items | Local DB count and list refresh correctly |
| U9 | Open `Open DB`, then delete or clear from the popup | The full DB page refreshes automatically |

## Interactive DB Console Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| DB1 | Open `Open DB` from the popup | A full admin page opens with toolbar, table, filters, and drawer support |
| DB2 | Click `Add` in the DB page | The right-side drawer opens in add mode |
| DB3 | Save a new row from the DB page | The row appears immediately in the table and later exact matches are detected |
| DB4 | Click `Edit` on an existing row | The drawer opens with the existing raw value and type |
| DB5 | Save an edited row | The table updates immediately and duplicate exact values are merged safely |
| DB6 | Select multiple rows, then click `Delete selected` | A confirmation appears and the selected rows are removed |
| DB7 | Search for a partial raw value | The table filters down to matching rows only |
| DB8 | Change the type filter | Only rows of that type remain visible |
| DB9 | Change sort from `Newest` to `Oldest` or `Type` | The table order updates without reloading the page |
| DB10 | Export JSON while filtered | The downloaded JSON contains only the currently filtered rows |
| DB11 | Export CSV while filtered | The downloaded CSV contains only the currently filtered rows with `id,value,type,createdAt,updatedAt` headers |
| DB12 | Import JSON in merge mode | Valid rows are added or updated, and skipped rows are reported in the preview |
| DB13 | Import CSV in merge mode | Valid rows are added or updated, and skipped rows are reported in the preview |
| DB14 | Import in `Replace all` mode | A confirmation appears and the old table contents are replaced by the imported rows |
| DB15 | Delete or clear rows from the popup while the DB page is open | The DB page refreshes automatically from storage changes |

## Input Variation Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| I1 | Empty input | No popup |
| I2 | Multiline text with one password | Detect only the password |
| I3 | Large pasted technical text | No freeze. Inline scan may pre-warn, and send interception must still work |
| I4 | Two passwords and one token in one prompt | Compact summary reflects multiple findings |
| I5 | Multiple internal names with no secret | `LOW` or `MEDIUM` only depending on context. Avoid blocking for plain names alone |

## ChatGPT Regression Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| C1 | Paste `Password=ExamplePass!2026` into ChatGPT | Debug badge shows `Loaded: Yes`, `Editor: Found`, then findings appear |
| C2 | Paste `ExamplePass!2026` into ChatGPT | Inline warning appears near the send area |
| C3 | Paste `token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` into ChatGPT | Inline warning appears and console logs findings |
| C4 | Paste connection string example into ChatGPT | Warning appears before send |
| C5 | Click `Send` after warning is visible | Send is intercepted until user acts |
| C6 | Press `Enter` to send after warning is visible | Send is intercepted until user acts |

## Unsupported Site Case

| ID | Scenario | Expected Result |
| --- | --- | --- |
| X1 | Open an unsupported site with a textarea | No injection behavior. No detection UI. No badge activity from content script |
