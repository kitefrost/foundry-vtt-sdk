/**
 * Public module API (design R10) - `game.modules.get("kitefrost").api`.
 *
 * For macros, world scripts and other modules. Same core as the right-click
 * dialog (`runDialogue`), so the UI and API paths cannot drift. Every member
 * REJECTS on failure (no notification) so callers can try/catch.
 *
 * @example
 *   const kf = game.modules.get("kitefrost").api;
 *   const r = await kf.generateDialogue(game.actors.getName("Innkeeper"),
 *     { playerMessage: "Any rooms free?", tone: "friendly" });
 *   console.log(r.dialogue, r.mood);
 */

import { reportIssue as postReport } from "./api-client.mjs";
import { extractActorContext, runDialogue } from "./npc-dialogue.mjs";

function _resolveActor(actorOrId) {
  if (typeof actorOrId === "string") {
    const actor = game.actors?.get(actorOrId) ?? game.actors?.getName?.(actorOrId);
    if (!actor) throw new Error(`[KiteFrost] Actor not found: ${actorOrId}`);
    return actor;
  }
  return actorOrId;
}

export function buildApi(version) {
  return Object.freeze({
    version,
    /** Generate NPC dialogue without a dialog. See design R10 for the result shape. */
    generateDialogue: async (actor, options = {}) => runDialogue(_resolveActor(actor), options),
    /** The exact {npc_name, npc_context} the API is sent for this actor. */
    extractActorContext: (actor) => extractActorContext(_resolveActor(actor)),
    /** Submit an issue report; resolves {feedback_id, ...}. */
    reportIssue: async ({ category, severity, description, npcName, dialogue, mood, actorId, runId } = {}) => {
      if (!description?.trim()) throw new Error("[KiteFrost] description is required.");
      const metadata = {
        npc_name: npcName ?? "",
        dialogue_text: dialogue ?? "",
        mood: mood ?? "",
        foundry_version: game.version ?? "",
        game_system: game.system?.id ?? "",
      };
      if (actorId) metadata.actor_id = actorId;
      return postReport({ run_id: runId ?? "", category: category ?? "other", severity: severity ?? "medium", description, metadata });
    },
  });
}
