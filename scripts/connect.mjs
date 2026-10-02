/**
 * Foundry Connect - pair this module with a KiteFrost project using a one-time code.
 *
 * The GM clicks "Connect Foundry VTT" in the KiteFrost dashboard, gets a code like
 * K7QM-X2PD, and types it here. The server returns a key limited to NPC dialogue
 * for that one project; we save it (client scope, this browser only) together with
 * the project ID. No API key or project ID is ever copied by hand.
 *
 * Calls: POST {apiUrl}/v1/foundry/pair   (no auth - the code is the credential)
 * Design: docs/design/concepts/foundry-connect-pairing/README.md (D8)
 *
 * @module connect
 */

import { MODULE_ID, getSetting } from "./settings.mjs";

/**
 * Exchange a pairing code for a key and save the module settings.
 * @param {string} code - The code as the GM typed it (case, spaces and dashes are fine)
 * @returns {Promise<{projectId: string, keyPrefix: string}>}
 */
export async function claimPairingCode(code) {
  const trimmed = (code ?? "").trim();
  if (!trimmed) throw new Error("[KiteFrost] Enter the code shown in the KiteFrost dashboard.");
  const apiUrl = getSetting("apiUrl")?.trim().replace(/\/+$/, "");
  if (!apiUrl) throw new Error("[KiteFrost] API URL is not configured. Check Module Settings.");

  let response;
  try {
    response = await fetch(`${apiUrl}/v1/foundry/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmed }),
    });
  } catch (err) {
    throw new Error(`[KiteFrost] Could not reach KiteFrost: ${err.message}`);
  }

  if (response.status === 404) {
    throw new Error("[KiteFrost] That code is wrong or has expired. Create a new one in the dashboard.");
  }
  if (response.status === 429) {
    throw new Error("[KiteFrost] Too many attempts. Wait 10 minutes and try a new code.");
  }
  if (!response.ok) {
    throw new Error(`[KiteFrost] Connecting failed (HTTP ${response.status}). Try again in a minute.`);
  }

  const data = await response.json();
  await game.settings.set(MODULE_ID, "apiKey", data.api_key);
  await game.settings.set(MODULE_ID, "projectId", data.project_id);
  return { projectId: data.project_id, keyPrefix: data.key_prefix };
}

/** Prompt for the code, claim it, and report the result to the GM. */
export function openConnectDialog() {
  const content = `
    <form>
      <p>In the KiteFrost dashboard, open your campaign's <b>API Keys</b> page and click
      <b>Connect Foundry VTT</b>. Type the code it shows here.</p>
      <div class="form-group">
        <label>Code</label>
        <input type="text" name="pairingCode" placeholder="XXXX-XXXX" autocomplete="off" />
      </div>
    </form>
  `;
  new Dialog({
    title: "Connect to KiteFrost",
    content,
    buttons: {
      connect: {
        icon: '<i class="fas fa-link"></i>',
        label: "Connect",
        callback: async (html) => {
          try {
            await claimPairingCode(html.find('[name="pairingCode"]').val());
            ui.notifications.info("[KiteFrost] Connected. Right-click an NPC and choose AI: Generate Dialogue.");
          } catch (err) {
            ui.notifications.error(err.message);
          }
        },
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" },
    },
    default: "connect",
  }).render(true);
}

// registerMenu requires an Application subclass; ApplicationV2 on v13+, a plain base
// class when loaded outside Foundry (tests).
const MenuBase = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};

/**
 * Settings-menu target: opens the connect dialog instead of rendering its own form.
 */
export class ConnectMenu extends MenuBase {
  render() {
    openConnectDialog();
    return this;
  }
}
