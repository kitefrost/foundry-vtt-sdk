/**
 * NPC Dialogue generation - context menu action on Actor documents.
 *
 * Adds "AI: Generate Dialogue" to the Actor context menu via the
 * getActorContextOptions Hook (v13+) or getActorDirectoryEntryContext Hook (v12).
 * When triggered:
 *   1. Extracts actor data using extractActorContext()
 *   2. Prompts GM for an optional player message (simple dialog)
 *   3. Calls the Quick Dialogue API
 *   4. Posts the result as a ChatMessage spoken by the NPC
 *
 * @module npc-dialogue
 */

import { generateDialogue, reportIssue } from "./api-client.mjs";
import { getSetting, MODULE_ID } from "./settings.mjs";

// ---------------------------------------------------------------------------
// Actor Context Extraction (C-ACE)
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags from a string (Foundry stores biography as HTML).
 * @param {string} html
 * @returns {string}
 */
function _stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Truncate a string to maxChars, appending "..." if truncated.
 * @param {string} str
 * @param {number} maxChars
 * @returns {string}
 */
function _truncate(str, maxChars = 500) {
  if (!str || str.length <= maxChars) return str || "";
  // Reserve room for the 3-char ASCII ellipsis so the result never exceeds
  // maxChars. The ASCII-typography pass swapped the old 1-char ellipsis for
  // "..."; without reserving width that pushed the result to maxChars+3 and
  // broke the "truncates long biographies" test.
  return str.slice(0, maxChars - 3) + "...";
}

/**
 * Extract NPC context from a dnd5e Actor document.
 * Maps Foundry fields → QuickDialogueRequest.npc_context object.
 *
 * @param {Actor} actor
 * @returns {Object} npc_context suitable for the API
 */
function _extractDnd5eContext(actor) {
  const details = actor.system?.details ?? {};
  const abilities = actor.system?.abilities ?? {};

  const biography = _truncate(_stripHtml(details.biography?.value ?? ""), 500);

  const ctx = {
    race: details.type?.value ?? "",
    alignment: details.alignment ?? "",
    challenge_rating: details.cr ?? null,
    biography,
  };

  // Only include abilities if present (some NPCs have them set)
  const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
  const abilityValues = {};
  for (const key of abilityKeys) {
    if (abilities[key]?.value !== undefined) {
      abilityValues[key] = abilities[key].value;
    }
  }
  if (Object.keys(abilityValues).length > 0) {
    ctx.abilities = abilityValues;
  }

  // Merge KiteFrost flags if set (personality, motivation, etc.)
  const engineFlags = actor.getFlag(MODULE_ID, "personality") ?? null;
  if (engineFlags) {
    Object.assign(ctx, typeof engineFlags === "object" ? engineFlags : { personality_traits: engineFlags });
  }

  return ctx;
}

/**
 * Fallback extractor for unknown game systems.
 * Returns just name, type, and biography if present.
 *
 * @param {Actor} actor
 * @returns {Object}
 */
function _extractGenericContext(actor) {
  const biography =
    actor.system?.details?.biography?.value ??
    actor.system?.details?.publicNotes ??
    actor.system?.biography?.value ??
    "";

  return {
    type: actor.type ?? "npc",
    biography: _truncate(_stripHtml(biography), 500),
  };
}

/**
 * Extract Actor data and map it to the API npc_context format.
 * Dispatches on game.system.id for system-specific extraction.
 *
 * @param {Actor} actor
 * @returns {{ npc_name: string, npc_context: Object }}
 */
export function extractActorContext(actor) {
  const systemId = game.system?.id ?? "generic";

  let npc_context;
  if (systemId === "dnd5e") {
    npc_context = _extractDnd5eContext(actor);
  } else {
    npc_context = _extractGenericContext(actor);
  }

  return {
    npc_name: actor.name ?? "Unknown NPC",
    npc_context,
  };
}

// ---------------------------------------------------------------------------
// Dialog helper - prompt GM for player message and optional situation
// ---------------------------------------------------------------------------

