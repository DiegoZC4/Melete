/* One audio-free practice trace per score, channel and station singer. */
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
  function pack(frames) {
    const data=new Int32Array(frames.length*3);
    frames.forEach((f,i)=>data.set([Math.round(f.start*1000),Math.round(f.end*1000),Math.round(f.cents)],3*i));
    return data;
  }
  function merge(old,observations) {
    // Preserve gaps the detector never observed. Observed silence, unlike a
    // missing sample, can erase old singing in precisely that interval.
    const starts=new Map();
    for(const f of observations) {
      const a=Math.round(f.start*1000), b=Math.round(f.end*1000);
      if(Number.isFinite(a)&&Number.isFinite(b)&&b>a) starts.set(a,{start:a/1000,end:b/1000,cents:f.cents});
    }
    const batch=[...starts.values()].sort((a,b)=>a.start-b.start),ranges=[];
    for(let i=0;i<batch.length;i++){
      const f=batch[i];if(batch[i+1])f.end=Math.min(f.end,batch[i+1].start);
      const last=ranges.at(-1);
      if(last && f.start<=last[1]+.001)last[1]=f.end;else ranges.push([f.start,f.end]);
    }
    const kept=[];let j=0;
    for(const f of unpack(old)) {
      let a=f.start;while(j<ranges.length&&ranges[j][1]<=a)j++;
      for(let k=j;k<ranges.length&&ranges[k][0]<f.end;k++) {
        if(a<ranges[k][0])kept.push({...f,start:a,end:ranges[k][0]});
        a=Math.max(a,ranges[k][1]);if(a>=f.end)break;
      }
      if(a<f.end)kept.push({...f,start:a});
    }
    return pack(kept.concat(batch.filter(f=>Number.isFinite(f.cents))).sort((a,b)=>a.start-b.start));
  }
  function read(store,k) {
    return store.transaction(["counters"],"readonly",(tx,done)=>{
      tx.objectStore("counters").get(k).onsuccess=e=>done(e.target.result || null);
    });
  }
  function remove(store,k) {
    return store.transaction(["counters"],"readwrite",tx=>{tx.objectStore("counters").delete(k);});
  }
  function save(store,k,frames,days) {
    return store.transaction(["counters"],"readwrite",(tx,done,fail)=>{
      const table=tx.objectStore("counters");
      table.get(k).onsuccess=e=>{try {
        for(const [day,seconds] of days) {
          const counter=["recording-seconds",day];
          table.get(counter).onsuccess=r=>table.put((r.target.result||0)+seconds,counter);
        }
        const before=e.target.result,data=merge(before?.data,frames);
        if(!data.length){if(before)table.delete(k);done(null);return;}
        const now=Date.now(),record={data,createdAt:before?.createdAt||now,updatedAt:now};
        table.put(record,k);done(record);
      }catch(error){fail(error);}};
    });
  }
  function writer(store,k,spec,onError) {
    let batch=[],pending=Promise.resolve(null),lastTime=null,failed=null,timer=null;
    const checkpoint=(finish=false)=>{
      const from=lastTime,to=Date.now(),frames=batch;batch=[];lastTime=finish?null:to;
      const days=from===null ? [] : root.MeleteRecording.recordingDays({createdAt:from,sampleRate:1000},Math.max(0,to-from));
      if(finish)clearInterval(timer);
      if(!frames.length && !days.length)return pending;
      pending=pending.then(result=>failed?result:save(store,k,frames,days)).catch(error=>{
        if(!failed){failed=error;clearInterval(timer);onError(error);}return null;});
      return pending;
    };
    return {key:k,spec,begin(){if(lastTime!==null)checkpoint();lastTime=Date.now();timer??=setInterval(()=>checkpoint(),2000);},
      observe(start,end,cents){if(lastTime!==null&&!failed)batch.push({start,end,cents});},
      finish(){return checkpoint(true);},get failed(){return failed;}};
  }
  const api={key,id,unpack,merge,read,remove,writer};
  if(typeof module==="object"&&module.exports) module.exports=api;else root.MeletePracticeTrace=api;
})(globalThis);
