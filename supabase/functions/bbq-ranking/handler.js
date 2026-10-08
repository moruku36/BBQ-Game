// BBQ ranking API. Portable: Deno deployment and Node tests use the same handler.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BBQRankingServer = api;
})(globalThis, function () {
  "use strict";
  const VERSION = 2, MODE = "standard", MAX_ACTIONS = 512;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}]/u;
  function exact(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === keys.slice().sort().join("|");
  }
  function publicName(raw, Core) {
    if (typeof raw !== "string" || FORBIDDEN.test(raw)) throw new Error("invalid");
    const result = Core.normalizeNickname(raw);
    if (!result.ok || !raw.trim()) throw new Error("invalid");
    return result.value;
  }
  function replay(body, run, Core) {
    if (!exact(body, ["runId", "name", "actions"]) || !UUID.test(body.runId) ||
        !Array.isArray(body.actions) || body.actions.length > MAX_ACTIONS) throw new Error("invalid");
    const name = publicName(body.name, Core);
    let clock = 0, previous = -1;
    const game = Core.createGame({ seed: run.seed, now: () => clock });
    game.start();
    const actions = [];
    for (const action of body.actions) {
      if (!exact(action, ["t", "slot", "ingredient", "type"]) ||
          !Number.isFinite(action.t) || action.t < 0 || action.t >= Core.GAME_MS || action.t < previous ||
          !Number.isInteger(action.slot) || action.slot < 0 || action.slot >= Core.SLOT_COUNT ||
          !Core.INGREDIENT_IDS.includes(action.ingredient) ||
          !["placed", "collected"].includes(action.type)) throw new Error("invalid");
      clock = previous = action.t;
      game.select(action.ingredient);
      const result = game.tapSlot(action.slot);
      if (result.type !== action.type || result.ingredient !== action.ingredient) throw new Error("invalid");
      actions.push({ t: action.t, slot: action.slot, ingredient: action.ingredient, type: action.type });
    }
    clock = Core.GAME_MS;
    game.snapshot();
    const score = game.results().score;
    game.dispose();
    if (!Core.isValidScore(score)) throw new Error("invalid");
    return { name, score, actions };
  }
  async function readJson(request, limit) {
    if (request.headers.get("content-encoding")) throw Object.assign(new Error(), { code: "invalid" });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) throw Object.assign(new Error(), { code: "invalid" });
    const declared = request.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw Object.assign(new Error(), { code: "too-large" });
    const chunks = [];
    const deadline = Date.now() + 8000;
    let length = 0;
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          let timer;
          const { done, value } = await Promise.race([
            reader.read(),
            new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(Object.assign(new Error(), { code: "invalid" })); }, Math.max(1, deadline - Date.now())); }),
          ]).finally(() => clearTimeout(timer));
          if (done) break;
          length += value.byteLength;
          if (length > limit) { void reader.cancel().catch(() => {}); throw Object.assign(new Error(), { code: "too-large" }); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch (_) { throw Object.assign(new Error(), { code: "invalid" }); }
  }
  function create(options) {
    const { Core, repo, rateKey, digest, origin } = options;
    function response(status, data, request, retryAfter) {
      const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
      if (request.headers.get("origin") === origin) headers["Access-Control-Allow-Origin"] = origin;
      if (retryAfter) headers["Retry-After"] = String(Math.max(1, Math.min(600, retryAfter)));
      return new Response(JSON.stringify(data), { status, headers });
    }
    return async request => {
      try {
        const url = new URL(request.url), route = url.pathname.split("/").pop();
        const hash = await rateKey(request);
        const admitted = await repo.call("admit", hash, { route, method: request.method });
        if (!admitted.ok) return response(429, { error: "rate" }, request, admitted.retryAfter || 60);
        if (new TextEncoder().encode(url.pathname + url.search).length > 256) return response(413, { error: "too-large" }, request);
        if (request.headers.get("origin") && request.headers.get("origin") !== origin) return response(403, { error: "origin" }, request);
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: {
            "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin",
          } });
        }
        if (request.method === "GET" && route === "top") {
          if (request.body || url.searchParams.toString() !== "version=2&mode=standard") return response(400, { error: "invalid" }, request);
          const result = await repo.call("top", hash, {});
          return response(200, { rows: result.rows }, request);
        }
        if (request.method !== "POST" || !["runs", "scores"].includes(route) || url.search)
          return response(400, { error: "invalid" }, request);
        const body = await readJson(request, route === "runs" ? 256 : 32768);
        if (route === "runs") {
          if (!exact(body, ["version", "mode", "seed"]) || body.version !== VERSION || body.mode !== MODE ||
              !Number.isInteger(body.seed) || body.seed < 1 || body.seed > 4294967295)
            return response(400, { error: "invalid" }, request);
          const run = await repo.call("create", hash, body);
          return response(201, run, request);
        }
        if (!exact(body, ["runId", "name", "actions"]) || !UUID.test(body.runId))
          return response(400, { error: "invalid" }, request);
        // Reading a run does not accept it: SQL rechecks expiry and receipt atomically.
        const run = await repo.call("run", hash, { runId: body.runId });
        if (!run || run.version !== VERSION || run.mode !== MODE) return response(410, { error: "expired" }, request);
        let verified;
        try { verified = replay(body, run, Core); }
        catch (_) { return response(400, { error: "invalid" }, request); }
        const signature = await digest(JSON.stringify({ runId: body.runId, name: verified.name, actions: verified.actions }));
        const result = await repo.call("accept", hash, { runId: body.runId, ...verified, digest: signature });
        const status = { accepted: 200, conflict: 409, early: 409, expired: 410 }[result.state] || 503;
        if (status !== 200) return response(status, { error: result.state || "unavailable" }, request, result.state === "early" ? 2 : undefined);
        return response(200, { accepted: true, score: result.score, ranked: result.ranked }, request);
      } catch (error) {
        const code = error.code === "too-large" ? "too-large" : error.code === "invalid" ? "invalid" : "unavailable";
        return response(code === "too-large" ? 413 : code === "invalid" ? 400 : 503, { error: code }, request);
      }
    };
  }
  return { create, replay, publicName, VERSION, MODE, MAX_ACTIONS };
});
