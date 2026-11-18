// Real collection/UI, disposable storage and synthetic audio only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.GUI_QA_NODE_MODULES
  ? path.join(process.env.GUI_QA_NODE_MODULES,'playwright') : 'playwright');
const {expandSettingsFixture}=require('./browser-settings-sections.cjs');
const {recordingProbe}=require('./browser-loop-recorder.cjs');
const {choosePart}=require('./browser-sing.cjs');
(async()=>{
  const html=await fs.readFile(process.argv[2],'utf8'),output=path.dirname(process.argv[2]);
  const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||undefined,args:['--mute-audio']});
  require('./browser-silent-output.cjs').useSilentOutput(browser);
  const reports=[];
  try { for(const song of ['autumn','the-seed']) {
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
    try {
      const origin='http://127.0.0.1:18873';
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/qa')
        ?route.fulfill({contentType:'text/html',body:html}):route.abort());
      await expandSettingsFixture(context);
      await context.addInitScript(probe=>{
        if(window.top!==window)return;
        const original=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
        Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...original,set(html){
          const marker='engine = new GuideEngine(sequence);';
          original.set.call(this,html.replace(marker,()=>marker+'window.__qa={engine,'+probe+'};'));
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
      const checkNew=async()=>{
        await frame.waitForFunction(()=>{
          const row=document.querySelector('#compRows > .take-row');
          return row?.classList.contains('is-armed')&&row.classList.contains('is-new')&&row.checkVisibility();
        });
        const pos=await frame.locator('#compRows > .take-row').first().evaluate(row=>{
          const table=row.closest('.take-review'),box=row.getBoundingClientRect(),pane=table.getBoundingClientRect();
          return {key:row.dataset.compKey,label:row.querySelector('.take-number').textContent,
            scroll:table.scrollTop,visible:box.top>=pane.top&&box.bottom<=pane.bottom};
        });
        assert.equal(pos.label,'New');assert.equal(pos.scroll,0);assert.ok(pos.visible);
        assert.deepEqual(await frame.locator('#compRows > [data-take-id]').evaluateAll(rows=>rows.map(r=>r.dataset.takeId)),oldOrder);
        return pos.key;
      };
      await bottom();await frame.locator('#addTrack').click();const first=await checkNew();
      await bottom();await frame.evaluate(()=>__qa.refreshComp());
      assert.ok(await frame.locator('.take-review').evaluate(el=>el.scrollTop)>0,'ordinary refresh does not hijack scroll');
      await frame.locator('#takeFields').click();await frame.locator('#takeSourceFilter').selectOption('cloud');await frame.locator('#takeFields').click();
      await frame.locator('#addTrack').click();await frame.locator('#partChooserOptions button').nth(1).click();
      const second=await checkNew();assert.notEqual(first,second);
      assert.equal(await frame.locator('#takeSourceFilter').inputValue(),'all','new local take is visible from Cloud');
      // Give this part a synthetic recorded passage so + follows the same-part layer path.
      await frame.evaluate(async()=>{
        const q=__qa,d=q.compDescriptor,ref={...d.reference,latency:0};
        const id=crypto.randomUUID(),sr=8000,n=Math.ceil(ref.seconds*sr);
        const take=await q.takeStore.append({id,song:q.takeSong,sampleRate:sr,createdAt:Date.now(),
          start:ref.start,end:ref.end,rate:ref.rate,part:d.label,replaces:true,pitchReference:ref,
          trackSlot:q.compState.descriptor.slot,peak:.1},0,
          Int16Array.from({length:n},(_,i)=>2000*Math.sin(i*.2)),{finalized:true,complete:true});
        const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
          const start=i*80/sr,end=Math.min((i+1)*80,n)/sr,note=ref.notes.find(n=>n[0]<=start&&n[1]>start);
          return {start,end,cents:note?note[2][0]*100+15:null};
        });
        await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,ref.seconds),MeleteTakePitch.packContour(frames,take));
        await q.reloadTakes();await q.refreshComp();
      });
      await frame.waitForFunction(()=>__qa.compState.segments.length>0);
      await bottom();await frame.locator('#addTrack').click();await frame.locator('#partChooserOptions button').nth(1).click();
      const third=await checkNew();assert.notEqual(third,second);
      assert.ok(await frame.evaluate(()=>Boolean(__qa.compState.descriptor.slot)));
      assert.ok(await frame.evaluate(async ids=>(await __qa.takeStore.list(__qa.takeSong)).filter(t=>ids.includes(t.id)).length===ids.length,existing));
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(output,song+'-new-take.png')});
      reports.push({song,firstTrack:true,anotherPart:true,samePartLayer:true,newRowFirstAndVisible:true,
        scrollReturnsToTop:true,existingOrderPreserved:true,cloudFilterRevealsNewLocalTake:true,pageErrors:errors.length});
    } finally {await context.close();}
  }}finally{await browser.close();}
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
})().catch(error=>{console.error(error);process.exitCode=1});
