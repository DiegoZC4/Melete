'use strict';
const {octaveError} = require('../../template/take_pitch.js');

// Positive advance moves the mic earlier. Use the same voiced time for every
// candidate: a shift cannot win by moving bad samples into rests or off either end.
function fit(frames, notes, limitMs, wave=null) {
  if (!Number.isInteger(limitMs) || limitMs < 1 || limitMs > 1000) throw Error('Invalid search radius');
  const radius = limitMs / 1000, runs = [], usable = [], changes = [];
  for (let i=0; i<notes.length; i++) {
    const [a,b,keys] = notes[i];
    if (!keys.length || b <= a) continue;
    const run = runs.at(-1);
    if (run && Math.abs(run[1]-a)<1e-7) {
      run[1]=b;
      if (JSON.stringify(notes[i-1][2]) !== JSON.stringify(keys)) changes.push(a);
    } else runs.push([a,b]);
  }
  let j=0;
  for (const f of frames) {
    if (!Number.isFinite(f.cents)) continue;
    while (j<runs.length && runs[j][1]-radius<=f.start) j++;
    for (let k=j; k<runs.length && runs[k][0]+radius<f.end; k++) {
      const a=Math.max(f.start,runs[k][0]+radius), b=Math.min(f.end,runs[k][1]-radius);
      if (b>a) usable.push([a,b,f.cents]);
    }
  }
  let n=0;
  const transitions=changes.filter(t=>{
    while(n<usable.length && usable[n][1]<t-radius) n++;
    return n<usable.length && usable[n][0]<t+radius;
  });
  const weights=usable.reduce((s,f)=>s+f[1]-f[0],0);
  const onset=wave?{count:wave.count,kinds:wave.kinds,quality:wave.reason,peakMs:wave.peakMs??null,
    foldsMs:wave.foldsMs,halvesMs:wave.halvesMs,heldoutGain:wave.heldoutGain,shuffleP:wave.shuffleP,
    widerPeaks:wave.wider?.peaks}:null;
  const useWave=Boolean(wave?.usable);
  if(useWave && (!Array.isArray(wave.gridMs) || wave.gridMs[0]!==-limitMs || wave.gridMs.at(-1)!==limitMs ||
    wave.curve.length!==wave.gridMs.length || !wave.gridMs.every((v,i)=>Number.isFinite(wave.curve[i]) && (!i || v>wave.gridMs[i-1]))))
    throw Error('Incompatible waveform search grid');
  if (weights<=1e-6 || !transitions.length) return {advanceMs:useWave?wave.peakMs:0,limitMs,
    status:useWave?(wave.strong?'supported lyric attacks':'uncertain lyric attacks'):'insufficient transitions',transitions:transitions.length,
    basis:useWave?'lyric attacks':'no timing evidence',onset,pitchOnlyMs:null};
  const split=transitions[Math.floor(transitions.length/2)];
  function loss(ms) {
    const shift=ms/1000, sums=[0,0], den=[0,0];
    let idx=0;
    for (const [a,b,c] of usable) {
      while (idx<notes.length && notes[idx][1]<=a-shift) idx++;
      for (let k=idx;k<notes.length && notes[k][0]<b-shift;k++) {
        const [on,off,keys]=notes[k], w=Math.min(b-shift,off)-Math.max(a-shift,on);
        if (w<=0) continue;
        let err=Infinity;
        for(const pitch of keys) err=Math.min(err,Math.abs(octaveError(c-pitch*100)));
        const h=(a+b)/2<split?0:1;
        sums[h]+=err*w; den[h]+=w;
      }
    }
    return [(sums[0]+sums[1])/weights, ...sums.map((x,i)=>den[i]?x/den[i]:Infinity)];
  }
  // Multiple local minima are possible. Search the whole bounded grid; break
  // ties toward the smallest change, including a genuinely flat zero-offset fit.
  const best=[0,0,0], minimum=loss(0), baseline=minimum[0], losses=new Float64Array(limitMs*2+1);
  losses[limitMs]=baseline;
  for (let d=1;d<=limitMs;d++) for(const ms of [-d,d]){
    const v=loss(ms);
    losses[ms+limitMs]=v[0];
    for(let h=0;h<3;h++) if(v[h]<minimum[h]-1e-7){best[h]=ms;minimum[h]=v[h];}
  }
  const gain=baseline-minimum[0];
  let status=transitions.length<5?'sparse evidence':Math.abs(best[0])>=limitMs-2?'at search bound':
    gain<.3?'weak evidence':Math.abs(best[1]-best[2])>55?'inconsistent across halves':'consistent fit';
  let advanceMs=best[0],basis='pitch';
  if(useWave){
    const other=wave.wider?.peaks?.find(([ms,h])=>Math.abs(ms)>limitMs && h>=.80 &&
      Math.sign(ms)===Math.sign(best[0]) && Math.abs(ms-best[0])<Math.abs(wave.peakMs-best[0])/2);
    const alias=wave.wider?.usable && other && Math.sign(best[0])!==Math.sign(wave.peakMs) &&
      Math.abs(best[0]-wave.peakMs)>limitMs*.8;
    if(alias){onset.neighborRejected=true;status='neighboring syllable rejected; '+status;}
    else{
      // Normalize each loss by its own search contrast, not by signal volume.
      // Combine the actual curves: averaging their peak locations can put the
      // result between two unrelated syllables where neither signal agrees.
      const sorted=[...losses].sort((a,b)=>a-b), pitchScale=Math.max(.8,sorted[Math.floor(sorted.length*.8)]-minimum[0]);
      const pw=status==='consistent fit' ? 1 : status==='weak evidence' ? .30 : .6, ww=wave.strong ? .8 : .27;
      const samples=[];
      let j=0;
      for(let ms=-limitMs;ms<=limitMs;ms++){
        while(j+2<wave.gridMs.length && wave.gridMs[j+1]<ms)j++;
        samples.push([j,(ms-wave.gridMs[j])/(wave.gridMs[j+1]-wave.gridMs[j])]);
      }
      const at=(wc,ms)=>{const [j,v]=samples[ms+limitMs];return wc[j]+v*(wc[j+1]-wc[j]);};
      function choose(wc){
        const asc=[...wc].sort((a,b)=>a-b),high=asc.at(-1),scale=Math.max(.12,high-asc[Math.floor(asc.length*.2)]);
        let lowest=Infinity,d=0;
        for(let ms=-limitMs;ms<=limitMs;ms++){
          const cost=pw*(losses[ms+limitMs]-minimum[0])/pitchScale+ww*(high-at(wc,ms))/scale;
          if(cost<lowest-1e-9 || Math.abs(cost-lowest)<1e-9 && Math.abs(ms)<Math.abs(d)){lowest=cost;d=ms;}
        }
        return d;
      }
      advanceMs=choose(wave.curve);
      basis='pitch + lyric attacks';
      if(Math.abs(advanceMs)>=limitMs-2)status='at search bound';
      else if(Math.abs(wave.peakMs-best[0])>90)status='pitch and lyric attacks disagree';
      else if(!wave.strong && status!=='consistent fit')status='uncertain fit';
      if(wave.count>=8 && wave.splitCurves?.length===2){
        onset.crossFitMs=wave.splitCurves.map(choose);
        onset.crossFitGain=wave.splitCurves.map((wc,i)=>Math.round(1000*(at(wc,onset.crossFitMs[1-i])-at(wc,best[0])))/1000);
        if(onset.crossFitGain.every(v=>v<-.035)){
          advanceMs=best[0];basis='pitch';status='lyric fit failed held-out check';
        }
      }
    }
  }
  return {advanceMs,limitMs,status,basis,onset,pitchOnlyMs:best[0],transitions:transitions.length,halfFitsMs:best.slice(1),
    commonSeconds:weights,rawCommonMean:baseline,fittedCommonMean:losses[advanceMs+limitMs]};
}
function fitHistorical(frames,notes,limit,wave,allowExtended=false){
  const base=fit(frames,notes,limit,wave),w=wave?.wider;
  if(!allowExtended || !w?.strong || !base.transitions || Math.abs(base.pitchOnlyMs)<limit-3 || Math.abs(w.peakMs)<=limit+8)return base;
  const wide=fit(frames,notes,w.gridMs.at(-1),w);
  const peaks=[wide.pitchOnlyMs,...wide.halfFitsMs,w.peakMs,...w.foldsMs,...w.halvesMs];
  if(wide.transitions<8 || wide.basis!=='pitch + lyric attacks' || !peaks.every(ms=>Math.sign(ms)===Math.sign(w.peakMs) && Math.abs(ms)>limit+5) ||
    Math.max(...peaks)-Math.min(...peaks)>70 || Math.abs(wide.advanceMs)<=limit || Math.abs(wide.advanceMs)>=wide.limitMs-2)return base;
  return {...wide,originalLimitMs:limit,extended:true};
}
module.exports={fit,fitHistorical};
