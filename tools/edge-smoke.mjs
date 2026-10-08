// CI only: load the actual Deno entrypoint without binding a port or configuring a provider.
let handler;
const originalServe=Deno.serve;
Deno.serve=fn=>{handler=fn;return {};};
globalThis.fetch=()=>{throw new Error("unexpected network call");};
for(const key of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","BBQ_HASH_SECRET","BBQ_TRUSTED_IP_HEADER","BBQ_ALLOWED_ORIGIN"])Deno.env.delete(key);
await import("../supabase/functions/bbq-ranking/index.js");
Deno.serve=originalServe;
if(typeof handler!=="function")throw new Error("entrypoint did not register handler");
const response=await handler(new Request("https://example.test/top?version=2&mode=standard"));
if(response.status!==503)throw new Error("unconfigured deployment did not fail closed");
console.log("Deno "+Deno.version.deno+" actual Edge entrypoint: unconfigured 503, no network PASS");
