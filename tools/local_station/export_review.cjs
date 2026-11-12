'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), cp=require('node:child_process');
const pitch=require('../../template/take_pitch.js'), comp=require('../../template/practice_comp.js');
const {splice}=require('../../template/comp_audio.js'), {fit,fitHistorical}=require('./alignment.cjs');
const archive=require('./library_archive.js');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function loadSession(file,expectedHash=null) {
  const bytes=fs.readFileSync(file);
  if(expectedHash && hash(bytes)!==expectedHash)throw Error('Lyric-onset evidence is for a different recording library');
  const {stores}=archive.unpack(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  return Object.fromEntries(['takes','chunks','comps'].map(k=>[k,stores[k].map(([,v])=>k==='chunks'
    ? {...v,pcm:Buffer.from(v.pcm.buffer,v.pcm.byteOffset,v.pcm.byteLength)} : v)]));
}
function clock(seq,tick){let seconds=0,t=0,bpm=seq.tempos[0][1];
  for(const [nt,nv] of seq.tempos){if(nt>tick)break;seconds+=(nt-t)*60/(seq.division*bpm);t=nt;bpm=nv;}
  return seconds+(tick-t)*60/(seq.division*bpm);
}
function summarize(f,ref){const s=pitch.scoreFrames(f,ref,ref.seconds);return {mean:s.meanAbsCents,median:s.medianAbsCents,
  coverage:s.coverage,within50:s.trackedSeconds?s.within50CentsSeconds/s.trackedSeconds:null,trackedSeconds:s.trackedSeconds};}
function run(config){
  const wave=config.onsetReport?JSON.parse(fs.readFileSync(config.onsetReport,'utf8')):null;
  if(wave && (!wave.librarySha256 || !wave.scoreSha256))throw Error('Lyric-onset evidence lacks source identities');
  const {takes,chunks,comps}=loadSession(config.library,wave?.librarySha256), data=JSON.parse(fs.readFileSync(config.roster,'utf8').replace(/^\s*window\.MeleteLocalStationRoster\s*=\s*/,'').replace(/;\s*$/,''));
  const out=config.output, assets=path.join(out,'assets');fs.mkdirSync(assets,{recursive:true});
  const songs=new Map(config.songs.map(s=>{
    const bytes=fs.readFileSync(s.playback);if(wave && hash(bytes)!==wave.scoreSha256[s.slug])throw Error('Score changed since lyric-onset analysis');
    return [s.slug,{...s,seq:JSON.parse(bytes)}];
  }));
  const byId=new Map(takes.map(t=>[t.id,t])), source=new Map(), index=[], reports=[];
  const fittedTakes=new Map(), corrections=new Map(), testIds=new Set(config.testIds || []);
  if(wave && (wave.version!==1 || takes.some(t=>!wave.takes?.[t.id])))throw Error('Missing lyric-onset evidence for this recording library');
  for(const c of chunks){if(!source.has(c.takeId))source.set(c.takeId,[]);source.get(c.takeId).push(c);}
  const name=t=>config.credits?.[t.id] || data.credits?.[t.id] || t.performer?.name || t.station?.name;
  for(const t of takes){
    if(!name(t))throw Error('A source take has no confirmed singer');
    const ref=t.pitchReference;t.origin=clock(songs.get(t.song).seq,ref.captureStart??t.start)/t.rate;
    t.previousMs=t.playbackAdvanceMs??(config.originalPlaybackAdvanceMs || data.playbackAdvanceMs)?.[t.id]??0;
    t.playbackAdvance=config.fitSources ? 0 : t.previousMs/1000;
    t.analysisFrames=pitch.readContour(t);if(!t.analysisFrames)throw Error('Invalid saved contour for '+t.id);
  }
  const stateFor=t=>comps.find(c=>c.song===t.song && c.descriptor.reference.part===t.pitchReference.part &&
    c.descriptor.reference.line===t.pitchReference.line && c.descriptor.reference.rate===t.rate);
  const radius=(seq,ref,origin,end)=>{
    const bpms=seq.tempos.filter(([t],i)=>clock(seq,t)/ref.rate<=end && (!seq.tempos[i+1]||clock(seq,seq.tempos[i+1][0])/ref.rate>origin)).map(t=>t[1]);
    return Math.floor(15000/(Math.max(...(bpms.length?bpms:[seq.tempos[0][1]]))*ref.rate)+1e-8);
  };
  if(config.fitSources)for(const t of takes){
    const ref=stateFor(t)?.descriptor.reference;if(!ref)throw Error('No score for '+t.id);
    const to=t.origin+t.pitchReference.seconds, range=[{takeId:t.id,from:t.origin,to}];
    const result=fitHistorical(comp.framesFor(range,byId),ref.notes,radius(songs.get(t.song).seq,ref,t.origin,to),wave?.takes[t.id],config.allowCorroboratedExtension===true);
    const advanceMs=result.basis!=='no timing evidence'?result.advanceMs:t.previousMs;
    corrections.set(t.id,{song:t.song,singer:name(t),number:t.number,part:stateFor(t).descriptor.label.split(' · ')[0],
      previousMs:t.previousMs,...result,advanceMs,test:testIds.has(t.id)});
    fittedTakes.set(t.id,{...t,playbackAdvance:advanceMs/1000});
  }
  function pcm(t){
    const raw=Buffer.alloc(t.frames*2);
    let end=0,total=0;
    for(const c of (source.get(t.id)||[]).slice().sort((a,b)=>a.offset-b.offset)){
      if(!Number.isSafeInteger(c.offset)||c.pcm.length%2||c.offset<end||c.offset>end&&t.storedFrames===undefined||
        c.offset*2+c.pcm.length>raw.length)throw Error('Missing, overlapping or invalid audio chunk');
      c.pcm.copy(raw,c.offset*2);total+=c.pcm.length/2;end=c.offset+c.pcm.length/2;
    }
    if(total!==(t.storedFrames??t.frames))throw Error('Incomplete audio for '+t.id);
    return new Int16Array(raw.buffer,raw.byteOffset,t.frames);
  }
  const groups=new Map();
  for(const c of comps.filter(c=>c.segments.length)){
    const names=new Set(c.segments.map(s=>name(byId.get(s.takeId))));
    if(names.size!==1)throw Error('Mixed performer comp; review the source credits');
    const singer=[...names][0], key=JSON.stringify([singer,c.song]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);
  }
  function output(singer,song,state,segs,kind,number){
    const ref=state.descriptor.reference, seq=songs.get(song).seq, ids=[...new Set(segs.map(s=>s.takeId))];
    const origin=segs[0].from, end=segs.at(-1).to, first=byId.get(ids[0]);
    if(!(end>origin) || ids.some(id=>byId.get(id).sampleRate!==first.sampleRate))throw Error('Invalid or mixed sample rates');
    const key=hash(JSON.stringify([config.date,song,singer,kind,ids])).slice(0,24);
    const rounded=x=>Math.round(x*1e6)/1e6;
    function render(suffix,map){
      const rate=first.sampleRate, mixed=new Float32Array(Math.ceil((end-origin)*rate));
      for(const id of ids){const t=map.get(id);
        splice(mixed,Float32Array.from(pcm(t),x=>x/32768),segs.filter(s=>s.takeId===id).map(s=>({from:s.from-origin,to:s.to-origin})),
          t.origin-origin,t.pitchReference.latency+t.playbackAdvance,rate);
      }
      const base=path.join(assets,key+suffix);
      cp.execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',String(rate),'-ac','1','-i','pipe:0','-map_metadata','-1','-codec:a','libmp3lame','-q:a','2',base+'.mp3'],{input:Buffer.from(mixed.buffer)});
      const frames=comp.framesFor(segs,map);
      fs.writeFileSync(base+'.json',JSON.stringify({ref,frames:frames.map(f=>[rounded(f.start-origin),rounded(f.end-origin),f.cents])}));
      return frames;
    }
    const frames=render('',byId);
    // A single shift for the entire performance, bounded by the shortest sixteenth it contains.
    const fitInfo=config.savedTiming ? {advanceMs:0,status:'saved timing',basis:'Saved source corrections already rendered'}
      : (ids.length===1 && corrections.get(ids[0])) || fit(frames,ref.notes,radius(seq,ref,origin,end));
    const advance=fitInfo.advanceMs/1000;
    const row={id:key,song,singer,kind,number,part:state.descriptor.label.split(' · ')[0],origin,end,
      createdAt:Math.min(...ids.map(id=>byId.get(id).createdAt)),
      sourceIds:ids,segments:segs.map(s=>[s.from,s.to,byId.get(s.takeId).number]),fit:fitInfo,raw:summarize(frames,ref),
      fitted:summarize(frames.map(f=>({...f,start:f.start-advance,end:f.end-advance})),ref)};
    if(config.fitSources){
      const shifts=ids.map(id=>{const {number,advanceMs,status,basis,transitions,limitMs,onset}=corrections.get(id);
        return {number,advanceMs,status,basis,transitions,limitMs,lyricAttacks:onset?.count||0};});
      row.alignment={version:1,changed:shifts.some(s=>s.advanceMs!==0),shifts};
      row.fitted=row.alignment.changed?summarize(render('.aligned',fittedTakes),ref):row.raw;
      row.test=ids.every(id=>testIds.has(id));
    }
    index.push(row);
    if(kind==='performance'){
      const safe=s=>{if(!s||/[\\/\x00-\x1f]/.test(s)||s==='.'||s==='..')throw Error('Unsafe path');return s;};
      if(config.listening){
        fs.mkdirSync(config.listening,{recursive:true});
        fs.copyFileSync(path.join(assets,key+(row.alignment?.changed?'.aligned':'')+'.mp3'),path.join(config.listening,safe(singer)+' - '+safe(songs.get(song).title)+'.mp3'));
      }
      reports.push({singer,song,...(row.alignment?{sourceOffsets:row.alignment.shifts}:{advanceMs:fitInfo.advanceMs,status:fitInfo.status}),
        mean:row.raw.mean,fitted:row.fitted.mean,tracked:row.raw.coverage});
    }
  }
  for(const [k,states] of groups){
    const [singer,song]=JSON.parse(k), coverage=c=>c.segments.reduce((n,s)=>n+s.to-s.from,0);
    states.sort((a,b)=>coverage(b)-coverage(a));
    const chosen=config.performancesOnly ? states.filter(c=>!c.segments.every(s=>testIds.has(s.takeId))).slice(0,1) : states;
    chosen.forEach((c,i)=>output(singer,song,c,c.segments,c.segments.every(s=>testIds.has(s.takeId))?'test':i?'alternate':'performance',c.firstTakeNumber));
  }
  for(const t of config.performancesOnly ? [] : takes){
    const state=stateFor(t);
    if(!state)throw Error('No matching reference for source '+t.id);
    output(name(t),t.song,state,[{from:t.origin,to:t.origin+t.pitchReference.seconds,takeId:t.id}],'source',t.number);
  }
  if(config.expectedPerformances){
    const actual=index.map(r=>JSON.stringify([r.singer,r.song])).sort();
    const expected=config.expectedPerformances.map(r=>JSON.stringify(r)).sort();
    if(!config.performancesOnly || JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Unexpected performance roster; catalog not replaced');
  }
  fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify({date:config.date,items:index}));
  if(config.timingReport)fs.writeFileSync(config.timingReport,JSON.stringify({date:config.date,method:'One signed absolute advance per original take; score fit, not device calibration.',takes:Object.fromEntries(corrections)},null,2)+'\n');
  console.log(JSON.stringify({performances:reports.length,testComps:index.filter(r=>r.kind==='test').length,sourceTakes:takes.length,rows:index.length,reports},null,2));
}
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
module.exports={run,loadSession,clock};
