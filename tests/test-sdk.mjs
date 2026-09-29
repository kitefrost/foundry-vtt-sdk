/**
 * KiteFrost - Foundry VTT SDK Tests
 *
 * Runs in Node.js (no Jest). Uses built-in assert module.
 * Mocks the Foundry globals (game, ui, ChatMessage, Hooks, Dialog, CONST,
 * renderTemplate) that the SDK assumes exist at module load time.
 */

import assert from "assert";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Global Foundry mocks - must be set before importing SDK modules
// ---------------------------------------------------------------------------

const _settingsStore = {};

globalThis.game = {
  settings: {
    register: (moduleId, key, options) => {
      _settingsStore[`${moduleId}.${key}`] = options.default;
    },
    get: (moduleId, key) => _settingsStore[`${moduleId}.${key}`],
    set: (moduleId, key, value) => {
      _settingsStore[`${moduleId}.${key}`] = value;
    },
  },
  system: { id: "dnd5e" },
  user: { isGM: true },
  actors: {
    get: (id) => null,
  },
};

globalThis.ui = {
  notifications: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

globalThis.ChatMessage = {
  getSpeaker: (opts) => ({ alias: opts?.actor?.name ?? "Unknown" }),
  // Mirrors Foundry v12+ validation: `type` is a document SUBTYPE string; a
  // numeric presentation value belongs in `style` (design R9). dnd5e rejects it.
  create: async (data) => {
    if (data && "type" in data && typeof data.type !== "string") {
      throw new Error(`type: "${data.type}" is not a valid type for the ChatMessage Document class`);
    }
    return data;
  },
};

globalThis.Hooks = {
  on: (event, fn) => {},
};

globalThis.Dialog = class Dialog {
  constructor(opts) {
    this._opts = opts;
  }
  render() {}
};

globalThis.CONST = {
  CHAT_MESSAGE_STYLES: { OTHER: 0 },
  CHAT_MESSAGE_TYPES: { OTHER: 0 },
};

globalThis.renderTemplate = async (path, data) => {
  return `<div>${JSON.stringify(data)}</div>`;
};

// fetch mock - configurable per test
let _fetchMock = null;
globalThis.fetch = async (url, opts) => {
  if (_fetchMock) return _fetchMock(url, opts);
  throw new Error("fetch not configured for this test");
};

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`        ${err.message}`);
    failed++;
    failures.push({ name, err });
  }
}

// ---------------------------------------------------------------------------
// Suite 1: settings.mjs
// ---------------------------------------------------------------------------

console.log("\n--- Suite: settings.mjs ---");

const { MODULE_ID, registerSettings, getSetting } =
  await import(join(sdkRoot, "scripts/settings.mjs"));

await test("MODULE_ID is exported and non-empty", () => {
  assert.ok(MODULE_ID, "MODULE_ID should be a non-empty string");
  assert.strictEqual(typeof MODULE_ID, "string");
});

await test("registerSettings is a function", () => {
  assert.strictEqual(typeof registerSettings, "function");
});

await test("getSetting is a function", () => {
  assert.strictEqual(typeof getSetting, "function");
});

await test("registerSettings registers apiUrl with correct default", () => {
  registerSettings();
  const val = getSetting("apiUrl");
  assert.ok(val, "apiUrl default should be non-empty");
  assert.ok(val.startsWith("https://"), `apiUrl should start with https://, got: ${val}`);
});

await test("registerSettings registers apiKey with empty default", () => {
  const val = getSetting("apiKey");
  assert.strictEqual(val, "", "apiKey default should be empty string");
});

await test("registerSettings registers projectId with empty default", () => {
  const val = getSetting("projectId");
  assert.strictEqual(val, "", "projectId default should be empty string");
});

await test("registerSettings registers defaultTone with 'neutral' default", () => {
  const val = getSetting("defaultTone");
  assert.strictEqual(val, "neutral");
});

await test("getSetting returns updated value after set", () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://custom.example.com");
  assert.strictEqual(getSetting("apiUrl"), "https://custom.example.com");
});

// ---------------------------------------------------------------------------
// Suite 2: api-client.mjs
// ---------------------------------------------------------------------------

console.log("\n--- Suite: api-client.mjs ---");

const { generateDialogue } =
  await import(join(sdkRoot, "scripts/api-client.mjs"));

await test("generateDialogue is exported as a function", () => {
  assert.strictEqual(typeof generateDialogue, "function");
});

