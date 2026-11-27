/* Editor times are absolute seconds in the original recording, not in the trimmed practice MP3. */
(function(root){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function time(points,tick){
    let lo=0,hi=points.length-1;
    while(hi-lo>1){const i=(lo+hi)>>1;if(points[i][0]<=tick)lo=i;else hi=i;}
    const [x,y]=points[lo],[b,s]=points[hi];return y+(tick-x)*(s-y)/(b-x);
  }
  const equal=(a,b)=>a.length===b.length&&a.every(([t,s],i)=>t===b[i][0]&&s===b[i][1]);
  function model(data,storage){
    const key='melete-timing-draft:'+data.song, primary=new Set(data.base.map(p=>p[0]));
    const starts=[...new Set(data.notes.map(n=>n[1]).filter(t=>t>=0&&t<data.base.at(-1)[0]))].sort((a,b)=>a-b);
    const allowed=new Set([...primary,...starts]);
    function valid(p){
      return Array.isArray(p)&&p.length<=allowed.size&&p.every((q,i)=>Array.isArray(q)&&q.length===2&&allowed.has(q[0])&&Number.isFinite(q[1])&&q[1]>=0&&q[1]<=data.sourceSeconds&&(!i||q[0]>p[i-1][0]&&q[1]>p[i-1][1]))&&[...primary].every(t=>p.some(q=>q[0]===t));
    }
    let anchors=data.anchors,warn='',past=[],future=[];
    try{const d=JSON.parse(storage.getItem(key));if(d&&d.baseId===data.baseId&&d.revision===data.revision&&valid(d.anchors))anchors=d.anchors;
      else if(d)warn='Older draft not applied: project timing changed.';}catch{warn='Browser drafts unavailable.';}
    function persist(){try{storage.setItem(key,JSON.stringify({baseId:data.baseId,revision:data.revision,anchors}));warn='';}
      catch{warn='Draft not saved in this browser. Export it.';}}
    function moved(t,s){
      if(!allowed.has(t))return anchors;
      // Every explicit anchor stays glued to the recording until that handle is moved.
      const points=root.MeleteBeatEditor.moved(anchors,t,clamp(s,0,data.sourceSeconds),{bars:anchors.map(p=>p[0]),beats:[]});
      return valid(points)?points:anchors;
    }
    function commit(p){if(!valid(p)||equal(p,anchors))return;past.push(anchors);if(past.length>120)past.shift();future=[];anchors=p;persist();}
    function history(redo){const [from,to]=redo?[future,past]:[past,future];if(from.length){to.push(anchors);anchors=from.pop();persist();}}
    function reset(t){const original=data.base.find(p=>p[0]===t);commit(original?moved(t,original[1]):anchors.filter(p=>p[0]!==t));}
    function payload(){return {schema:1,baseId:data.baseId,revision:data.revision,anchors};}
    function saved(revision,applied){data.anchors=applied;data.revision=revision;persist();}
    return {primary,starts,valid,moved,commit,history,reset,payload,saved,get anchors(){return anchors;},
      get dirty(){return !equal(anchors,data.anchors);},get warn(){return warn;},get undoable(){return past.length>0;},get redoable(){return future.length>0;}};
  }
  root.TimingEditorModel={clamp,time,equal,model};
})(globalThis);
