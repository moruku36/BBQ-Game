"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createHash,randomUUID}=require("node:crypto");
const Core=require("../core.js"),Client=require("../ranking.js"),Server=require("../supabase/functions/bbq-ranking/handler.js");
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
const actions=[{t:0,slot:0,ingredient:"shrimp",type:"placed"},{t:Core.ingredientById("shrimp").idealMs,slot:0,ingredient:"shrimp",type:"collected"}];
const run={runId:randomUUID(),seed:123,version:2,mode:"standard",expiresAt:Date.now()+900000};
const score=Server.replay({runId:run.runId,name:"Ken",actions},run,Core).score;
function client(fetch,extra={}){return Client.create({Core,fetch,apiBase:"https://example.test/api",AbortController,...extra});}
test("disabled client makes no request",async()=>{
 const c=Client.create({Core,fetch:()=>assert.fail(),apiBase:""});
 assert.equal((await c.top()).status,"disabled");await c.begin(123);assert.equal(c.canSubmit(),false);
 assert.equal((await c.submit("Ken",true)).state,"disabled");
});
test("client validates public top3 and rejects hostile or malformed responses",async()=>{
 for(const rows of [[{name:"<b>Ken</b>",score:90}],[{name:"日本語😀",score:90}]]){
  const c=client(async()=>json({rows}));assert.deepEqual((await c.top()).rows,rows);
 }
 for(const rows of [[{name:"bad\u202ename",score:90}],[{name:"a",score:0}],[{name:"a",score:1},{name:"b",score:2}],Array(4).fill({name:"a",score:1}),[{name:"a",score:1,token:"secret"}]]){
  assert.equal((await client(async()=>json({rows})).top()).status,"error");
 }
 assert.equal((await client(async()=>new Response("x".repeat(1025))).top()).status,"error");
});
test("client requires explicit consent and retries one immutable run without duplicate mutation",async()=>{
 const submitted=[];let failed=true;
 const c=client(async(url,opts)=>{
  if(url.endsWith("/runs"))return json(run);
  submitted.push(JSON.parse(opts.body));
  if(failed){failed=false;throw Error("lost acknowledgement");}
  return json({accepted:true,score,ranked:true});
 });
 await c.begin(123);actions.forEach(c.record);c.finish(score);
 assert.equal(c.canSubmit(),true);
 assert.equal((await c.submit("Ken",false)).state,"consent");assert.equal(submitted.length,0);
 assert.equal((await c.submit("Ken",true)).state,"retry");
 assert.equal((await c.submit("Changed",true)).state,"accepted");
 assert.deepEqual(submitted[0],submitted[1]);assert.equal(c.canSubmit(),false);
});
test("old async results cannot publish into a new round",async()=>{
 let resolve;
 const c=client(async(url)=>url.endsWith("/runs")?json(run):new Promise(r=>resolve=r));
 await c.begin(123);actions.forEach(c.record);c.finish(score);
 const pending=c.submit("Ken",true);c.cancel();
 resolve(json({accepted:true,score,ranked:true}));
 assert.equal((await pending).state,"stale");assert.equal(c.canSubmit(),false);
});
test("timeout covers a stalled response body and cancels the fetch",async()=>{
 let aborted=false;
 const c=client(async(_url,opts)=>{
  opts.signal.addEventListener("abort",()=>{aborted=true;});
  return new Response(new ReadableStream({start(){}}));
 },{setTimeout:fn=>setTimeout(fn,10),clearTimeout});
 assert.equal((await c.top()).status,"error");assert.equal(aborted,true);
});
test("replay computes score from rules and rejects altered actions, score injection and names",()=>{
 const body={runId:run.runId,name:"Ken",actions};
 assert.ok(Server.replay(body,run,Core).score>0);
 const bad=[
  {...body,score:99999},{...body,name:"bad\u0000"},{...body,name:"bad\u202e"},
  {...body,actions:Array(513).fill(actions[0])},
  {...body,actions:[actions[0],{...actions[1],t:100,type:"collected"}]},
  {...body,actions:[{...actions[0],slot:6}]},
  {...body,actions:[{...actions[0],t:NaN}]},
  {...body,actions:[{...actions[0],ingredient:"fake"}]},
  {...body,actions:[actions[0],{...actions[1],t:60000}]},
 ];
 for(const value of bad)assert.throws(()=>Server.replay(value,run,Core));
});
test("all API methods are admitted before parsing and reject large, unauthorised, or invalid input",async()=>{
 const calls=[];
 let allow=true;
 const repo={call:async(action,_hash,payload)=>{calls.push(action);if(action==="admit")return {ok:allow};if(action==="top")return {rows:[]};if(action==="create")return run; if(action==="run")return run; if(action==="accept")return {state:"accepted",score:payload.score,ranked:true};}};
 const api=Server.create({Core,repo,origin:"https://example.test",rateKey:async()=>"a".repeat(64),digest:async t=>createHash("sha256").update(t).digest("hex")});
 const request=(path,opts={})=>new Request("https://api.test/"+path,opts);
 assert.equal((await api(request("top?version=2&mode=standard"))).status,200);
 assert.equal((await api(request("runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:2,mode:"standard",seed:123})}))).status,201);
 const valid=await api(request("scores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({runId:run.runId,name:"Ken",actions})}));
 assert.deepEqual(await valid.json(),{accepted:true,score,ranked:true});
 for(const [path,opts,status] of [
 ["top?version=1&mode=standard",{},400],["top?version=2&mode=standard",{headers:{Origin:"https://evil.test"}},403],
 ["runs",{method:"POST",headers:{"Content-Type":"application/json"},body:"x".repeat(257)},413],
 ["runs",{method:"POST",headers:{"Content-Type":"text/plain"},body:"{}"},400],
 ["runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:2,mode:"standard",seed:123,score:9999})},400],
 ["scores",{method:"POST",headers:{"Content-Type":"application/json"},body:"x".repeat(32769)},413],
 ["nonsense",{method:"DELETE"},400],
 ]){
   calls.length=0;assert.equal((await api(request(path,opts))).status,status);assert.equal(calls[0],"admit");
 }
 allow=false;calls.length=0;
 const limited=await api(request("scores",{method:"POST",body:"bad"}));
 assert.equal(limited.status,429);assert.deepEqual(calls,["admit"]);assert.ok(Number(limited.headers.get("retry-after"))<=600);
});
test("API fails closed without backend identity/configuration",async()=>{
 const api=Server.create({Core,repo:{call:()=>assert.fail()},origin:"https://example.test",rateKey:async()=>{throw Error("missing trusted header");},digest:()=>assert.fail()});
 assert.equal((await api(new Request("https://api.test/top?version=2&mode=standard"))).status,503);
});

test("shared rate limit explains retry without mutating the submission",async()=>{
 const bodies=[];let limited=true;
 const c=client(async(url,opts)=>{
  if(url.endsWith("/runs"))return json(run);
  bodies.push(opts.body);
  if(limited){limited=false;return json({error:"rate"},429);}
  return json({accepted:true,score,ranked:true});
 });
 await c.begin(123);actions.forEach(c.record);c.finish(score);
 assert.equal((await c.submit("Ken",true)).state,"rate");
 assert.equal((await c.submit("Changed",true)).state,"accepted");
 assert.equal(bodies[0],bodies[1]);
});
