// Compare the same graded trace in the actual collection. Only the cloud identity
// response is simulated; no account or microphone is used.
const assert=require('node:assert/strict');
const browsers=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));
const {active}=require('./browser-compatibility.cjs');
const {snapshotEdge,rasterEdge,compareFigure}=require('./browser-contour-ink.cjs');
const {strokePixel}=require('./browser-stroke-pixel.cjs');
async function check(browser,url,song,user){
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  try{
    await ctx.addInitScript({content:'window.qaTraceSvg='+snapshotEdge.toString()+';window.qaSolidInk='+strokePixel.toString()+';'});
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
    const fixture=await f.waitForFunction(()=>{
      if(!window.displayQA?.libraryReady()||!window.displayQA.descriptor())return false;
      const a=window.displayQA,ref=a.descriptor().reference;
      const [from,end,[pitch]]=ref.notes.find(([s,e])=>e-s>.6);
      const show=frames=>a.patchReview({id:'identity-fixture',track:ref.part,ref,frames,start:0,end:ref.seconds,rate:1,
        ranges:[[from,end]],seams:[],label:'Synthetic contour'},true);
      const selector='#barScore .take-pitch-trace-edge[data-take-id="identity-fixture"]';
      // Keep the previous near-red boundary check, independent of the new glide.
      show([10,25,50,77,99,100].flatMap((e,i)=>[e,e,null].map((v,j)=>({
        start:from+.03+i*.075+j*.015,end:from+.04+i*.075+j*.015,cents:v===null?null:pitch*100+v}))));
      const flat=[...document.querySelectorAll(selector)].map(window.qaSolidInk);
      // Two red observations, one flat and one sharp of the SAME sustained note.
      // The old renderer painted this entire connected edge solid red.
      const frames=[-100,100].map((e,i)=>({start:from+.08+i*.20,end:from+.09+i*.20,cents:pitch*100+e}));
      show(frames);
      const path=document.querySelector(selector);
      if(!path)return false;
      return {...window.qaTraceSvg(path),flat};
    },null,{polling:100,timeout:15000});
    const probe=await fixture.jsonValue();await fixture.dispose();
    assert.deepEqual(probe.flat.slice(0,4),['rgb(0, 255, 0)','rgb(164, 234, 0)','rgb(248, 187, 0)','rgb(255, 120, 41)']);
    assert.equal(probe.flat.length,6);assert.notEqual(probe.flat[4],probe.flat[5],'99 cents is not full red');
    assert.equal(probe.flat[5],'rgb(255, 0, 0)');
    const {bands,colors}=await f.evaluate(rasterEdge,probe);
    assert.ok(bands>=5,'the native-size 2.6px stroke must visibly cross all five hue families; got '+bands);
    const expected=[[255,0,0],[255,84,29],[255,146,43],[248,187,0],[205,218,0],[164,234,0],[0,255,0]];
    for(let i=0;i<colors.length;i++) {
      const rgb=expected[Math.min(i,colors.length-1-i)];
      assert.ok(rgb.every((v,k)=>Math.abs(v-colors[i][k])<16),JSON.stringify({i,rgb,paint:colors[i]}));
    }
    if(process.env.CONTOUR_FIGURE&&!user&&song.id==='autumn') {
      await f.evaluate(compareFigure);
      await f.locator('#contour-test-figure').screenshot({path:process.env.CONTOUR_FIGURE});
    }
    return colors;
  }finally{await ctx.close();}
}
(async()=>{
  const engine=process.env.QA_DISPLAY_BROWSER||'chromium';assert.ok(['chromium','firefox','webkit'].includes(engine));
  const browser=await browsers[engine].launch(engine==='chromium'?{args:['--mute-audio']}:{});
  async function run(url,songs){for(const song of songs){
    const anon=await check(browser,url,song,null);
    assert.deepEqual(await check(browser,url,song,{id:'qa',name:'Fixture Singer'}),anon);
    console.log(engine+' '+song.title+': signed-out/in contour pixels match; both sides of the red-to-green crossing and badge-free toolbar verified.');
  }}
  try {
    if(process.argv[2]) await run(process.argv[2],[{id:'autumn',title:'Autumn',part:'B2'},{id:'the-seed',title:'The Seed',part:'B2'}]);
    else await require('./hosted-fixture.cjs').hostedFixture(run);
  } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
