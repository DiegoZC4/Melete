const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const {recordingProbe} = require('./browser-loop-recorder.cjs');
const {expandSettingsFixture} = require('./browser-settings-sections.cjs');
const {choosePart} = require('./browser-sing.cjs');
const {checkTakeColumnLayout} = require('./browser-take-column-layout.cjs');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'melete-take-columns-'));
  const output = path.resolve(process.env.QA_OUTPUT_DIR || 'qa/take-columns');
  const results = [], errors = [];
  let browser;
  try {
    await fs.mkdir(output, {recursive: true});
    execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['build_trainer.py', 'tests/fixtures/shared-regressions.musicxml', '--project-dir', temp], {stdio: 'pipe'});
    browser = await chromium.launch({channel: process.env.QA_BROWSER_CHANNEL, headless: true});
    const project = process.env.QA_COLLECTION_PROJECT;
    for (const song of (project ? ['generic', 'autumn', 'the-seed'] : ['generic'])) for (const mobile of [false, true]) {
      const file = song === 'generic' ? path.join(temp, 'dist/index.html') : path.resolve(project, 'players', song, 'dist/index.html');
      const html = (await fs.readFile(file, 'utf8')).replace('engine = new GuideEngine(sequence);',
        `engine = new GuideEngine(sequence);window.__qa={engine,api,${recordingProbe} get busy(){return !!(renderTimer||barRenderFrame||notationRenderInFlight||notationRenderQueued)}};`);
      const context = await browser.newContext({viewport: mobile ? {width:393,height:852} : {width:1440,height:900}, isMobile:mobile, hasTouch:mobile, colorScheme:'dark'});
      try {
        await expandSettingsFixture(context);
        const origin = `http://127.0.0.1:8809/take-column-fixture-${song}`;
        await context.route('**/*', route => route.request().url() === origin ? route.fulfill({contentType:'text/html',body:html}) : route.abort());
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin);
        await page.waitForFunction(() => window.__qa && !__qa.busy && !document.querySelector('#playPause').disabled);
        if (await page.locator('#partChooser').isVisible()) await page.locator('#partChooserDismiss').click();
        await choosePart(page, 0);
        await page.waitForFunction(() => __qa.compState);
        await page.evaluate(async () => {
          const q=__qa,d=q.compDescriptor,first=d.reference.notes[0],rate=d.reference.rate;
          const start=q.engine.tickAtSeconds(first[0]*rate),end=Math.min(d.reference.end,q.engine.tickAtSeconds((first[0]+6)*rate));
          const ref=q.pitchReference({start,end,rate});ref.latency=0;
          const sr=8000,n=Math.ceil(ref.seconds*sr),id=crypto.randomUUID();
          const take=await q.takeStore.append({id,song:q.takeSong,createdAt:Date.now(),sampleRate:sr,replaces:true,
            part:d.label,rate,start,end,pitchReference:ref},0,new Int16Array(n),{finalized:true,complete:true});
          const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
            const from=i*.01,to=Math.min((i+1)*80,n)/sr,note=ref.notes.find(n=>n[0]<=from&&n[1]>from);
            return {start:i*80/sr,end:to,cents:note?note[2][0]*100:null};
          });
          await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,n/sr),MeleteTakePitch.packContour(frames,take));
          await q.reloadTakes();await q.refreshComp();
        });
        const record = page.locator('[data-settings-section="takes"] .settings-section-toggle');
        if (await record.getAttribute('aria-expanded') === 'false') await record.click();
        const row = page.locator('#compRows .is-armed');
        await page.waitForFunction(() => Number(document.querySelector('#compRows .is-armed .take-segments')?.textContent) > 0);
        const label = `${song}-${mobile?'mobile':'desktop'}`;
        const geometry = await checkTakeColumnLayout(page,page,row,{output,label});
        results.push({song,mobile,geometry});
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output,'take-columns.json'),JSON.stringify({passed:true,results,errors},null,2));
    console.log(JSON.stringify({passed:true,cases:results.length}));
  } finally { await browser?.close();await fs.rm(temp,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
