// No credentials in source. Deploy/configure only after exact-target approval.
import "../../../core.js";
import "./handler.js";
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const hashSecret = Deno.env.get("BBQ_HASH_SECRET");
const ipHeader = Deno.env.get("BBQ_TRUSTED_IP_HEADER");
const origin = Deno.env.get("BBQ_ALLOWED_ORIGIN");
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
    // Header provenance must be verified on the selected gateway BEFORE enabling.
    // Never infer client identity from a user-provided nickname or browser token.
    if (!hashSecret || !ipHeader || !origin) throw new Error("not configured");
    const ip = request.headers.get(ipHeader);
    if (!ip || ip.length>256) throw new Error("trusted network identity unavailable");
    const hmac = await crypto.subtle.importKey("raw",encoder.encode(hashSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const hour = Math.floor(Date.now()/3600000);
    const bytes = await crypto.subtle.sign("HMAC",hmac,encoder.encode(hour+"|"+ip));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
  },
});
Deno.serve(handler);
