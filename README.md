# KiteFrost - Foundry VTT Module

> **NOT PUBLISHED YET - the install instructions below do not work today.**
>
> The manifest URL 404s (no release has been cut into the GitLab project), and the
> module's default API base `https://api.kitefrost.ai` is unreachable while
> production is down. Installing today fails twice over.
>
> Machine-readable state: `PUBLICATION.json`. Rationale and the condition for
> publishing: DR-R3 in
> `docs/design/concepts/foundry-vtt-live-module/design.md` (`FND-20260922-6A1`).
>
> **Alpha testers**: use the Foundry VTT **JSON import/export** path instead - that
> is implemented and works. See `docs/design/alpha-reply-playbook.md` §B1.

Real-time NPC dialogue generation for TTRPG GMs. Right-click any Actor in the
Actor Directory to generate in-character dialogue with mood and stage directions,
powered by the KiteFrost API.

## Requirements

- Foundry VTT v12+
- D&D 5e game system (other systems fall back to generic extraction)
- A [KiteFrost](https://kitefrost.ai) account with a project and API key

## Installation

### Method 1: Manifest URL (recommended)

1. Open Foundry VTT → **Add-on Modules** → **Install Module**
2. Paste the manifest URL:
   ```
   https://gitlab.com/kitefrost/foundry-vtt-sdk/-/releases/permalink/latest/downloads/module.json
   ```

   **Alpha/beta testers**: install the testing channel instead - a separate
   project that carries only unstable builds:
   `https://gitlab.com/kitefrost/foundry-vtt-sdk-testing/-/releases/permalink/latest/downloads/module.json`.
   Testing builds are numbered above every stable patch (e.g. `1.1.100`), so you
   are never downgraded; reinstall from the stable URL to return to stable.
   Then set **Module Settings -> KiteFrost -> API URL** to the API address in your
   invite message, and paste your API key.
3. Click **Install**

### Method 2: Manual

1. Download `kitefrost.zip` from the
   [releases page](https://gitlab.com/kitefrost/foundry-vtt-sdk/-/releases)
2. Extract to `<foundry-data>/modules/kitefrost/`
3. Restart Foundry VTT

## Configuration

1. Go to **Game Settings** → **Configure Settings** → **Module Settings**
2. Find **KiteFrost** and set:

| Setting | Description | Example |
|---------|-------------|---------|
| **API URL** | Base URL of the KiteFrost API | `https://api.kitefrost.ai` |
| **API Key** | Your API key (`sk_...`), Full Access permissions. Stored only in your browser. | `sk_live_abc123def456` |
| **Project ID** | Your project's ID (a UUID) from the project's page in the dashboard | `c4d8b72d-d74c-463a-8474-6405c15fe0a9` |
| **Default Tone** | Default NPC dialogue tone | `neutral` |

Your API key and Project ID are found in the
[KiteFrost dashboard](https://kitefrost.ai/dashboard).

## Usage

1. Open the **Actors Directory** (the people icon in the right sidebar)
2. Right-click any NPC Actor
3. Click **AI: Generate Dialogue**
4. In the dialog:
   - Enter what the player said or did
   - Optionally add situational context (e.g. "tense confrontation in the tavern")
   - Select a tone
5. Click **Generate**

The NPC's dialogue, mood, and stage direction appear as a chat message spoken by
the NPC. Suggested follow-up actions are shown below the dialogue for the GM.

## NPC Personality Flags

You can store persistent personality data on any Actor using the
`kitefrost.personality` flag. This data is merged into every dialogue
request for that Actor.

```js
// Example: set personality via macro
const actor = game.actors.getName("Grognard the Innkeeper");
await actor.setFlag("kitefrost", "personality", {
  personality_traits: "Gruff exterior, secretly kind-hearted",
  motivation: "Protect the village from outsiders",
  secret: "Was once an adventurer before a bad injury",
});
```

## Scripting API (macros and other modules)

Everything the right-click menu does is also available from code, for macros,
world scripts and other modules:

```js
const kf = game.modules.get("kitefrost").api;

// Generate dialogue and post it to chat as the NPC (no dialog is shown)
const r = await kf.generateDialogue(game.actors.getName("Grognard the Innkeeper"), {
  playerMessage: "Any rooms free tonight?",
  situation: "late evening, the common room is packed", // optional
  tone: "friendly",                                      // optional
});
console.log(r.dialogue, r.mood, r.suggested_actions);

// Just get the text - no chat message
const quiet = await kf.generateDialogue(actorId, { playerMessage: "Halt!", postToChat: false });

// Report a problem with a reply
await kf.reportIssue({ category: "quality", severity: "low", description: "Too long", npcName: r.npc_name });

// React to every generated line (from the menu or the API)
Hooks.on("kitefrost.dialogueGenerated", ({ actor, result, message }) => { /* ... */ });
```

| Member | Returns |
|---|---|
| `generateDialogue(actorOrId, { playerMessage, situation?, tone?, postToChat? })` | `{ npc_name, dialogue, mood, stage_direction, suggested_actions, request, message }` (`message` is `null` when `postToChat: false`) |
| `extractActorContext(actorOrId)` | The NPC details that are sent for this Actor |
| `reportIssue({ category, severity, description, npcName?, dialogue?, mood?, actorId? })` | `{ feedback_id, ... }` |
| `version` | The module version |

Every call **rejects** on a problem (missing settings, missing `playerMessage`,
an invalid key, a network error), so wrap it in `try { ... } catch (e) { ... }`.

## Troubleshooting

**"AI: Generate Dialogue" does not appear in the context menu**

- Confirm you are logged in as a GM
- Check that **API Key** and **Project ID** are set in Module Settings

**503 LLM service unavailable**

- Verify the **API URL** setting points to a running KiteFrost instance
- Check your API key is valid and not revoked

**Empty or malformed dialogue**

- The LLM occasionally returns non-standard output; the module falls back to
  plain text in this case

## License

MIT - see [LICENSE](LICENSE).
