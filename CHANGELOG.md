# Changelog

All notable changes to the KiteFrost Foundry VTT module will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.103] - 2026-09-26 (testing channel)

### Added

- Scripting API at `game.modules.get("kitefrost").api` for macros and other
  modules: `generateDialogue`, `extractActorContext`, `reportIssue`, `version`,
  plus a `kitefrost.dialogueGenerated` hook. See README "Scripting API".

### Fixed

- API errors whose detail is an object showed as "[object Object]"; they now
  show the server's message.

---

## [1.1.102] - 2026-09-26 (testing channel)

### Fixed

- Generated dialogue was never posted to chat on systems with typed chat
  messages (dnd5e 6): the message set a numeric `type`, which Foundry v12+
  rejects. It now sets `style` and omits `type`.
- Foundry v14: context-menu entry uses `label` / `visible` / `onClick`, and
  templates render through `foundry.applications.handlebars.renderTemplate`,
  removing the deprecation warnings (the old names are removed in v15/v16).

---

## [1.0.0] - 2026-04-20

### Changed - BREAKING

- **API URL path migration** - The module now calls
  `POST {apiUrl}/v1/projects/{projectId}/quick-dialogue` and
  `POST {apiUrl}/v1/projects/{projectId}/feedback/report` instead of the
  previous `/v1/worlds/...` paths. The KiteFrost API has consolidated on
  `projects` as the canonical resource name. The user-facing "Project ID"
  setting is unchanged - only the outbound HTTP path has moved.
- **Minimum supported KiteFrost API version** - Requires a KiteFrost API
  deployment that serves `/v1/projects/*`. Older deployments that only
  serve `/v1/worlds/*` are no longer compatible; stay on `0.1.x` if you
  cannot upgrade the API side.

### Notes

- Foundry VTT's native `game.world`, `WorldConfig`, and world-scope
  settings (`scope: "world"`) are unchanged - those are Foundry engine
  APIs and not owned by this module.

## [0.1.0] - 2026-03-21

### Added

- **NPC Dialogue Generation** - Right-click any Actor in the Actor Directory to
  generate in-character dialogue via the KiteFrost Quick Dialogue API.
- **Actor Context Extraction** - Automatic extraction of NPC data (race,
  alignment, biography, abilities) from dnd5e Actor documents. Falls back to
  generic extraction for other game systems.
- **GM Input Dialog** - Prompt for player message, optional situation override,
  and tone selection before calling the API.
- **ChatMessage Output** - Dialogue posted as a ChatMessage spoken by the NPC,
  including mood tag, stage direction, and suggested follow-up actions.
- **Module Settings** - World-scope configuration for API URL, API Key,
  Project ID, and default tone via `game.settings.register`.
- **Foundry VTT v12+ compatibility** - Uses ES modules (`module.json` → `esmodules`),
  no build step required.
- **Personality Flags** - GMs can store persistent NPC personality data via
  `actor.setFlag("kitefrost", "personality", { ... })`.

[1.0.0]: https://github.com/kitefrost/foundry-vtt-sdk/releases/tag/v1.0.0
[0.1.0]: https://github.com/kitefrost/foundry-vtt-sdk/releases/tag/v0.1.0