await test("generateDialogue throws if apiUrl is not configured", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_abc");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  try {
    await generateDialogue({ npc_name: "Test", player_message: "Hello" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(
      err.message.includes("API URL"),
      `Expected 'API URL' in error, got: ${err.message}`
    );
  }
});

await test("generateDialogue throws if apiKey is not configured", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  try {
    await generateDialogue({ npc_name: "Test", player_message: "Hello" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(
      err.message.includes("API Key"),
      `Expected 'API Key' in error, got: ${err.message}`
    );
  }
});

await test("generateDialogue throws if projectId is not configured", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_abc");
  game.settings.set(MODULE_ID, "projectId", "");

  try {
    await generateDialogue({ npc_name: "Test", player_message: "Hello" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(
      err.message.includes("Project ID"),
      `Expected 'Project ID' in error, got: ${err.message}`
    );
  }
});

await test("generateDialogue calls fetch with correct URL structure", async () => {
  const apiUrl = "https://api.example.com";
  const projectId = "proj_abc123";
  game.settings.set(MODULE_ID, "apiUrl", apiUrl);
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", projectId);

  let capturedUrl;
  _fetchMock = async (url, opts) => {
    capturedUrl = url;
    return {
      ok: true,
      json: async () => ({
        dialogue: "Hello adventurer",
        mood: "neutral",
        stage_direction: "speaks calmly",
        suggested_actions: ["ask_quest"],
      }),
    };
  };

  await generateDialogue({ npc_name: "Guard", player_message: "Hello" });

  assert.strictEqual(
    capturedUrl,
    `${apiUrl}/v1/projects/${projectId}/quick-dialogue`
  );
});

await test("generateDialogue uses POST method", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  let capturedMethod;
  _fetchMock = async (url, opts) => {
    capturedMethod = opts.method;
    return {
      ok: true,
      json: async () => ({ dialogue: "", mood: "", stage_direction: "", suggested_actions: [] }),
    };
  };

  await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
  assert.strictEqual(capturedMethod, "POST");
});

await test("generateDialogue sends Content-Type: application/json header", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  let capturedHeaders;
  _fetchMock = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true,
      json: async () => ({ dialogue: "", mood: "", stage_direction: "", suggested_actions: [] }),
    };
  };

  await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
  assert.strictEqual(capturedHeaders["Content-Type"], "application/json");
});

await test("generateDialogue sends Authorization Bearer header", async () => {
  const apiKey = "pk_test_bearer_check";
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", apiKey);
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  let capturedHeaders;
  _fetchMock = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true,
      json: async () => ({ dialogue: "", mood: "", stage_direction: "", suggested_actions: [] }),
    };
  };

  await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
  assert.strictEqual(capturedHeaders["Authorization"], `Bearer ${apiKey}`);
});

// FND-20260926-B41: the API checks X-Tenant-ID against the KEY's tenant and answers
// 404 on a mismatch. A project id is never the tenant id, so sending it broke every
// call on staging (probed 2026-09-26). The project travels in the URL path only.
await test("generateDialogue sends NO X-Tenant-ID header (project id is in the URL)", async () => {
  const projectId = "proj_tenant_check";
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", projectId);

  let capturedHeaders;
  _fetchMock = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true,
      json: async () => ({ dialogue: "", mood: "", stage_direction: "", suggested_actions: [] }),
    };
  };

  await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
  assert.strictEqual(capturedHeaders["X-Tenant-ID"], undefined);
});

await test("generateDialogue serializes requestBody as JSON in body", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  let capturedBody;
  _fetchMock = async (url, opts) => {
    capturedBody = opts.body;
    return {
      ok: true,
      json: async () => ({ dialogue: "", mood: "", stage_direction: "", suggested_actions: [] }),
    };
  };

  const req = { npc_name: "Merchant", player_message: "What do you sell?", tone: "neutral" };
  await generateDialogue(req);

  const parsed = JSON.parse(capturedBody);
  assert.strictEqual(parsed.npc_name, "Merchant");
  assert.strictEqual(parsed.player_message, "What do you sell?");
});

