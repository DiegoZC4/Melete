const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const {expandSettingsFixture}=require('./browser-settings-sections.cjs');

(async()=>{
  const html=await fs.readFile(process.argv[2],'utf8');
  const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||undefined,args:['--mute-audio','--use-fake-device-for-media-stream']});
  require('./browser-silent-output.cjs').useSilentOutput(browser);
  try {
    for(const song of ['autumn','the-seed']){
      const context=await browser.newContext({viewport:{width:1180,height:780},serviceWorkers:'block'});
      const origin='http://127.0.0.1:18878';
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin && new URL(route.request().url()).pathname==='/qa'
        ? route.fulfill({contentType:'text/html',body:html}) : route.abort());
      await expandSettingsFixture(context);
      const page=await context.newPage(), errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.setDefaultTimeout(12000);
      await page.goto(origin+'/qa?mode=station#'+song);
      const iframe=page.locator('iframe[data-melete-collection-player][aria-hidden="false"]');
      await iframe.waitFor();
      const frame=await (await iframe.elementHandle()).contentFrame();
      await frame.waitForFunction(()=>!document.querySelector('#playPause')?.disabled);
      if(await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
      if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
      await frame.locator('#fullscreen').click();
      await frame.waitForFunction(()=>!!document.fullscreenElement);
      await page.keyboard.press('Escape');
      await frame.waitForFunction(()=>!document.fullscreenElement);
      assert.equal(await frame.locator('#settingsToggle').getAttribute('aria-expanded'),'true');
      await page.waitForTimeout(200);
      await frame.locator('#settingsToggle').focus();
      await page.keyboard.press('Escape');
      assert.equal(await frame.locator('#settingsToggle').getAttribute('aria-expanded'),'false');
      assert.deepEqual(errors,[]);
      console.log(song+': first Escape exits fullscreen and preserves settings; second Escape closes settings');
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
