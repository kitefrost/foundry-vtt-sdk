/**
 * Module settings registration for KiteFrost.
 *
 * Settings (scopes per D-R4.6; apiKey is client-scoped so it never leaves
 * the GM's browser, the rest are world-scoped):
 *   - apiUrl:   Base URL of the KiteFrost API
 *   - apiKey:   Bearer token (publishable key, pk_...)
 *   - projectId: The project ID to use for all calls
 *   - defaultTone: Default NPC dialogue tone
 */

export const MODULE_ID = "kitefrost";

/**
 * Register all module settings with Foundry's settings API.
 * Called once from main.mjs Hooks.on("init", ...).
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, "apiUrl", {
    name: "API URL",
    hint: "Base URL of the KiteFrost API (e.g. https://api.kitefrost.ai).",
    scope: "world",
    config: true,
    type: String,
    default: "https://api.kitefrost.ai",
  });

  game.settings.register(MODULE_ID, "apiKey", {
    name: "API Key",
    hint: "Your KiteFrost API key (sk_...). Dashboard -> your project -> API Keys -> New API Key. Stored only in this browser.",
    scope: "client",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "projectId", {
    name: "Project ID",
    hint: "The Project ID to use for NPC dialogue generation.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "defaultTone", {
    name: "Default Tone",
    hint: "Default emotional tone for generated NPC dialogue.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      neutral: "Neutral",
      friendly: "Friendly",
      hostile: "Hostile",
      cautious: "Cautious",
      suspicious: "Suspicious",
      fearful: "Fearful",
      excited: "Excited",
    },
    default: "neutral",
  });
}

/**
 * Retrieve a setting value.
 * @param {string} key - Setting key (apiUrl, apiKey, projectId, defaultTone)
 * @returns {*} The setting value.
 */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
