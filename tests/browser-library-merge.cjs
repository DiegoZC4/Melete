const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
async function checkLibraryMerge(browser){
  const context=await browser.newContext();
  try{
    await context.route('http://library.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Library test</title>'}));
    const page=await context.newPage();await page.goto('http://library.test/');
    await page.addScriptTag({content:await fs.readFile(require.resolve('../tools/local_station/library_archive.js'),'utf8')});
    const proof=await page.evaluate(async()=>{
      const L=MeleteLibraryArchive, req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
      const r=indexedDB.open('melete-audio-takes-v1',2);r.onupgradeneeded=()=>{
        r.result.createObjectStore('takes',{keyPath:'id'});r.result.createObjectStore('comps',{keyPath:'key'});
        r.result.createObjectStore('chunks');r.result.createObjectStore('counters');};
      const db=await req(r), empty={stores:Object.fromEntries(L.names.map(n=>[n,[]])),preferences:{}};
      const ref={part:0,line:null}, descriptor={song:'song',reference:ref},key=JSON.stringify([1,'song','f',0,null,1,[],1]);
      const src={stores:{takes:[['source',{id:'source',song:'song',pitchReference:ref,finalized:true}]],
        chunks:[[['source',0],new Int16Array([1,2,3])]],comps:[[key,{key,song:'song',descriptor,segments:[{takeId:'source',from:0,to:1}]}]],counters:[]},preferences:{}};
      const plan=L.plan(empty,src,'a'.repeat(64));await L.apply(db,empty,plan);
      const after=await L.snapshot(db), again=L.plan(after,src,'a'.repeat(64));await L.apply(db,after,again);
      const before=L.pack(after);let conflict=false;
      try{await L.apply(db,empty,plan);}catch(e){conflict=/changed/.test(e.message);}
      const stable=L.equal(L.unpack(await before.arrayBuffer()),await L.snapshot(db));
      db.close();return {counts:L.summary(after).counts,conflict,stable,idempotent:again.alreadyMerged,
        pcm:Array.from(after.stores.chunks[0][1])};
    });
    assert.deepEqual(proof,{counts:{takes:1,chunks:1,comps:1,counters:1},conflict:true,stable:true,idempotent:true,pcm:[1,2,3]});
    return proof;
  }finally{await context.close();}
}
module.exports={checkLibraryMerge};
