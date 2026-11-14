/* Relative guide settings have no singer, source IDs or microphone state. */
((root)=>{
  "use strict";
  const splitKeys=["myVol","otherVol","myPan","otherPan"];
  const keys=[...splitKeys,"layout","width"];
  const factory=Object.freeze({myVol:150,otherVol:35,myPan:100,otherPan:-35});
  const defaultWidth=70, stationKey="melete:station:practice-mix-default:v1";
  function read(fields) {
    const result={}, input=new Map([...(fields instanceof URLSearchParams?fields:Object.entries(fields || {}))]
      .map(([k,v])=>[k.toLowerCase(),v]));
    const layout=String(input.get("layout") || "").trim().toLowerCase();
    if (layout && layout!=="choir" && layout!=="split") return null;
    if (layout==="choir") {result.layout="choir";result.width=defaultWidth;}
    for (const key of layout==="choir" ? ["width","myVol","otherVol"] : splitKeys) {
      if (!input.has(key.toLowerCase())) continue;
      const raw=String(input.get(key.toLowerCase())).trim(), n=Number(raw), pan=key.endsWith("Pan");
      if (!/^[+-]?\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n) || n<(pan?-100:0) || n>(pan || key==="width"?100:200)) return null;
      result[key]=Math.round(n/5)*5;
    }
    return Object.keys(result).length?result:null;
  }
  function fullPreset(fields) {
    const mix=read(fields);
    return mix?.layout==="choir" ? {layout:"choir",width:mix.width,myVol:mix.myVol??factory.myVol,otherVol:mix.otherVol??factory.otherVol}
      : {...factory,...mix};
  }
  function stationDefault() {
    try { return fullPreset(JSON.parse(root.localStorage.getItem(stationKey))); } catch {return {...factory};}
  }
  function setStationDefault(mix) {
    try {root.localStorage.setItem(stationKey,JSON.stringify(fullPreset(mix)));return true;} catch {return false;}
  }
  function seatOrder(channels,roles=[]) {
    const code=c=>{
      for(const label of [c.short,c.name]){
        const match=/^(s(?:oprano)?|a(?:lto)?|t(?:enor)?|b(?:ass)?)\s*(\d*)\s*(?:solo(?:ist)?)?$/i.exec(String(label||"").trim());
        if(match) return "SATB".indexOf(match[1][0].toUpperCase())*100+Number(match[2]);
      }
      return null;
    };
    const seats=channels.map((c,i)=>{
      const parent=roles.find(r=>r.soloist===c.source);
      const main=parent && channels.find(p=>p.source===parent.part && p.line===c.line);
      return {code:code(main||c),fallback:main?channels.indexOf(main):i};
    });
    const known=seats.some(s=>s.code!==null);
    const order=[...new Set(seats.map(s=>known?s.code:s.fallback).filter(n=>n!==null))].sort((a,b)=>a-b);
    return seats.map(s=>order.indexOf(known?s.code:s.fallback));
  }
  function project(channels,guide,fields,roles) {
    const mix=fullPreset(fields),choir=mix.layout==="choir",seats=choir?seatOrder(channels,roles):[];
    const span=Math.max(1,...seats);
    return {volumes:channels.map((_,i)=>i===guide?mix.myVol:mix.otherVol),
      pans:channels.map((_,i)=>!choir ? (i===guide?mix.myPan:mix.otherPan)
        : seats[i]<0 || !(seats[guide]>=0) ? 0
        : Math.sign(seats[guide]-seats[i])*Math.round(Math.abs(seats[guide]-seats[i])*mix.width/span/5)*5 || 0)};
  }
  function fromMixer(index,volumes,pans) {
    if (!Number.isInteger(index) || index<0 || index>=volumes.length) return null;
    const pairs=new Map();
    volumes.forEach((v,i)=>{if(i!==index){const k=v+","+pans[i];pairs.set(k,(pairs.get(k)||0)+1);}});
    const [otherVol,otherPan]=[...pairs].sort((a,b)=>b[1]-a[1])[0]?.[0].split(",").map(Number) || [volumes[index],pans[index]];
    return {mix:{myVol:volumes[index],otherVol,myPan:pans[index],otherPan},uniform:pairs.size<=1};
  }
  const audioKeys=["metronome","audible","volumes","pans","takeVolume","takeReverb","reference",
    "practiceMixMode","practiceMixPart","practiceMixUndo"];
  const audioState=state=>structuredClone(Object.fromEntries(audioKeys.filter(k=>k in state).map(k=>[k,state[k]])));
  const roleFields=["audible","volumes","pans"];
  function roleKey(song,channels,scope) {
    return `melete:role-mix:v1:${JSON.stringify([song,channels.map(c=>[c.source,c.line??null,c.short]),scope])}`;
  }
  function common(values,fallback) {
    const counts=new Map();
    for(const value of values) counts.set(value,(counts.get(value)||0)+1);
    return [...counts].sort((a,b)=>b[1]-a[1] || Number(b[0]===fallback)-Number(a[0]===fallback))[0]?.[0] ?? fallback;
  }
  // Remember the backing value underneath the guide. Otherwise moving the
  // guide onto a deliberately quiet part would transplant its exception.
  function follow(channels,state,old,index,previous=null,layout=null,roles=[]) {
    if(!channels[old] || !channels[index]) return null;
    const settings=audioState(state), shadow={}, base={};
    const seats=i=>layout?.layout==="choir"?project(channels,i,layout,roles).pans:channels.map(()=>0);
    const from=seats(old),to=seats(index),prior=previous?.index===old ? previous : null;
    let panCarry;
    for(const field of roleFields){
      const src=state[field];
      const values=src.map((v,i)=>{
        if(field!=="pans") return v;
        // A seat change can pin a dial at its limit. Recover its excess only
        // while the displayed pan and seat still match; a manual edit wins.
        const carry=prior?.panCarry?.[i];
        const pinned=prior?.panSeats?.[i]===from[i] && Number.isFinite(carry) && v===100*Math.sign(carry);
        return v-from[i]+(pinned?carry:0);
      });
      const others=values.filter((_,i)=>i!==old);
      base[field]=common(others,prior?.base?.[field] ?? values[old]);
      const priorValue=prior?.shadow?.[field];
      const hidden=priorValue===undefined || priorValue===prior.base[field] ? base[field] : priorValue;
      const guide=values[old];
      values[old]=hidden;
      shadow[field]=values[index];
      values[index]=guide;
      if(field==="pans"){
        const raw=values.map((v,i)=>v+to[i]);
        settings.pans=raw.map(v=>Math.max(-100,Math.min(100,v)));
        panCarry=raw.map((v,i)=>v-settings.pans[i]);
      }else settings[field]=values;
    }
    return {index,settings,base,shadow,...(panCarry.some(Boolean)?{panCarry,panSeats:to}:{})};
  }
  function reviewKey(song,channels,index) {
    return `melete:review-mix:v1:${JSON.stringify([song,channels.map(c=>[c.source,c.line??null,c.short]),index])}`;
  }
  function reviewProfile(channels,index,saved) {
    const defaults={metronome:0,takeVolume:100,takeReverb:0,
      audible:channels.map((_,i)=>i!==index),volumes:channels.map(()=>factory.otherVol),pans:channels.map(()=>0),
      practiceMixMode:null,practiceMixPart:null,practiceMixUndo:null};
    if(!saved || !["audible","volumes","pans"].every(k=>Array.isArray(saved[k]) && saved[k].length===channels.length))return defaults;
    if(!saved.audible.every(v=>typeof v==="boolean") || !saved.volumes.every(v=>Number.isFinite(v)&&v>=0&&v<=200)
      || !saved.pans.every(v=>Number.isFinite(v)&&v>=-100&&v<=100))return defaults;
    const next={...defaults,...audioState(saved)};
    for(const [key,min,max] of [["metronome",0,200],["takeVolume",0,200],["takeReverb",0,100]])
      if(!Number.isFinite(next[key]) || next[key]<min || next[key]>max)next[key]=defaults[key];
    return next;
  }
  function address(base,mix,loop,publishedBase) {
    const url=new URL(publishedBase || base), song=new URL(base).searchParams.get("song") || url.searchParams.get("song");
    if (!/^https?:$/.test(url.protocol)) throw new Error("A hosted player is required to share links.");
    url.username="";url.password="";url.search="";url.hash="";
    if (song) url.searchParams.set("song",song);
    if (loop) url.searchParams.set("loop",loop);
    for(const [key,value] of Object.entries(read(mix) || {})) url.searchParams.set(key,String(value));
    return url.href;
  }
  const api={keys,read,fromMixer,address,factory,defaultWidth,stationDefault,setStationDefault,seatOrder,project,fullPreset,
    audioState,reviewKey,reviewProfile,roleKey,follow};
  if(typeof module==="object" && module.exports) module.exports=api; else root.MeletePracticeMix=api;
})(globalThis);
