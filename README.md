# Maya AutoPilot

Chrome extension that fully automatically fills answers in Maya assessments:

- **Grand Assessments**: `https://maya.adityauniversity.in/grand-assessment/<id>`
- **Emp-Skills Deep-Dive**: `https://maya.adityauniversity.in/emp-skills-deep-dive-in/<id>`

**Zero interaction required.** Load the test page and every question gets
answered (and submitted, for deep-dive) automatically.

## How it works

1. **Hook** (`hook.js` -> `hook-injected.js`, loaded from the extension's own
   origin so the site CSP cannot block it) intercepts the page's own network
   requests to `get-grand-assessment-questions-by-id` and
   `get-random-deep-dive-question`, and captures the exact responses.
2. **No API fallback.** The extension only uses the page's own question data, so
   answers always match what is displayed. It waits (and retries) until the data
   arrives.
3. **Grand assessment**: questions are matched by decoded question text and the
   correct option is clicked; the extension walks the question navigator grid,
   fills every unanswered question, verifies each radio is actually checked, and
   finishes with a verification pass.
4. **Deep-dive**: each captured question is verified against the displayed text,
   answered, then the "Next Question" / "Submit" button is clicked automatically.
   If an option cannot be found, the page reloads for a new question (max 5
   consecutive). If capture is missed, the extension fetches random questions
   itself until one matches the displayed question.
5. **SPA navigation is supported** - clicking into a test from the dashboard
   works without a manual refresh.
6. A draggable, minimizable floating panel (bottom-right) shows live progress:
   status, progress ring, "Answered X / Y" (or "Attempted X / Y" parsed from the
   page for deep-dive). Position is remembered across page loads.

## Install (Chrome/Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `maya-autofill-extension` folder.
4. Reload the test page. Questions are filled automatically - no popup needed.

## Options (extension popup - all optional)

- **Auto-run when questions load** (default on)
- **Auto-advance to next question** (default on)
- **Advanced (optional)** - Pasted JSON: only if you want a manual answer source
  for grand assessments: paste the full response of
  `get-grand-assessment-questions-by-id` from the Network tab, save.

## Troubleshooting

- **Panel looks old / no progress ring** -> you are running a stale version. On
  `chrome://extensions`, click the refresh icon on the extension (or remove and
  Load unpacked again), then reload the test page.
- **"Loading..." forever** -> capture has not arrived yet. On deep-dive the
  extension self-heals (self-fetch + reload-on-failure). On grand assessments,
  click **Autofill all** - it waits up to 60s for the page data.
- A question stays unanswered -> click **Autofill all**; the run re-checks every
  unanswered question and logs what failed (e.g. "no-option (answer: '...')").
- The page shows CSP errors in console -> that is the *old* build's hook. Make
  sure the extension card reads the latest version and reload the page.

## Files

- `manifest.json` - MV3 manifest (v1.3.8, "Maya AutoPilot")
- `hook.js` - injects `hook-injected.js` (external extension file, CSP-safe)
- `hook-injected.js` - main-world fetch/XHR capture
- `content.js` - matching, clicking, sweep engine, deep-dive flow, floating panel
- `background.js` - unused legacy API fallback (kept for reference)
- `popup.html` / `popup.js` - optional settings and paste-JSON fallback
- `icons/` - extension icons (green rounded square with white checkmark)
