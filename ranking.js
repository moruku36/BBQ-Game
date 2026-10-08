// Optional online ranking. Local records and game rules remain separate.
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.BBQRanking=api;
})(globalThis,function(){
  "use strict";
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function create(options){
    const {Core,fetch:fetcher}=options;
    const base=typeof options.apiBase==="string"?options.apiBase.replace(/\/$/,""):"";
    let enabled=false;
    try {const u=new URL(base); enabled=u.protocol==="https:"&&!u.username&&!u.password&&!u.search&&!u.hash;}catch(_){}
    // HTTP is allowed only by explicit test injection, never by production config.
    if(options.testLocal===true&&/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(base))enabled=true;
    let generation=0,current=null,busy=false,pending=null;
    const timeout=options.setTimeout||globalThis.setTimeout,clear=options.clearTimeout||globalThis.clearTimeout;
    async function request(route,payload){
      if(!enabled)throw Object.assign(new Error(),{code:"disabled"});
      const controller=typeof options.AbortController==="function"?new options.AbortController():null;
      let timer;
      try {
        return await Promise.race([
          (async()=>{
            const response=await fetcher(base+"/"+route,{
              method:payload?"POST":"GET",credentials:"omit",referrerPolicy:"no-referrer",
              headers:payload?{"Content-Type":"application/json"}:{},
              body:payload?JSON.stringify(payload):undefined,signal:controller?controller.signal:undefined,
            });
            const reader=response.body?.getReader();
            if(!reader)throw Object.assign(new Error(),{code:"invalid-response"});
            const chunks=[];let length=0;
            try{
              while(true){
                const {done,value}=await reader.read();if(done)break;
                length+=value.byteLength;
                if(length>1024){void reader.cancel().catch(()=>{});throw Object.assign(new Error(),{code:"invalid-response"});}
                chunks.push(value);
              }
            }finally{reader.releaseLock();}
            const bytes=new Uint8Array(length);let offset=0;
            for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
            let data;try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
            catch(_){throw Object.assign(new Error(),{code:"invalid-response"});}
            if(!response.ok)throw Object.assign(new Error(),{code:data.error==="too-large"?"invalid":["rate","early","expired","conflict","invalid"].includes(data.error)?data.error:"network"});
            return data;
          })(),
          new Promise((_,reject)=>{timer=timeout(()=>{if(controller)controller.abort();reject(Object.assign(new Error(),{code:"network"}));},8000);}),
        ]);
      }finally{if(timer)clear(timer);}
    }
    async function top(){
      if(!enabled)return {status:"disabled",rows:[]};
      try{
        const data=await request("top?version=2&mode=standard");
        if(!Array.isArray(data.rows)||data.rows.length>3)throw new Error();
        const rows=data.rows.map(row=>{
          if(!row||Object.keys(row).sort().join("|")!=="name|score"||typeof row.name!=="string"||
            /[\p{Cc}\p{Cf}\p{Cs}]/u.test(row.name)||!row.name.trim()||Array.from(row.name).length>12||!Core.isValidScore(row.score))throw new Error();
          return {name:row.name,score:row.score};
        });
        if(rows.some((r,i)=>i&&r.score>rows[i-1].score))throw new Error();
        return {status:rows.length?"ready":"empty",rows};
      }catch(_){return {status:"error",rows:[]};}
    }
    async function begin(seed){
      const ticket=++generation;
      current={ticket,seed,runId:null,actions:[],eligible:enabled,complete:false,score:0};
      pending=null;busy=false;
      if(!enabled)return;
      try{
        const run=await request("runs",{version:2,mode:"standard",seed});
        if(!UUID.test(run.runId)||run.seed!==seed||run.version!==2||run.mode!=="standard"||!Number.isFinite(run.expiresAt))throw new Error();
        if(current&&current.ticket===ticket)current.runId=run.runId;
      }catch(_){if(current&&current.ticket===ticket)current.eligible=false;}
    }
    function record(action){
      if(!current||!current.eligible||current.complete)return;
      if(current.actions.length>=512){current.eligible=false;return;}
      current.actions.push({...action});
    }
    function finish(score){if(current){current.complete=true;current.score=score;}}
    function cancel(){generation++;current=null;pending=null;busy=false;}
    function canSubmit(){return Boolean(current&&current.eligible&&current.runId&&current.complete&&Core.isValidScore(current.score));}
    async function submit(name,consent){
      if(!consent)return {state:"consent"};
      if(busy)return {state:"busy"};
      if(!canSubmit())return {state:enabled?"unavailable":"disabled"};
      const ticket=current.ticket;
      // Freeze once. Language changes, retries and name edits cannot mutate an in-flight submission.
      if(!pending)pending=JSON.stringify({runId:current.runId,name,actions:current.actions});
      busy=true;
      try{
        if(new TextEncoder().encode(pending).length>32768)throw Object.assign(new Error(),{code:"invalid"});
        const result=await request("scores",JSON.parse(pending));
        if(!result||result.accepted!==true||result.score!==current?.score||typeof result.ranked!=="boolean")throw Object.assign(new Error(),{code:"invalid-response"});
        if(!current||current.ticket!==ticket)return {state:"stale"};
        current.eligible=false;
        return {state:"accepted",ranked:result.ranked};
      }catch(error){
        if(!current||current.ticket!==ticket)return {state:"stale"};
        const terminal=["expired","conflict","invalid"].includes(error.code);
        if(terminal)current.eligible=false;
        return {state:terminal?error.code:error.code==="rate"?"rate":"retry"};
      }finally{if(current&&current.ticket===ticket)busy=false;}
    }
    return {enabled,top,begin,record,finish,cancel,canSubmit,submit,isBusy:()=>busy};
  }
  return {create};
});
