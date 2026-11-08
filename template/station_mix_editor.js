/* Station mix previews own their notes, never the transport or microphone. */
((root)=>{
  "use strict";
  function create({dialog,channels,roles,compare,drag,pan,thumb,engine,guide,restore,address}) {
    const mix=root.MeletePracticeMix, el=id=>dialog.querySelector("#"+id);
    const mode=el("stationMixMode"), select=el("stationMixGuide"), listen=el("stationMixListen");
    const status=el("stationMixStatus"), link=el("stationMixUrl"), controls=new Map(), rows=new Map();
    const ordered=channels.map((part,index)=>({part,index})).sort((a,b)=>compare(a.part.short,b.part.short));
    const audible=new Set(channels.keys()),voices=new Set();
    let draft, timer=0, request=0, sampling=false, session=0, saved=false;
    for(const {part,index} of ordered) {
      select.add(new Option(part.name,String(index)));
      const row=document.createElement("div");row.className="mix-seat";
      const name=document.createElement("span"), rail=document.createElement("i"), volume=document.createElement("span");
      name.textContent=part.short;row.style.setProperty("--seat-color",part.color);
      row.append(name,rail,volume);rows.set(index,row);el("stationMixSeats").append(row);
    }
    for(const field of dialog.querySelectorAll("[data-param]")) {
      const key=field.dataset.param, initial=mix.factory[key]??mix.defaultWidth;
      let control;
      if(key.endsWith("Pan")) {
        const ring=document.createElement("span"),cap=document.createElement("span"),needle=document.createElement("span");
        ring.className="pan-arc";ring.ariaHidden="true";cap.className="pan-cap";needle.className="pan-indicator";
        cap.append(needle);ring.append(cap);field.append(ring);
        control=pan(field,{name:key==="myPan"?"My":"Other",defaultValue:initial});
      } else control=drag(field,{values:Array.from({length:key==="width"?21:41},(_,i)=>i*5),defaultValue:initial,
        format:v=>v+"%",aria:v=>v+" percent"});
      controls.set(key,{field,control});
      field.addEventListener("input",()=>{draft[key]=control.value();render();});
    }
    const spec=()=>mix.fullPreset(draft);
    function drawListen() {
      const on=sampling || engine.playing;
      listen.disabled=engine.playing;
      listen.setAttribute("aria-pressed",String(on));
      listen.setAttribute("aria-label",engine.playing?"Previewing current playback":sampling?"Stop preview":"Play preview");
      listen.title=engine.playing?"Previewing current playback":sampling?"Stop preview":"Play eight seconds from the cursor";
    }
    function render() {
      const choir=draft.layout==="choir", index=Number(select.value);
      for(const b of mode.querySelectorAll("[data-layout]")) {
        const on=b.dataset.layout===draft.layout;b.classList.toggle("is-active",on);
        b.setAttribute("aria-selected",String(on));b.tabIndex=on?0:-1;
      }
      thumb(mode);
      for(const [key,{field,control}] of controls) {
        const pan=key.endsWith("Pan");field.closest("label").hidden=pan?choir:key==="width"?!choir:false;
        control.setValue(draft[key],false);
        if(pan) field.nextElementSibling.textContent=draft[key]===0?"C":Math.abs(draft[key])+(draft[key]<0?"L":"R");
      }
      const {volumes,pans}=mix.project(channels,index,draft,roles);
      const stereo=[];
      for(const [i,row] of rows){
        row.style.setProperty("--position",(50+pans[i]/2)+"%");row.classList.toggle("is-guide",i===index);
        row.lastChild.textContent=volumes[i]+"%";
        row.title=channels[i].short+": "+volumes[i]+"%, "+(pans[i]===0?"center":Math.abs(pans[i])+"% "+(pans[i]<0?"left":"right"));
        stereo.push(row.title);
      }
      el("stationMixSeats").parentElement.setAttribute("aria-label",stereo.join("; "));
      engine.setPracticeDivisi(channels[index].source,channels[index].line);
      engine.updateMix(audible,volumes,pans);
      link.hidden=true;status.textContent="";drawListen();
    }
    function stopSample() {
      ++request;clearTimeout(timer);sampling=false;engine.releaseVoices(voices);drawListen();
    }
    async function sample() {
      if(sampling) {stopSample();return;}
      if(engine.playing) return;
      const token=++request;sampling=true;drawListen();
      try {
        await engine.prepareAudio();
        if(token!==request || !dialog.open) return;
        render();
        const notes=engine.playbackNotes || engine.notes, here=Math.max(0,engine.currentSeconds());
        if(!notes.length){stopSample();return;}
        const next=notes.find(n=>n.end>here), start=next?Math.max(here,next.start):notes[0].start;
        const end=Math.min(engine.duration,start+8*engine.rate);
        for(const n of notes){
          if(n.start>=end) break;
          if(n.end>start) engine.scheduleNote(n,start,0.012,end,voices);
        }
        timer=setTimeout(stopSample,Math.max(0,(end-start)/engine.rate)*1000+32);
      } catch {if(token===request){stopSample();status.textContent="Audio preview unavailable.";}}
    }
    function changeMode(next) {draft.layout=next;render();}
    mode.onclick=()=>changeMode(draft.layout==="choir"?"split":"choir");
    mode.onkeydown=e=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
      e.preventDefault();changeMode(e.key==="ArrowLeft"||e.key==="Home"?"split":"choir");
      mode.querySelector(".is-active").focus();
    };
    select.onchange=()=>{
      const restart=sampling;stopSample();render();if(restart)void sample();
    };
    listen.onclick=()=>void sample();
    el("closeStationMix").onclick=()=>dialog.close();
    el("setStationMix").onclick=()=>{
      if(mix.setStationDefault(spec())){saved=true;status.textContent="Station default saved on this device.";}
      else status.textContent="Could not save on this device.";
    };
    el("copyChoirMix").onclick=async()=>{
      const current=session;
      let url;try{url=address(spec());}catch{status.textContent="Open the hosted player to share this mix.";return;}
      try {await navigator.clipboard.writeText(url);if(current===session)status.textContent="Choir link copied.";}
      catch {if(current===session){link.hidden=false;link.value=url;link.focus();link.select();status.textContent="Copy the selected link.";}}
    };
    dialog.addEventListener("close",()=>{++session;stopSample();restore(saved);});
    const close=()=>{if(dialog.open)dialog.close();};
    document.addEventListener("melete:deactivate",close);
    document.addEventListener("visibilitychange",()=>{if(document.hidden)close();});
    root.addEventListener("pagehide",close);
    new ResizeObserver(()=>{if(dialog.open)thumb(mode);}).observe(mode);
    return {transportChanged(){
      if(dialog.open){if(sampling && engine.playing)stopSample();else drawListen();}
    },open(){
      if(dialog.open) return;
      ++session;saved=false;draft={layout:"split",width:mix.defaultWidth,...mix.factory,...mix.stationDefault()};
      select.value=String(Math.max(0,guide()));dialog.showModal();render();
    }};
  }
  root.MeleteStationMixEditor={create};
})(globalThis);
