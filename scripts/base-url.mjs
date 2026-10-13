/**
 * KiteFrost Foundry VTT Module - API URL check (FND-20261012-F0C).
 *
 * Whatever host the "API URL" setting names receives the pairing code, the minted
 * sk_ key and the bearer on every call, so it is checked before any fetch - the same
 * rules as the Python/TS SDK cores (docs/design/concepts/sdk-portfolio/design.md R-BUT):
 *   - https only; plain http only to localhost or a literal loopback IP (parsed, never a
 *     "127." prefix - "127.evil.example" is a DNS name that resolves anywhere)
 *   - no user:pass@ part ("https://api.kitefrost.ai@evil.example" goes to evil.example)
 *   - a host outside kitefrost.ai / loopback is allowed (self-hosted, proxies) but
 *     announced once per host with a Foundry notification naming the REAL host
 */

const _warnedHosts = new Set();

function _isLoopback(host) {
  if (host === "localhost") return true;
  const v4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) return v4[1] === "127";
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1);
    return v6 === "::1" || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
  }
  return false;
}

/**
 * Validate the API URL; throw before anything is sent to an unsafe one.
 * @param {string} url
 * @returns {string} the URL without a trailing slash
 */
export function checkApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("[KiteFrost] API URL is not a valid URL. Check Module Settings.");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("[KiteFrost] API URL has no host. Check Module Settings.");
  if (parsed.username || parsed.password) {
    throw new Error(`[KiteFrost] API URL must not contain a user name or password (it would send your key to "${host}").`);
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && _isLoopback(host))) {
    throw new Error("[KiteFrost] API URL must start with https:// (plain http only for a local server). Check Module Settings.");
  }
  if (host !== "kitefrost.ai" && !host.endsWith(".kitefrost.ai") && !_isLoopback(host) && !_warnedHosts.has(host)) {
    _warnedHosts.add(host);
    globalThis.ui?.notifications?.warn(
      `KiteFrost: your API key is being sent to "${host}", which is not a kitefrost.ai address. Change API URL in Module Settings unless you trust that server.`,
    );
  }
  return url.replace(/\/+$/, "");
}

/** Test hook: forget which foreign hosts were announced. */
export function _resetApiUrlWarnings() {
  _warnedHosts.clear();
}
