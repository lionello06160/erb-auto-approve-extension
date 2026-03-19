# ERB Auto-Approve

Chrome Extension (Manifest V3) that automates the approval flow on supported ERB / Program Workshop proctor pages.

It was originally adapted from a userscript, then rebuilt as a Chrome extension with a popup UI, persistent status badge, background rescan support, and safer click filtering.

## What It Does

- Runs on `https://*.programworkshop.com/*`
- Prefers `Approve All` when available
- Falls back to individual `Approve`
- Detects the first-time accommodations reminder dialog
- Auto-checks "do not show again" style checkboxes when present
- Confirms safe dialogs such as `Confirm` / `OK` / `Approve`
- Stores the last approval timestamp in `chrome.storage.local`
- Shows the last approval time in a page badge
- Provides popup toggles for:
  - Auto-approve on/off
  - Debug logging on/off
- Uses both DOM observation and periodic rescans
- Uses a background alarm to trigger rescans for matching tabs

## Current Behavior

The extension is designed around the ERB proctor workflow:

1. Detect a visible dialog and handle it first if it looks safe.
2. If no dialog blocks the workflow, click `Approve All`.
3. If `Approve All` is not present, click the first eligible `Approve`.
4. Update the badge and save the timestamp after a successful click.

The implementation intentionally avoids clicking dangerous actions such as `Cancel`, `Close`, `Delete`, `Deny`, `Pause`, `Complete All`, `Logout`, or `Return`.

## Files

- `manifest.json`: extension manifest and permissions
- `content.js`: main approval logic injected into matching pages and frames
- `background.js`: MV3 service worker that schedules background rescans
- `popup.html`: popup UI
- `popup.js`: popup state and actions
- `icons/`: extension icons

## Permissions

The extension currently requests:

- `storage`
  - Saves enabled state, debug state, and last approval time
- `alarms`
  - Triggers periodic background rescans
- `tabs`
  - Finds matching ERB tabs and sends rescan messages

## Installation

### Load Unpacked

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder

### Update After Local Changes

1. Open `chrome://extensions`
2. Find `ERB Auto-Approve`
3. Click `Reload`

## Usage

1. Open the ERB / Program Workshop proctor page.
2. Keep the relevant session tab open.
3. Leave `Auto-approve` enabled in the popup.
4. Optionally enable `Debug Logs` when testing or troubleshooting.
5. Watch the bottom-right badge for the last successful approval time.

## Background Reliability

The extension is more resilient than the original userscript, but there are still limits.

It actively rescans when:

- the DOM changes
- the page becomes visible again
- the window regains focus
- the page is restored
- the browser comes back online
- the background worker alarm fires

It will usually continue to work when the display turns off, as long as:

- Chrome is still running
- the computer does not go to sleep
- the ERB tab remains open
- the session is still valid

It may stop or become unreliable if:

- the Mac goes to sleep
- Chrome is closed or suspended
- the tab is discarded or the page is fully replaced
- the ERB session expires
- the site changes button text, DOM structure, or approval flow

## Safety Rules

The extension tries to avoid bad clicks by requiring one of these conditions:

- the button is an explicit `Approve All` target
- the button is an explicit safe dialog action
- the button is in an approval-related table / row context

It also rejects actions that look like:

- `Cancel`
- `Close`
- `Delete`
- `Deny`
- `Pause`
- `Complete All`
- `Logout`
- `Return`

## Debug Logging

Enable `Debug Logs` in the popup to print categorized messages into DevTools console.

Current log categories include:

- `state`
- `scan`
- `found`
- `dialog`
- `click`
- `skip`

This is useful for verifying:

- whether `Approve All` was found
- whether a reminder dialog blocked the flow
- whether a target was skipped because it was hidden, disabled, or unsafe
- whether a background-triggered rescan fired

## Manual Test Checklist

Use this before relying on the extension in production:

1. Confirm the popup can enable and disable auto-approve.
2. Confirm `Approve All` is clicked when present.
3. Confirm single `Approve` is clicked when `Approve All` is absent.
4. Confirm the accommodations reminder dialog is auto-checked and confirmed on first appearance.
5. Confirm the badge updates after a successful approval.
6. Confirm the badge survives page reloads.
7. Confirm background tabs recover when brought back to the foreground.
8. Confirm dangerous actions are not clicked.
9. Confirm debug logs are readable and useful when enabled.

## Development Notes

- The extension is intentionally simple and file-based.
- No build step is required.
- Changes can be tested by reloading the unpacked extension.
- Syntax can be checked locally with:

```bash
node --check background.js
node --check content.js
node --check popup.js
```

## Known Limitations

- The logic currently depends on ERB-specific labels such as `Approve All` and `Approve`.
- If the site changes text, classes, or button layout, selectors may need updating.
- Background execution is more reliable than the original userscript, but it still depends on Chrome and the page staying alive.
- This repository does not include automated browser tests.

## Disclaimer

- This project is not affiliated with or endorsed by ERB or Program Workshop.
- Use it only in environments where this kind of workflow automation is allowed.
- Review the code and test it with non-critical sessions before relying on it.
