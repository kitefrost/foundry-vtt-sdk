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
 *   - getJournalEntryContextOptions: note flags (mark shown, export) - gm-vault-foundry-sync
 *
 * @module main
 */

import { buildApi } from "./api.mjs";
import { registerSettings, MODULE_ID } from "./settings.mjs";
import { generateNpcDialogue, registerReportIssueHandler } from "./npc-dialogue.mjs";
import { collectFlags, markShown } from "./note-flags.mjs";
import { runCheckNotesUi, runSessionBriefUi } from "./notes.mjs";

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

// ---------------------------------------------------------------------------
// getJournalEntryContextOptions - note flags (gm-vault-foundry-sync)
// ---------------------------------------------------------------------------

/**
 * Journal right-click entries (GM only, no API key needed - flags stay in this world):
 *   - "KiteFrost: Mark Shown To Players" stamps shown_to_players_at on every page of the
 *     entry (presentation history; never changes note_state - D2).
 *   - "KiteFrost: Export Note Flags" downloads every flagged page in the world as JSON for
 *     the GM's own vault tool to read back (D4). The text itself is never exported back.
 */
Hooks.on("getJournalEntryContextOptions", (_app, options) => {
  if (!game.user?.isGM) return;
  const entryFrom = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset?.entryId ?? el?.closest?.("[data-entry-id]")?.dataset?.entryId;
    return id ? game.journal.get(id) : null;
  };
  const markShownClick = async (_event, li) => {
    const entry = entryFrom(li);
    if (!entry) return;
    for (const page of entry.pages ?? []) await markShown(page);
    ui.notifications.info(`[KiteFrost] Marked "${entry.name}" as shown to players.`);
  };
  const exportClick = async () => {
    const rows = collectFlags(game.journal?.contents ?? []);
    const data = JSON.stringify({ exported_at: new Date().toISOString(), pages: rows }, null, 2);
    saveDataToFile(data, "application/json", "kitefrost-note-flags.json");
    ui.notifications.info(`[KiteFrost] Exported flags for ${rows.length} page(s).`);
  };
  const isV14 = Number(game.release?.generation ?? 0) >= 14;
  const always = () => true;
  const entries = [
    ["KiteFrost: Mark Shown To Players", "fas fa-eye", markShownClick],
    ["KiteFrost: Export Note Flags", "fas fa-file-export", exportClick],
  ];
  for (const [label, icon, onClick] of entries) {
    options.push(
      isV14
        ? { label, icon: `<i class="${icon}"></i>`, visible: always, onClick }
        : { name: label, icon: `<i class="${icon}"></i>`, condition: always, callback: (li) => onClick(null, li) },
    );
  }
});

// ---------------------------------------------------------------------------
// renderJournalDirectory - "Check Notes" + "Session Brief" (pack-audience DECISION 1a)
// ---------------------------------------------------------------------------

/**
 * Two GM-only buttons in the Journal sidebar header. Both send the world's journal text
 * pages to the API (notes.mjs) and show the result in a dialog only the GM sees. Hidden
 * until an API key and project are set. v13+ passes an HTMLElement; jQuery is unwrapped.
 */
Hooks.on("renderJournalDirectory", (_app, html) => {
  if (!game.user?.isGM) return;
  if (!(game.settings.get(MODULE_ID, "apiKey") && game.settings.get(MODULE_ID, "projectId"))) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const bar = root?.querySelector?.(".header-actions") ?? root?.querySelector?.(".directory-header");
  if (!bar || bar.querySelector(".kitefrost-notes")) return;
  for (const [label, icon, onClick] of [
    ["Check Notes", "fas fa-spell-check", runCheckNotesUi],
    ["Session Brief", "fas fa-scroll", runSessionBriefUi],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kitefrost-notes";
    button.innerHTML = `<i class="${icon}"></i> ${label}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
    bar.append(button);
  }
});
