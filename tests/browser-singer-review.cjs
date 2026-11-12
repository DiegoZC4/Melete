const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {wavBytes}=require('../template/loop_recorder.js');

async function checkSingerReview(context,url,{output,label='desktop',inspect=null}={}) {
  await context.addInitScript(()=>Object.defineProperty(window,'MeleteCompPanel',{configurable:true,set(panel){
    const create=panel.create;
    panel.create=adapter=>{
      adapter.cloudConfig={api:'/melete/api.php'};window.reviewQA=adapter;
      const review=adapter.review;adapter.review=(data,...args)=>{window.reviewQAData=data;return review(data,...args);};
      return create(adapter);
    };
    Object.defineProperty(window,'MeleteCompPanel',{value:panel,configurable:true});
  }}));
  let signed=true,firstSong,delaySong=null,release=null,delayed=false;
  const rows=new Map(),requests=[],errors=[];
  const people=['Kathleen Fixture','Other Fixture','Only Here','Rapid Fixture'];
  const slug=name=>name.toLowerCase().replaceAll(' ','-');
  function catalog(song){
    firstSong ||= song;
    return people.filter(name=>name!=='Only Here'||song===firstSong).map((name,i)=>{
      const item={id:`${song}-${slug(name)}`,owner:`rehearsal:${slug(name)}`,name,label:'S',rehearsalDate:'2026-11-08',
        uploaded:1794182400000,mean:20,median:10,tracked:90,origin:0,end:1,segments:[[0,1,1]],part:i===0&&song!==firstSong?1:0};
      rows.set(item.id,{...item,song});return item;
    });
  }
  await context.route('**/melete/api.php*',async route=>{
    const u=new URL(route.request().url()),action=u.searchParams.get('action'),song=u.searchParams.get('song');
    requests.push({action,method:route.request().method(),signed});
    if(action==='status')return route.fulfill({json:{configured:true,user:signed?{id:'reviewer',name:'Fixture Reviewer'}:null,
      directoryAccess:signed,rehearsalReviewer:signed,submissionReviewer:false,reviewer:false}});
    if(action==='logout'){signed=false;return route.fulfill({json:{ok:true}});}
    if(!signed)return route.fulfill({status:401,json:{error:'Sign in required'}});
    if(action==='load')return route.fulfill({json:{profile:null}});
    if(action==='list'||action==='submissions')return route.fulfill({json:{items:[],next:null}});
    if(action==='rehearsals')return route.fulfill({json:{items:catalog(song)}});
    if(action==='directory')return route.fulfill({json:{directory:{singers:people.map(name=>({name,discord:slug(name)}))}}});
    throw Error('Unexpected API action '+action);
  });
  await context.route('**/melete/rehearsal.php*',async route=>{
    const u=new URL(route.request().url()),row=rows.get(u.searchParams.get('id'));
    const ref=await route.request().frame().evaluate(part=>reviewQA.descriptor(part,null,1).reference,row.part);
    if(u.searchParams.get('action')==='pitch'){
      if(delaySong===row.song){delaySong=null;delayed=true;await new Promise(resolve=>{release=resolve;});}
      return route.fulfill({json:{ref,frames:ref.notes.slice(0,3).map(([a,b,p])=>[a,b,p[0]*100])}});
    }
    const pcm=Int16Array.from({length:Math.ceil(ref.seconds*8000)},(_,i)=>Math.round(1200*Math.sin(i/8000*Math.PI*440)));
    return route.fulfill({body:Buffer.from(wavBytes(pcm,8000)),contentType:'audio/wav'});
  });
  await context.route('**/melete/signin.html*',route=>route.fulfill({contentType:'text/html',body:'<title>Fixture sign in</title>'}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const shown=async()=>{
    const handle=await page.locator('iframe[data-melete-collection-player][aria-hidden="false"]').elementHandle();
    const frame=await handle.contentFrame();
    await frame.waitForFunction(()=>window.reviewQA&&!document.getElementById('playPause').disabled);
    if(await frame.locator('#partChooser').isVisible()) {
      // A restored/cloud-selected part can dismiss onboarding while this
      // initial frame is settling. Only tolerate an already-completed dismissal.
      await frame.locator('#partChooserDismiss').click({timeout:2000}).catch(async error=>{
        if(await frame.locator('#partChooser').isVisible())throw error;
      });
      await frame.locator('#partChooser').waitFor({state:'hidden'});
    }
    if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
    for(const section of ['practice','takes']){
      const toggle=frame.locator(`[data-settings-section="${section}"] .settings-section-toggle`);
      if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
    }
    return frame;
  };
  const row=(frame,name)=>frame.locator('[data-cloud-id]').filter({has:frame.locator('.take-singer',{hasText:name})}).locator('.comp-review');
  const selected=async(frame,name)=>frame.waitForFunction(name=>window.reviewQAData?.label.includes(name)&&reviewQA.selected()===reviewQAData.id,name);
  const flip=async frame=>{await frame.locator('#songToggle').click();return shown();};
  try {
    await page.goto(url);let a=await shown();
    await a.waitForFunction(()=>document.querySelectorAll('[data-cloud-id]').length===4);
    await a.locator('#stationPicker').waitFor({state:'visible'});
    await a.locator('#stationSinger').fill('Kathleen');
    await a.locator('.station-option').filter({hasText:'Kathleen Fixture'}).click();
    await selected(a,'Kathleen Fixture');
    assert.equal(await a.evaluate(()=>reviewQAData.ref.part),0);
    if(inspect)return await inspect({page,frame:a,row,selected,
      delayNext:song=>{delaySong=song;delayed=false;},isDelayed:()=>delayed,
      release:()=>{release?.();release=null;}});
    await a.locator('#playPause').click();
    await a.waitForFunction(()=>document.getElementById('playPause').classList.contains('is-playing'));
    const b=await flip(a);await selected(b,'Kathleen Fixture');
    assert.equal(await b.evaluate(()=>reviewQAData.ref.part),1,'same singer may sing a different part in the other score');
    assert.equal(await b.locator('#stationSinger').inputValue(),'Kathleen Fixture');
    assert.equal(await b.locator('#playPause').getAttribute('aria-label'),'Play score','song switch does not autoplay');
    assert.equal(await b.evaluate(()=>reviewQA.audible(reviewQAData.id)),true);
    assert.ok(await b.evaluate(()=>reviewQAData.frames.length>0));
    await flip(b);await selected(a,'Kathleen Fixture');
    await row(a,'Kathleen Fixture').click();
    await a.waitForFunction(()=>reviewQA.selected()===null);
    await flip(a);await b.waitForTimeout(250);
    assert.equal(await b.evaluate(()=>reviewQA.selected()),null,'explicit deselection carries no singer');
    await flip(b);await row(a,'Only Here').click();await selected(a,'Only Here');
    await flip(a);await b.waitForTimeout(250);
    assert.equal(await b.evaluate(()=>reviewQA.selected()),null,'never substitute a different singer');
    assert.equal(await b.locator('#stationSinger').inputValue(),'Only Here');
    await flip(b);await selected(a,'Only Here');
    await row(a,'Other Fixture').click();await selected(a,'Other Fixture');
    delaySong=await b.evaluate(()=>reviewQA.song());delayed=false;
    await flip(a);
    for(let i=0;!delayed&&i<100;i++)await page.waitForTimeout(20);
    assert.equal(delayed,true);
    await row(b,'Kathleen Fixture').click();await selected(b,'Kathleen Fixture');
    release();release=null;await page.waitForTimeout(200);await selected(b,'Kathleen Fixture');
    await row(b,'Rapid Fixture').click();await selected(b,'Rapid Fixture');
    delaySong=await a.evaluate(()=>reviewQA.song());delayed=false;
    await flip(b);
    for(let i=0;!delayed&&i<100;i++)await page.waitForTimeout(20);
    assert.equal(delayed,true);
    await flip(a);await selected(b,'Rapid Fixture');release();release=null;
    await page.waitForTimeout(200);
    assert.equal(await a.evaluate(()=>reviewQA.selected()),null,'late loading cannot select in the hidden song');
    if(output){
      await b.locator('#stationSinger').fill('Kathleen');
      await b.locator('.station-option').filter({hasText:'Kathleen Fixture'}).click();await selected(b,'Kathleen Fixture');
      if(await b.locator('#expandTakes').getAttribute('aria-expanded')!=='true')await b.locator('#expandTakes').click();
      await b.locator('#takePanel').screenshot({path:path.join(output,`singer-review-${label}.png`)});
    }
    await b.locator('#openCloudLibrary').click();await b.locator('#compCloudLogout').click();
    await b.waitForFunction(()=>!document.querySelector('[data-cloud-id]')&&document.getElementById('stationPicker').hidden);
    await a.waitForFunction(()=>!document.querySelector('[data-cloud-id]')&&document.getElementById('stationPicker').hidden);
    assert.equal(await b.locator('.station-option').count(),0,'private directory removed on logout');
    assert.deepEqual(requests.filter(r=>r.action==='directory'&&!r.signed),[]);
    assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>r.action),['logout']);
    assert.deepEqual(errors,[]);
    return {label,sameSingerAcrossSongs:true,directoryReview:true,differentParts:true,missingSinger:true,
      explicitDeselect:true,manualOverride:true,rapidSwitch:true,logoutClearsDirectory:true,uploads:0};
  } finally {release?.();await page.close();}
}

