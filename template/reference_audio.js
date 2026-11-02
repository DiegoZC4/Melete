/* Optional embedded recording, aligned offline to the unchanged score clock. */
((root) => {
  'use strict';
  const ID = 'reference:original';
  const timing = sequence => Object.fromEntries(['division','endTick','measures','tempos'].map(key=>[key,sequence[key]]));
  function valid(source, sequence) {
    return Boolean(source?.data && source?.timing && Object.entries(timing(sequence))
      .every(([key,value])=>JSON.stringify(source.timing[key])===JSON.stringify(value)));
  }
  function create(source, sequence, adapter) {
    if (!valid(source,sequence)) throw Error('Reference recording timing does not match this score; rebuild its alignment.');
    let state = {enabled:false,volume:100,pan:0}, loading = null, buffer = null, blob = null, active = true;
    let hear, volume, pan, level, balance;
    function paint() {
      if (hear) { hear.classList.toggle('is-active', state.enabled); hear.setAttribute('aria-pressed',String(state.enabled)); hear.setAttribute('aria-busy',String(Boolean(loading))); }
      level?.setValue(state.volume,false); balance?.setValue(state.pan,false);
    }
    async function sync() {
      const engine = adapter.engine();
      if (!engine) return;
      const layer = engine.referenceLayers.get(ID);
      if (!state.enabled || !active) { if (layer) engine.removeTakeLayer(ID); return; }
      if (layer) {
        layer.gain.gain.setTargetAtTime(state.volume/100,engine.context.currentTime,.015);
        layer.panner.pan.setTargetAtTime(state.pan/100,engine.context.currentTime,.015);
        return;
      }
      if (loading) return;
      engine.ensureAudio();
      try {
        loading = (async()=>{
          if (buffer) return;
          const data=Uint8Array.from(atob(source.data),ch=>ch.charCodeAt(0));
          blob=new Blob([data],{type:source.mime || 'audio/mpeg'});
          buffer=await engine.context.decodeAudioData(data.buffer);
          if (Math.abs(buffer.duration-engine.duration) > .15) throw Error('Reference recording duration does not match the score.');
        })();
        paint(); await loading;
        if (!state.enabled || !active) return;
        engine.addTakeLayer({id:ID, reference:true, buffer, blob, playbackGain:state.volume/100,
          pan:state.pan/100, start:0, end:engine.duration, rate:1, latency:0});
      } catch(error) {
        buffer=null; state.enabled=false; adapter.changed(); adapter.error(error.message);
      } finally { loading=null; paint(); }
    }
    function restore(value) {
      state={enabled:value?.enabled===true,volume:Math.max(0,Math.min(200,Number(value?.volume??100)||0)),
        pan:Math.max(-100,Math.min(100,Number(value?.pan)||0))};
      paint(); void sync();
    }
    function mount(row, parent) {
      if(row==='See') {
        const label=document.createElement('span'); label.className='reference-heading'; label.textContent='Ref';
        label.title=source.label || 'Aligned reference recording'; parent.append(label);
      } else if(row==='Hear') {
        hear=document.createElement('button'); hear.type='button'; hear.className='matrix-cell reference-hear';
        hear.setAttribute('aria-label','Hear reference recording'); hear.title=source.label || 'Hear aligned reference recording';
        hear.onclick=()=>{state.enabled=!state.enabled;paint();adapter.changed();void sync();}; parent.append(hear);
      } else if(row==='Vol') {
        volume=document.createElement('button'); volume.type='button'; volume.className='drag-number reference-volume';
        volume.dataset.value=String(state.volume); volume.title='Reference recording volume'; parent.append(volume);
        level=adapter.drag(volume,{values:Array.from({length:201},(_,i)=>i),clickStep:10,defaultValue:()=>100,
          format:v=>`${v}%`,aria:v=>`Reference volume ${v} percent`,pixelsPerStep:4});
        volume.addEventListener('input',()=>{state.volume=level.value();adapter.changed();void sync();});
      } else if(row==='Pan') {
        pan=document.createElement('button');pan.type='button';pan.className='pan-ring reference-pan';pan.dataset.value=String(state.pan);
        pan.innerHTML='<span class="pan-arc" aria-hidden="true"><span class="pan-cap"><span class="pan-indicator"></span></span></span>';
        pan.title='Reference recording pan';parent.append(pan);
        balance=adapter.pan(pan,{name:'Reference recording',defaultValue:()=>0});
        pan.addEventListener('input',()=>{state.pan=balance.value();adapter.changed();void sync();});
      }
      paint();
    }
    return {mount,restore,get state(){return {...state};},sync,activate(value){active=value;void sync();}};
  }
  const api={create,valid,timing};
  if(typeof module==='object' && module.exports) module.exports=api; else root.MeleteReferenceAudio=api;
})(globalThis);
