// Diagnostic copy of a collection; reads existing Melete settings/trace but never writes them.
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node prepare-live-timing-probe.cjs collection.html probe.html');
const original = fs.readFileSync(input, 'utf8');
const match = original.match(/(<script id="songs" type="application\/json">)([\s\S]*?)(<\/script>)/);
if (!match) throw new Error('Collection songs not found');
const songs = JSON.parse(match[2]);
for (const song of songs) {
  let html = Buffer.from(song.html, 'base64').toString('utf8');
  html = html.replace('      loadPreferences();', `
      const realStorage = window.localStorage, memoryStorage = new Map();
      for (const key of Object.keys(realStorage)) if (key.startsWith('choir-practice:solstice-2026-')) memoryStorage.set(key, realStorage.getItem(key));
      Object.defineProperty(window, 'localStorage', {value:{
        getItem:key=>memoryStorage.get(key)??null, setItem:(key,value)=>memoryStorage.set(key,String(value)),
        removeItem:key=>memoryStorage.delete(key), key:i=>[...memoryStorage.keys()][i]??null,
        get length(){return memoryStorage.size;}
      }});
      loadTakeLibrary = async()=>{};
      loadPreferences();`);
  const marker = 'engine = new GuideEngine(sequence);';
  if (!html.includes(marker)) throw new Error('Instrumentation marker missing');
  html = html.replace(marker, marker + `
      const diagnostic = document.createElement('pre');
      diagnostic.id = 'clock-probe';
      diagnostic.style.cssText = 'position:fixed;bottom:0;right:0;z-index:99999;background:white;color:black;padding:8px;font:12px monospace;pointer-events:none';
      diagnostic.textContent = 'Read-only timing probe. Play stops after 20 seconds.';
      document.body.append(diagnostic);
      elements.recordTake.disabled=true;
      const samples=[], stalls=[], scheduled=[];
      const pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)]||0;
      try { new PerformanceObserver(list=>stalls.push(...list.getEntries().map(e=>({
        duration:e.duration,blocking:e.blockingDuration,render:e.renderStart,style:e.styleAndLayoutStart,
        scripts:e.scripts?.map(s=>({fn:s.sourceFunctionName,duration:s.duration,layout:s.forcedStyleAndLayoutDuration}))
      })))).observe({type:'long-animation-frame',buffered:false}); } catch{}
      let previous=0, first=0, noteExpected=null;
      const ensureAudio=engine.ensureAudio;
      engine.ensureAudio=function(){
        const existed=!!this.context;ensureAudio.call(this);if(existed)return;
        const create=this.context.createOscillator.bind(this.context);
        this.context.createOscillator=()=>{
          const oscillator=create(), start=oscillator.start.bind(oscillator);
          oscillator.start=at=>{ if(noteExpected!==null)scheduled.push((at-noteExpected)*1000);start(at); };
          return oscillator;
        };
      };
      const schedule=engine.scheduleNote;
      engine.scheduleNote=function(note,...args){
        noteExpected=this.anchorTime+(Math.max(note.start,args[0])-this.basePosition)/this.rate;
        try{return schedule.call(this,note,...args);}finally{noteExpected=null;}
      };
      const originalPlay=engine.play;
      engine.play=function(){samples.length=stalls.length=scheduled.length=0;previous=first=0;return originalPlay.call(this);};
      const push=engine.pushPosition;
      engine.pushPosition=function(seconds){
        const now=performance.now();push.call(this,seconds);if(!this.playing)return;
        first ||= now;
        const stamp=this.context.getOutputTimestamp();
        const cursor=barSystems.find(s=>seconds>=engine.secondsAtTick(s.startTick)&&seconds<engine.secondsAtTick(s.endTick))?.cursor;
        samples.push({gap:previous?now-previous:0,delay:(this.currentSeconds()-seconds)*1000/this.rate,
          cost:performance.now()-now,stampAge:now-stamp.performanceTime});previous=now;
        if(samples.length%15===0)diagnostic.textContent=JSON.stringify({
          frames:samples.length,seconds:(now-first)/1000,trace:pitchTraceCount,sing:pitchCaptureState,
          frameGapP95:pct(samples.map(s=>s.gap),.95),frameGapMax:Math.max(...samples.map(s=>s.gap)),
          clockDelayP95:pct(samples.map(s=>s.delay),.95),clockDelayMax:Math.max(...samples.map(s=>s.delay)),
          callbackCostP95:pct(samples.map(s=>s.cost),.95),stampAgeP95:pct(samples.map(s=>s.stampAge),.95),
          audioLateP95:pct(scheduled,.95),audioLateMax:Math.max(0,...scheduled),
          baseLatency:this.context.baseLatency,outputLatency:this.context.outputLatency,
          cursor:cursor?.outerHTML.slice(0,250),
          motion:typeof barPlayheadMotion!=='undefined'&&barPlayheadMotion?{
            anchor:barPlayheadMotion.now,animations:barPlayheadMotion.animations.length,
            transform:getComputedStyle(cursor).transform,opacity:getComputedStyle(cursor).opacity
          }:null,stalls:stalls.slice(-5)
        },null,2);
        if(now-first>20000)this.pauseTransport();
      };
      api.playerReady.on(()=>setTimeout(()=>{
        if(sequence.measures.length>18)engine.seek(engine.secondsAtTick(sequence.measures[18][0]));
      },600));
  `);
  song.html = Buffer.from(html).toString('base64');
}
fs.writeFileSync(output, original.replace(match[0], match[1]+JSON.stringify(songs)+match[3]));
console.log(output);
