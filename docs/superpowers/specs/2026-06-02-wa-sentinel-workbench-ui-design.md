# WA Sentinel Workbench UI Redesign

## Goal

Replace the current configuration-heavy page with a focused workbench for WhatsApp alert forwarding. The user should always know which rule is selected, which settings will be saved, and whether the selected DingTalk robot is usable before saving.

## Selected Direction

Use layout option A: a two-column desktop workbench.

- Left rail: WhatsApp account status, global forwarding switch, and the full rule list.
- Main panel: only the selected rule is editable.
- Bottom or secondary panel: group selector and forwarding history for the selected context.

This layout supports multiple rules without making the page feel like a long settings form.

## Core Interaction

Each rule is a complete alert route:

- Rule name and enabled state.
- Keywords.
- Notification time window.
- Group scope and optional personal-message monitoring.
- DingTalk robot alias, webhook, signing secret, title, and mention settings.

Selecting a rule in the left rail changes the main editor. The primary action is always `校验并保存当前规则`. The button validates the currently selected rule by sending a DingTalk test message first. If validation fails, the configuration file is not updated.

## Screen Structure

The first viewport should be usable without scrolling for the common workflow:

- Header: compact product title and three status chips: WhatsApp login, DingTalk global switch, rule count.
- Left rail:
  - WhatsApp login state with account details and login/logout action.
  - Global DingTalk forwarding switch.
  - Rule list with rule name, enabled state, robot alias, keyword summary, and time summary.
  - Add rule button.
- Main editor:
  - Sticky editor header with selected rule name and primary save button.
  - Trigger card: keywords, time window, direct-message toggle.
  - Destination card: DingTalk robot alias, webhook, secret, title, at options.
  - Scope card: selected groups with search and all-groups mode.
- History:
  - Compact rows showing time, group/session name, sender, rule, robot, message summary, and result.

## Visual Style

Keep the Cult UI-inspired direction but make it quieter and more operational:

- Monochrome base with one clear action color.
- Less grid texture; reserve it for background only, not every card.
- 8px radii.
- Dense but readable spacing.
- No large decorative hero or branding block.

## States and Feedback

- Login states: `未登录`, `登录中`, `登录成功`.
- QR failure should show a clear network-oriented message and should not remain visible after login succeeds.
- Saved sensitive fields are never echoed as plaintext. Show `已保存，留空表示不修改`.
- Save feedback should include the selected rule name and config file path.
- Rule list should visually mark unsaved local edits with `未保存` until the selected rule is validated and saved.

## Non-Goals

- No new backend forwarding behavior.
- No change to packaging workflow.
- No OAuth or web login.
- No image OCR keyword matching in this UI pass.

## Validation

- `node --check src/views/components/AlertWorkbench.js`
- `go test ./...`
- `git diff --check`
- Build local browser binaries.
- Use a local smoke check to confirm the page serves and the config endpoint returns expected rule data.
