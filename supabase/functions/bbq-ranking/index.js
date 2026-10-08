// No credentials in source. Deploy/configure only after exact-target approval.
import "../../../core.js";
import "./handler.js";
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const origin = "https://moruku36.github.io";
const encoder = new TextEncoder();
async function digest(text) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,"0")).join("");
}
const repo = { async call(action, hash, payload) {
  if (!url || !key) throw new Error("not configured");
  const res = await fetch(url + "/rest/v1/rpc/bbq_dispatch", {
    method: "POST", headers: { "Content-Type": "application/json", apikey:key, Authorization:"Bearer "+key },
    body: JSON.stringify({ p_action:action, p_hash:hash, p_payload:payload }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error("database unavailable");
  return await res.json();
} };
const handler = globalThis.BBQRankingServer.create({
  Core:globalThis.BBQCore, repo, origin, digest,
  async rateKey(request) {
    // Conservative first release: one shared anonymous bucket for all players.
    // This needs no new secret and cannot be evaded by spoofing IP headers.
    // Existing per-hash budgets apply to the entire game, in addition to global caps.
    if (!url || !key) throw new Error("not configured");
    const hour = Math.floor(Date.now()/3600000);
    return digest("bbq-party-v2-shared-admission|" + hour);
  },
});
Deno.serve(handler);
