"use strict";
// ONLY an isolated CI database. No public endpoint, credential or production data.
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {chromium}=require("playwright"),{Pool}=require("pg");
const Core=require("../core.js"),Server=require("../supabase/functions/bbq-ranking/handler.js");
assert.equal(process.env.BBQ_TEST_DB,"1");assert.equal(process.env.PGHOST,"127.0.0.1");assert.equal(process.env.PGDATABASE,"bbq_test");
const ROOT=path.resolve(__dirname,".."),OUT=process.env.BBQ_ARTIFACT_DIR||path.join(ROOT,"browser-artifacts");
const pool=new Pool({max:4});let base,loseAck=true,offline=false,submissions=0,checks=0;
const repo={async call(action,hash,payload){
 const c=await pool.connect();
 try{await c.query("set role service_role");return (await c.query("select public.bbq_dispatch($1,$2,$3::jsonb) result",[action,hash,JSON.stringify(payload)])).rows[0].result;}
 finally{await c.query("reset role");c.release();}
}};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,"http://localhost").pathname;
  if(pathname.startsWith("/api/")){
    if(offline){res.writeHead(503).end();return;}
    const chunks=[];for await(const c of req)chunks.push(c);
    const request=new Request(base+req.url,{method:req.method,headers:req.headers,body:req.method==="POST"?Buffer.concat(chunks):undefined});
    const handler=Server.create({Core,repo,origin:base,rateKey:async()=>"d".repeat(64),digest:async text=>crypto.createHash("sha256").update(text).digest("hex")});
    const response=await handler(request);
    if(pathname==="/api/scores"){submissions++;if(loseAck&&response.status===200){loseAck=false;res.writeHead(503).end('{"error":"unavailable"}');return;}}
    res.writeHead(response.status,Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!pathname.startsWith("/BBQ-Game/")){res.writeHead(404).end();return;}
  const file=path.resolve(ROOT,decodeURIComponent(pathname.slice(10))||"index.html");
  if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
  let body=fs.readFileSync(file);
  // This isolated fixture enables only its own loopback API; production CSP stays connect-src 'none'.
  if(file.endsWith("index.html"))body=body.toString().replace("connect-src 'none'","connect-src 'self'");
  if(file.endsWith("ranking-config.js"))body='window.BBQRankingConfig=Object.freeze({apiBase:'+JSON.stringify(base+"/api")+',testLocal:true});';
  const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};
  res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream"}).end(body);
 }catch(error){console.error("isolated server:",error.message);res.writeHead(500).end();}
});
function check(condition,message){assert.ok(condition,message);checks++;}
(async()=>{
 await pool.query("delete from bbq_private.rates; delete from bbq_private.receipts; delete from bbq_private.runs; delete from bbq_private.scores");
 await new Promise(r=>server.listen(0,"127.0.0.1",r));base="http://127.0.0.1:"+server.address().port;
 const browser=await chromium.launch();
 try{
  const first=await browser.newContext({viewport:{width:390,height:844},locale:"ja",hasTouch:true}),second=await browser.newContext({viewport:{width:1280,height:800},locale:"en"});
  const page=await first.newPage(),other=await second.newPage(),errors=[];
  for(const p of [page,other])p.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{const real=performance.now.bind(performance);let offset=0;Object.defineProperty(performance,"now",{value:()=>real()+offset});window.bbqAdvance=ms=>offset+=ms;});
  await Promise.all([page.goto(base+"/BBQ-Game/#v=2&seed=123"),other.goto(base+"/BBQ-Game/")]);
  await page.locator("#onlineStartStatus").filter({hasText:"まだありません"}).waitFor();
  check(await page.locator("#onlineStartName-0").textContent()==="—","empty shared board");
  await page.locator("#nicknameInput").fill("<b>Ken</b>");
  const issued=page.waitForResponse(r=>r.url().endsWith("/api/runs")&&r.status()===201);
  await page.locator("#startButton").click();await issued;
  await page.locator("#slot-0").tap();
  await page.evaluate(ms=>bbqAdvance(ms),Core.ingredientById("shrimp").idealMs);
  await page.locator("#slot-0").tap();
  check(Number(await page.locator("#hudScore").textContent())>0,"touch earns score");
  const before=await page.locator("#hudScore").textContent();
  await page.locator("#languageGame").click();
  check(await page.locator("#hudScore").textContent()===before,"language preserves round score");
  // Only CI clock: server still requires sixty real seconds on a public deployment.
  await pool.query("update bbq_private.runs set issued_at=clock_timestamp()-interval '61 seconds'");
  await page.evaluate(()=>bbqAdvance(60000));
  await page.locator("#screenResult").waitFor({state:"visible"});
  await page.locator("#publishStatus").filter({hasText:"only when"}).waitFor();
  check(await page.locator("#publishButton").isDisabled(),"consent is off by default");
  check(submissions===0,"no automatic submission");
  await page.locator("#languageResult").click();
  check(await page.locator("#publishConsent").isChecked()===false,"language does not grant consent");
  await page.locator("#publishConsent").check();await page.locator("#publishButton").click();
  await page.locator("#publishStatus").filter({hasText:"再試行"}).waitFor();
  check(await page.locator("#publishButton").isEnabled(),"lost acknowledgement offers retry");
  await page.locator("#languageResult").click();await page.locator("#publishButton").click();
  await page.locator("#publishStatus").filter({hasText:"Submitted"}).waitFor();
  check(submissions===2,"one explicit retry");
  check((await pool.query("select count(*) from bbq_private.receipts")).rows[0].count==="1","one receipt");
  check((await pool.query("select count(*) from bbq_private.scores")).rows[0].count==="1","one public record");
  await other.locator("#onlineStartRefresh").click();
  await other.locator("#onlineStartName-0").filter({hasText:"<b>Ken</b>"}).waitFor();
  check(await other.locator("#onlineStartName-0 b").count()===0,"public name is plain text");
  check(await other.locator("#startRankName-0").textContent()==="—","second device local record stays empty");
  check(await other.locator("#onlineStartScore-0").textContent()===before,"independent browser shares score");
  await page.screenshot({path:path.join(OUT,"ranking-mobile-result.png")});
  await other.screenshot({path:path.join(OUT,"ranking-desktop-start.png")});
  offline=true;await other.locator("#onlineStartRefresh").click();
  await other.locator("#onlineStartStatus").filter({hasText:"unavailable"}).waitFor();
  check(await other.locator("#onlineStartName-0").textContent()==="—","outage never substitutes local scores");
  await other.locator("#startButton").click();
  check(await other.locator("#hudTime").textContent()==="60","offline API does not block game");
  check(errors.length===0,errors.join("\n"));
  fs.writeFileSync(path.join(OUT,"ranking-browser.json"),JSON.stringify({checks,browser:browser.version(),database:"isolated PostgreSQL 17",productionWrites:false},null,2));
  console.log("Ranking Chromium/PostgreSQL: "+checks+" checks PASS");
  await first.close();await second.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));await pool.end();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();pool.end();});