await test("generateDialogue returns parsed response object", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  const mockResponse = {
    dialogue: "Welcome, traveller.",
    mood: "friendly",
    stage_direction: "smiles warmly",
    suggested_actions: ["buy_goods", "ask_rumors"],
  };

  _fetchMock = async (url, opts) => ({
    ok: true,
    json: async () => mockResponse,
  });

  const result = await generateDialogue({ npc_name: "Merchant", player_message: "Hello" });
  assert.strictEqual(result.dialogue, mockResponse.dialogue);
  assert.strictEqual(result.mood, mockResponse.mood);
  assert.strictEqual(result.stage_direction, mockResponse.stage_direction);
  assert.deepStrictEqual(result.suggested_actions, mockResponse.suggested_actions);
});

await test("generateDialogue throws on non-ok HTTP response", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async (url, opts) => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    json: async () => ({ detail: "Invalid API key" }),
  });

  try {
    await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("401"), `Expected 401 in error, got: ${err.message}`);
  }
});

await test("generateDialogue wraps network errors", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(
      err.message.includes("Network error") || err.message.includes("network"),
      `Expected network error, got: ${err.message}`
    );
  }
});

// ---------------------------------------------------------------------------
// Suite 2b: api-client.mjs - reportIssue()
// ---------------------------------------------------------------------------

console.log("\n--- Suite: api-client.mjs - reportIssue ---");

const { reportIssue } =
  await import(join(sdkRoot, "scripts/api-client.mjs"));

await test("reportIssue is exported as a function", () => {
  assert.strictEqual(typeof reportIssue, "function");
});

await test("reportIssue throws if apiUrl is not configured", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_abc");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  try {
    await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("API URL"), `Expected 'API URL' in error, got: ${err.message}`);
  }
});

await test("reportIssue throws if apiKey is not configured", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  try {
    await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("API Key"), `Expected 'API Key' in error, got: ${err.message}`);
  }
});

await test("reportIssue throws if projectId is not configured", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_abc");
  game.settings.set(MODULE_ID, "projectId", "");

  try {
    await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("Project ID"), `Expected 'Project ID' in error, got: ${err.message}`);
  }
});

await test("reportIssue calls correct feedback/report URL", async () => {
  const apiUrl = "https://api.example.com";
  const projectId = "proj_report_test";
  game.settings.set(MODULE_ID, "apiUrl", apiUrl);
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", projectId);

  let capturedUrl;
  _fetchMock = async (url, opts) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ status: "accepted", feedback_id: "FB-abc", report_id: "rpt-1" }) };
  };

  await reportIssue({ run_id: "r1", severity: "medium", category: "quality", description: "test report" });
  assert.strictEqual(capturedUrl, `${apiUrl}/v1/projects/${projectId}/feedback/report`);
});

await test("reportIssue sends POST with correct headers", async () => {
  const apiKey = "pk_test_report_headers";
  const projectId = "proj_001";
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", apiKey);
  game.settings.set(MODULE_ID, "projectId", projectId);

  let capturedOpts;
  _fetchMock = async (url, opts) => {
    capturedOpts = opts;
    return { ok: true, json: async () => ({ status: "accepted", feedback_id: "FB-abc", report_id: "rpt-1" }) };
  };

  await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
  assert.strictEqual(capturedOpts.method, "POST");
  assert.strictEqual(capturedOpts.headers["Content-Type"], "application/json");
  assert.strictEqual(capturedOpts.headers["Authorization"], `Bearer ${apiKey}`);
  assert.strictEqual(capturedOpts.headers["X-Tenant-ID"], undefined);
});

await test("reportIssue returns parsed response", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  const mockResp = { status: "accepted", feedback_id: "FB-xyz", report_id: "rpt-42" };
  _fetchMock = async () => ({ ok: true, json: async () => mockResp });

  const result = await reportIssue({ run_id: "r1", severity: "high", category: "crash", description: "broke" });
  assert.strictEqual(result.status, "accepted");
  assert.strictEqual(result.feedback_id, "FB-xyz");
});

await test("reportIssue throws on non-ok HTTP response", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => ({ ok: false, status: 500, statusText: "Internal Server Error", json: async () => ({ detail: "DB down" }) });

  try {
    await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("500"), `Expected 500 in error, got: ${err.message}`);
    assert.ok(err.message.includes("DB down"), `Expected 'DB down' in error, got: ${err.message}`);
  }
});

await test("reportIssue handles non-ok response with non-JSON body", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => ({
    ok: false, status: 502, statusText: "Bad Gateway",
    json: async () => { throw new Error("not json"); },
  });

  try {
    await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("502"), `Expected 502 in error, got: ${err.message}`);
    assert.ok(err.message.includes("Bad Gateway"), `Expected 'Bad Gateway' in error, got: ${err.message}`);
  }
});

