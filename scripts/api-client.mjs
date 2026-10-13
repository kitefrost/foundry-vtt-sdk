/**
 * HTTP client for the KiteFrost Quick Dialogue endpoint.
 *
 * Calls: POST {apiUrl}/v1/projects/{projectId}/quick-dialogue
 *
 * Note on naming: the API path segment is `projects` and the setting
 * surfaced to GMs is labelled "Project ID". We use "Project" rather
 * than "Project" because Foundry VTT already has its own native concept
 * called "Project" (`game.project`, `ProjectConfig`), and overloading that
 * term would be confusing for GMs.
 *
 * Uses Foundry's native fetch() (runs in browser context).
 *
 * @module api-client
 */

import { checkApiUrl } from "./base-url.mjs";
import { getSetting } from "./settings.mjs";

/**
 * @typedef {Object} QuickDialogueRequest
 * @property {string} npc_name       - NPC display name
 * @property {string|Object} npc_context - Free-text or structured NPC context
 * @property {string} [situation]    - GM-provided scene context
 * @property {string} [tone]         - Desired tone (neutral, cautious, hostile, ...)
 * @property {string} player_message - What the player said
 * @property {string} [game_system]  - Game system slug (dnd5e, pf2e)
 */

/**
 * @typedef {Object} QuickDialogueResponse
 * @property {string}   dialogue          - NPC's spoken words
 * @property {string}   mood              - NPC's emotional state
 * @property {string}   stage_direction   - Behavioural description for the GM
 * @property {string[]} suggested_actions - Follow-up action hints
 */

/**
 * API error bodies carry `detail` as a string OR an object/array (FastAPI
 * validation errors, `{code, message}` envelopes). Never interpolate it raw -
 * that shows the GM "[object Object]".
 */
function _detailText(d) {
  if (d == null || d === "") return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg ?? _detailText(x)).filter(Boolean).join("; ");
  if (typeof d === "object") return d.message ?? d.msg ?? d.error ?? d.code ?? JSON.stringify(d);
  return String(d);
}

/**
 * Call the Quick Dialogue endpoint and return the parsed response.
 *
 * @param {QuickDialogueRequest} requestBody
 * @returns {Promise<QuickDialogueResponse>}
 * @throws {Error} On network failure, bad status, or missing configuration
 */
export async function generateDialogue(requestBody) {
  const apiUrl = getSetting("apiUrl")?.trim();
  const apiKey = getSetting("apiKey")?.trim();
  const projectId = getSetting("projectId")?.trim();

  if (!apiUrl) throw new Error("[KiteFrost] API URL is not configured. Check Module Settings.");
  if (!apiKey) throw new Error("[KiteFrost] API Key is not configured. Check Module Settings.");
  if (!projectId) throw new Error("[KiteFrost] Project ID is not configured. Check Module Settings.");

  const url = `${checkApiUrl(apiUrl)}/v1/projects/${projectId}/quick-dialogue`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // No X-Tenant-ID: the API resolves the tenant from the key and 404s a
        // header that differs from it (a project id always does) - FND-20260926-B41.
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    throw new Error(`[KiteFrost] Network error: ${networkErr.message}`);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errorBody = await response.json();
      detail = _detailText(errorBody.detail ?? errorBody.error) || detail;
    } catch (_) {
      // ignore JSON parse failure, use statusText
    }
    throw new Error(`[KiteFrost] API error ${response.status}: ${detail}`);
  }

  return /** @type {QuickDialogueResponse} */ (await response.json());
}

/**
 * @typedef {Object} ReportIssueRequest
 * @property {string} run_id        - The run/session ID
 * @property {string} severity      - low | medium | high | critical
 * @property {string} category      - hallucination | inconsistency | crash | quality | safety | other
 * @property {string} description   - Description of the issue
 * @property {string} [expected]    - What the user expected
 * @property {string} [actual]      - What actually happened
 * @property {Object} [metadata]    - Additional context (actor info, platform, etc.)
 */

/**
 * @typedef {Object} ReportIssueResponse
 * @property {string} status      - "accepted"
 * @property {string} feedback_id - Short copyable token (e.g. "FB-a7x9k2m4")
 * @property {string} report_id   - Internal report identifier
 */

/**
 * Submit an issue report to the /v1/projects/{projectId}/feedback/report endpoint.
 *
 * @param {ReportIssueRequest} reportBody
 * @returns {Promise<ReportIssueResponse>}
 * @throws {Error} On network failure, bad status, or missing configuration
 */
export async function reportIssue(reportBody) {
  const apiUrl = getSetting("apiUrl")?.trim();
  const apiKey = getSetting("apiKey")?.trim();
  const projectId = getSetting("projectId")?.trim();

  if (!apiUrl) throw new Error("[KiteFrost] API URL is not configured. Check Module Settings.");
  if (!apiKey) throw new Error("[KiteFrost] API Key is not configured. Check Module Settings.");
  if (!projectId) throw new Error("[KiteFrost] Project ID is not configured. Check Module Settings.");

  const url = `${checkApiUrl(apiUrl)}/v1/projects/${projectId}/feedback/report`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reportBody),
    });
  } catch (networkErr) {
    throw new Error(`[KiteFrost] Network error: ${networkErr.message}`);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errorBody = await response.json();
      detail = _detailText(errorBody.detail ?? errorBody.error) || detail;
    } catch (_) {
      // ignore JSON parse failure, use statusText
    }
    throw new Error(`[KiteFrost] API error ${response.status}: ${detail}`);
  }

  return /** @type {ReportIssueResponse} */ (await response.json());
}

/**
 * POST a JSON body to `{apiUrl}` + `pathFor(projectId)` and return the parsed
 * response - the notes check and session brief (notes.mjs). Same URL check and error
 * shape as the calls above. A 403 here almost always means a key from before notes
 * access was part of "Connect with a code", so the message says how to fix it.
 *
 * @param {(projectId: string) => string} pathFor - the full path, written out at the call site
 *   (scripts/check-sdk-parity.py reads endpoint paths from the source, so no generic path)
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function postProjectJson(pathFor, body) {
  const apiUrl = getSetting("apiUrl")?.trim();
  const apiKey = getSetting("apiKey")?.trim();
  const projectId = getSetting("projectId")?.trim();

  if (!apiUrl) throw new Error("[KiteFrost] API URL is not configured. Check Module Settings.");
  if (!apiKey) throw new Error("[KiteFrost] API Key is not configured. Check Module Settings.");
  if (!projectId) throw new Error("[KiteFrost] Project ID is not configured. Check Module Settings.");

  const url = `${checkApiUrl(apiUrl)}${pathFor(projectId)}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`[KiteFrost] Network error: ${networkErr.message}`);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errorBody = await response.json();
      detail = _detailText(errorBody.detail ?? errorBody.error) || detail;
    } catch (_) {
      // ignore JSON parse failure, use statusText
    }
    if (response.status === 403) {
      detail += ' - this key cannot read notes. Use "Connect with a code" in Module Settings again to get one that can.';
    }
    throw new Error(`[KiteFrost] API error ${response.status}: ${detail}`);
  }

  return await response.json();
}
