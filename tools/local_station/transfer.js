/* Offline, one-time handoff from the installed file to the laptop's own origin. */
(async function () {
  'use strict';
  const home='http://127.0.0.1:18746', dbName='melete-audio-takes-v1', names=['takes','chunks','comps','counters'];
  const token=location.hash.slice(1), status=document.getElementById('stationProgress');
  if(!/^[a-f0-9]{64}$/.test(token) || !status) return;
  const keyOk=k=>/^(?:melete:|choir-practice:)/.test(k);
  const request=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
  const done=t=>new Promise((ok,no)=>{t.oncomplete=ok;t.onabort=t.onerror=()=>no(t.error || Error('Storage transaction interrupted'));});
  const signature=b=>crypto.subtle.digest('SHA-256',b).then(x=>Array.from(new Uint8Array(x),v=>v.toString(16).padStart(2,'0')).join(''));
  async function snapshot(db) {
    const tx=db.transaction(names), finish=done(tx), stores={};
    await Promise.all(names.map(async name=>{
      const s=tx.objectStore(name), [keys,values]=await Promise.all([request(s.getAllKeys()),request(s.getAll())]);
      stores[name]=keys.map((k,i)=>[k,values[i]]);
    })); await finish; return stores;
  }
  // Melete's structured records contain typed PCM and sometimes nonfinite pitch
  // statistics. Keep native types and exact bytes, including offsets of views.
  function pack(stores,preferences) {
    const buffers=[]; let at=0;
    function encode(v) {
      if(v===undefined) return {$melete:'undefined'};
      if(typeof v==='number'&&!Number.isFinite(v)) return {$melete:'number',value:String(v)};
      if(v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
        const bytes=v instanceof ArrayBuffer?new Uint8Array(v):new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
        const item={$melete:'binary',type:v.constructor.name,at,bytes:bytes.length};
        buffers.push(bytes);at+=bytes.length;return item;
      }
      if(v instanceof Date) return {$melete:'date',value:v.toISOString()};
      if(Array.isArray(v)) return v.map(encode);
      if(v&&typeof v==='object') {
        if(Object.getPrototypeOf(v)!==Object.prototype||Object.hasOwn(v,'$melete')) throw Error('Unsupported recording field; source has not been changed.');
        return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));
      } return v;
    }
    const header=new TextEncoder().encode(JSON.stringify({format:1,preferences,stores:Object.fromEntries(names.map(n=>[n,encode(stores[n])]))}));
    const len=new Uint8Array(4); new DataView(len.buffer).setUint32(0,header.length,true);
    return new Blob([len,header,...buffers],{type:'application/octet-stream'});
  }
  function unpack(bytes) {
    const header=new DataView(bytes).getUint32(0,true), start=4+header;
    if(start>bytes.byteLength) throw Error('Incomplete recording package');
    const manifest=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,4,header)));
    const types={Int16Array,Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int32Array,Uint8ClampedArray,DataView};
    function decode(v) {
      if(!v||typeof v!=='object')return v;
      if(Array.isArray(v))return v.map(decode);
      if(!Object.hasOwn(v,'$melete'))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));
      if(v.$melete==='undefined')return undefined;
      if(v.$melete==='date')return new Date(v.value);
      if(v.$melete==='number')return Number(v.value);
      if(v.$melete!=='binary'||!Number.isSafeInteger(v.at)||!Number.isSafeInteger(v.bytes)||v.at<0||v.bytes<0||start+v.at+v.bytes>bytes.byteLength)throw Error('Invalid recording field');
      const raw=bytes.slice(start+v.at,start+v.at+v.bytes);
      if(v.type==='ArrayBuffer')return raw;
      if(!Object.hasOwn(types,v.type))throw Error('Unknown recording format');
      return new types[v.type](raw);
    }
    if(manifest.format!==1 || names.some(n=>!Array.isArray(manifest.stores[n])))throw Error('Unknown recording database format');
    return {stores:decode(manifest.stores),preferences:manifest.preferences};
  }
  try {
    if(location.protocol==='file:') {
      if(!(await indexedDB.databases()).some(x=>x.name===dbName))throw Error('No Melete library was found in this Chrome profile. Open the shortcut using the rehearsal profile.');
      const db=await request(indexedDB.open(dbName));
      if(db.version!==2||db.objectStoreNames.length!==names.length)throw Error('The source database format has changed.');
      let stores;
      for(;;) {
        stores=await snapshot(db);
        if(!stores.takes.some(([,t])=>!t.finalized && Date.now()-Math.max(t.createdAt||0,t.updatedAt||0)<180000))break;
        status.textContent='Waiting for the current take to finish. Save it in the original Melete tab; this window will continue automatically.';
        stores=null; await new Promise(r=>setTimeout(r,2500));
      }
      db.close(); const prefs={};
      for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(keyOk(k))prefs[k]=localStorage.getItem(k);}
      // Browser device IDs change with the origin. Both origins start with the
      // system's currently selected microphone unless the singer selects another.
      delete prefs['choir-practice:microphone:v1'];
      status.textContent='Copying '+stores.takes.length+' takes, tracks and settings on this laptop…';
      const payload=pack(stores,prefs), sha=await signature(await payload.arrayBuffer());
      const transfer=new DataTransfer();transfer.items.add(new File([payload],'melete.pack'));
      const form=document.createElement('form'),input=document.createElement('input');
      form.method='POST';form.action=home+'/stage/'+token+'/'+sha;form.enctype='multipart/form-data';
      input.type='file';input.name='library';input.files=transfer.files;form.append(input);form.hidden=true;
      document.body.append(form);form.submit();return;
    }
    if(location.origin!==home) return;
    status.textContent='Checking the recording copy…';
    const response=await fetch('/package/'+token,{cache:'no-store'});if(!response.ok)throw Error('Reopen the desktop shortcut to retry the transfer.');
    const bytes=await response.arrayBuffer(), sha=response.headers.get('X-Melete-SHA256');
    if(!sha||await signature(bytes)!==sha)throw Error('The recording copy failed verification.');
    const {stores,preferences}=unpack(bytes); const db=await new MeleteRecording.TakeStore().open();
    const current=await snapshot(db), notEmpty=names.some(n=>current[n].length);
    if(notEmpty) {
      if(await signature(await pack(current,preferences).arrayBuffer())!==sha)throw Error('The destination already has different recordings. Neither library was changed.');
    } else {
      status.textContent='Restoring '+stores.takes.length+' original takes and their history…';
      const tx=db.transaction(names,'readwrite'), finish=done(tx);
      for(const name of names){const s=tx.objectStore(name);for(const [key,value] of stores[name])s.keyPath===null?s.add(value,key):s.add(value);}
      await finish;
      if(await signature(await pack(await snapshot(db),preferences).arrayBuffer())!==sha)throw Error('Destination verification failed. The source is unchanged.');
    }
    for(const [k,v] of Object.entries(preferences))if(keyOk(k)&&localStorage.getItem(k)===null)localStorage.setItem(k,v);
    db.close(); localStorage.setItem('melete:local-station:ready','1');
    const receipt=await fetch('/complete/'+token,{method:'POST',headers:{'Content-Type':'text/plain'},body:sha});
    if(!receipt.ok)throw Error('Could not save the verified transfer receipt.');
    location.replace('/practice?mode=station#autumn');
  } catch(e) { status.textContent='Melete could not finish opening the station: '+e.message+' Your original file and recordings are intact.'; }
})();