await test("reportIssue wraps network errors", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => { throw new TypeError("Failed to fetch"); };

  try {
    await reportIssue({ run_id: "r1", severity: "low", category: "other", description: "test" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(
      err.message.includes("Network error") || err.message.includes("network"),
      `Expected network error, got: ${err.message}`
    );
  }
});

// Also test generateDialogue with non-JSON error body
await test("generateDialogue handles non-ok response with non-JSON body", async () => {
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => ({
    ok: false, status: 503, statusText: "Service Unavailable",
    json: async () => { throw new Error("not json"); },
  });

  try {
    await generateDialogue({ npc_name: "Guard", player_message: "Hello" });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.message.includes("503"), `Expected 503 in error, got: ${err.message}`);
    assert.ok(err.message.includes("Service Unavailable"), `Expected statusText in error, got: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Suite 3: npc-dialogue.mjs
// ---------------------------------------------------------------------------

console.log("\n--- Suite: npc-dialogue.mjs ---");

const { extractActorContext, generateNpcDialogue, showReportIssueDialog, registerReportIssueHandler } =
  await import(join(sdkRoot, "scripts/npc-dialogue.mjs"));

await test("extractActorContext is exported as a function", () => {
  assert.strictEqual(typeof extractActorContext, "function");
});

await test("generateNpcDialogue is exported as a function", () => {
  assert.strictEqual(typeof generateNpcDialogue, "function");
});

await test("extractActorContext returns npc_name and npc_context", () => {
  const mockActor = {
    name: "Aria Shadowstep",
    type: "npc",
    system: {
      details: {
        type: { value: "humanoid" },
        alignment: "neutral",
        cr: 1,
        biography: { value: "<p>A skilled rogue from the northern wastes.</p>" },
      },
      abilities: {},
    },
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);

  assert.ok(result.npc_name, "npc_name should be set");
  assert.strictEqual(result.npc_name, "Aria Shadowstep");
  assert.ok(result.npc_context, "npc_context should be set");
  assert.strictEqual(typeof result.npc_context, "object");
});

await test("extractActorContext strips HTML from biography", () => {
  const mockActor = {
    name: "Guard",
    type: "npc",
    system: {
      details: {
        biography: { value: "<p>A <strong>brave</strong> guard.</p>" },
        type: { value: "humanoid" },
        alignment: "",
        cr: null,
      },
      abilities: {},
    },
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.ok(!result.npc_context.biography.includes("<"), "biography should not contain HTML tags");
  assert.ok(result.npc_context.biography.includes("brave"), "biography should contain text content");
});

await test("extractActorContext falls back to generic for non-dnd5e systems", () => {
  const mockActor = {
    name: "Space Pirate",
    type: "npc",
    system: {
      details: {
        publicNotes: "A dangerous pirate of the outer rim.",
      },
    },
    getFlag: () => null,
  };

  game.system = { id: "starfinder" };
  const result = extractActorContext(mockActor);
  assert.strictEqual(result.npc_name, "Space Pirate");
  assert.ok(result.npc_context, "npc_context should be set for unknown system");
});

await test("extractActorContext uses 'Unknown NPC' when actor.name is null", () => {
  const mockActor = {
    name: null,
    type: "npc",
    system: { details: {}, abilities: {} },
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.strictEqual(result.npc_name, "Unknown NPC");
});

await test("extractActorContext includes abilities when present (dnd5e)", () => {
  const mockActor = {
    name: "Wizard",
    type: "npc",
    system: {
      details: {
        type: { value: "humanoid" },
        alignment: "chaotic neutral",
        cr: 5,
        biography: { value: "" },
      },
      abilities: {
        str: { value: 8 },
        dex: { value: 14 },
        con: { value: 12 },
        int: { value: 18 },
        wis: { value: 13 },
        cha: { value: 10 },
      },
    },
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.ok(result.npc_context.abilities, "abilities should be present");
  assert.strictEqual(result.npc_context.abilities.int, 18);
  assert.strictEqual(result.npc_context.abilities.str, 8);
});

await test("extractActorContext omits abilities when empty (dnd5e)", () => {
  const mockActor = {
    name: "Commoner",
    type: "npc",
    system: {
      details: { type: { value: "humanoid" }, alignment: "", cr: 0, biography: { value: "" } },
      abilities: {},
    },
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.strictEqual(result.npc_context.abilities, undefined, "abilities should be omitted when empty");
});

await test("extractActorContext merges personality flags (object)", () => {
  const mockActor = {
    name: "Innkeeper",
    type: "npc",
    system: {
      details: { type: { value: "humanoid" }, alignment: "lawful good", cr: 0, biography: { value: "" } },
      abilities: {},
    },
    getFlag: (moduleId, key) => {
      if (key === "personality") return { trait: "cheerful", flaw: "gossips too much" };
      return null;
    },
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.strictEqual(result.npc_context.trait, "cheerful");
  assert.strictEqual(result.npc_context.flaw, "gossips too much");
});

await test("extractActorContext merges personality flags (string)", () => {
  const mockActor = {
    name: "Bard",
    type: "npc",
    system: {
      details: { type: { value: "humanoid" }, alignment: "", cr: 1, biography: { value: "" } },
      abilities: {},
    },
    getFlag: (moduleId, key) => {
      if (key === "personality") return "always rhymes";
      return null;
    },
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.strictEqual(result.npc_context.personality_traits, "always rhymes");
});

await test("extractActorContext truncates long biographies", () => {
  const longBio = "<p>" + "A".repeat(1000) + "</p>";
  const mockActor = {
    name: "Lorekeeper",
    type: "npc",
    system: {
      details: { type: { value: "humanoid" }, alignment: "", cr: 0, biography: { value: longBio } },
      abilities: {},
    },
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.ok(result.npc_context.biography.length <= 501, "biography should be truncated to ~500 chars");
  assert.ok(result.npc_context.biography.endsWith("..."), "truncated biography should end with ...");
});

await test("extractActorContext generic uses biography.value fallback", () => {
  const mockActor = {
    name: "Alien",
    type: "npc",
    system: {
      biography: { value: "<p>From another project.</p>" },
    },
    getFlag: () => null,
  };

  game.system = { id: "swade" };
  const result = extractActorContext(mockActor);
  assert.ok(result.npc_context.biography.includes("From another project"));
});

await test("extractActorContext handles completely empty system data", () => {
  const mockActor = {
    name: "Mystery",
    type: "npc",
    system: {},
    getFlag: () => null,
  };

  game.system = { id: "dnd5e" };
  const result = extractActorContext(mockActor);
  assert.strictEqual(result.npc_name, "Mystery");
  assert.ok(result.npc_context, "should still return context object");
});

await test("showReportIssueDialog is exported as a function", () => {
  assert.strictEqual(typeof showReportIssueDialog, "function");
});

await test("registerReportIssueHandler is exported as a function", () => {
  assert.strictEqual(typeof registerReportIssueHandler, "function");
});

await test("generateNpcDialogue returns early for null actor", async () => {
  const errorCalls = [];
  const origError = ui.notifications.error;
  ui.notifications.error = (msg) => errorCalls.push(msg);

  await generateNpcDialogue(null);

  assert.ok(errorCalls.length > 0, "should show error notification");
  assert.ok(errorCalls[0].includes("No actor"), `Expected 'No actor' error, got: ${errorCalls[0]}`);

  ui.notifications.error = origError;
});

await test("generateNpcDialogue calls API and posts ChatMessage on success", async () => {
  // Mock Dialog to auto-resolve with input
  const OrigDialog = globalThis.Dialog;
  globalThis.Dialog = class MockDialog {
    constructor(opts) {
      // Simulate immediate "Generate" click
      const mockHtml = {
        find: (sel) => ({
          val: () => {
            if (sel.includes("playerMessage")) return "Hello there";
            if (sel.includes("situation")) return "tavern";
            if (sel.includes("tone")) return "friendly";
            return "";
          },
        }),
      };
      setTimeout(() => opts.buttons.generate.callback(mockHtml), 0);
    }
    render() { return this; }
  };

  // Mock fetch for dialogue
  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => ({
    ok: true,
    json: async () => ({
      dialogue: "Well met, traveller!",
      mood: "friendly",
      stage_direction: "waves warmly",
      suggested_actions: ["ask_quest"],
    }),
  });

  let createdMessage = null;
  const origCreate = ChatMessage.create;
  ChatMessage.create = async (data) => { await origCreate(data); createdMessage = data; return data; };

  const mockActor = {
    name: "Barkeep",
    type: "npc",
    system: { details: { type: { value: "humanoid" }, alignment: "", cr: 0, biography: { value: "" } }, abilities: {} },
    getFlag: () => null,
  };
  game.system = { id: "dnd5e" };

  await generateNpcDialogue(mockActor);

  // Wait for the async Dialog callback
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(createdMessage, "ChatMessage.create should have been called");
  assert.ok(createdMessage.content.includes("Well met"), `Message should contain dialogue, got: ${createdMessage.content}`);
  assert.equal(createdMessage.style, CONST.CHAT_MESSAGE_STYLES.OTHER, "presentation goes in `style` (R9)");
  assert.ok(!("type" in createdMessage), "numeric `type` is rejected by v12+ typed chat messages (R9)");

  ChatMessage.create = origCreate;
  globalThis.Dialog = OrigDialog;
});

await test("generateNpcDialogue handles API error gracefully", async () => {
  const OrigDialog = globalThis.Dialog;
  globalThis.Dialog = class MockDialog {
    constructor(opts) {
      const mockHtml = {
        find: (sel) => ({
          val: () => {
            if (sel.includes("playerMessage")) return "Hello";
            if (sel.includes("situation")) return "";
            if (sel.includes("tone")) return "neutral";
            return "";
          },
        }),
      };
      setTimeout(() => opts.buttons.generate.callback(mockHtml), 0);
    }
    render() { return this; }
  };

  game.settings.set(MODULE_ID, "apiUrl", "https://api.example.com");
  game.settings.set(MODULE_ID, "apiKey", "pk_test_key");
  game.settings.set(MODULE_ID, "projectId", "proj_001");

  _fetchMock = async () => ({ ok: false, status: 500, statusText: "Server Error", json: async () => ({ detail: "boom" }) });

  const errorCalls = [];
  const origError = ui.notifications.error;
  ui.notifications.error = (msg) => errorCalls.push(msg);

  const mockActor = {
    name: "Guard",
    type: "npc",
    system: { details: { type: { value: "humanoid" }, alignment: "", cr: 0, biography: { value: "" } }, abilities: {} },
    getFlag: () => null,
  };
  game.system = { id: "dnd5e" };

  await generateNpcDialogue(mockActor);
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(errorCalls.length > 0, "should show error notification on API failure");

  ui.notifications.error = origError;
  globalThis.Dialog = OrigDialog;
});

await test("generateNpcDialogue returns early when GM cancels dialog", async () => {
  const OrigDialog = globalThis.Dialog;
  globalThis.Dialog = class MockDialog {
    constructor(opts) {
      // Simulate cancel
      setTimeout(() => opts.buttons.cancel.callback(), 0);
    }
    render() { return this; }
  };

  let fetchCalled = false;
  _fetchMock = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };

  const mockActor = {
    name: "Guard",
    type: "npc",
    system: { details: {}, abilities: {} },
    getFlag: () => null,
  };
  game.system = { id: "dnd5e" };

  await generateNpcDialogue(mockActor);
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(!fetchCalled, "fetch should not be called when GM cancels");

  globalThis.Dialog = OrigDialog;
});

// ---------------------------------------------------------------------------
// Suite 4: template file integrity
// ---------------------------------------------------------------------------

console.log("\n--- Suite: dialogue-result.hbs template ---");

await test("dialogue-result.hbs file exists and is readable", () => {
  const templatePath = join(sdkRoot, "templates/dialogue-result.hbs");
  const content = readFileSync(templatePath, "utf-8");
  assert.ok(content.length > 0, "template should not be empty");
});

await test("template contains {{dialogue}} expression", () => {
  const content = readFileSync(join(sdkRoot, "templates/dialogue-result.hbs"), "utf-8");
  assert.ok(content.includes("{{dialogue}}"), "template should include {{dialogue}}");
});

await test("template contains {{mood}} expression", () => {
  const content = readFileSync(join(sdkRoot, "templates/dialogue-result.hbs"), "utf-8");
  assert.ok(content.includes("{{mood}}"), "template should include {{mood}}");
});

await test("template contains {{stage_direction}} expression", () => {
  const content = readFileSync(join(sdkRoot, "templates/dialogue-result.hbs"), "utf-8");
  assert.ok(
    content.includes("{{stage_direction}}"),
    "template should include {{stage_direction}}"
  );
});

await test("template contains {{#each suggested_actions}} block", () => {
  const content = readFileSync(join(sdkRoot, "templates/dialogue-result.hbs"), "utf-8");
  assert.ok(
    content.includes("{{#each suggested_actions}}"),
    "template should include {{#each suggested_actions}}"
  );
});

await test("template contains {{#if stage_direction}} guard", () => {
  const content = readFileSync(join(sdkRoot, "templates/dialogue-result.hbs"), "utf-8");
  assert.ok(
    content.includes("{{#if stage_direction}}"),
    "template should include {{#if stage_direction}}"
  );
});

// ---------------------------------------------------------------------------
// Suite 5: module.json manifest
// ---------------------------------------------------------------------------

console.log("\n--- Suite: module.json manifest ---");

await test("module.json exists and parses as valid JSON", () => {
  const manifestPath = join(sdkRoot, "module.json");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);
  assert.ok(manifest, "manifest should parse");
});

await test("module.json has required fields: id, title, version", () => {
  const manifest = JSON.parse(readFileSync(join(sdkRoot, "module.json"), "utf-8"));
  assert.ok(manifest.id, "manifest.id should be present");
  assert.ok(manifest.title, "manifest.title should be present");
  assert.ok(manifest.version, "manifest.version should be present");
});

// ---------------------------------------------------------------------------
// Suite: public module API (design R10) - game.modules.get("kitefrost").api
// ---------------------------------------------------------------------------

console.log("\n--- Suite: api.mjs (public module API, R10) ---");

const { buildApi } = await import(join(sdkRoot, "scripts/api.mjs"));

function _apiActor(name = "Barkeep") {
  return {
    id: "act1",
    name,
    type: "npc",
    system: { details: { type: { value: "humanoid" }, alignment: "", cr: 0, biography: { value: "" } }, abilities: {} },
    getFlag: (_m, k) => (k === "personality" ? { motivation: "keep the inn safe" } : null),
  };
}

function _okFetch(capture) {
  return async (url, opts) => {
    capture.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ dialogue: "Rooms are two silver.", mood: "wary", stage_direction: "", suggested_actions: [] }) };
  };
}

await test("api: buildApi exposes generateDialogue, extractActorContext, reportIssue, version", () => {
  const api = buildApi("1.2.3");
  for (const k of ["generateDialogue", "extractActorContext", "reportIssue"]) assert.strictEqual(typeof api[k], "function", k);
  assert.strictEqual(api.version, "1.2.3");
});

await test("api: generateDialogue sends the request without a dialog and posts chat", async () => {
  game.settings.set(MODULE_ID, "apiKey", "sk_test");
  game.settings.set(MODULE_ID, "projectId", "proj_001");
  game.system = { id: "dnd5e" };
  const calls = [];
  _fetchMock = _okFetch(calls);
  let posted = null;
  const origCreate = ChatMessage.create;
  ChatMessage.create = async (d) => { await origCreate(d); posted = d; return { id: "msg1", ...d }; };
  const OrigDialog = globalThis.Dialog;
  globalThis.Dialog = class { constructor() { throw new Error("API path must not open a dialog"); } };
  try {
    const r = await buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Any rooms?", tone: "cautious" });
    assert.strictEqual(r.dialogue, "Rooms are two silver.");
    assert.strictEqual(r.message.id, "msg1");
    assert.strictEqual(calls[0].body.player_message, "Any rooms?");
    assert.strictEqual(calls[0].body.tone, "cautious");
    assert.strictEqual(calls[0].body.npc_context.motivation, "keep the inn safe", "personality flag merged");
    assert.ok(posted.content.includes("Rooms are two silver."));
  } finally {
    ChatMessage.create = origCreate;
    globalThis.Dialog = OrigDialog;
  }
});

await test("api: postToChat:false returns the result and creates no message", async () => {
  _fetchMock = _okFetch([]);
  let created = false;
  const origCreate = ChatMessage.create;
  ChatMessage.create = async () => { created = true; };
  try {
    const r = await buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi", postToChat: false });
    assert.strictEqual(r.message, null);
    assert.strictEqual(created, false);
  } finally {
    ChatMessage.create = origCreate;
  }
});

await test("api: generateDialogue REJECTS on API error (callers can try/catch)", async () => {
  _fetchMock = async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ detail: "bad key" }) });
  await assert.rejects(() => buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi" }), /bad key|401/);
});

await test("api: generateDialogue REJECTS when playerMessage is missing", async () => {
  await assert.rejects(() => buildApi("x").generateDialogue(_apiActor(), {}), /playerMessage/);
});

await test("api: generateDialogue fires the kitefrost.dialogueGenerated hook", async () => {
  _fetchMock = _okFetch([]);
  const fired = [];
  const origCallAll = Hooks.callAll;
  Hooks.callAll = (name, payload) => fired.push({ name, payload });
  try {
    await buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi", postToChat: false });
    assert.strictEqual(fired[0]?.name, "kitefrost.dialogueGenerated");
    assert.strictEqual(fired[0].payload.result.dialogue, "Rooms are two silver.");
  } finally {
    Hooks.callAll = origCallAll;
  }
});

await test("api: reportIssue posts to feedback/report and resolves the response", async () => {
  const calls = [];
  _fetchMock = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ feedback_id: "fb_1" }) }; };
  const r = await buildApi("x").reportIssue({ category: "quality", severity: "low", description: "too long", npcName: "Barkeep" });
  assert.strictEqual(r.feedback_id, "fb_1");
  assert.ok(calls[0].url.endsWith("/feedback/report"));
  assert.strictEqual(calls[0].body.metadata.npc_name, "Barkeep");
});

await test("api-client: object-shaped error detail is readable, not [object Object]", async () => {
  _fetchMock = async () => ({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: { code: "project_not_found", message: "Project not found" } }) });
  await assert.rejects(() => buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi", postToChat: false }), (e) => {
    assert.ok(!e.message.includes("[object Object]"), e.message);
    assert.ok(e.message.includes("Project not found"), e.message);
    return true;
  });
});

await test("api: unknown actor id rejects with a clear error", async () => {
  await assert.rejects(() => buildApi("x").generateDialogue("no-such-actor", { playerMessage: "Hi" }), /Actor not found/);
});

await test("api: reportIssue rejects a blank description", async () => {
  await assert.rejects(() => buildApi("x").reportIssue({ description: "  " }), /description is required/);
});

await test("api: template render failure falls back to plain HTML, still posts", async () => {
  _fetchMock = _okFetch([]);
  const origRender = globalThis.renderTemplate;
  globalThis.renderTemplate = async () => { throw new Error("no template"); };
  let posted = null;
  const origCreate = ChatMessage.create;
  ChatMessage.create = async (d) => { posted = d; return { id: "m", ...d }; };
  try {
    await buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi" });
    assert.ok(posted.content.includes("Rooms are two silver."), posted.content);
    assert.ok(posted.content.includes("[wary]"), posted.content);
  } finally {
    globalThis.renderTemplate = origRender;
    ChatMessage.create = origCreate;
  }
});

await test("api: chat creation failure rejects and does NOT fire the hook", async () => {
  _fetchMock = _okFetch([]);
  const origCreate = ChatMessage.create;
  ChatMessage.create = async () => { throw new Error("permission denied"); };
  const fired = [];
  const origCallAll = Hooks.callAll;
  Hooks.callAll = (n) => fired.push(n);
  try {
    await assert.rejects(() => buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi" }), /permission denied/);
    assert.deepStrictEqual(fired, []);
  } finally {
    ChatMessage.create = origCreate;
    Hooks.callAll = origCallAll;
  }
});

await test("api: fallback chat HTML escapes model output (R12)", async () => {
  _fetchMock = async () => ({ ok: true, json: async () => ({ dialogue: '<img src=x onerror="alert(1)">hi', mood: "<b>x</b>", stage_direction: "", suggested_actions: ["<script>"] }) });
  const origRender = globalThis.renderTemplate;
  globalThis.renderTemplate = async () => { throw new Error("no template"); };
  let posted = null;
  const origCreate = ChatMessage.create;
  ChatMessage.create = async (d) => { posted = d; return { id: "m", ...d }; };
  try {
    await buildApi("x").generateDialogue(_apiActor(), { playerMessage: "Hi" });
    assert.ok(!/<img|<script|<b>/.test(posted.content), posted.content);
    assert.ok(posted.content.includes("&lt;img"), posted.content);
  } finally {
    globalThis.renderTemplate = origRender;
    ChatMessage.create = origCreate;
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=========================================`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`=========================================`);

if (failed > 0) {
  console.log("\nFailed tests:");
  for (const { name, err } of failures) {
    console.log(`  - ${name}: ${err.message}`);
  }
  process.exit(1);
}
