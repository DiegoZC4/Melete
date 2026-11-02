// Disposable, device-local timing probe. Never uses the singer's preferences or takes.
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node prepare-clock-probe.cjs player.html probe.html');
let html = fs.readFileSync(input, 'utf8').replaceAll('choir-practice', 'melete-clock-probe');
html = html.replace('      loadPreferences();', `
      localStorage.setItem(preferenceKey, JSON.stringify({scoreView:'bars',practicePart:parts.length-1,
        visible:parts.map((_,i)=>i===parts.length-1),audible:parts.map(()=>true),sing:false,
        horizontal:200,vertical:120,tempo:100}));
      loadPreferences();`);
const marker = 'engine = new GuideEngine(sequence);';
if (!html.includes(marker)) throw new Error('Player instrumentation marker missing');
html = html.replace(marker, marker + `
      addEventListener('pagehide',()=>{
        for(const key of Object.keys(localStorage))if(key.startsWith('melete-clock-probe'))localStorage.removeItem(key);
      });
      const diagnostic = document.createElement('pre');
      diagnostic.id = 'clock-probe';
      diagnostic.style.cssText = 'position:fixed;bottom:0;right:0;z-index:99999;background:white;color:black;padding:12px;font:12px monospace;pointer-events:none';
      diagnostic.textContent = 'Clock probe: press Play. Stops after eight seconds.';
      document.body.append(diagnostic);
      const samples = [], originalPush = engine.pushPosition;
      const originalPlay = engine.play;
      engine.play = function() { samples.length=0; return originalPlay.call(this); };
      engine.pushPosition = function(seconds) {
        const before=performance.now();
        originalPush.call(this,seconds);
        if (!this.playing) return;
        const stamp=this.context.getOutputTimestamp();
        const cursor=[...document.querySelectorAll('.bar-playhead')].find(node=>
          node.getAttribute('visibility')==='visible'||(node.tagName==='DIV'&&Number(getComputedStyle(node).opacity)>.5));
        const row=cursor?.closest('.bar-system'), plot=row?.querySelector('.bar-system-background');
        const x=cursor?.tagName==='DIV'?new DOMMatrixReadOnly(getComputedStyle(cursor).transform).m41+1:Number(cursor?.getAttribute('x1'));
        const tick=row && plot ? Number(row.dataset.startTick)+(x-Number(plot.getAttribute('x')))
          /Number(plot.getAttribute('width'))*(Number(row.dataset.endTick)-Number(row.dataset.startTick)) : null;
        samples.push({at:before,lag:(this.currentSeconds()-seconds)*1000,
          barLag:tick===null?null:(seconds-this.secondsAtTick(tick))*1000,
          stampAge:before-stamp.performanceTime,stampTime:stamp.contextTime,
          currentTime:this.context.currentTime,baseLatency:this.context.baseLatency,outputLatency:this.context.outputLatency,
          microphone:pitchCaptureState, inputLatency:pitchCaptureStream?.getAudioTracks()[0]?.getSettings().latency,
          cost:performance.now()-before});
        if(samples.length%12===0) diagnostic.textContent=JSON.stringify({samples:samples.length,
          latest:samples.at(-1),maxLag:Math.max(...samples.map(s=>s.lag)),
          maxFrameGap:Math.max(...samples.slice(1).map((s,i)=>s.at-samples[i].at))},null,2);
        if(before-samples[0].at>8000) this.pauseTransport();
      };
      api.playerReady.on(()=>setTimeout(()=>{
        if(sequence.measures.length>18) engine.seek(engine.secondsAtTick(sequence.measures[18][0]));
      },600));
`);
fs.writeFileSync(output, html);
console.log(output);
