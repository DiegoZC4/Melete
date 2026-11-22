// Real collection/UI, disposable storage and synthetic audio only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.GUI_QA_NODE_MODULES
  ? path.join(process.env.GUI_QA_NODE_MODULES,'playwright') : 'playwright');
const {expandSettingsFixture}=require('./browser-settings-sections.cjs');
const {recordingProbe}=require('./browser-loop-recorder.cjs');
const {choosePart}=require('./browser-sing.cjs');
(async()=>{
  const html=await fs.readFile(process.argv[2],'utf8'),output=path.dirname(process.argv[2]);
  const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||undefined,
    args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  require('./browser-silent-output.cjs').useSilentOutput(browser);
  const reports=[];
  try { for(const song of ['autumn','the-seed']) {
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',permissions:['microphone']});
    try {
      const origin='http://127.0.0.1:18873';
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/qa')
        ?route.fulfill({contentType:'text/html',body:html}):route.abort());
      await context.route('**/station-roster.json',route=>route.fulfill({json:{singers:[{name:'Test Singer',voice:'Alto'}]}}));
      await expandSettingsFixture(context);
      await context.addInitScript(probe=>{
        if(window.top!==window)return;
        const original=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
        Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...original,set(html){
          const marker='engine = new GuideEngine(sequence);';
          original.set.call(this,html.replace(marker,()=>marker+'window.__qa={engine,plan:s=>compPanel.recordingPlan(s),'+
            'get selected(){return takePreviewId},get capturingSlot(){return takeJournal?.spec.trackSlot},'+probe+'};'));
        }});
      },recordingProbe);
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
      await page.goto(origin+'/qa?mode=station#'+song);
      const iframe=page.locator('iframe[aria-hidden="false"]');await iframe.waitFor();
      const frame=await(await iframe.elementHandle()).contentFrame();
      await frame.waitForFunction(()=>window.__qa?.recording.ready&&!document.querySelector('#playPause').disabled);
      if(await frame.locator('#partChooser').isVisible())await frame.locator('#partChooserDismiss').click();
      await choosePart(frame,0);
      const existing=await frame.evaluate(async()=>{
        const q=__qa,ids=[];
        for(let i=0;i<24;i++){
          const id=crypto.randomUUID();ids.push(id);
          await q.takeStore.append({id,song:q.takeSong,sampleRate:8000,createdAt:Date.now()+i,
            part:'QA',rate:1,peak:.1},0,Int16Array.from({length:1600},(_,j)=>(j%61)*81),{finalized:true,complete:true});
        }
        await q.reloadTakes();return ids;
      });
      await frame.waitForFunction(()=>document.querySelectorAll('#compRows > .take-row[data-take-id]').length===24);
      const oldOrder=await frame.locator('#compRows > [data-take-id]').evaluateAll(rows=>rows.map(r=>r.dataset.takeId));
      const bottom=async()=>{
        const offset=await frame.locator('.take-review').evaluate(el=>(el.scrollTop=el.scrollHeight,el.scrollTop));
        assert.ok(offset>0,'fixture must require scrolling');
      };
      const checkNew=async(previous=null)=>{
        await frame.waitForFunction(previous=>{
          const row=document.querySelector('#compRows > .take-row');
          return row?.classList.contains('is-armed') && row.dataset.compKey!==previous && row.classList.contains('is-new')
            && row.classList.contains('is-selected') && row.checkVisibility();
        },previous).catch(async error=>{
          const state=await frame.evaluate(()=>({selected:__qa.selected?.slice(-50),key:__qa.compState?.descriptor.slot,recording:__qa.recording.state,
            slot:__qa.capturingSlot,layers:__qa.engine.takeLayers.size,notice:__qa.recording.notice,
            rows:[...document.querySelectorAll('#compRows .comp-row')].map(r=>[r.className,r.querySelector('.take-number').textContent,JSON.parse(r.dataset.compKey).at(-1)])}));
          throw Error(song+' draft selection: '+JSON.stringify(state),{cause:error});
        });
        const pos=await frame.locator('#compRows > .take-row').first().evaluate(row=>{
          const table=row.closest('.take-review'),box=row.getBoundingClientRect(),pane=table.getBoundingClientRect();
          return {key:row.dataset.compKey,label:row.querySelector('.take-number').textContent,
            values:['.comp-tracked','.comp-mean','.comp-median','.comp-within','.take-segments','.take-created','.take-modified'].map(s=>row.querySelector(s).textContent),
            scroll:table.scrollTop,visible:box.top>=pane.top&&box.bottom<=pane.bottom};
        });
        assert.equal(pos.label,'New');assert.equal(pos.scroll,0);assert.ok(pos.visible);
        assert.deepEqual(pos.values,['0%','—','—','—','—','—','—']);
        assert.equal(await frame.locator('#compRows .is-selected').count(),1);
        assert.equal(await frame.locator('#compRows .is-selected .comp-review').getAttribute('aria-pressed'),'true');
        assert.equal(await frame.evaluate(()=>__qa.selected),'comp:'+pos.key);
        assert.equal(await frame.locator('#compRows .take-hear[aria-pressed="true"]').count(),0);
        assert.equal(await frame.evaluate(()=>__qa.engine.takeLayers.size),0);
        assert.equal(await frame.locator('#exitTakeReview').getAttribute('aria-busy'),'false');
        assert.equal(await frame.locator('#partChooser').isVisible(),false);
        assert.ok(await frame.evaluate(async key=>(await __qa.takeStore.comps(__qa.takeSong)).some(s=>s.key===key && s.track && !s.segments.length),pos.key));
        assert.deepEqual(await frame.locator('#compRows > [data-take-id]').evaluateAll(rows=>rows.map(r=>r.dataset.takeId)),oldOrder);
        return pos.key;
      };
      await bottom();await frame.locator('#addTrack').click();const first=await checkNew();
      await frame.locator('#addTrack').click();const firstSibling=await checkNew(first);
      await recordPass();
      await bottom();await frame.evaluate(()=>__qa.refreshComp());
      assert.ok(await frame.locator('.take-review').evaluate(el=>el.scrollTop)>0,'ordinary refresh does not hijack scroll');
      await frame.locator('#takeFields').click();await frame.locator('#takeSourceFilter').selectOption('cloud');await frame.locator('#takeFields').click();
      await choosePart(frame,1);
      await frame.locator('#addTrack').click();
      const second=await checkNew();assert.notEqual(first,second);
      assert.equal(await frame.locator('#takeSourceFilter').inputValue(),'all','new local take is visible from Cloud');
      // Give this part a synthetic recorded passage so + follows the same-part layer path.
      async function recordPass(){return frame.evaluate(async()=>{
        const q=__qa,d=q.compDescriptor,ref={...d.reference,latency:0};
        const id=crypto.randomUUID(),sr=8000,n=Math.ceil(ref.seconds*sr);
        const take=await q.takeStore.append({id,song:q.takeSong,sampleRate:sr,createdAt:Date.now(),
          start:ref.start,end:ref.end,rate:ref.rate,part:d.label,replaces:true,pitchReference:ref,
          ...q.plan({trackSlot:q.compState.descriptor.slot}),peak:.1},0,
          Int16Array.from({length:n},(_,i)=>2000*Math.sin(i*.2)),{finalized:true,complete:true});
        const errors=[-430,-101,-100,-7,0,15,100,101,430];
        const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
          const start=i*80/sr,end=Math.min((i+1)*80,n)/sr,note=ref.notes.find(n=>n[0]<=start&&n[1]>start);
          return {start,end,cents:note?note[2][0]*100+errors[i%errors.length]:null};
        });
        await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,ref.seconds),MeleteTakePitch.packContour(frames,take));
        await q.reloadTakes();await q.refreshComp();
      });}
      const rowFor=async key=>frame.locator('#compRows > [data-comp-key='+await frame.evaluate(k=>CSS.escape(k),key)+']');
      await recordPass();
      await frame.waitForFunction(()=>__qa.compState.segments.length>0);
      await frame.locator('#takeFields').click();await frame.locator('#allTakeFields').click();await frame.locator('#takeFields').click();
      const scored=await rowFor(second);
      const hit=await scored.evaluate(row=>{
        const cell=row.querySelector('.comp-mean').getBoundingClientRect(),button=row.querySelector('.take-distribution').getBoundingClientRect();
        return {cell:[cell.left,cell.right],button:[button.left,button.right],width:cell.width};
      });
      assert.ok(hit.width>0 && hit.button[0]<=hit.cell[0]+1 && hit.button[1]>=hit.cell[1]-1,JSON.stringify(hit));
      const selected=await scored.locator('.comp-review').getAttribute('aria-pressed');
      await scored.locator('.take-distribution').click();
      const dialog=frame.locator('#takeDistributionDialog');
      await dialog.locator('details:not([hidden])').waitFor({state:'attached'});
      const bins=await dialog.locator('tbody tr').evaluateAll(rows=>rows.map(r=>[...r.cells].map(c=>c.textContent)));
      assert.ok(bins.some(([c,n])=>c==='-7' && Number(n)>0) && bins.some(([c,n])=>c==='+15' && Number(n)>0));
      assert.equal(bins[0][0],'< −100');assert.equal(bins.at(-1)[0],'> +100');
      assert.ok(['-100','+100'].every(label=>bins.some(([c])=>c===label)));
      const chart=dialog.locator('.distribution-chart'), bars=chart.locator('rect');
      assert.equal(await bars.count(),bins.length);
      assert.deepEqual(await bars.locator('title').allTextContents(),bins.map(([c,n])=>c+' ¢ · '+n+(n==='1'?' measurement':' measurements')));
      assert.ok(Number(await bars.first().getAttribute('width'))>2,'both tails leave room for individual one-cent bars');
      for(const label of ['< −100','-100','0','+100','> +100'])assert.ok((await chart.locator('text').allTextContents()).includes(label));
      await dialog.getByRole('button',{name:'Close intonation distribution'}).click();
      assert.equal(await scored.locator('.comp-review').getAttribute('aria-pressed'),selected);
      // Review one recording, pin a different part with Hear, then add during playback.
      if(await scored.locator('.comp-review').getAttribute('aria-pressed')==='true')await scored.locator('.comp-review .take-number').click();
      await scored.locator('.comp-review .take-number').click();
      await frame.waitForFunction(key=>__qa.engine.takeLayers.has('comp:'+key),second);
      const sibling=await rowFor(firstSibling);
      await sibling.locator('.take-hear').click();
      await frame.waitForFunction(()=>__qa.engine.takeLayers.size===2);
      await frame.locator('#playPause').click();
      await frame.waitForFunction(()=>__qa.engine.playing && [...__qa.engine.takeLayers.values()].some(layer=>layer.source));
      await frame.evaluate(()=>{window.__oldLayers=[...__qa.engine.takeLayers.values()];});
      await bottom();await frame.locator('#addTrack').click();
      const third=await checkNew();assert.notEqual(third,second);
      assert.ok(await frame.evaluate(()=>__qa.engine.playing && !__qa.engine.pinnedTakeIds.size && __oldLayers.every(layer=>!layer.source)));
      await frame.locator('#playPause').click();
      assert.ok(await frame.evaluate(()=>Boolean(__qa.compState.descriptor.slot)));
      assert.ok(await frame.evaluate(async ids=>(await __qa.takeStore.list(__qa.takeSong)).filter(t=>ids.includes(t.id)).length===ids.length,existing));
      await frame.locator('#stationSinger').fill('Test Singer');
      await frame.locator('#stationSinger').press('Enter');
      if(await frame.locator('#partChooser').isVisible())await frame.locator('#partChooserOptions button').first().click();
      await frame.waitForFunction(()=>__qa.compState?.descriptor.station?.name==='Test Singer');
      await frame.locator('#addTrack').click();const named=await checkNew();
      await recordPass();
      const namedRows=frame.locator('#compRows .comp-row').filter({has:frame.locator('.take-singer',{hasText:'Test Singer'})});
      await frame.waitForFunction(()=>[...document.querySelectorAll('#compRows .comp-row')].some(r=>r.querySelector('.take-singer').textContent==='Test Singer' && r.querySelector('.comp-mean').textContent!=='—'));
      // Reviewing an older part on the station must return to this singer's recording target.
      await scored.locator('.comp-review .take-number').click();
      await frame.waitForFunction(key=>__qa.engine.takeReview?.id==='comp:'+key,second);
      await frame.locator('#playPause').click();
      await frame.waitForFunction(()=>__qa.engine.playing);
      await frame.evaluate(()=>{
        const store=__qa.takeStore,save=store.saveComp.bind(store);
        store.saveComp=async (state,...args)=>{
          if(state.track && !state.segments.length){
            store.saveComp=save;
            await new Promise(resolve=>{window.__finishDraft=resolve;});
          }
          return save(state,...args);
        };
      });
      await frame.locator('#addTrack').click();
      await frame.waitForFunction(()=>window.__finishDraft && __qa.engine.takeLayers.size===0);
      await frame.locator('#pitchCapture').click();
      await frame.waitForFunction(()=>document.querySelector('#pitchCapture').getAttribute('aria-pressed')==='true');
      assert.equal(await frame.evaluate(()=>__qa.capturingSlot),undefined);
      await frame.evaluate(()=>__finishDraft());
      const punch=await checkNew();
      await frame.waitForFunction(()=>__qa.recording.state==='recording');
      const capture=await frame.evaluate(()=>({slot:__qa.capturingSlot,target:__qa.compState.descriptor.slot,
        key:__qa.compState.key,singer:__qa.compState.descriptor.station.name,muted:!__qa.engine.takeLayers.size}));
      assert.equal(capture.slot,capture.target);assert.equal(capture.key,punch);
      assert.equal(capture.singer,'Test Singer');assert.ok(capture.muted);
      assert.equal(await namedRows.count(),2,'a new named pass is visible beside the existing performance');
      await frame.locator('#pitchCapture').click();
      await frame.waitForFunction(()=>__qa.recording.state==='off');
      if(await frame.evaluate(()=>__qa.engine.playing))await frame.locator('#playPause').click();
      await recordPass();
      await frame.waitForFunction(()=>[...document.querySelectorAll('#compRows .comp-row')].filter(r=>
        r.querySelector('.take-singer').textContent==='Test Singer' && !r.classList.contains('is-new')).length===2);
      const latest=await frame.evaluate(async()=>{
        const takes=await __qa.takeStore.list(__qa.takeSong);
        return Math.max(...takes.filter(t=>t.station?.name==='Test Singer' && t.complete && t.frames).map(t=>t.number));
      });
      await frame.waitForFunction(n=>[...document.querySelectorAll('#compRows .comp-row')].some(r=>
        r.querySelector('.take-singer').textContent==='Test Singer' && r.querySelector('.take-number').textContent===String(n)),latest);
      const numbers=await namedRows.locator('.take-number').allTextContents();
      assert.equal(new Set(numbers).size,2);
      assert.match(await namedRows.locator('.take-number').filter({hasText:new RegExp('^'+latest+'$')}).getAttribute('title'),new RegExp('Take '+latest+'.*in comp'));
      assert.ok(named);
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(output,song+'-new-take.png')});
      reports.push({song,firstTrack:true,anotherPart:true,samePartLayer:true,newRowFirstAndVisible:true,
        emptyMetrics:true,independentNamedTakes:true,signedHistogram:true,
        selectedDraft:true,mutedPlayingAndPinned:true,recordedIntoNewSlot:true,
        scrollReturnsToTop:true,existingOrderPreserved:true,cloudFilterRevealsNewLocalTake:true,pageErrors:errors.length});
    } finally {await context.close();}
  }}finally{await browser.close();}
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
})().catch(error=>{console.error(error);process.exitCode=1});
