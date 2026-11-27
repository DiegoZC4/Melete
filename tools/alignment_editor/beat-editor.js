/* Local-only click-grid editor for Diego's beat review. With the move button on,
   drag a bar line or a beat on the waveform lanes; Cmd/Ctrl+Z undoes and
   Shift+Cmd/Ctrl+Z redoes. A bar line stretches the beats of its two bars in
   proportion; a beat first pins the other beats of its bar, so only it moves.
   Edits stay in this browser's localStorage until they are installed into
   reference-alignment.json. Publication excludes this file and its control. */
(function(root){
  'use strict';
  const KEY='solstice-auditions:beat-edits';
  const GAP=.05;
  const copy=anchors=>anchors.map(p=>[...p]);
  const same=(a,b)=>a.length===b.length&&a.every((p,i)=>p[0]===b[i][0]&&p[1]===b[i][1]);
  const round=(x,places)=>Math.round(x*10**places)/10**places;
  function stored(storage){try{return JSON.parse(storage.getItem(KEY))||{};}catch{return {};}}
  function idFor(a){return `${a.id}:${a.scoreVersion}:${a.originalSha256}`;}
  function secondsAt(anchors,tick){
    const found=anchors.findIndex(p=>p[0]>=tick),i=Math.max(1,found<0?anchors.length-1:found);
    const [t0,s0]=anchors[i-1],[t1,s1]=anchors[i];return s0+(tick-t0)*(s1-s0)/(t1-t0);
  }
  // A saved edit keeps every installed anchor tick (beats it pinned are extra) and stays strictly increasing.
  function fits(anchors,base){
    const ticks=new Set(anchors.map(p=>p[0]));
    return anchors[0]?.[0]===0&&anchors.at(-1)[0]===base.at(-1)[0]&&base.every(p=>ticks.has(p[0]))
      &&anchors.every((p,i)=>!i||p[0]>anchors[i-1][0]&&p[1]>anchors[i-1][1]);
  }
  // grid {bars, beats} lists the ticks of bar lines and beats; without one every anchor is a bar line.
  // Keeps anchors strictly increasing and at least GAP apart so the timeline stays valid while dragging.
  function moved(anchors,tick,seconds,grid=null){
    const bars=grid?.bars||anchors.map(p=>p[0]);
    return bars.includes(tick)?movedBar(anchors,tick,seconds,bars):movedBeat(anchors,tick,seconds,grid);
  }
  function movedBar(anchors,tick,seconds,bars){
    const next=copy(anchors),i=next.findIndex(p=>p[0]===tick),old=next[i][1];
    let a=i-1,c=i+1;while(a>=0&&!bars.includes(next[a][0]))a--;while(c<next.length&&!bars.includes(next[c][0]))c++;
    // Scaling a bar scales its smallest gap too.
    const smallest=(from,to)=>Math.min(...next.slice(from,to).map((p,k)=>next[from+k+1][1]-p[1]));
    const lo=a<0?-Infinity:Math.min(old,next[a][1]+(old-next[a][1])*GAP/smallest(a,i));
    const hi=c>=next.length?Infinity:Math.max(old,next[c][1]-(next[c][1]-old)*GAP/smallest(i,c));
    const s=round(Math.max(lo,Math.min(hi,seconds)),4);
    for(let k=a+1;k<i;k++)next[k][1]=round(next[a][1]+(next[k][1]-next[a][1])*(s-next[a][1])/(old-next[a][1]),6);
    for(let k=i+1;k<c;k++)next[k][1]=round(next[c][1]-(next[c][1]-next[k][1])*(next[c][1]-s)/(next[c][1]-old),6);
    next[i][1]=s;return next;
  }
  function movedBeat(anchors,tick,seconds,grid){
    const first=anchors[0][0],last=anchors.at(-1)[0];
    const start=Math.max(first,...grid.bars.filter(t=>t<tick)),end=Math.min(last,...grid.bars.filter(t=>t>tick));
    const points=new Map(anchors.map(p=>[p[0],p[1]]));
    for(const t of [start,...grid.beats.filter(t=>t>start&&t<end),end,tick])if(!points.has(t))points.set(t,round(secondsAt(anchors,t),6));
    const next=[...points].sort((x,y)=>x[0]-y[0]),i=next.findIndex(p=>p[0]===tick);
    const lo=i?next[i-1][1]+GAP:-Infinity,hi=i<next.length-1?next[i+1][1]-GAP:Infinity;
    next[i][1]=round(Math.max(lo,Math.min(hi,seconds)),4);return next;
  }
  class Editor{
    constructor(onChange,storage=root.localStorage,target=root){
      Object.assign(this,{onChange,storage,alignment:null,grid:null,enabled:false,undo:[],redo:[]});
      target.addEventListener?.('keydown',e=>{
        if(!this.enabled||!this.alignment||!(e.metaKey||e.ctrlKey)||e.altKey||e.key.toLowerCase()!=='z')return;
        if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
        const [from,to]=e.shiftKey?[this.redo,this.undo]:[this.undo,this.redo];
        e.preventDefault();if(!from.length)return;
        to.push(copy(this.alignment.beatAnchors));this.apply(from.pop());
      });
    }
    // Applies this browser's saved edits for the same score and recording, but only
    // edits of the grid now installed: older ones are already in reference-alignment.json.
    attach(alignment,grid=null){
      this.alignment=alignment?.beatAnchors?alignment:null;this.grid=grid;this.undo=[];this.redo=[];
      if(!this.alignment)return;
      alignment.reviewedBeatAnchors??=copy(alignment.beatAnchors);
      alignment.reviewedCountIn??={start:alignment.countInStart,beats:(alignment.countInBeats||[]).map(b=>({...b}))};
      if(alignment.loop)alignment.reviewedLoop??={...alignment.loop};
      const saved=stored(this.storage)[idFor(alignment)],base=alignment.reviewedBeatAnchors;
      const current=Array.isArray(saved?.reviewed)&&same(saved.reviewed,base)&&Array.isArray(saved.beatAnchors)&&fits(saved.beatAnchors,base);
      alignment.beatAnchors=copy(current?saved.beatAnchors:base);
      this.sync();
    }
    // Moving the first downbeat carries the count-in with it; the loop seams keep their lead.
    sync(){
      const a=this.alignment,shift=a.beatAnchors[0][1]-a.reviewedBeatAnchors[0][1],loop=a.reviewedLoop;
      if(loop)a.loop={...loop,start:loop.start+shift,end:loop.end+secondsAt(a.beatAnchors,loop.endTick)-secondsAt(a.reviewedBeatAnchors,loop.endTick)};
      if(!Number.isFinite(a.reviewedCountIn.start))return;
      a.countInStart=a.reviewedCountIn.start+shift;a.countInBeats=a.reviewedCountIn.beats.map(b=>({...b,seconds:b.seconds+shift}));
    }
    preview(tick,seconds){return moved(this.alignment.beatAnchors,tick,seconds,this.grid);}
    export(){return stored(this.storage);}
    commit(tick,seconds){
      const next=this.preview(tick,seconds);
      if(Math.abs(secondsAt(next,tick)-secondsAt(this.alignment.beatAnchors,tick))<1e-9)return;
      this.undo.push(copy(this.alignment.beatAnchors));this.redo=[];this.apply(next);
    }
    apply(anchors){
      const a=this.alignment;a.beatAnchors=copy(anchors);this.sync();
      const all=stored(this.storage),edited=!same(a.beatAnchors,a.reviewedBeatAnchors);
      if(edited)all[idFor(a)]={id:a.id,scoreVersion:a.scoreVersion,originalSha256:a.originalSha256,beatAnchors:a.beatAnchors,
        reviewed:a.reviewedBeatAnchors,updated:new Date().toISOString()};
      else delete all[idFor(a)];
      try{this.storage.setItem(KEY,JSON.stringify(all));}catch{}
      this.onChange?.();
    }
  }
  const api={Editor,moved,KEY};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteBeatEditor=api;
})(globalThis);