async function checkSingerCollections(browser,temporary,output){
  const fixture=await fs.readFile(path.join(__dirname,'fixtures/shared-regressions.musicxml'),'utf8');
  const scores=[];
  for(const [i,title] of ['Review One','Review Two'].entries()){
    const file=path.join(temporary,`review-${i}.musicxml`);await fs.writeFile(file,fixture.replace('Shared regression score',title));scores.push(file);
  }
  const project=path.join(temporary,'singer-collection');
  execFileSync(process.env.PYTHON||'python3',[path.resolve(__dirname,'../build_trainer.py'),...scores,'--project-dir',project],{stdio:'pipe'});
  const html=await fs.readFile(path.join(project,'dist/index.html'),'utf8'),results=[];
  const url='http://127.0.0.1:8809/singer-collection-fixture';
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
    await context.route('**/singer-collection-fixture*',route=>route.fulfill({body:html,contentType:'text/html'}));
    try {
      results.push(await checkSingerReview(context,url,{output,label:mobile?'mobile':'desktop'}));
    }
    finally {await context.close();}
    const controls=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
    await controls.route('**/singer-collection-fixture*',route=>route.fulfill({body:html,contentType:'text/html'}));
    try {results.push(await require('./browser-review-controls.cjs').checkReviewControls(controls,url,{label:mobile?'mobile':'desktop'}));}
    finally {await controls.close();}
  }
  return results;
}
module.exports={checkSingerReview,checkSingerCollections};
