/**
 * KiteFrost - Foundry VTT Module Entry Point
 *
 * Registers settings, hooks, and context menu entries for the KiteFrost
 * TTRPG GM pack integration.
 *
 * Hooks registered:
 *   - init:                    Register module settings
 *   - ready:                   Log startup info
 *   - getActorContextOptions:  Add "AI: Generate Dialogue" to Actor context menu (v13+)
 *   - getActorDirectoryEntryContext: Legacy hook for v12 compatibility
 *
 * @module main
 */

import { buildApi } from "./api.mjs";
import { registerSettings, MODULE_ID } from "./settings.mjs";
import { generateNpcDialogue, registerReportIssueHandler } from "./npc-dialogue.mjs";

// ---------------------------------------------------------------------------
// init - settings registration
// ---------------------------------------------------------------------------

Hooks.on("init", () => {
  console.log(`${MODULE_ID} | Initialising KiteFrost module`);
  registerSettings();
  // Public API for macros / other modules (design R10).
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = buildApi(mod.version);
});

// ---------------------------------------------------------------------------
// ready - startup confirmation
// ---------------------------------------------------------------------------

Hooks.on("ready", () => {
  console.log(`${MODULE_ID} | KiteFrost module ready`);
  registerReportIssueHandler();
});

// ---------------------------------------------------------------------------
// getActorContextOptions - Actor right-click menu (v13+)
// ---------------------------------------------------------------------------

/**
 * Add "AI: Generate Dialogue" to the Actor context menu.
 *
 * Used in Foundry VTT v13+ (replaces getActorDirectoryEntryContext).
 * The entry is only shown for GMs (isGM guard) since players should not
 * trigger server-side LLM calls directly.
 *
 * v13 signature is (application, menuItems) - the first argument is the
 * ActorDirectory application, NOT an Actor. The selected actor is resolved in
 * the callback from the clicked entry's data-entry-id.
 *
 * @param {Application} _app    - The ActorDirectory application
 * @param {Array}       options - Mutable array of context menu option objects
 */
Hooks.on("getActorContextOptions", (_app, options) => {
  // Only show the menu item for GMs
  if (!game.user?.isGM) return;

  const visible = () => {
    // Show for any actor, but require configuration to be set
    const apiKey = game.settings.get(MODULE_ID, "apiKey");
    const projectId = game.settings.get(MODULE_ID, "projectId");
    return !!(apiKey && projectId);
  };
  const onClick = async (_event, li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const actorId = el?.dataset?.entryId ?? el?.closest?.("[data-entry-id]")?.dataset?.entryId;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (actor) await generateNpcDialogue(actor);
  };
  const isV14 = Number(game.release?.generation ?? 0) >= 14;
  // v14 renamed name, condition, callback to label, visible, onClick(event, target);
  // the v13 names are removed in v16 (design R9).
  options.push(
    isV14
      ? { label: "AI: Generate Dialogue", icon: '<i class="fas fa-comment-dots"></i>', visible, onClick }
      : {
          name: "AI: Generate Dialogue",
          icon: '<i class="fas fa-comment-dots"></i>',
          condition: visible,
          callback: (li) => onClick(null, li),
        },
  );
});

// ---------------------------------------------------------------------------
// getActorDirectoryEntryContext - Actor right-click menu (v12 compatibility)
// ---------------------------------------------------------------------------

/**
 * Legacy hook for Foundry VTT v12 and earlier.
 * Add "AI: Generate Dialogue" to the Actor Directory context menu.
 *
 * The entry is only shown for GMs (isGM guard) since players should not
 * trigger server-side LLM calls directly.
 *
 * @param {jQuery} html    - The context menu jQuery element
 * @param {Array}  options - Mutable array of context menu option objects
 */
Hooks.on("getActorDirectoryEntryContext", (html, options) => {
  // Only show the menu item for GMs
  if (!game.user?.isGM) return;

  options.push({
    name: "AI: Generate Dialogue",
    icon: '<i class="fas fa-comment-dots"></i>',
    condition: (li) => {
      // Show for any actor, but require configuration to be set
      const apiKey = game.settings.get(MODULE_ID, "apiKey");
      const projectId = game.settings.get(MODULE_ID, "projectId");
      return !!(apiKey && projectId);
    },
    callback: async (li) => {
      const actorId = li.data("documentId") ?? li.data("entityId");
      if (!actorId) {
        ui.notifications.error("[KiteFrost] Could not determine actor ID.");
        return;
      }
      const actor = game.actors?.get(actorId);
      if (!actor) {
        ui.notifications.error("[KiteFrost] Actor not found.");
        return;
      }
      await generateNpcDialogue(actor);
    },
  });
});
