"use strict";
// Isolated real Chromium; accelerated clock offsets, no production writes.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.BBQ_ARTIFACT_DIR || path.join(ROOT, "browser-artifacts");
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!pathname.startsWith("/BBQ-Game/")) { res.writeHead(404).end(); return; }
  const file = path.resolve(ROOT, decodeURIComponent(pathname.slice(10)) || "index.html");
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".png":"image/png" };
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  } catch (_) { res.writeHead(404).end(); }
});
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/BBQ-Game/";
  const browser = await chromium.launch();
  try {
    for (const [width,height] of [[360,640],[390,844],[1280,800]]) for (const language of ["ja","en"]) {
      const context = await browser.newContext({ viewport:{width,height}, locale:language, hasTouch:true });
      const page = await context.newPage(), errors=[], badResponses=[];
      page.on("pageerror", e => errors.push(e.message));
      page.on("response", r => { if(r.status()>=400) badResponses.push(r.url()); });
      await page.addInitScript(() => {
        const realNow=performance.now.bind(performance); let offset=0;
        Object.defineProperty(performance,"now",{value:()=>realNow()+offset});
        window.bbqTestAdvance=ms=>{offset+=ms;};
        window.bbqCspViolations=[];
        document.addEventListener("securitypolicyviolation",e=>window.bbqCspViolations.push(e.violatedDirective));
      });
      await page.goto(base+"#v=2&seed=123456789");
      check(await page.getAttribute("html","lang")===language,"browser language");
      await page.locator("#nicknameInput").fill("<b>Ken</b>"); await page.locator("#startButton").click();
      check(await page.locator("#hudPlayer").textContent()==="<b>Ken</b>","nickname text");
      check(await page.locator("#hudPlayer b").count()===0,"no nickname markup");
      const controls=await page.evaluate(()=>{
        const ids=["languageGame","soundButton","pauseButton",...Array.from({length:6},(_,i)=>"slot-"+i),...BBQCore.INGREDIENT_IDS.map(id=>"ing-"+id)];
        return ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};});
      });
      await page.screenshot({path:path.join(OUT,width+"x"+height+"-"+language+"-game.png")});
      console.log(JSON.stringify({width,height,language,controls}));
      for(const c of controls){
        check(c.w>=44&&c.h>=44,"44px target "+c.id);
        check(c.x>=-1&&c.y>=-1&&c.right<=width+1&&c.bottom<=height+1,"inside viewport "+JSON.stringify(c));
      }
      await page.locator("#slot-0").tap();
      await page.evaluate(()=>bbqTestAdvance(1000)); await page.waitForTimeout(80);
      const before=Number(await page.locator("#hudTime").textContent()), seed=await page.evaluate(()=>location.hash);
      await page.locator("#languageGame").click();
      check(await page.getAttribute("html","lang")!==language,"live switch");
      check(Math.abs(Number(await page.locator("#hudTime").textContent())-before)<=1,"clock retained");
      check(await page.locator("#slot-0").getAttribute("class")==="slot is-raw","food retained");
      check(await page.evaluate(()=>location.hash)===seed,"seed retained");
      await page.evaluate(()=>bbqTestAdvance(2050)); await page.waitForTimeout(50); await page.locator("#slot-0").click();
      check(Number(await page.locator("#hudScore").textContent())===80,"perfect score");
      await page.locator("#pauseButton").focus(); await page.keyboard.press("Enter");
      check(await page.locator("#pauseOverlay").isVisible(),"keyboard pause");
      const paused=await page.locator("#hudTime").textContent(); await page.locator("#languagePause").click();
      await page.evaluate(()=>bbqTestAdvance(10000)); await page.waitForTimeout(80);
      check(await page.locator("#hudTime").textContent()===paused,"pause retained");
      await page.locator("#pauseSoundButton").click(); await page.locator("#languageSound").click();
      await page.locator("#seToggle").click();
      check(await page.locator("#seToggle").getAttribute("aria-pressed")==="false","effects mute");
      await page.locator("#soundCloseButton").click(); await page.locator("#resumeButton").click();
      await page.evaluate(()=>bbqTestAdvance(61000)); await page.waitForTimeout(120);
      check(await page.locator("#screenResult").isVisible(),"result screen");
      const score=await page.locator("#resultScore").textContent(), stored=await page.evaluate(()=>localStorage.getItem(BBQCore.STORAGE_KEY));
      await page.locator("#languageResult").click();
      check(await page.locator("#resultScore").textContent()===score,"result unchanged");
      check(await page.evaluate(()=>localStorage.getItem(BBQCore.STORAGE_KEY))===stored,"no duplicate record");
      await page.screenshot({path:path.join(OUT,width+"x"+height+"-"+language+"-result.png")});
      await page.locator("#retryButton").click();
      check(Number(await page.locator("#hudScore").textContent())===0,"retry");
      check(await page.evaluate(()=>location.hash)===seed,"retry seed");
      const choice=await page.getAttribute("html","lang"); await page.reload();
      check(await page.getAttribute("html","lang")===choice,"choice persists");
      check(errors.length===0,"no JS errors "+errors.join(";"));
      check(badResponses.length===0,"no 404 "+badResponses.join(";"));
      check((await page.evaluate(()=>bbqCspViolations)).length===0,"no CSP violation");
      await context.close();
    }
    const summary={checks,viewports:["360x640","390x844","1280x800"],languages:["ja","en"],chromium:browser.version(),clock:"accelerated performance.now offsets",limits:"No physical phone, Safari, audible output, native sharing or online ranking test."};
    fs.writeFileSync(path.join(OUT,"summary.json"),JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary,null,2));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
