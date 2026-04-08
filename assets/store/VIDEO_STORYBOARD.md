# SafePrompt Guard Promo Video Storyboard

## Goal
Show the extension detecting sensitive prompt content, masking it, and managing learned values in the Local DB in under 30 seconds.

## Duration
25-35 seconds

## Story Arc
1. Paste a realistic technical prompt with risky values into ChatGPT
2. Show the inline warning appear before send
3. Highlight selective masking and manual add
4. Open the Local DB console and show edit/import/export
5. End on the local-first privacy message

## Shot List
1. Title card
   - Visual: SafePrompt Guard logo + short line
   - Text: `Local prompt security for AI workflows`
   - Duration: 2s

2. Paste risky prompt
   - Visual: ChatGPT composer with a migration/support-style prompt
   - Action: paste prompt containing a password and token
   - Duration: 5s

3. Warning appears
   - Visual: inline warning popup near send area
   - Action: hover the finding list
   - Callout: `Detect before send`
   - Duration: 4s

4. Mask flow
   - Visual: click `Mask this` or `Mask`
   - Action: sensitive value becomes masked in composer
   - Callout: `Keep the prompt readable`
   - Duration: 4s

5. Manual add flow
   - Visual: open `Add manually` from warning or popup
   - Action: paste a missed value, save to Local DB
   - Callout: `Teach the detector exact values`
   - Duration: 5s

6. Local DB console
   - Visual: DB page with search, filters, edit drawer, import/export buttons
   - Action: search for an item, open edit drawer, show export button
   - Callout: `Manage learned values locally`
   - Duration: 6s

7. End frame
   - Visual: marquee graphic or DB console hero
   - Text: `No backend. No account. Local-first.`
   - Duration: 3s

## Capture Script
- Start with a clean browser profile and the unpacked extension loaded
- Keep the toolbar popup pinned and ready
- Use one deterministic prompt sample with clearly visible findings
- Record at 1280x800 or higher, then crop/export to your final video target
- Avoid rapid cursor movement; hold each state long enough for captions

## Suggested Demo Prompt
`Customer: Demo Corporation`
`Project: DemoSales`
`Password: DemoAccess2026`
`webhook_token=wh_123456789abcdef`

## Thumbnail Concept
- Use `assets/store/video-thumbnail-1280x720.png`
- Add optional overlay text in video editing:
  - `Catch secrets before send`
  - `Local DB + inline review`