/**
 * Open a simple Dialog to collect the player's message and optional situation
 * override from the GM.
 *
 * @param {string} npcName
 * @returns {Promise<{playerMessage: string, situation: string, tone: string}|null>}
 *   Resolves to the collected data or null if the GM cancelled.
 */
async function _promptGmForInput(npcName) {
  return new Promise((resolve) => {
    const defaultTone = getSetting("defaultTone") ?? "neutral";

    const toneOptions = ["neutral", "friendly", "hostile", "cautious", "suspicious", "fearful", "excited"]
      .map((t) => `<option value="${t}"${t === defaultTone ? " selected" : ""}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`)
      .join("");

    const content = `
      <form>
        <div class="form-group">
          <label>Player message / action</label>
          <input type="text" name="playerMessage" placeholder="What does the player say or do?" autofocus />
        </div>
        <div class="form-group">
          <label>Situation (optional)</label>
          <input type="text" name="situation" placeholder="e.g. 'tense confrontation in the tavern'" />
        </div>
        <div class="form-group">
          <label>Tone</label>
          <select name="tone">${toneOptions}</select>
        </div>
      </form>
    `;

    new Dialog({
      title: `AI Dialogue - ${npcName}`,
      content,
      buttons: {
        generate: {
          icon: '<i class="fas fa-comment-dots"></i>',
          label: "Generate",
          callback: (html) => {
            const playerMessage = html.find('[name="playerMessage"]').val()?.trim();
            if (!playerMessage) {
              ui.notifications.warn("[KiteFrost] Player message is required.");
              resolve(null);
              return;
            }
            resolve({
              playerMessage,
              situation: html.find('[name="situation"]').val()?.trim() ?? "",
              tone: html.find('[name="tone"]').val() ?? defaultTone,
            });
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "generate",
    }).render(true);
  });
}

// ---------------------------------------------------------------------------
// Main action - called from context menu
// ---------------------------------------------------------------------------

/**
 * Run the full dialogue generation flow for an actor.
 * Called by the context menu entry registered in main.mjs.
 *
 * @param {Actor} actor
 */
export async function generateNpcDialogue(actor) {
  if (!actor) {
    ui.notifications.error("[KiteFrost] No actor found.");
    return;
  }

  // 1. Prompt GM for player message / situation / tone
  const input = await _promptGmForInput(actor.name ?? "NPC");
  if (!input) return; // GM cancelled

  ui.notifications.info(`[KiteFrost] Generating dialogue for ${actor.name ?? "NPC"}...`);
  try {
    await runDialogue(actor, input);
  } catch (err) {
    ui.notifications.error(err.message);
    console.error("[KiteFrost] Dialogue generation failed:", err);
  }
}

/**
 * The shared core of the UI path and the public API (design R10): build the
 * request, call the API, optionally post the chat message, fire the hook.
 * Throws on any failure - the UI caller turns that into a notification.
 *
 * @param {Actor} actor
 * @param {{playerMessage: string, situation?: string, tone?: string, postToChat?: boolean}} input
 */
export async function runDialogue(actor, input = {}) {
  if (!actor) throw new Error("[KiteFrost] No actor given.");
  const playerMessage = (input.playerMessage ?? "").trim();
  if (!playerMessage) throw new Error("[KiteFrost] playerMessage is required.");

  const { npc_name, npc_context } = extractActorContext(actor);
  const request = {
    npc_name,
    npc_context,
    situation: input.situation ?? "",
    tone: input.tone ?? getSetting("defaultTone") ?? "neutral",
    player_message: playerMessage,
    game_system: game.system?.id ?? "dnd5e",
  };

  const result = await generateDialogue(request);

  let message = null;
  if (input.postToChat !== false) {
    const speaker = ChatMessage.getSpeaker({ actor });
    let content;
    try {
      const render = globalThis.foundry?.applications?.handlebars?.renderTemplate ?? renderTemplate;
      content = await render(`modules/${MODULE_ID}/templates/dialogue-result.hbs`, {
        dialogue: result.dialogue,
        mood: result.mood,
        stage_direction: result.stage_direction,
        suggested_actions: result.suggested_actions ?? [],
        npc_name,
      });
    } catch (_) {
      // Template render failed - fall back to plain HTML. Every field is model
      // output: escape it, or a crafted reply injects markup into every viewer's
      // chat (design R12).
      const esc = (v) =>
        String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      const actionsText =
        result.suggested_actions?.length > 0
          ? `<p><em>Suggested actions: ${result.suggested_actions.map(esc).join(" | ")}</em></p>`
          : "";
      content = `<p><em>[${esc(result.mood)}]</em> ${esc(result.dialogue)}</p>${
        result.stage_direction ? `<p><em>${esc(result.stage_direction)}</em></p>` : ""
      }${actionsText}`;
    }
    message = await ChatMessage.create({
      speaker,
      content,
      // v12+: presentation is `style`; `type` is a subtype string and dnd5e rejects a number (design R9).
      style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
    });
  }

  const out = { npc_name, ...result, request, message };
  Hooks.callAll?.("kitefrost.dialogueGenerated", { actor, result: out, message });
  return out;
}

// ---------------------------------------------------------------------------
// Report Issue - Dialog + click handler
// ---------------------------------------------------------------------------

/**
 * Show a Foundry Dialog for reporting an issue with generated dialogue.
 *
 * @param {Object} context
 * @param {string} context.npcName   - NPC display name
 * @param {string} context.dialogue  - The generated dialogue text
 * @param {string} context.mood      - The NPC mood tag
 * @param {string} [context.actorId] - Foundry actor ID
 * @param {Object} [context.npcContext] - NPC context object (biography, traits)
 */
export async function showReportIssueDialog(context = {}) {
  const categoryOptions = [
    "hallucination", "inconsistency", "crash", "quality", "safety", "other",
  ]
    .map((c) => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`)
    .join("");

  const severityOptions = ["low", "medium", "high", "critical"]
    .map((s) => `<option value="${s}"${s === "medium" ? " selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
    .join("");

  const formContent = `
    <form>
      <div class="form-group">
        <label>Category</label>
        <select name="category">${categoryOptions}</select>
      </div>
      <div class="form-group">
        <label>Severity</label>
        <select name="severity">${severityOptions}</select>
      </div>
      <div class="form-group">
        <label>Description *</label>
        <textarea name="description" rows="4" placeholder="Describe the issue..."></textarea>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: `Report Issue - ${context.npcName ?? "NPC Dialogue"}`,
      content: formContent,
      buttons: {
        submit: {
          icon: '<i class="fas fa-flag"></i>',
          label: "Submit Report",
          callback: async (html) => {
            const category = html.find('[name="category"]').val();
            const severity = html.find('[name="severity"]').val();
            const description = html.find('[name="description"]').val()?.trim();

            if (!description) {
              ui.notifications.warn("[KiteFrost] Description is required.");
              resolve(null);
              return;
            }

            const metadata = {
              npc_name: context.npcName ?? "",
              dialogue_text: context.dialogue ?? "",
              mood: context.mood ?? "",
              foundry_version: game.version ?? "",
              game_system: game.system?.id ?? "",
            };

            if (context.actorId) {
              metadata.actor_id = context.actorId;
            }

            if (context.npcContext) {
              metadata.npc_context = context.npcContext;
            }

            try {
              const result = await reportIssue({
                run_id: context.runId ?? "",
                category,
                severity,
                description,
                metadata,
              });

              ui.notifications.info(
                `[KiteFrost] Report submitted. Your report ID: ${result.feedback_id}`,
              );
              resolve(result);
            } catch (err) {
              ui.notifications.error(`[KiteFrost] Report failed: ${err.message}`);
              console.error("[KiteFrost] Report submission failed:", err);
              resolve(null);
            }
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "submit",
    }).render(true);
  });
}

/**
 * Register a delegated click handler on the chat log for Report Issue buttons.
 * Call this once from main.mjs Hooks.on("ready", ...).
 */
export function registerReportIssueHandler() {
  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".kitefrost-report-issue");
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();

    showReportIssueDialog({
      npcName: btn.dataset.npcName ?? "",
      dialogue: btn.dataset.dialogue ?? "",
      mood: btn.dataset.mood ?? "",
    });
  });
}
