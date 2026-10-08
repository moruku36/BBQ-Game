"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const Core=require("../core.js"),Server=require("../supabase/functions/bbq-ranking/handler.js");
test("isolated PostgreSQL: real permissions, transactions, replay, global top3, retry, limits and expiry",{skip:process.env.BBQ_TEST_DB!=="1"},async()=>{
 assert.equal(process.env.PGHOST,"127.0.0.1");assert.equal(process.env.PGDATABASE,"bbq_test");
 const {Pool}=require("pg");const pool=new Pool({max:8});
 const hash="a".repeat(64),origin="https://example.test";
 try{
  await pool.query("create role anon; create role authenticated; create role service_role bypassrls");
  await pool.query(fs.readFileSync(path.join(__dirname,"../supabase/migrations/202610080001_bbq_ranking.sql"),"utf8"));
  const version=(await pool.query("select version()")).rows[0].version;console.log(version);
  const c=await pool.connect();
  try{
    for(const role of ["anon","authenticated"]){
      await c.query("set role "+role);
      await assert.rejects(c.query("select * from bbq_private.scores"),/permission denied/);
      await assert.rejects(c.query("select public.bbq_dispatch('top',$1,'{}')",[hash]),/permission denied/);
      await c.query("reset role");
    }
  }finally{c.release();}
  const repo={async call(action,key,payload){
    const connection=await pool.connect();
    try{await connection.query("set role service_role");return (await connection.query("select public.bbq_dispatch($1,$2,$3::jsonb) result",[action,key,JSON.stringify(payload)])).rows[0].result;}
    finally{await connection.query("reset role");connection.release();}
  }};
  const api=Server.create({Core,repo,origin,rateKey:async()=>hash,digest:async text=>crypto.createHash("sha256").update(text).digest("hex")});
  const post=async(route,body)=>api(new Request("https://api.test/"+route,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(body)}));
  const newRun=async(seed=123)=>{const r=await post("runs",{seed,version:2,mode:"standard"});assert.equal(r.status,201);return r.json();};
  const actions=[{t:0,slot:0,ingredient:"shrimp",type:"placed"},{t:Core.ingredientById("shrimp").idealMs,slot:0,ingredient:"shrimp",type:"collected"}];
  const run=await newRun(),body={runId:run.runId,name:"<b>Ken</b>",actions};
  assert.equal((await post("scores",body)).status,409,"minimum real elapsed time");
  await pool.query("update bbq_private.runs set issued_at=clock_timestamp()-interval '61 seconds' where id=$1",[run.runId]);
  const replies=await Promise.all([post("scores",body),post("scores",body)]);
  assert.deepEqual(await replies[0].json(),await replies[1].json(),"concurrent replay is idempotent");
  assert.equal((await pool.query("select count(*) from bbq_private.receipts")).rows[0].count,"1");
  assert.equal((await post("scores",{...body,name:"changed"})).status,409,"immutable digest conflict");
  // Replayed logs reject client score injection even with a valid run.
  assert.equal((await post("scores",{...body,score:99999})).status,400);
  // Independent DB transactions race to trim one shared score board atomically.
  const candidates=await Promise.all(Array.from({length:5},(_,i)=>repo.call("create",hash,{seed:i+1,version:2,mode:"standard"})));
  await pool.query("update bbq_private.runs set issued_at=clock_timestamp()-interval '61 seconds'");
  const ranks=await Promise.all(candidates.map((r,i)=>repo.call("accept",hash,{runId:r.runId,name:"Same name",score:500+i,digest:String(i).repeat(64),actions:[]})));
  assert.ok(ranks.every(r=>r.state==="accepted"));
  const top=await repo.call("top",hash,{});
  assert.deepEqual(top.rows.map(r=>r.score),[504,503,502]);assert.ok(top.rows.every(r=>Object.keys(r).sort().join("|")==="name|score"));
  assert.equal((await pool.query("select count(*) from bbq_private.scores")).rows[0].count,"3");
  // Lost acknowledgements still replay after run cleanup, for the receipt's 24h window.
  await pool.query("delete from bbq_private.runs where id=$1",[run.runId]);
  assert.equal((await post("scores",body)).status,200);
  await pool.query("update bbq_private.receipts set expires_at=clock_timestamp()-interval '1 second' where run_id=$1",[run.runId]);
  assert.equal((await post("scores",body)).status,410);
  const exp=await newRun();
  await pool.query("update bbq_private.runs set expires_at=clock_timestamp()-interval '1 second' where id=$1",[exp.runId]);
  assert.equal((await post("scores",{...body,runId:exp.runId})).status,410);
  // Every attempted request increments counters, including invalid API payloads.
  await pool.query("delete from bbq_private.rates");
  for(let i=0;i<20;i++)assert.equal((await repo.call("admit",hash,{route:"runs",method:"POST"})).ok,true);
  assert.equal((await repo.call("admit",hash,{route:"runs",method:"POST"})).ok,false);
  assert.equal((await repo.call("admit","b".repeat(64),{route:"runs",method:"POST"})).ok,true);
  await pool.query("delete from bbq_private.rates");
  for(let i=0;i<10;i++)assert.equal((await repo.call("admit",hash,{route:"scores",method:"POST"})).ok,true);
  assert.equal((await repo.call("admit",hash,{route:"scores",method:"POST"})).ok,false);
  await pool.query("delete from bbq_private.rates");
  for(let i=0;i<60;i++)assert.equal((await repo.call("admit",hash,{route:"top",method:"GET"})).ok,true);
  assert.equal((await repo.call("admit",hash,{route:"top",method:"GET"})).ok,false);
  await pool.query("update bbq_private.rates set expires_at=clock_timestamp()-interval '1 second'");
  await pool.query("update bbq_private.receipts set actions='[{}]'::jsonb,actions_expires_at=clock_timestamp()-interval '1 second'");
  await repo.call("admit","c".repeat(64),{route:"unknown",method:"DELETE"});
  assert.equal((await pool.query("select count(*) from bbq_private.rates where expires_at<=clock_timestamp()")).rows[0].count,"0");
  assert.equal((await pool.query("select count(*) from bbq_private.receipts where actions<>'[]'::jsonb")).rows[0].count,"0");
  // Global exhaustion must not allocate attacker-controlled per-hash rows.
  await pool.query("delete from bbq_private.rates");
  await pool.query("insert into bbq_private.rates(bucket,count,expires_at) values('all:g:'||floor(extract(epoch from clock_timestamp())/60),601,clock_timestamp()+interval '1 hour')");
  assert.equal((await repo.call("admit","e".repeat(64),{route:"unknown",method:"DELETE"})).ok,false);
  assert.equal((await pool.query("select count(*) from bbq_private.rates where bucket like '%:h:%'")).rows[0].count,"0");
  console.log("PostgreSQL ranking transaction/permission checks passed");
 }finally{await pool.end();}
});
