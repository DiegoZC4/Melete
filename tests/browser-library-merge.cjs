const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
async function checkLibraryMerge(browser){
  const context=await browser.newContext();
  try{
    await context.route('https://library.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Library test</title>'}));
    const page=await context.newPage();await page.goto('https://library.test/');
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
    const exporter=await fs.readFile(require.resolve('../tools/local_station/library_export.html'),'utf8');
    const script=await fs.readFile(require.resolve('../tools/local_station/library_archive.js'),'utf8');
    await context.route('https://library.test/backup/',r=>r.fulfill({contentType:'text/html',body:exporter}));
    await context.route('https://library.test/backup/library_archive.js',r=>r.fulfill({contentType:'text/javascript',body:script}));
    await page.evaluate(()=>{localStorage.setItem('melete:cloud:test-login','not-for-export');localStorage.setItem('melete:take-octaves:song','{"source":1}');});
    await page.goto('https://library.test/backup/');
    const requests=[];page.on('request',r=>requests.push(r.url()));
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download recording library'}).click()]);
    const file=await fs.readFile(await download.path()),lib=require('../tools/local_station/library_archive.js');
    const data=lib.unpack(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength));
    assert.deepEqual(data.preferences,{'melete:take-octaves:song':'{"source":1}'});
    assert.deepEqual(Array.from(data.stores.chunks[0][1]),[1,2,3]);assert.equal(data.stores.comps.length,1);
    assert.ok(!requests.some(url=>/^https?:/.test(url)),'export never sends private recordings to a server');
    const maintenance=await fs.readFile(require.resolve('../tools/local_station/library_archive.html'),'utf8');
    await context.route('https://recovery.test/local-library/',r=>r.fulfill({contentType:'text/html',body:maintenance}));
    await context.route('https://recovery.test/local-library/archive.js',r=>r.fulfill({contentType:'text/javascript',body:script}));
    await page.goto('https://recovery.test/local-library/');
    await page.evaluate(async()=>{
      const q=indexedDB.open('melete-audio-takes-v1',2);
      q.onupgradeneeded=()=>{for(const [name,keyPath] of [['takes','id'],['comps','key'],['chunks',['takeId','offset']],['counters',null]])
        q.result.createObjectStore(name,keyPath?{keyPath}:undefined);};
      const db=await new Promise((ok,no)=>{q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
      const tx=db.transaction(MeleteLibraryArchive.names,'readwrite'), ref={part:0,fingerprint:'f:ref:r',scoreClock:'r'},slot='daily';
      const key=JSON.stringify([1,'song',ref.fingerprint,0,null,1,[],3,slot]),descriptor={song:'song',reference:ref,slot,label:'B2'};
      const segment=takeId=>({from:0,to:1,takeId});
      for(const [i,id] of ['first','latest','damaged'].entries()){
        tx.objectStore('takes').add({id,song:'song',trackSlot:slot,pitchReference:ref,number:i+1,frames:3,practiceTimeFrames:3,finalized:true,complete:true});
        tx.objectStore('chunks').add({takeId:id,offset:0,pcm:new Int16Array([101+i,-100])});
        if(id!=='damaged')tx.objectStore('chunks').add({takeId:id,offset:2,pcm:new Int16Array([321])});
      }
      tx.objectStore('comps').add({key,song:'song',descriptor,offerVersion:2,trackVersion:1,segments:[segment('latest')]});
      const edits=[{at:1000,ids:['first','damaged']},{at:2000,ids:['first']},{at:3000,ids:['latest']}];
      tx.objectStore('counters').add({past:edits.map(({at,ids})=>({key,at,after:{segments:ids.map(segment),track:false,firstTakeNumber:1}})),future:[],revision:7},['comp-edit-history','song']);
      await new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});
      window.original=await MeleteLibraryArchive.snapshot(db);db.close();
    });
    await page.getByText('Recover an earlier practice comp').click();
    await page.waitForFunction(()=>document.getElementById('edits').options.length===2);
    const copy=page.getByRole('button',{name:'Copy as separate local track'}), status=page.getByRole('status');
    await page.getByLabel('Saved edit').selectOption('1');await copy.click();
    await status.filter({hasText:'Full source audio is no longer retained'}).waitFor();
    assert.ok(await page.evaluate(async()=>{const l=MeleteLibraryArchive,db=await l.open();try{return l.equal(original,await l.snapshot(db));}finally{db.close();}}),'a missing tail rolls back every copy');
    await page.getByLabel('Saved edit').selectOption('0');await copy.click();await status.filter({hasText:'Copied as a separate local track'}).waitFor();
    await copy.click();await status.filter({hasText:'Already copied'}).waitFor();
    assert.deepEqual(await page.evaluate(async()=>{const l=MeleteLibraryArchive,db=await l.open(),result=await l.snapshot(db);db.close();
      const copy=result.stores.comps.find(([key])=>key!==original.stores.comps[0][0])[1], id=copy.segments[0].takeId;
      return {originals:l.names.every(n=>original.stores[n].every(([k,v])=>result.stores[n].some(([kk,vv])=>l.equal(k,kk)&&l.equal(v,vv)))),
        counts:l.summary(result).counts,samples:result.stores.chunks.filter(([k])=>k[0]===id).flatMap(([,v])=>Array.from(v.pcm)),
        clock:copy.descriptor.reference.scoreClock,private:JSON.parse(localStorage.getItem('melete:cloud:local-only:v1')).includes(JSON.stringify(['song',0,null,copy.descriptor.slot]))};
    }),{originals:true,counts:{takes:4,chunks:7,comps:2,counters:2},samples:[101,-100,321],clock:'r',private:true});
    return proof;
  }finally{await context.close();}
}
module.exports={checkLibraryMerge};
