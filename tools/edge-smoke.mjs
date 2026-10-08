// CI only: the actual Deno entrypoint, no listening port, no real keys or provider calls.
let handler;
const originalServe=Deno.serve;
Deno.serve=fn=>{handler=fn;return {};};
globalThis.fetch=()=>{throw new Error("unexpected network call");};
for(const key of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"])Deno.env.delete(key);
await import("../supabase/functions/bbq-ranking/index.js");
if(typeof handler!=="function")throw new Error("entrypoint did not register handler");
let response=await handler(new Request("https://example.test/top?version=2&mode=standard"));
if(response.status!==503)throw new Error("unconfigured deployment did not fail closed");

// Synthetic CI-only values; never fetch or inspect a real provider secret.
Deno.env.set("SUPABASE_URL","https://mock.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","isolated-fixture-key");
const admissions=[];
globalThis.fetch=async(url,options)=>{
 if(url!=="https://mock.invalid/rest/v1/rpc/bbq_dispatch")throw new Error("unexpected URL");
 if(options.headers.apikey!=="isolated-fixture-key"||options.headers.Authorization!=="Bearer isolated-fixture-key")throw new Error("wrong backend headers");
 const data=JSON.parse(options.body);
 if(data.p_action==="admit"){admissions.push(data.p_hash);return Response.json({ok:true});}
 if(data.p_action==="top")return Response.json({rows:[]});
 throw new Error("unexpected RPC");
};
await import("../supabase/functions/bbq-ranking/index.js?configured");
for(const ip of ["203.0.113.1","198.51.100.1"]){
 response=await handler(new Request("https://example.test/top?version=2&mode=standard",{headers:{Origin:"https://moruku36.github.io","X-Forwarded-For":ip,"CF-Connecting-IP":ip}}));
 if(response.status!==200||response.headers.get("access-control-allow-origin")!=="https://moruku36.github.io")throw new Error("configured entrypoint or CORS failed");
}
if(admissions.length!==2||admissions[0]!==admissions[1]||!/^[0-9a-f]{64}$/.test(admissions[0]))throw new Error("spoofed headers affected shared admission");
Deno.serve=originalServe;
console.log("Deno "+Deno.version.deno+" Edge entrypoint: unconfigured 503, configured mock RPC/CORS, spoof-resistant shared budget PASS");
