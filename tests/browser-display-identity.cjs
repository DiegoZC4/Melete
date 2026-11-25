// Compare the same graded trace in the actual collection. Only the cloud identity
// response is simulated; no account or microphone is used.
const assert=require('node:assert/strict');
const browsers=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));
const {active}=require('./browser-compatibility.cjs');
const {strokePixel}=require('./browser-stroke-pixel.cjs');
async function check(browser,url,song,user){
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  try{
    await ctx.addInitScript({content:'window.qaStrokePixel='+strokePixel.toString()+';'});
    await ctx.addInitScript(()=>Object.defineProperty(window,'MeleteCompPanel',{configurable:true,set(panel){
      const create=panel.create;panel.create=a=>{window.displayQA=a;return create(a);};
      Object.defineProperty(window,'MeleteCompPanel',{value:panel,configurable:true});
    }}));
    await ctx.route('**/melete/api.php*',route=>{
      assert.equal(route.request().method(),'GET');
      const action=new URL(route.request().url()).searchParams.get('action');
      const json=action==='status'?{configured:true,user}:action==='load'?{profile:null}:{items:[],next:null};
      return route.fulfill({json});
    });
    const page=await ctx.newPage();await page.goto(url+'?song='+song.id+'&view=pitchbar&part='+(song.part||'A'));
    const f=await active(page,song);
    await f.waitForFunction(name=>document.querySelector('#openCloudLibrary')?.getAttribute('aria-label')===name,
      user?'Google account and recording backups':'Sign in with Google to review recordings');
    await f.locator('#offlineReady[data-state=ready]').waitFor({state:'attached',timeout:45000});
    assert.equal(await f.locator('#offlineReady').isVisible(),false);
    assert.equal(await f.locator('#transport #offlineReady').count(),0);
    await f.locator('#barScore .bar-note').first().waitFor({state:'attached'});
    // Wait until the actual song has finished its initial scale/layout pass.
    // Sample this temporary fixture in the same turn as the renderer, before
    // the ordinary saved-take selection can replace it.
    const pixels=await f.waitForFunction(()=>{
      if(!window.displayQA?.libraryReady()||!window.displayQA.descriptor())return false;
      const a=window.displayQA,ref=a.descriptor().reference;
      const [from,end,[pitch]]=ref.notes.find(([s,e])=>e-s>.6);
      const errors=[10,30,50,75,99,100];
      const frames=Array.from({length:6*errors.length},(_,i)=>({start:from+.05+i*.014,end:from+.05+(i+1)*.014,
        cents:pitch*100+errors[Math.floor(i/6)]}));
      a.patchReview({id:'identity-fixture',track:ref.part,ref,frames,start:0,end:ref.seconds,rate:1,
        ranges:[[from,end]],seams:[],label:'Synthetic contour'},true);
      const edges=[...document.querySelectorAll('#barScore .take-pitch-trace-edge[data-take-id="identity-fixture"]')];
      return edges.length?[...new Set(edges.map(window.qaStrokePixel))]:false;
    },null,{polling:100,timeout:15000});
    const palette=await pixels.jsonValue();await pixels.dispose();
    assert.deepEqual(palette.slice(0,4),['rgb(0, 255, 0)','rgb(160, 213, 0)','rgb(208, 168, 0)','rgb(237, 115, 0)']);
    assert.equal(palette.length,6,'the last cent below red must remain distinct in a saved take');
    const nearRed=palette[4].match(/^rgb\((\d+), (\d+), 0\)$/);
    assert.ok(nearRed && +nearRed[1]>=250 && +nearRed[2]>0 && +nearRed[2]<32,'99 cents is nearly but not fully red: '+palette[4]);
    assert.equal(palette[5],'rgb(255, 0, 0)','100 cents is solid red');
    return palette;
  }finally{await ctx.close();}
}
(async()=>{
  const engine=process.env.QA_DISPLAY_BROWSER||'chromium';assert.ok(['chromium','firefox','webkit'].includes(engine));
  const browser=await browsers[engine].launch(engine==='chromium'?{args:['--mute-audio']}:{});
  async function run(url,songs){for(const song of songs){
    const anon=await check(browser,url,song,null);
    assert.deepEqual(await check(browser,url,song,{id:'qa',name:'Fixture Singer'}),anon);
    console.log(engine+' '+song.title+': identical signed-out and signed-in paint and badge-free toolbar: '+anon.join('; '));
  }}
  try {
    if(process.argv[2]) await run(process.argv[2],[{id:'autumn',title:'Autumn',part:'B2'},{id:'the-seed',title:'The Seed',part:'B2'}]);
    else await require('./hosted-fixture.cjs').hostedFixture(run);
  } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
