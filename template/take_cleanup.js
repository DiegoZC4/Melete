/* Listening/export cleanup; stored microphone audio stays intact. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("../vendor/fft/fft.js") : null);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeCleanup = api;
})(globalThis, function cleanupTools(FFT) {
  "use strict";
  const VERSION = 2;
  const SETTINGS = Object.freeze({
    voicedGuard: .04, attackGuard: .10, releaseGuard: .06, observedFraction: .7,
    minimumRms: .0008, minimumFlatness: .12, maximumCentroid: 4800,
    maximumHighFraction: .35, minimumDuration: .06, maximumDuration: 1.2,
    bridgeGap: .02, edgePadding: .03, fade: .008,
  });
  function breathRanges(pcm, rate, frames, ref) {
    if (!frames?.length || !ref?.notes || !(rate >= 8000)) return [];
    const size = 2 ** Math.ceil(Math.log2(rate * .025)), hop = Math.round(rate * .01);
    const fft = new FFT(size), input = new Float64Array(size), spectrum = fft.createComplexArray();
    const window = Float64Array.from({length:size}, (_,i) => .5-.5*Math.cos(2*Math.PI*i/(size-1)));
    const blocks = [], latency = ref.latency || 0;
    let frameIndex = 0, noteIndex = 0;
    for (let offset = 0; offset + size <= pcm.length; offset += hop) {
      const center = (offset + size/2) / rate - latency;
      const from = center - SETTINGS.voicedGuard, to = center + SETTINGS.voicedGuard;
      while (frameIndex < frames.length && frames[frameIndex].end < from) frameIndex++;
      let observed = 0, voiced = false;
      for (let j=frameIndex;j<frames.length&&frames[j].start<to;j++) {
        const f=frames[j]; if(Number.isFinite(f.cents)){voiced=true;break;}
        observed += Math.max(0,Math.min(to,f.end)-Math.max(from,f.start));
      }
      while(noteIndex<ref.notes.length&&ref.notes[noteIndex][1]<center-SETTINGS.releaseGuard)noteIndex++;
      const nearWord = ref.notes.slice(noteIndex,noteIndex+2).some(([a,b])=>
        Math.abs(center-a)<SETTINGS.attackGuard||Math.abs(center-b)<SETTINGS.releaseGuard);
      const eligible = !voiced && observed >= (to-from)*SETTINGS.observedFraction && !nearWord;
      let candidate = eligible, rms = 0;
      if (eligible) {
        for(let i=0;i<size;i++){const x=pcm[offset+i]/32768;rms+=x*x;input[i]=x*window[i];}
        rms=Math.sqrt(rms/size); candidate=rms>SETTINGS.minimumRms;
      }
      if(candidate){
        fft.realTransform(spectrum,input);
        let sum=0,logs=0,count=0,weighted=0,high=0;
        for(let k=Math.max(1,Math.floor(150*size/rate));k<Math.min(size/2,Math.ceil(8000*size/rate));k++){
          const p=spectrum[2*k]**2+spectrum[2*k+1]**2+1e-15,hz=k*rate/size;
          sum+=p;logs+=Math.log(p);weighted+=p*hz;count++;if(hz>6000)high+=p;
        }
        const flatness=Math.exp(logs/count)/(sum/count);
        candidate=flatness>SETTINGS.minimumFlatness&&weighted/sum<SETTINGS.maximumCentroid&&high/sum<SETTINGS.maximumHighFraction;
      }
      blocks.push({from:Math.max(0,(offset+size/2-hop/2)/rate),to:Math.min(pcm.length/rate,(offset+size/2+hop/2)/rate),candidate,eligible,rms});
    }
    // Brief spectral dips split a single inhalation. Never bridge a protected voice/word boundary.
    const bridge=Math.floor(SETTINGS.bridgeGap*rate/hop),padding=Math.round(SETTINGS.edgePadding*rate/hop);
    for(let i=1;i<blocks.length;i++){
      if(blocks[i].candidate||!blocks[i-1].candidate)continue;
      let end=i;while(end<blocks.length&&!blocks[end].candidate&&blocks[end].eligible&&end-i<bridge)end++;
      if(end<blocks.length&&blocks[end].candidate)for(let j=i;j<end;j++)blocks[j].candidate=true;
    }
    // A fluctuating hiss must not become many small "breaths" when its spectrum changes.
    for(let i=0;i<blocks.length;){
      if(!blocks[i].eligible||blocks[i].rms<=SETTINGS.minimumRms){i++;continue;}
      const first=i;while(i<blocks.length&&blocks[i].eligible&&blocks[i].rms>SETTINGS.minimumRms)i++;
      if(blocks[i-1].to-blocks[first].from>SETTINGS.maximumDuration)
        for(let j=first;j<i;j++)blocks[j].candidate=false;
    }
    const ranges=[];
    for(let i=0;i<blocks.length;){
      if(!blocks[i].candidate){i++;continue;}
      let first=i;while(i<blocks.length&&blocks[i].candidate)i++;
      let last=i-1;
      const duration=blocks[last].to-blocks[first].from;
      // Short consonants/clicks and persistent room hiss are not breaths.
      if(duration<SETTINGS.minimumDuration-1e-9||duration>SETTINGS.maximumDuration)continue;
      for(let j=0;j<padding&&first>0&&blocks[first-1].eligible;j++)first--;
      for(let j=0;j<padding&&last+1<blocks.length&&blocks[last+1].eligible;j++)last++;
      const from=blocks[first].from,to=blocks[last].to,previous=ranges.at(-1);
      if(previous&&previous[1]>=from)previous[1]=Math.max(previous[1],to);
      else ranges.push([from,to]);
    }
    return ranges;
  }
  function apply(pcm, rate, ranges) {
    const fade=Math.max(1,Math.round(SETTINGS.fade*rate));
    for(const [a,b] of ranges){
      const from=Math.max(0,Math.round(a*rate)),to=Math.min(pcm.length,Math.round(b*rate));
      for(let i=from;i<to;i++)pcm[i]*=Math.max(0,1-(i-from)/fade,1-(to-1-i)/fade);
    }
    return pcm;
  }
  function workerSource(pitchy) {
    return `const window=globalThis;\n${pitchy}\nconst cleanup=(${cleanupTools.toString()})(Pitchy.FFT);
      onmessage=({data:m})=>{try{
        const view=new DataView(m.wav);
        if(view.getUint16(22,true)!==1||view.getUint16(34,true)!==16||view.byteLength!==44+m.take.frames*2)throw Error('Unsupported recording format');
        const pcm=new Int16Array(m.wav,44),ranges=cleanup.breathRanges(pcm,m.take.sampleRate,m.frames,m.take.pitchReference);
        cleanup.apply(pcm,m.take.sampleRate,ranges);postMessage({wav:m.wav,ranges},[m.wav]);
      }catch(e){postMessage({error:e.message});}};`;
  }
  async function prepare(blob,take,frames,pitchy){
    if(!frames?.length)return {blob,ranges:[]};
    const url=URL.createObjectURL(new Blob([workerSource(pitchy)],{type:"text/javascript"}));
    const worker=new Worker(url);let timer;
    try{
      const wav=await blob.arrayBuffer();
      const result=await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(new Error("Breath cleanup timed out")),60000);
        worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data);
        worker.onerror=()=>reject(new Error("Breath cleanup unavailable"));
        worker.postMessage({wav,frames,take:{frames:take.frames,sampleRate:take.sampleRate,pitchReference:take.pitchReference}},[wav]);
      });
      return {blob:new Blob([result.wav],{type:"audio/wav"}),ranges:result.ranges};
    }finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);}
  }
  return {VERSION,SETTINGS,breathRanges,apply,prepare,workerSource};
});
