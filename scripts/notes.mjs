/**
 * KiteFrost Foundry VTT Module - notes check and session brief (pack-audience DECISION 1a).
 *
 * The GM's journal is their notes. Both actions send the world's journal TEXT pages as
 * markdown notes to the same endpoints the Obsidian plugin uses:
 *   - Check Notes:   POST /v1/projects/{id}/ttrpg-gm/continuity/check-notes
 *   - Session Brief: POST /v1/projects/{id}/ttrpg-gm/notes/brief  (Pro; 402 on Free)
 * Nothing is saved server-side; results show in a GM-only dialog, never in chat.
 *
 * A page's KiteFrost `note_state` flag (idea / planned / true / secret, set via the note
 * flags API) becomes frontmatter, so the server treats it exactly like an Obsidian note
 * with `note_state:` - secret pages contribute their NAME only to the brief, idea/planned
 * pages count as prep. Folder paths become note paths, so `ignoreFolders` works.
 *
 * @module notes
 */

import { postProjectJson } from "./api-client.mjs";
import { readFlags } from "./note-flags.mjs";

/** Server limits (NotesUploadRequest): 500 notes, 100,000 characters per note. */
export const MAX_NOTES = 500;
export const MAX_NOTE_CHARS = 100_000;

const _ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Journal page HTML -> plain markdown-ish text. Pure (no DOM), so it runs in tests too. */
export function htmlToText(html) {
  let s = String(html ?? "");
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n${"#".repeat(Number(n))} `);
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr|table|section)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => _ENTITIES[m]);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function _folderPath(folder) {
  const parts = [];
  for (let f = folder; f; f = f.folder) parts.unshift(f.name);
  return parts;
}

function _safe(segment) {
  return String(segment ?? "").replace(/[\\/]/g, "-").trim() || "Untitled";
}

/** One text page as an upload note `{name, text}`, or null for an empty / non-text page. */
export function pageToNote(journal, page) {
  if (page?.type && page.type !== "text") return null;
  const body = htmlToText(page?.text?.content ?? "");
  const state = readFlags(page).note_state;
  if (!body && !state) return null;
  const path = [..._folderPath(journal?.folder), journal?.name, page?.name].map(_safe).join("/");
  const front = state ? `---\nnote_state: ${state}\n---\n` : "";
  const heading = `# ${_safe(page?.name)}\n\n`;
  return { name: `${path}.md`.slice(0, 300), text: (front + heading + body).slice(0, MAX_NOTE_CHARS) };
}

/**
 * Every text page in the given journals as upload notes, capped at MAX_NOTES.
 * @returns {{notes: Array<{name: string, text: string}>, skipped: number}}
 */
export function collectNotes(journals) {
  const all = [];
  for (const journal of journals ?? []) {
    for (const page of journal?.pages ?? []) {
      const note = pageToNote(journal, page);
      if (note) all.push(note);
    }
  }
  return { notes: all.slice(0, MAX_NOTES), skipped: Math.max(0, all.length - MAX_NOTES) };
}

function _payload(options) {
  const { notes, skipped } = collectNotes(options.journals ?? game.journal?.contents ?? []);
  if (!notes.length) throw new Error("[KiteFrost] No journal text pages to send.");
  return { body: { notes, ignore_folders: options.ignoreFolders ?? [] }, skipped };
}

/** Check the journal against the project's quest/NPC records (and notes against each other). */
export async function checkNotes(options = {}) {
  const { body, skipped } = _payload(options);
  const result = await postProjectJson((projectId) => `/v1/projects/${projectId}/ttrpg-gm/continuity/check-notes`, body);
  return { ...result, pages_not_sent: skipped };
}

/** Pre-session brief from the journal. Pro feature: rejects with the API's 402 message on Free. */
export async function sessionBrief(options = {}) {
  const { body, skipped } = _payload(options);
  const result = await postProjectJson((projectId) => `/v1/projects/${projectId}/ttrpg-gm/notes/brief`, body);
  return { ...result, pages_not_sent: skipped };
}

// ---------------------------------------------------------------------------
// GM-only result dialogs. Every server string is escaped (R12: model output is untrusted).
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function _list(items, fmt) {
  if (!items?.length) return "<p><em>None.</em></p>";
  return `<ul>${items.map((i) => `<li>${fmt(i)}</li>`).join("")}</ul>`;
}

function _footer(r) {
  const bits = [];
  if (r.left_out?.length) bits.push(`Left out to fit the reading budget: ${escapeHtml(r.left_out.join(", "))}`);
  if (r.pages_not_sent) bits.push(`${r.pages_not_sent} page(s) not sent (limit ${MAX_NOTES}).`);
  if (r.unjudged?.length) bits.push(`Not judged: ${escapeHtml(r.unjudged.join(", "))}`);
  return bits.length ? `<p class="notes"><small>${bits.join("<br>")}</small></p>` : "";
}

export function renderCheck(r) {
  if (!r.evaluated) {
    return `<p>Nothing could be compared, so this is <strong>not</strong> a clean result.</p>${_footer(r)}`;
  }
  const findings = _list(r.findings, (f) => {
    const where = f.note ? ` <small>(${escapeHtml(f.note)}${f.other_note ? ` vs ${escapeHtml(f.other_note)}` : ""})</small>` : "";
    const fix = f.fix ? `<br><em>Fix:</em> ${escapeHtml(f.fix)}` : "";
    return `<strong>${escapeHtml(f.name)}</strong>: ${escapeHtml(f.message)}${where}<br>"${escapeHtml(f.quote)}"${fix}`;
  });
  return `<p>${r.claims_found} statement(s) checked, ${r.findings?.length ?? 0} problem(s).</p>${findings}${_footer(r)}`;
}

export function renderBrief(r) {
  const b = r.brief;
  if (!b) return `<p>Nothing to brief from these notes.</p>${_footer(r)}`;
  const item = (i) => `${escapeHtml(i.text)} <small>(${escapeHtml(i.from ?? i.source ?? "")})</small>`;
  const sections = [
    ["Story so far", _list(b.story_so_far, item)],
    ["Open threads", _list(b.open_threads, item)],
    ["What characters want", _list(b.character_goals, item)],
    ["Coming up", _list(b.coming_up, item)],
    ["Not revealed yet", _list(b.not_revealed_yet, escapeHtml)],
    ["Notes that disagree", _list(b.notes_disagree, (f) => `<strong>${escapeHtml(f.name)}</strong>: ${escapeHtml(f.message)}`)],
  ];
  return sections.map(([h, body]) => `<h3>${h}</h3>${body}`).join("") + _footer(r);
}

function _show(title, content) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2) return DialogV2.prompt({ window: { title }, content, ok: { label: "Close" }, rejectClose: false });
  return new Dialog({ title, content, buttons: { ok: { label: "Close" } } }).render(true);
}

/** Journal-sidebar button handlers: run, show the result, notify on failure. */
export async function runCheckNotesUi() {
  ui.notifications.info("[KiteFrost] Checking your journal...");
  try {
    await _show("KiteFrost: Check Notes", renderCheck(await checkNotes()));
  } catch (err) {
    ui.notifications.error(err.message);
  }
}

export async function runSessionBriefUi() {
  ui.notifications.info("[KiteFrost] Building the session brief...");
  try {
    await _show("KiteFrost: Session Brief", renderBrief(await sessionBrief()));
  } catch (err) {
    ui.notifications.error(err.message);
  }
}
