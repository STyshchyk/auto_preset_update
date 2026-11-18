---
name: station-release-checklist
description: Post-edit verification and documentation checklist for the Drone Setup Station SPA (index.html, css/, js/). Trigger after completing code changes or before wrapping up a task.
---

# Station Release & Verification Checklist

1. **Syntax & Module Integrity**
   - Confirm `index.html` loads `./js/main.js` as `type="module"` without broken relative imports.
   - Check `git status -s` and `git diff` to ensure no stray or unrelated edits exist.

2. **UI Mode Parity**
   - **Simplified Mode (`body.simplified-mode`):**
     - Fits within a single desktop viewport.
     - Intermediate Step 1 & Step 2 popups are suppressed in `js/ui/modal.js` (callbacks still execute).
     - Only «🏁 Завершити налаштування» (`saveMotorDirections()`) shows a completion popup (`{ allowInSimplified: true }`, `1000ms` auto-close).
   - **Expert Mode:**
     - `.safety-box` (`#chkPropellersRemoved`) remains active as an explicit operator interlock.
     - All modal popups and grouped toolbars remain functional.

3. **Persistence & Error Handling**
   - Wrap `localStorage` calls in `try/catch`.
   - Ensure `#log` DOM output remains capped (800 lines) and `setProgressionBanner()` uses `textContent` (not `innerHTML`).

4. **Documentation Sync**
   - Update `PROJECT_STATUS.md` (and `PROJECT_MAP.md` if selectors or modules changed) after significant tasks.
