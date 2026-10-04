/**
 * GM vault <-> Foundry: small facts flow back (gm-vault-foundry-sync D1-D4).
 *
 * The GM's vault stays the master copy of the TEXT; it is exported one way into journal
 * pages by the GM's own tool. Only small, structured facts live on the page as flags under
 * this module's namespace and can be read back by that tool:
 *   - note_state          idea | planned | true | secret            (gm-note-state values)
 *   - in_world_date       { label, sort_key }  - label is display text, sort_key is the
 *                         GM's own order (a number or ISO-like string); month names are
 *                         never parsed (TCE-3a)
 *   - shown_to_players_at ISO time a page was shown - presentation HISTORY only; it never
 *                         changes note_state or any NPC's "known to players" (D2)
 *   - content_hash        fingerprint of the page content AS FOUNDRY STORED IT (after its
 *                         sanitiser), so the exporter can tell "edited in Foundry" from
 *                         "untouched" before it overwrites a page (D3)
 *
 * The pure helpers below take plain values so they are testable outside Foundry.
 *
 * @module note-flags
 */

import { MODULE_ID } from "./settings.mjs";

export const NOTE_STATES = Object.freeze(["idea", "planned", "true", "secret"]);
const FLAG_KEYS = Object.freeze(["note_state", "in_world_date", "shown_to_players_at", "content_hash"]);

/** Stable 32-bit FNV-1a hash of a string, as 8 hex chars (no crypto needed: a change detector). */
export function contentFingerprint(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Validate + normalise a flag patch; throws on an unknown key or bad value. */
export function normaliseFlags(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!FLAG_KEYS.includes(k)) throw new Error(`[KiteFrost] Unknown note flag: ${k}`);
    if (k === "note_state") {
      const s = String(v).trim().toLowerCase();
      if (!NOTE_STATES.includes(s)) throw new Error(`[KiteFrost] note_state must be one of ${NOTE_STATES.join(", ")}`);
      out[k] = s;
    } else if (k === "in_world_date") {
      if (v === null) {
        out[k] = null;
        continue;
      }
      const label = String(v?.label ?? "").trim();
      const sortKey = v?.sort_key;
      if (!label) throw new Error("[KiteFrost] in_world_date.label is required");
      if (!(typeof sortKey === "number" || (typeof sortKey === "string" && sortKey.trim()))) {
        throw new Error("[KiteFrost] in_world_date.sort_key must be a number or a non-empty string");
      }
      out[k] = { label: label.slice(0, 100), sort_key: sortKey };
    } else {
      out[k] = v === null ? null : String(v);
    }
  }
  return out;
}

/** The page's KiteFrost flags as a plain object (missing keys omitted). */
export function readFlags(page) {
  const out = {};
  for (const k of FLAG_KEYS) {
    const v = page?.getFlag?.(MODULE_ID, k);
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** Write a validated flag patch onto a journal page. */
export async function writeFlags(page, patch) {
  const clean = normaliseFlags(patch);
  for (const [k, v] of Object.entries(clean)) {
    if (v === null) await page.unsetFlag(MODULE_ID, k);
    else await page.setFlag(MODULE_ID, k, v);
  }
  return readFlags(page);
}

/** Record that the page was shown to players (history only - D2). */
export async function markShown(page, when = new Date()) {
  return writeFlags(page, { shown_to_players_at: when.toISOString() });
}

/** Fingerprint the page content as Foundry stored it, and remember it (D3). */
export async function stampContent(page) {
  return writeFlags(page, { content_hash: contentFingerprint(page?.text?.content ?? "") });
}

/** True when the stored page content no longer matches the last stamp (edited in Foundry). */
export function editedSinceStamp(page) {
  const stamp = page?.getFlag?.(MODULE_ID, "content_hash");
  if (!stamp) return false;
  return contentFingerprint(page?.text?.content ?? "") !== stamp;
}

/**
 * Every journal page that carries KiteFrost flags, for the GM's vault tool to read back.
 * Shape: [{journal, page, page_id, flags, edited_in_foundry}], sorted by in-world sort key
 * (pages without a date last), then by name.
 */
export function collectFlags(journals) {
  const rows = [];
  for (const journal of journals ?? []) {
    for (const page of journal?.pages ?? []) {
      const flags = readFlags(page);
      if (!Object.keys(flags).length) continue;
      rows.push({
        journal: journal.name,
        page: page.name,
        page_id: page.id,
        flags,
        edited_in_foundry: editedSinceStamp(page),
      });
    }
  }
  const key = (r) => r.flags.in_world_date?.sort_key;
  return rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === undefined && kb !== undefined) return 1;
    if (kb === undefined && ka !== undefined) return -1;
    if (ka !== undefined && kb !== undefined && ka !== kb) return String(ka).localeCompare(String(kb), undefined, { numeric: true });
    return `${a.journal}/${a.page}`.localeCompare(`${b.journal}/${b.page}`);
  });
}
