==========================================================
  Maya AutoPilot - Setup & Instructions
==========================================================

WHAT IT DOES
  Automatically answers questions on Aditya University's Maya
  platform, with zero interaction:
    - Grand Assessments  (/grand-assessment/<id>)
    - Emp-Skills Deep-Dive (/emp-skills-deep-dive-in/<id>)

  Answers come from the PAGE ITSELF (captured from the page's
  own network request), so they always match the displayed
  questions. No API calls, no manual JSON input needed.

----------------------------------------------------------
STEP 1 - INSTALL (Chrome or Edge)
----------------------------------------------------------
1. Unzip this file into a folder (e.g. C:\college\maya\maya-autofill-extension).
2. Open chrome://extensions  (Edge: edge://extensions).
3. Turn ON "Developer mode" (top-right toggle).
4. Click "Load unpacked".
5. Select the unzipped folder (the one containing manifest.json).
6. The extension card should appear as "Maya AutoPilot".

----------------------------------------------------------
STEP 2 - UPDATE (if you already had an older version)
----------------------------------------------------------
VERY IMPORTANT: if the console shows this error:
  "Executing inline script violates the following Content
   Security Policy directive..."
...you are running an OLD version. Remove it completely:
1. On chrome://extensions, click REMOVE on every
   "Maya AutoPilot" / "Maya Grand Assessment Helper" entry
   (you may have two copies loaded - remove both).
2. Unzip this new folder again (overwrite the old one).
3. Click "Load unpacked" and select the folder.
4. Verify the card name says "Maya AutoPilot".
5. Reload your test page.

----------------------------------------------------------
STEP 3 - USE
----------------------------------------------------------
GRAND ASSESSMENT:
  1. Open the test link (e.g.
     https://maya.adityauniversity.in/grand-assessment/<id>)
  2. Sit back. The extension captures the questions, fills
     all 60 automatically, and shows progress in the panel
     (green box, bottom-right).
  3. If anything is left unanswered, click "Autofill all".

EMP-SKILLS DEEP-DIVE:
  1. Open a deep-dive test link (topic-based, e.g.
     .../emp-skills-deep-dive-in/<id>?technology=...&roll_no=...)
  2. The extension captures each question, selects the
     correct answer, and clicks "Next Question" automatically,
     question after question.
  3. You can also click into the test from the dashboard -
     no manual refresh needed.

----------------------------------------------------------
PANEL CONTROLS (the green floating box)
----------------------------------------------------------
  - Drag the green header to move the panel (position is
    remembered).
  - "-"  : minimize to the header only.
  - "x"  : hide the panel (a small green button reappears
           bottom-right - click it to bring the panel back).
  - Autofill all : fill every unanswered question.
  - Fill current : fill only the question on screen.
  - Retry : wait for / reload answer data and try again.
  - Stop  : abort a running fill (appears during runs).
  - Auto-run / Auto-advance toggles: switch on/off.

----------------------------------------------------------
PROGRESS / STATUS MEANING
----------------------------------------------------------
  Status dot:  green = working/captured, amber (pulsing) =
  waiting, red = error.
  Ring + text: Answered X / Y for grand assessments;
  "Attempted X / Y (auto: N)" for deep-dive (read from the
  page's own counter).

----------------------------------------------------------
TROUBLESHOOTING
----------------------------------------------------------
- Panel stuck on "Loading..." for deep-dive: it self-heals
  (fetches matching questions itself). Give it ~10 seconds.
  If the page shows no question at all, reload the page.
- A question remains unanswered on grand assessments: click
  "Autofill all" (it retries everything and verifies).
- Console shows the CSP inline-script error: you are on the
  OLD build - see STEP 2.
- Extension does nothing at all: make sure the URL is exactly
  /grand-assessment/<id> or /emp-skills-deep-dive-in/<id>,
  you are logged in, and the question card is visible.

----------------------------------------------------------
FILES IN THIS ZIP
----------------------------------------------------------
  manifest.json        - extension definition
  hook.js              - injects the capture script (CSP-safe)
  hook-injected.js     - main-world fetch/XHR capture
  content.js           - filling engine + floating panel
  background.js        - legacy fallback (unused, kept)
  popup.html/popup.js  - optional settings
  icons/               - extension icons
  README.md            - full documentation
  setup.txt            - this file
==========================================================
