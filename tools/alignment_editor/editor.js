(() => {
  'use strict';
  const $=id=>document.getElementById(id), {time,clamp,equal,model}=TimingEditorModel;
  const transport=new AlignmentTransport(), colors=['#ce5663','#de8755','#b49628','#6aa447','#489b98','#5486b8','#8879b4','#ab71ab','#b26982'];
  const songs=[],titles=new Map(),views=new Map(),plot=$('plot'),rail=$('timeline'),overview=$('overview');
  let applyUrl=null;
  const localApply=()=>!!applyUrl&&['127.0.0.1','localhost'].includes(location.hostname);
  let data,m,slug,span=14,left=0,selected=0,part=-1,loop=false,peaks,serial=0,drag=null,preview=null;
  let applying=false,loading=false,frame=0,shownPlay=false,message='',error=false,partColors=[],loadController;
  function status(s,bad=false){message=s;error=bad;update();}
  function fmt(t){t=Math.max(0,t||0);return Math.floor(t/60)+':'+(t%60).toFixed(2).padStart(5,'0');}
  function points(){return preview||m.anchors;}
  function at(t){return time(points(),t);}
  function mi(t){let i=data.measures.findIndex((r,j)=>j+1===data.measures.length||data.measures[j+1][0]>t);return Math.max(0,i);}
  function bounds(i){const [t,n]=data.measures[i];return [at(t),Math.min(data.sourceSeconds,at(t+n))];}
  function label(t){if(t===data.base.at(-1)[0])return 'Release';
    const i=mi(t),[s,,num,den]=data.measures[i],b=(t-s)/(data.division*4/den);
    const beat=Math.floor(b+1e-6)+1,frac=Math.round((b-Math.floor(b+1e-6))*1000)/1000;
    return t===s?'m'+(i+1):'m'+(i+1)+'.'+beat+(frac>0?String(frac).slice(1):'');}
  const songTitle=s=>titles.get(s);
  function setLeft(x){left=clamp(x,0,Math.max(0,data.sourceSeconds-span));}
  function position(s,f=.32){setLeft(s-span*f);}
  function zoom(f,anchor,ratio=.5){if(!data)return;span=clamp(span*f,.9,data.sourceSeconds);setLeft(anchor-span*ratio);draw();}
  function selectMeasure(i,fit=false){const [a,b]=bounds(i);selected=data.measures[i][0];
    if(fit)span=Math.min(data.sourceSeconds,(b-a)*1.22);position(a,fit?.08:.13);
    transport.seek(a);url();draw();}
  function url(){const u=new URL(location.href);u.searchParams.set('song',slug);u.searchParams.set('measure',mi(selected)+1);history.replaceState(null,'',u);}
  function setAudioEvents(){
    if(!m)return;
    const notes=data.notes.filter(n=>part===-1||n[0]===part).map(([track,a,b,key,velocity])=>({track,key,velocity,start:at(a),end:at(b)})).sort((a,b)=>a.start-b.start);
    const clicks=[];for(const [t,len,,den] of data.measures)for(let k=t;k<t+len;k+=data.division*4/den)clicks.push({time:at(k),accent:m.primary.has(k)});
    transport.loop=()=>loop?bounds(mi(selected)):null;transport.setEvents(notes,clicks);
  }
  function sectionPeaks(buf){
    const step=128,count=Math.ceil(buf.length/step),lo=new Float32Array(count),hi=new Float32Array(count);
    for(let c=0;c<buf.numberOfChannels;c++){const channel=buf.getChannelData(c);
      for(let j=0;j<count;j++){let neg=lo[j],pos=hi[j];const limit=Math.min((j+1)*step,channel.length);
        for(let i=j*step;i<limit;i+=2){const a=channel[i];if(a<neg)neg=a;if(a>pos)pos=a;}lo[j]=neg;hi[j]=pos;}}
    return {lo,hi,step:step/buf.sampleRate};
  }
  function canvas(el){const w=el.clientWidth,h=el.clientHeight,d=window.devicePixelRatio||1;
    if(el.width!==Math.round(w*d)||el.height!==Math.round(h*d)){el.width=Math.round(w*d);el.height=Math.round(h*d);}
    const ctx=el.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);return [ctx,w,h];}
  function wave(c,w,top,h,start,duration){
    if(!peaks)return;const mid=top+h/2,upper=new Float32Array(w+1),lower=new Float32Array(w+1);let peak=.012;
    for(let x=0;x<=w;x++){const a=Math.max(0,Math.floor((start+x/w*duration)/peaks.step));
      const b=Math.min(peaks.lo.length,Math.max(a+1,Math.ceil((start+(x+1)/w*duration)/peaks.step)));
      let lo=0,hi=0;for(let k=a;k<b;k++){lo=Math.min(lo,peaks.lo[k]);hi=Math.max(hi,peaks.hi[k]);}
      upper[x]=hi;lower[x]=lo;peak=Math.max(peak,hi,-lo);}
    const scale=h*.47/peak;c.beginPath();c.moveTo(0,mid-scale*lower[0]);
    for(let x=1;x<=w;x++)c.lineTo(x,mid-scale*lower[x]);
    for(let x=w;x>=0;x--)c.lineTo(x,mid-scale*upper[x]);c.closePath();c.fill();
  }
  function draw(){
    if(!m)return;const [c,w,h]=canvas(plot);if(!w||!h)return;
    const css=getComputedStyle(rail),color=v=>css.getPropertyValue('--'+v).trim();
    const X=s=>(s-left)/span*w,head=$('onsets').checked?47:31,waveTop=Math.round(h*.69),lyricY=waveTop-8;
    const upper=head+4,lower=waveTop-25,right=left+span,atTick=t=>X(at(t)),viewNotes=data.notes.filter(n=>part===-1||n[0]===part);
    const visibleNotes=viewNotes.filter(n=>at(n[2])>=left&&at(n[1])<=right);
    let low=Math.min(...visibleNotes.map(n=>n[3]))-1,high=Math.max(...visibleNotes.map(n=>n[3]))+1;
    if(!Number.isFinite(low)){low=48;high=72;}if(high-low<12){low-=Math.floor((12-high+low)/2);high=low+12;}
    const row=(lower-upper)/(high-low+1),Y=k=>upper+(high-k)*row;
    function vline(x,y0,y1,col){c.strokeStyle=col;c.beginPath();c.moveTo(Math.round(x)+.5,y0);c.lineTo(Math.round(x)+.5,y1);c.stroke();}
    c.font='12px system-ui';c.textBaseline='middle';c.fillStyle=color('soft');
    for(let k=low;k<=high;k++)if(k%12===0){const y=Math.round(Y(k)+row/2);c.strokeStyle=color('grid');c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();c.fillText('C'+(k/12-1),3,y-4);}
    for(const [t,len,,den] of data.measures){if(at(t+len)<left||at(t)>right)continue;
      for(let k=t;k<t+len;k+=data.division*4/den){const x=atTick(k);
        vline(x,k===t?22:head,k===t?h-17:lower,k===t?color('bar'):m.primary.has(k)?color('mint'):color('grid'));}}
    for(const [i,a,b,key] of visibleNotes){const x1=atTick(a),x2=atTick(b);
      c.fillStyle=partColors[i];c.globalAlpha=.82;c.fillRect(x1,Y(key),Math.max(1,x2-x1-.8),Math.max(2,row*.83));}
    c.globalAlpha=1;c.fillStyle=color('soft');c.font='italic 12px Georgia';let prev=-Infinity;
    for(const [t,word] of data.words){const x=atTick(t);if(x<0||x>w||x<prev+4)continue;
      c.fillText(word,x+2,lyricY);prev=x+c.measureText(word).width;}
    c.fillStyle=color('grid');c.fillRect(0,waveTop,w,1);c.fillStyle=color('wave');wave(c,w,waveTop+3,h-waveTop-24,left,span);
    c.fillStyle=color('soft');c.font='11px system-ui';const step=[.1,.25,.5,1,2,5,10,20,30,60,120].find(s=>s/ span*w>=65)||120;
    for(let s=Math.ceil(left/step)*step;s<=right;s+=step){const x=X(s);c.fillRect(x,h-16,1,3);const text=s<60?Number(s.toFixed(2))+'s':Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');c.fillText(text,Math.min(w-c.measureText(text).width-1,x+3),h-6);}
    const sx=atTick(selected);if(sx>=0&&sx<=w)vline(sx,head,h-17,color('note'));
    renderHandles(w);const [o,ow,oh]=canvas(overview);
    o.fillStyle=color('wave');wave(o,ow,0,oh,0,data.sourceSeconds);const x=left/data.sourceSeconds*ow,ww=span/data.sourceSeconds*ow;
    o.fillStyle=color('bg');o.globalAlpha=.7;o.fillRect(0,0,x,oh);o.fillRect(x+ww,0,ow-x-ww,oh);o.globalAlpha=1;
    o.strokeStyle=color('mint');o.strokeRect(x+.5,.5,Math.max(1,ww-1),oh-1);
    $('viewTime').textContent=fmt(left)+' – '+fmt(Math.min(data.sourceSeconds,right));overview.setAttribute('aria-valuemax',data.sourceSeconds.toFixed(2));overview.setAttribute('aria-valuenow',left.toFixed(2));
    update();cursor();
  }
  function renderHandles(w){
    const host=$('handles'),existing=new Map([...host.children].map(n=>[+n.dataset.tick,n]));
    const all=$('onsets').checked?[...new Set([...m.primary,...m.starts])]:[...m.primary];
    const pinned=new Set(points().map(p=>p[0])),bins=[[],[]];
    for(const t of all){const x=(at(t)-left)/span*w;if(x<-.1||x>w+.1)continue;bins[m.primary.has(t)?0:1].push([t,x]);}
    for(const [lane,items] of bins.entries()){items.sort((a,b)=>a[1]-b[1]);for(let i=0;i<items.length;i++){
      const [t,x]=items[i],bar=data.measures[mi(t)][0]===t;const b=existing.get(t)||document.createElement('button');
      const name=label(t),width=clamp(Math.min(x-(items[i-1]?.[1]??-Infinity),(items[i+1]?.[1]??Infinity)-x)-1,3,lane?22:54);
      b.type='button';b.dataset.tick=t;b.className='handle '+(lane?'note-mark':bar?'bar-mark':'group-mark')+(selected===t?' selected':'')+(lane&&pinned.has(t)?' pinned':'');
      b.textContent=lane?'':width>20?name.replace(/^m/,''):'';b.style.width=width+'px';b.style.left=clamp(x,width/2,w-width/2)+'px';
      b.title=(name==='Release'?name:(lane?'Note ':bar?'Downbeat ':'Group ')+name)+' · '+at(t).toFixed(3)+' s';b.setAttribute('aria-label',b.title);
      if(!b.parentNode)host.append(b);existing.delete(t);
    }}for(const b of existing.values())b.remove();
  }
  function update(){
    const busy=applying||loading||!m;
    for(const s of songs)$(s).disabled=applying;
    $('apply').disabled=busy||!m?.dirty||!localApply();
    $('apply').title=localApply()?'Rebuild the local practice player with these timings':'Apply on the local Mac; this preview can export edits.';
    $('measure').disabled=$('part').disabled=applying||!m;
    $('undo').disabled=busy||!m.undoable;$('redo').disabled=busy||!m.redoable;$('export').disabled=busy;
    $('play').disabled=!transport.buffer||loading;for(const id of ['earlier','later','reset'])$(id).disabled=busy;
    $('status').textContent=message||m?.warn||(m?.dirty?'Draft saved on this device':'');$('status').dataset.error=String(error);
    if(!m)return;$('measure').value=mi(selected)+1;$('selected').textContent=label(selected)+(m.primary.has(selected)?'':' · note');
    $('time').textContent=at(selected).toFixed(3)+' s';
  }
  function cursor(){
    const s=transport.now();$('clock').textContent=fmt(s);
    if(shownPlay!==!!transport.playing){shownPlay=!!transport.playing;const b=$('play');b.innerHTML='<i data-lucide="'+(shownPlay?'pause':'play')+'"></i>';b.setAttribute('aria-label',shownPlay?'Pause':'Play');lucide.createIcons({nodes:[b.firstChild]});}
    const x=(s-left)/span;$('cursor').hidden=x<0||x>1;$('cursor').style.left=(x*100)+'%';
  }
  function animate(){cancelAnimationFrame(frame);function next(){if(!data)return;const s=transport.now();
    if(transport.playing&&!drag&&(s>left+span||s<left)){position(s,.12);draw();}else cursor();
    if(transport.playing)frame=requestAnimationFrame(next);}next();}
  async function play(){if(!transport.buffer)return;if(transport.playing)transport.stop();else{const id=serial;await transport.ensure().resume();if(serial!==id||!transport.buffer)return;transport.start();}animate();}
  function editDone(fn){if(!m||applying)return;message='';error=false;fn();setAudioEvents();draw();}
  function setPart(){
    part=Number($('part').value);const words=new Map();
    for(const [p,t,,word] of data.lyrics)if((part===-1||p===part)&&!words.has(t))words.set(t,word);
    data.words=[...words].sort((a,b)=>a[0]-b[0]);$('legend').replaceChildren();
    for(const p of data.parts.filter(p=>part===-1||p.index===part)){const n=document.createElement('span'),b=document.createElement('b');b.style.background=partColors[p.index];n.append(b,p.short||p.name);$('legend').append(n);}
    setAudioEvents();draw();
  }
  async function select(s,num=null){
    if(applying)return;if(m)views.set(slug,{selected,left,span,part,position:transport.now()});
    const prior=num===null?views.get(s):null;const id=++serial;loadController?.abort();loadController=new AbortController();const signal=loadController.signal;
    cancelAnimationFrame(frame);transport.stop();transport.buffer=null;preview=drag=peaks=m=data=null;slug=s;loading=true;
    $('handles').replaceChildren();for(const el of [plot,overview])canvas(el);$('cursor').hidden=true;status('Loading '+songTitle(s)+'…');
    for(const k of songs)$(k).setAttribute('aria-selected',String(k===s));$('score').setAttribute('aria-labelledby',s);
    try{const res=await fetch(s+'.json',{cache:'no-store',signal});if(!res.ok)throw Error('Timing data unavailable');
      const d=await res.json();if(id!==serial)return;data=d;m=model(d,localStorage);d.words=[];partColors=d.parts.map((p,i)=>colors[i%colors.length]);
      $('measure').replaceChildren(...d.measures.map((_,i)=>new Option(String(i+1),i+1)));
      $('part').replaceChildren(new Option('All parts',-1),...d.parts.map(p=>new Option(p.short||p.name,p.index)));
      const i=clamp((Number(num)||1)-1,0,d.measures.length-1);selected=prior?.selected??d.measures[i][0];
      span=prior?.span??clamp((bounds(i)[1]-bounds(i)[0])*2.45,7,22);
      if(prior){setLeft(prior.left);$('part').value=prior.part;}else position(at(selected),.12);
      transport.pos=prior?.position??at(selected);setPart();url();
      const media=await fetch(d.audio,{signal});if(!media.ok)throw Error('Original recording unavailable');
      const buf=await transport.ensure().decodeAudioData(await media.arrayBuffer());if(id!==serial)return;
      if(Math.abs(buf.duration-d.sourceSeconds)>.15)throw Error('Recording length does not match timing data.');
      transport.buffer=buf;peaks=sectionPeaks(buf);loading=false;message='';draw();
    }catch(e){if(id===serial){loading=false;status(e.message,true);}}
  }
  const rel=(e,el)=>clamp((e.clientX-el.getBoundingClientRect().left)/el.clientWidth,0,1);
  function viewSeek(s){transport.seek(s);cursor();if(transport.playing)animate();}
  rail.onpointerdown=e=>{
    if(!m||applying||e.button!==0)return;const h=e.target.closest('.handle');
    if(!h){viewSeek(left+rel(e,rail)*span);return;}e.preventDefault();
    const t=+h.dataset.tick;selected=t;drag={id:e.pointerId,t,x:e.clientX,orig:at(t),wasMoved:false};rail.setPointerCapture(e.pointerId);draw();
  };
  rail.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x;if(!drag.wasMoved&&Math.abs(dx)<3)return;drag.wasMoved=true;
    preview=m.moved(drag.t,drag.orig+dx/rail.clientWidth*span);draw();};
  function finish(e,cancel){if(!drag||drag.id!==e.pointerId)return;const moved=drag.wasMoved,p=preview;drag=preview=null;
    if(!cancel){if(moved&&p)editDone(()=>m.commit(p));else viewSeek(at(selected));url();}draw();}
  rail.onpointerup=e=>finish(e,false);rail.onpointercancel=e=>finish(e,true);
  rail.onwheel=e=>{if(!m)return;e.preventDefault();const r=rel(e,rail);if(e.altKey||e.ctrlKey)zoom(Math.exp(clamp(e.deltaY,-80,80)*.012),left+span*r,r);
    else{setLeft(left+(e.deltaX||e.deltaY)*span/rail.clientWidth);draw();}};
  function pan(e){if(!m)return;setLeft(rel(e,overview)*data.sourceSeconds-span/2);draw();}
  overview.onpointerdown=e=>{overview.setPointerCapture(e.pointerId);pan(e);};overview.onpointermove=e=>{if(overview.hasPointerCapture(e.pointerId))pan(e);};
  overview.onkeydown=e=>{if(m&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setLeft(left+(e.key==='ArrowRight'?1:-1)*span/2);draw();}};
  $('play').onclick=play;$('measure').onchange=()=>selectMeasure(+$('measure').value-1);$('part').onchange=setPart;$('onsets').onchange=()=>{if(m)draw();};
  $('loop').onclick=()=>{loop=!loop;$('loop').setAttribute('aria-pressed',loop);if(transport.playing)transport.seek(transport.now());};
  for(const key of ['recording','midi','click'])$(key).onclick=()=>{const v=!transport.layers[key];$(key).setAttribute('aria-pressed',v);transport.mix(key,v);};
  $('balance').oninput=()=>{transport.balance=Number($('balance').value)/100;
    for(const key of ['recording','midi'])transport.mix(key,transport.layers[key]);};
  for(const [id,f] of [['in',.62],['out',1/.62]])$(id).onclick=()=>{if(m){const s=at(selected);zoom(f,s>=left&&s<=left+span?s:left+span/2,s>=left&&s<=left+span?(s-left)/span:.5);}};
  $('fit').onclick=()=>{if(m)selectMeasure(mi(selected),true);};
  function nudge(d){editDone(()=>m.commit(m.moved(selected,at(selected)+d)));}
  $('earlier').onclick=()=>nudge(-.01);$('later').onclick=()=>nudge(.01);
  $('undo').onclick=()=>editDone(()=>m.history(false));$('redo').onclick=()=>editDone(()=>m.history(true));$('reset').onclick=()=>editDone(()=>m.reset(selected));
  $('export').onclick=()=>{const a=document.createElement('a');const u=URL.createObjectURL(new Blob([JSON.stringify(m.payload(),null,2)],{type:'application/json'}));a.href=u;a.download=slug+'-reviewed-anchors.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
  $('apply').onclick=async()=>{if(!m||!localApply()||applying||!m.dirty)return;const payload=m.payload();applying=true;status('Rebuilding the local player…');try{
    const u=new URL(applyUrl,location.href);u.searchParams.set('song',slug);
    const res=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),r=await res.json();
    if(!res.ok||!r.revision)throw Error(r.error||'Apply failed');m.saved(r.revision,payload.anchors);status('Applied to local Melete.');
  }catch(e){status(e.message,true);}finally{applying=false;update();}};
  document.addEventListener('keydown',e=>{
    if(!m||applying||e.target.matches('input,select,textarea'))return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();editDone(()=>m.history(e.shiftKey));return;}
    if(e.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const s=songs[(songs.indexOf(slug)+(e.key==='ArrowLeft'?-1:1)+songs.length)%songs.length];$(s).focus();select(s);return;}
    if(e.code==='Space'){e.preventDefault();if(!e.repeat)play();return;}
    if(e.target.closest('.handle')){const t=+e.target.closest('.handle').dataset.tick;
      if(['ArrowLeft','ArrowRight','Enter'].includes(e.key)){e.preventDefault();selected=t;if(e.key==='Enter')viewSeek(at(t));else nudge((e.key==='ArrowLeft'?-1:1)*(e.shiftKey?.1:.01));draw();}}
  });
  new ResizeObserver(()=>{if(m)draw();}).observe(rail);
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(m)draw();});
  async function boot(){
    lucide.createIcons();loading=true;status('Loading performances…');
    const r=await fetch('catalog.json',{cache:'no-store'});if(!r.ok)throw Error('Performance catalog unavailable');
    const catalog=await r.json();applyUrl=catalog.applyUrl;
    for(const {id,title} of catalog.songs){
      if(!/^[a-z0-9][a-z0-9-]*$/.test(id)||$(id))throw Error('Invalid song identifier');
      songs.push(id);titles.set(id,title);const b=document.createElement('button');b.id=id;b.setAttribute('role','tab');b.setAttribute('aria-controls','score');
      b.setAttribute('aria-selected','false');b.textContent=title;b.onclick=()=>{if(id!==slug||(!m&&!loading))select(id);};$('songs').append(b);
    }
    if(!songs.length)throw Error('No performances in catalog');
    const query=new URLSearchParams(location.search);await select(songs.includes(query.get('song'))?query.get('song'):songs[0],parseInt(query.get('measure')||'1',10));
  }
  boot().catch(e=>{loading=false;status(e.message,true);});
})();
