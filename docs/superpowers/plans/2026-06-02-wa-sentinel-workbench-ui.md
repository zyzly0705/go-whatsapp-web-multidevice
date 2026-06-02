# WA Sentinel Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the WA Sentinel page into the approved option A workbench: left rail for status and rules, main panel for the selected rule, explicit validation-before-save, group scope, and compact history.

**Architecture:** Keep the existing Vue single-file component pattern in `src/views/components/AlertWorkbench.js`; do not change backend APIs. Use local component state to track selected rule, dirty rule IDs, and saved feedback. Keep CSS in `src/views/assets/app.css`, with layout classes scoped to the workbench.

**Tech Stack:** Vue global component, Fomantic UI controls, plain CSS, existing REST endpoints.

---

### Task 1: Component State and Dirty Tracking

**Files:**
- Modify: `src/views/components/AlertWorkbench.js`

- [ ] **Step 1: Add dirty tracking state**

Add `dirtyRuleIds: []` and `savingRuleId: ''` to `data()`.

- [ ] **Step 2: Add helpers**

Implement `markRuleDirty(rule)`, `isRuleDirty(rule)`, `clearRuleDirty(ruleID)`, and call `markRuleDirty(selectedRule)` from every editable control via `@input` or `@change`.

- [ ] **Step 3: Verify syntax**

Run: `node --check src/views/components/AlertWorkbench.js`

Expected: no output and exit code 0.

### Task 2: Option A Layout

**Files:**
- Modify: `src/views/components/AlertWorkbench.js`
- Modify: `src/views/assets/app.css`

- [ ] **Step 1: Replace template structure**

Use a single `.sentinel-shell` with:

- `.sentinel-rail`: WhatsApp status, global switch, rule list, add button.
- `.sentinel-main`: sticky current-rule header, trigger/destination/scope sections.
- `.sentinel-history`: compact history list.

- [ ] **Step 2: Keep current behavior wired**

Preserve existing methods for login, logout, group fetch, rule save, rule test, and history fetch. The primary button must call `saveCurrentRule`.

- [ ] **Step 3: Verify syntax**

Run: `node --check src/views/components/AlertWorkbench.js`

Expected: no output and exit code 0.

### Task 3: Simplify Visual Style

**Files:**
- Modify: `src/views/assets/app.css`

- [ ] **Step 1: Add workbench layout styles**

Add desktop layout for `.sentinel-shell`, `.sentinel-rail`, `.sentinel-main`, `.sentinel-editor-header`, `.sentinel-section`, `.sentinel-group-list`, and `.sentinel-history`.

- [ ] **Step 2: Add responsive layout**

Under `@media (max-width: 900px)`, collapse the shell into one column and keep the save bar visible without overlap.

- [ ] **Step 3: Verify whitespace**

Run: `git diff --check`

Expected: no output and exit code 0.

### Task 4: Cache Bust and Validation

**Files:**
- Modify: `src/views/index.html`

- [ ] **Step 1: Update component version query**

Change the AlertWorkbench import query to `?v=20260602-workbench-a`.

- [ ] **Step 2: Run tests and build**

Run:

```bash
cd src
/opt/homebrew/Cellar/go/1.26.1/bin/go test ./...
cd ..
node --check src/views/components/AlertWorkbench.js
git diff --check
PATH=/opt/homebrew/Cellar/go/1.26.1/bin:$PATH ./src/scripts/build-local-browser.sh
```

Expected: all commands pass.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add src/views/components/AlertWorkbench.js src/views/assets/app.css src/views/index.html
git commit -m "Redesign WA Sentinel workbench UI"
git push zyzly codex/wa-alert-dingtalk-workbench
```
