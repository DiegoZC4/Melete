// Playwright's usual per-page focus emulation masks tab visibility. Attach without
// overrides to an isolated Chromium profile; only fake audio devices are available.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));
const {hostedFixture}=require('./hosted-fixture.cjs');
const {active,section}=require('./browser-compatibility.cjs'),{enableSing}=require('./browser-sing.cjs');
async function run(url,songs) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'melete-tab-test-'));
  const proc=spawn(chromium.executablePath(),['--user-data-dir='+dir,'--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0','--headless=new','--no-first-run','--no-default-browser-check','--disable-sync',
    '--password-store=basic','--use-mock-keychain','--disable-background-networking','--mute-audio',
    '--use-fake-device-for-media-stream','about:blank'],{stdio:'ignore'});
  const ended=once(proc,'exit');let browser;
  try {
    const file=path.join(dir,'DevToolsActivePort');
    for(let i=0;i<120 && !fs.existsSync(file) && proc.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
    const port=Number(fs.readFileSync(file,'utf8').split('\n')[0]);assert.ok(port>0);
    browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{noDefaults:true});
    const ctx=browser.contexts()[0],peer=new URL('/other-audio',url);peer.hostname='localhost';
    for(const origin of [new URL(url).origin,peer.origin])await ctx.grantPermissions(['microphone'],{origin});
    await ctx.addInitScript(()=>{const devices=navigator.mediaDevices;if(!devices)return;
      const get=devices.getUserMedia.bind(devices);
      devices.getUserMedia=async args=>{const stream=await get(args);(top.qaTracks??=[]).push(...stream.getAudioTracks());return stream;};
    });
    await ctx.route(peer.href,r=>r.fulfill({contentType:'text/html',body:`<button id="start">Start</button><script>
      let stream,on=false; async function sync(){if(document.hidden){stream?.getTracks().forEach(t=>t.stop());}
      else if(on)stream=await navigator.mediaDevices.getUserMedia({audio:true});}
      start.onclick=()=>{on=true;sync()};document.addEventListener('visibilitychange',sync);</script>`}));
    const m=await ctx.newPage();await m.bringToFront();
    await m.goto(url+'?song='+songs[0].id+'&view=pitchbar&part=A');
    const f=await active(m,songs[0]);await section(f,'practice');await enableSing(f);
    const tracks=(page,total,live)=>page.waitForFunction(([n,k])=>top.qaTracks?.length===n &&
      top.qaTracks.filter(t=>t.readyState==='live').length===k,[total,live],{timeout:15000});
    await tracks(m,1,1);await f.locator('#playPause').click();
    await f.waitForFunction(()=>+document.querySelector('#seek').value>2200);
    const g=await ctx.newPage();await g.bringToFront();await g.goto(peer.href);
    await m.waitForFunction(()=>document.hidden);await tracks(m,1,0);await g.locator('#start').click();await tracks(g,1,1);
    for(let i=2;i<=3;i++){
      await m.bringToFront();await tracks(g,i-1,0);await tracks(m,i,1);
      assert.equal(await f.locator('#playPause').getAttribute('aria-label'),'Play score');
      await g.bringToFront();await tracks(m,i,0);await tracks(g,i,1);
    }
    await m.bringToFront();await tracks(m,4,1);await tracks(g,3,0);
    const rows=await f.evaluate(async()=>{const store=new MeleteRecording.TakeStore();
      try{return (await store.usage()).filter(t=>t.finalized&&t.frames).length;}finally{(await store.open()).close();}});
    assert.equal(rows,1);await f.locator('#pitchCapture').click();await g.bringToFront();await tracks(g,4,1);
    await m.bringToFront();await tracks(g,4,0);await tracks(m,4,0);
    assert.equal(await f.locator('#pitchCapture').getAttribute('aria-pressed'),'false');
    console.log('Native tab visibility: mic ownership moved both ways; one interrupted take saved; explicit Sing off respected.');
  } finally {
    try{await browser?.close();}finally{if(proc.exitCode===null)proc.kill();await ended;fs.rmSync(dir,{recursive:true,force:true});}
  }
}
hostedFixture(run).catch(e=>{console.error(e);process.exitCode=1;});
