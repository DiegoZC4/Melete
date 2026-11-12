/* Read older pitch-only practice records without creating new ones. */
((root)=>{
  "use strict";
  const prefix="practice-contour:1";
  const key=(song,part,line,singer,fingerprint)=>[prefix,song,part,line??-1,singer?.id||"",fingerprint];
  const id=k=>"trace:"+JSON.stringify(k);
  const unpack=data=>{
    const out=[];
    for(let i=0;i<(data?.length||0);i+=3) out.push({start:data[i]/1000,end:data[i+1]/1000,cents:data[i+2],live:true});
    return out;
  };
  function read(store,k) {
    return store.transaction(["counters"],"readonly",(tx,done)=>{
      tx.objectStore("counters").get(k).onsuccess=e=>done(e.target.result || null);
    });
  }
  function remove(store,k) {
    return store.transaction(["counters"],"readwrite",tx=>{tx.objectStore("counters").delete(k);});
  }
  const api={key,id,unpack,read,remove};
  if(typeof module==="object"&&module.exports) module.exports=api;else root.MeletePracticeTrace=api;
})(globalThis);
