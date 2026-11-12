// Starts an isolated browser and cleans its build on exit. Use heavy-run where installed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.GUI_QA_NODE_MODULES
  ? path.join(process.env.GUI_QA_NODE_MODULES, 'playwright') : 'playwright');
const {checkMeasureRests} = require('./browser-rest-layout.cjs');
const {checkWrittenAccidentals} = require('./browser-written-accidentals.cjs');
const {checkCursorEdges} = require('./browser-cursor-layout.cjs');
const {checkPanHolds} = require('./browser-pan-hold.cjs');
const {checkNumericClicks, checkNumericWheel, checkVolumeDrag, checkBoostedAudio} = require('./browser-volume-drag.cjs');
const {checkFirstVisit, checkTouchVolumeTip, checkPartLinks, checkTouchRows, checkScrubLabel} = require('./browser-onboarding.cjs');
const {pitchbarProbe, checkPitchbarSpacing} = require('./browser-pitchbar-spacing.cjs');
const {pitchTraceProbe, checkPitchTraceResolution} = require('./browser-pitch-resolution.cjs');
const {checkLoopLinks} = require('./browser-loop-links.cjs');
const {loopReloadProbe, checkLoopReload} = require('./browser-loop-reload.cjs');
const {recordingProbe, checkLoopRecorder} = require('./browser-loop-recorder.cjs');
const {checkTakePitch} = require('./browser-take-pitch.cjs');
const {checkComp} = require('./browser-comp.cjs');
const {checkMicrophone} = require('./browser-microphone-check.cjs');
const {staffFollowProbe, checkStaffFollow, checkHorizontalFollow} = require('./browser-staff-follow.cjs');
const {checkPlaybackTiming} = require('./browser-playback-timing.cjs');
const {singPreferenceProbe, checkSingPreferences} = require('./browser-sing-preferences.cjs');
const {expandSettingsFixture, checkSettingsSections} = require('./browser-settings-sections.cjs');
const {wavBytes} = require('../template/loop_recorder.js');
const {checkPracticeRoutes} = require('./browser-practice-routes.cjs');
const {checkLayeredTakes,checkNoteHitAreas} = require('./browser-layered-takes.cjs');
const {checkSelectiveLyrics, checkLyricNotePriority} = require('./browser-selective-lyrics.cjs');
const {checkUiImports} = require('./browser-ui-import.cjs');
const {checkReferenceMix} = require('./browser-reference-mix.cjs');
const {checkRecordingMix} = require('./browser-recording-mix.cjs');
const {checkRecordEdits} = require('./browser-record-edits.cjs');
const {checkCollections} = require('./browser-collection.cjs');
const {checkStation} = require('./browser-station.cjs');
const {checkCompMetrics} = require('./browser-comp-metrics.cjs');
const {checkEnsembleContours} = require('./browser-ensemble-contours.cjs');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'melete-shared-smoke-'));
  let browser;
  const results = [], errors = [], requests = [];
  try {
    const project = path.join(temporary, 'player');
    execFileSync(process.env.PYTHON || 'python3', [path.resolve(__dirname, '../build_trainer.py'),
      path.join(__dirname, 'fixtures/shared-regressions.musicxml'), '--project-dir', project], {stdio: 'pipe'});
    let html = await fs.readFile(path.join(project, 'dist/index.html'), 'utf8');
    const marker = 'engine = new GuideEngine(sequence);';
    assert.equal(html.split(marker).length, 2);
    html = html.replace(marker, marker + `
      window.__qa = {engine, api, onsets: [], ${staffFollowProbe} ${loopReloadProbe} ${pitchbarProbe}, ${pitchTraceProbe}, ${recordingProbe} ${singPreferenceProbe} get busy() { return Boolean(renderTimer || barRenderFrame || notationRenderInFlight || notationRenderQueued); }};
      const captureCreate = window.MeleteRecording.PcmCapture.create;
      window.MeleteRecording.PcmCapture.create = async function(...args) {
        try { return await captureCreate.apply(this, args); }
        catch (error) { __qa.captureError = String(error); throw error; }
      };
      const scheduleNote = engine.scheduleNote;
      engine.scheduleNote = function(note, ...args) {
        const before = this.scheduled.size;
        const result = scheduleNote.call(this, note, ...args);
        if (this.scheduled.size > before) __qa.onsets.push({start: note.start, track: note.track, key: note.key});
        return result;
      };
    `);
    const fakeMic = path.join(temporary, 'synthetic-microphone.wav');
    const pcm = Int16Array.from({length: 48000 * 4}, (_, i) => Math.round(32767 * .15 * Math.sin(2 * Math.PI * 997 * i / 48000)));
    await fs.writeFile(fakeMic, Buffer.from(wavBytes(pcm, 48000)));
    browser = await chromium.launch({channel: process.env.QA_BROWSER_CHANNEL || undefined, headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fakeMic}`]});
    const offlineFile = path.join(temporary, 'offline.html');
    if (process.env.QA_FILE_ORIGIN) await fs.writeFile(offlineFile, html);
    const origin = process.env.QA_FILE_ORIGIN ? pathToFileURL(offlineFile).href : 'http://127.0.0.1:8809/shared-regression-fixture';
    const output = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : path.resolve(__dirname, '../qa');
    await fs.mkdir(output, {recursive: true});
    const newContext = async (mobile, expanded = true) => {
      const context = await browser.newContext({viewport: mobile ? {width:393,height:852} : {width:1440,height:900},
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, colorScheme: 'dark', permissions: ['microphone']});
      context.on('page', page => page.on('console', message => {
        if (message.type() === 'error') console.error('Player console:', message.text());
      }));
      if (expanded) await expandSettingsFixture(context);
      await context.route('**/*', route => {
          // A ?part= link asks for the same document.
          if (route.request().url().split('?')[0] === origin) return route.fulfill({contentType: 'text/html', body: html});
          requests.push(route.request().url()); return route.abort();
      });
      return context;
    };
    const focused = Object.keys(process.env).some(key => /^QA_.*_ONLY$/.test(key) && process.env[key]);
    if(!focused || process.env.QA_LIBRARY_ONLY) results.push({libraryMerge:await require('./browser-library-merge.cjs').checkLibraryMerge(browser)});
    if(!focused || process.env.QA_ICONS_ONLY){
      const context=await newContext(false);
      try{
        const page=await context.newPage();await page.goto(origin);
        await page.waitForFunction(()=>window.__qa&&!__qa.busy);
        if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
        results.push({recordingIcons:await require('./browser-recording-icons.cjs').checkRecordingIcons(page,output)});
      }finally{await context.close();}
    }
    if(!focused || process.env.QA_ACOUSTIC_ONLY){
      const context=await newContext(false);
      try{results.push({acousticClock:await require('./browser-acoustic-clock.cjs').checkAcousticClock(context,origin)});}
      finally{await context.close();}
    }
    if (!focused || process.env.QA_COLLECTION_ONLY) results.push({collections:await checkCollections(browser,temporary,output)});
    if ((!focused || process.env.QA_SINGER_REVIEW_ONLY) && fsSync.existsSync(path.join(__dirname,'browser-singer-review.cjs')))
      results.push({singerReview:await require('./browser-singer-review.cjs').checkSingerCollections(browser,temporary,output)});
    if (!focused || process.env.QA_REFERENCE_ONLY) results.push({referenceMix:await checkReferenceMix(browser,temporary,output)});
    if (!focused || process.env.QA_ROUTES_ONLY) results.push({practiceRoutes:await checkPracticeRoutes(browser,temporary,output)});
    for (const mobile of [false, true]) {
      if(process.env.QA_ACOUSTIC_ONLY||process.env.QA_ICONS_ONLY||process.env.QA_LIBRARY_ONLY||process.env.QA_SINGER_REVIEW_ONLY)continue;
      if ((!focused || process.env.QA_CLOUD_TABLE_ONLY) && fsSync.existsSync(path.join(__dirname,'browser-cloud-table.cjs'))) {
        const context=await newContext(mobile);
        try {results.push({cloudTable:await require('./browser-cloud-table.cjs').checkCloudTable(context,origin,{output,label:mobile?'mobile':'desktop'})});}
        finally {await context.close();}
        if(process.env.QA_CLOUD_TABLE_ONLY)continue;
      }
      if(!focused || process.env.QA_NOTATION_INK_ONLY){
        const context=await newContext(mobile);
        try{
          const page=await context.newPage();await page.goto(origin);
          await page.waitForFunction(()=>window.__qa&&!__qa.busy);
          if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserOptions button').first().click();
          const probe=require('./browser-notation-ink.cjs').checkNotationInk;
          const dark=await probe(page,page,'dark');
          await page.evaluate(()=>document.documentElement.dataset.theme='light');
          const light=await probe(page,page,'light');
          results.push({notationInk:{mobile,dark,light}});
        }finally{await context.close();}
        if(process.env.QA_NOTATION_INK_ONLY)continue;
      }
      if (!focused || process.env.QA_STATION_MIX_ONLY) {
        const context=await newContext(mobile);
        try{results.push({stationMix:await require('./browser-station-mix.cjs').run(context,origin)});}
        finally{await context.close();}
        if(process.env.QA_STATION_MIX_ONLY)continue;
      }
      if (!focused || process.env.QA_PRACTICE_PRESETS_ONLY) {
        const context=await newContext(mobile);
        try{results.push({practicePresets:await require('./browser-practice-presets.cjs').run(context,origin,mobile)});}
        finally{await context.close();}
        if(process.env.QA_PRACTICE_PRESETS_ONLY)continue;
      }
      if (!focused || process.env.QA_ENSEMBLE_CONTOURS_ONLY) {
        const context = await newContext(mobile);
        try {
          const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
          await page.goto(origin);
          await page.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
          results.push({ensembleContours:await checkEnsembleContours(page,page,{output,label:mobile?'mobile':'desktop'})});
        } finally {await context.close();}
        if (process.env.QA_ENSEMBLE_CONTOURS_ONLY) continue;
      }
      if (!focused || process.env.QA_COMP_METRICS_ONLY) {
        const context = await newContext(mobile);
        try {
          const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
          await page.goto(origin);
          await page.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
          results.push({compMetrics:await checkCompMetrics(page,page,{output,label:mobile?'mobile':'desktop'})});
        } finally {await context.close();}
        if (process.env.QA_COMP_METRICS_ONLY) continue;
      }
      if (!focused || process.env.QA_RECORD_EDITS_ONLY) {
        const context=await newContext(mobile);
        try {
          const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
          await page.goto(origin);
          await page.waitForFunction(()=>window.__qa&&!__qa.busy&&document.querySelector('#playPause:not(:disabled)'));
          results.push({recordEdits:await checkRecordEdits(page,page,{output,label:mobile?'mobile':'desktop'})});
        } finally {await context.close();}
        if(process.env.QA_RECORD_EDITS_ONLY)continue;
      }
      if (!focused || process.env.QA_RECORDING_MIX_ONLY) {
        const context = await newContext(mobile);
        try {
          const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
          await page.goto(origin);
          await page.waitForFunction(()=>window.__qa&&!__qa.busy&&document.querySelector('#playPause:not(:disabled)'));
          results.push({recordingMix:await checkRecordingMix(page,page,{output,label:mobile?'mobile':'desktop'})});
        } finally {await context.close();}
        if(process.env.QA_RECORDING_MIX_ONLY)continue;
      }
      if (!focused || process.env.QA_STATION_ONLY) {
        results.push({station:await checkStation(newContext,origin,html,{output,label:mobile?'mobile':'desktop',mobile,errors})});
        if(process.env.QA_STATION_ONLY)continue;
      }
      if (!focused || process.env.QA_STATION_REVIEW_ONLY) {
        const context=await newContext(mobile);
        try {
          const {roster,checkStationReview}=require('./browser-station-review.cjs');
          await context.route('**/station-roster.json',r=>r.fulfill({json:roster}));
          const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
          await page.goto(origin+'?mode=station');
          const reviewResult=await checkStationReview(page,page,{output,label:mobile?'mobile':'desktop'});
          results.push({stationReview:reviewResult});
          const loadErrors=[];
          page.on('console',m=>{if(m.type()==='error')loadErrors.push(m.text());});
          const delayed=html.replace('await takeStore.backfillRecordingTime();',
            'await new Promise(resolve=>setTimeout(resolve,1200)); await takeStore.backfillRecordingTime();');
          assert.notEqual(delayed,html);
          await context.route(address=>address.href.split('?')[0]===origin,r=>r.fulfill({contentType:'text/html',body:delayed}));
          const ids=await page.evaluate(async()=> (await __qa.takeStore.list(__qa.takeSong)).map(t=>t.id));
          const sourceRow=page.locator('#compRows .comp-row').filter({has:page.locator('.take-singer',{hasText:'Review Source'})})
            .filter({has:page.locator('.comp-review:not(:disabled)')}).first();
          await sourceRow.locator('.take-number').click();
          await page.waitForFunction(part=>__qa.takeReview?.track===part,reviewResult.sourcePart);
          await page.reload();
          await page.waitForFunction(()=>window.__qa && document.querySelectorAll('#compRows .comp-row').length>=2);
          assert.deepEqual(await page.evaluate(async()=> (await __qa.takeStore.list(__qa.takeSong)).map(t=>t.id)),ids);
          assert.deepEqual(loadErrors,[],'station restore waits for its saved recording sources');
          assert.equal(await page.locator('#stationSinger').inputValue(),'Review Target');
          for(const key of ['audible','volumes','pans','metronome','takeVolume','takeReverb'])
            assert.deepEqual(await page.evaluate(key=>__qa.pitchbar.captureSettingsState()[key],key),reviewResult.recordingSettings[key],key+' recording mix survives reload');
          await page.locator('#compRows .comp-row').filter({has:page.locator('.take-singer',{hasText:'Review Source'})})
            .filter({has:page.locator('.comp-review:not(:disabled)')}).first().locator('.take-number').click();
          await page.waitForFunction(part=>__qa.takeReview?.track===part,reviewResult.sourcePart);
          assert.deepEqual(await page.evaluate(()=>__qa.pitchbar.captureSettingsState().volumes),reviewResult.reviewVolumes,'separate review mix survives reload');
          results.push({stationDelayedLibrary:{mobile,loaded:true,recordingsPreserved:true}});
        } finally {await context.close();}
        const ordinary=await newContext(mobile);
        try {
          const page=await ordinary.newPage();page.on('pageerror',e=>errors.push(e.message));
          await page.goto(origin);
          results.push({ordinaryReviewMix:{mobile,...await require('./browser-station-review.cjs').checkOrdinaryReviewMix(page)}});
        } finally {await ordinary.close();}
        if(process.env.QA_STATION_REVIEW_ONLY)continue;
      }
      if (process.env.QA_ROUTES_ONLY || process.env.QA_REFERENCE_ONLY || process.env.QA_COLLECTION_ONLY) continue;
      if (!focused || process.env.QA_SECTIONS_ONLY) {
        const compactContext = await newContext(mobile, false);
        try {
          const page = await compactContext.newPage();
          page.on('pageerror', error => errors.push(error.message));
          const settled = () => page.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
          await page.goto(origin + '?loop=1-2');
          await settled();
          results.push({viewport: mobile ? 'mobile' : 'desktop', sections: await checkSettingsSections(page, page, {
            mobile, output, label: mobile ? 'mobile' : 'desktop',
            reload: async () => {await page.reload(); await settled(); return page;},
          })});
        } finally {await compactContext.close();}
      }
      if (process.env.QA_SECTIONS_ONLY) continue;
      if (!focused || process.env.QA_LYRICS_ONLY) {
        const lyricContext = await newContext(mobile);
        try {
          const page = await lyricContext.newPage();
          page.on('pageerror', error => errors.push(error.message));
          const settled = () => page.waitForFunction(() => window.__qa && !__qa.busy
            && document.querySelector('#playPause:not(:disabled)'));
          await page.goto(origin);
          await settled();
          results.push({viewport:mobile?'mobile':'desktop',lyricNotePriority:await checkLyricNotePriority(page,page,{
            mobile,output,label:mobile?'mobile':'desktop',
          })});
          results.push({viewport:mobile?'mobile':'desktop', lyrics:await checkSelectiveLyrics(page,page,{
            mobile, output, splitWord:'together', label:mobile?'mobile':'desktop', reload:async()=>{await page.reload();await settled();return page;},
          })});
        } finally {await lyricContext.close();}
        if(process.env.QA_LYRICS_ONLY)continue;
      }
      const context = await newContext(mobile);
      try {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const settled = () => page.waitForFunction(() => window.__qa && !__qa.busy &&
          document.querySelector('#playPause:not(:disabled)') && document.querySelector('#score svg, #barScore svg'));
        await page.goto(origin);
        await settled();
        if(process.env.QA_NUMBER_CLICKS_ONLY) {
          if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
          if(await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#settingsToggle').click();
          for(const toggle of await page.locator('.settings-section-toggle').all())
            if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
          results.push({viewport:mobile?'mobile':'desktop',numericClicks:await checkNumericClicks(page,page,mobile,'__qa')});
          continue;
        }
        if(!focused || process.env.QA_NUMBER_WHEEL_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',numericWheel:await checkNumericWheel(page,page)});
          if(process.env.QA_NUMBER_WHEEL_ONLY)continue;
        }
        if (!focused || process.env.QA_UI_IMPORT_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',uiImports:await checkUiImports(page,page,{mobile,output,label:mobile?'mobile':'desktop'})});
          if (process.env.QA_UI_IMPORT_ONLY) continue;
          await page.evaluate(()=>localStorage.clear());
          await page.reload(); await settled();
        }
        if (!focused || process.env.QA_ACCIDENTALS_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',writtenAccidentals:await checkWrittenAccidentals(page,page,
            {output,label:mobile?'mobile':'desktop'})});
          if(process.env.QA_ACCIDENTALS_ONLY)continue;
        }
        assert.equal(await page.locator('#conductorControls').count(), 0, 'ordinary builds have no conductor-mode control');
        assert.equal(await page.evaluate(() => typeof window.MeleteConductor), 'undefined',
          'ordinary builds omit the optional conductor extension');
        assert.equal(await page.evaluate(() => typeof window.MeleteOnsetSource), 'undefined',
          'ordinary builds omit the conductor microphone worklet');
        const pitchCheck = () => checkPitchTraceResolution(page, page, {output, label: mobile ? 'mobile' : 'desktop',
          reload: async () => {await page.reload(); await settled(); return page;}});
        const takePitchCheck = () => checkTakePitch(page, page, {mobile, output, label: mobile ? 'mobile' : 'desktop',
          reload: async () => {await page.reload(); await settled(); return page;}});
        const timingCheck = () => checkPlaybackTiming(page,page,{output,label:mobile?'mobile':'desktop'});
        const compCheck = () => checkComp(page,page,{output,label:mobile?'mobile':'desktop',
          reload: async()=>{await page.reload(); await settled(); return page;}});
        const singCheck = () => checkSingPreferences(page, page, {
          reload: async () => {await page.reload(); await settled(); return page;}});
        const loopReloadCheck = () => checkLoopReload(page, page, {output, label: mobile ? 'mobile' : 'desktop',
          reload: async () => {await page.reload(); await settled(); return page;}});
        if (process.env.QA_HIT_AREAS_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',hitAreas:await checkNoteHitAreas(page,page)});
          continue;
        }
        if (process.env.QA_LAYERS_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',layers:await checkLayeredTakes(page,page,{output,label:mobile?'mobile':'desktop'})});
          results.at(-1).hitAreas=await checkNoteHitAreas(page,page);
          continue;
        }
        if (process.env.QA_STAFF_FOLLOW_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',staffFollow:await checkStaffFollow(page,page,{output,label:mobile?'mobile':'desktop'})});
          continue;
        }
        if (process.env.QA_HORIZONTAL_FOLLOW_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',horizontalFollow:await checkHorizontalFollow(page)});
          continue;
        }
        if (process.env.QA_MIC_CHECK_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',microphone:await checkMicrophone(page,page,{output,label:mobile?'mobile':'desktop'})});
          continue;
        }
        if (process.env.QA_COMP_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',comp:await compCheck()});
          continue;
        }
        if (process.env.QA_HISTORY_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',history:await require('./browser-comp-history.cjs').checkCompHistory(page)});
          continue;
        }
        if (process.env.QA_LOOP_RELOAD_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',loopReload:await loopReloadCheck()});
          continue;
        }
        if (process.env.QA_SING_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',singPreferences:await singCheck()});
          continue;
        }
        if (process.env.QA_TIMING_ONLY) {
          results.push({viewport:mobile?'mobile':'desktop',timing:await timingCheck()});
          continue;
        }
        if (process.env.QA_TAKE_PITCH_ONLY) {
          results.push({viewport: mobile ? 'mobile' : 'desktop', takePitch: await takePitchCheck()});
          continue;
        }
        if (process.env.QA_PITCH_ONLY) {
          if (process.env.QA_PITCH_AFTER_TAKES) await takePitchCheck();
          results.push({viewport:mobile?'mobile':'desktop',pitchResolution:await pitchCheck()});
          continue;
        }
        if (process.env.QA_RECORDER_ONLY) {
          results.push({viewport: mobile ? 'mobile' : 'desktop', loopRecorder:
            await checkLoopRecorder(page, origin, settled, {mobile, output, temporary})});
          continue;
        }
        assert.equal(await page.locator('#verticalScale').getAttribute('data-value'), mobile ? '70' : '100');
        assert.equal(await page.locator('#annotationLayout').count(), 0);
        const names = ['Soprano', 'Alto', 'Bass'];
        const firstVisit = await checkFirstVisit(page, page, {mobile, names});
        if (mobile) await page.locator('#settingsToggle').click();
        const touchTip = mobile ? await checkTouchVolumeTip(page, page, 'Soprano') : null;

        const themeButton = page.locator('#themeToggle');
        const themeIcon = await themeButton.innerHTML();
        const themePalettes = [];
        for (const theme of ['light', 'dark']) {
          await themeButton.click();
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          const next = theme === 'dark' ? 'light' : 'dark';
          assert.equal(await themeButton.getAttribute('aria-label'), `Switch to ${next} theme`);
          assert.equal(await themeButton.getAttribute('title'), `Switch to ${next} theme`);
          assert.equal(await themeButton.innerHTML(), themeIcon, 'theme changes never swap the glyph');
          assert.equal(await themeButton.locator('svg').count(), 1);
          const paint = await themeButton.locator('svg').evaluate(svg => {
            const css = getComputedStyle(svg), box = svg.getBoundingClientRect();
            return {fill: css.fill, color: css.color, stroke: css.stroke, width: box.width, height: box.height};
          });
          assert.equal(paint.fill, paint.color);
          assert.equal(paint.stroke, 'none');
          assert.ok(paint.width > 0 && paint.height > 0);
          themePalettes.push({theme, ...paint});
          await page.locator('.tools-group').screenshot({path: path.join(output, `theme-${mobile ? 'mobile' : 'desktop'}-${theme}.png`)});
        }

        // All nonempty visibility subsets: global directions survive, local ones do not migrate.
        for (const selected of [[0,1,2],[1,2],[0,2],[0,1],[2],[1],[0]]) {
          for (const part of [...selected, ...[0,1,2].filter(part => !selected.includes(part))]) {
            const control = page.locator(`[data-visible-index="${part}"]`);
            if ((await control.getAttribute('aria-pressed') === 'true') !== selected.includes(part)) await control.click();
          }
          await page.waitForFunction(selected => JSON.stringify(__qa.api.tracks.map(track => track.index)) === JSON.stringify(selected), selected);
          await settled();
          await page.waitForFunction(()=>[...document.querySelectorAll('#score svg text')].some(n=>n.textContent.trim()==='Intro'));
          const labels = await page.locator('#score svg text').allTextContents();
          if (!labels.some(label => label.trim() === 'Intro')) {
            await page.screenshot({path:path.join(output,'missing-engraving.png')});
            console.error(JSON.stringify(await page.evaluate(()=>({labels:[...document.querySelectorAll('#score svg text')].map(n=>n.textContent),
              settings:__qa.savedPractice,errors:document.querySelector('#scoreLoading')?.textContent,busy:__qa.busy}))));
          }
          for (const text of ['Intro', 'Verse', 'Chorus', 'Lightly', 'rit.', 'a tempo']) {
            assert.equal(labels.filter(label => label.trim() === text).length, 1, `${selected}: ${text}`);
          }
          assert.equal(labels.filter(label => label.trim() === 'breathe').length, selected.includes(1) ? 1 : 0);
          assert.equal(labels.filter(label => label.trim() === 'Listen').length,
            selected.includes(2) && selected[0] !== 2 ? 2 : 1, 'also-top retains the source-part cue without doubling the top');
          assert.ok(!labels.some(label => /\d\.\d{4}/.test(label)), 'no MIDI precision leaks into printed tempos');
          const engraving = await page.evaluate(() => {
            const texts = [...document.querySelectorAll('#score svg text')];
            const box = text => {
              const node = texts.find(node => node.textContent.trim() === text);
              if (!node) return null;
              const r = node.getBoundingClientRect(), css = getComputedStyle(node);
              return {x:r.x, top:r.top, bottom:r.bottom, weight:css.fontWeight, style:css.fontStyle};
            };
            return {intro:box('Intro'), cue:box('Lightly'), chord:box('C'), verse:box('Verse'), rit:box('rit.')};
          });
          assert.equal(engraving.intro.weight, '700');
          assert.equal(engraving.intro.style, 'normal');
          assert.equal(await page.locator('#score .section-heading').count(), 3);
          assert.equal(await page.locator('#score .section-heading path').count(), 3);
          assert.ok(engraving.cue.top > engraving.intro.bottom, 'heading and cue have visible clearance');
          if (engraving.chord) assert.ok(engraving.chord.top > engraving.cue.bottom, 'chord has its own lane');
          assert.ok(engraving.rit.x > engraving.verse.x + 8, 'mid-bar rit. must not migrate to the bar start');
          const state = await page.evaluate(() => ({renderedTracks: __qa.api.tracks.map(track => track.index)}));
          assert.deepEqual(state.renderedTracks, selected);
        }
        // Reset visibility before exercising actual score taps and playback.
        for (const part of [1,2]) await page.locator(`[data-visible-index="${part}"]`).click();
        await page.waitForFunction(() => __qa.api.tracks.length === 3);
        await settled();
        // Changed key/time signatures must not share the rest's centering span.
        await page.locator('#horizontalScale').press('Home');
        await page.waitForFunction(() => !__qa.busy && __qa.api.settings.display.stretchForce === .05);
        const restLayout = await checkMeasureRests(page, 4, 3);
        await page.locator('#horizontalScale').press('End');
        await page.waitForFunction(() => !__qa.busy && __qa.api.settings.display.stretchForce === 4);
        await checkMeasureRests(page, 4, 3);
        const cursorEdges = await checkCursorEdges(page);
        const pitchbarSpacing = await checkPitchbarSpacing(page, page, {output, label: mobile ? 'mobile' : 'desktop'});
        await settled();
        await page.evaluate(() => __qa.engine.seek(0));
        if (mobile) await page.locator('#settingsToggle').click();
        await page.locator('#playPause').click();
        await page.waitForFunction(() => __qa.engine.playing && __qa.engine.context.state === 'running');
        assert.deepEqual(await page.evaluate(() => __qa.onsets.filter(note => Math.abs(note.start) < 1e-6)
          .map(note => [note.track, note.key]).sort((a, b) => a[0] - b[0])), [[0,72],[1,67],[2,48]],
          'first Play schedules each opening note exactly once');
        await page.evaluate(() => {
          __qa.analyser = __qa.engine.context.createAnalyser();
          __qa.analyser.fftSize = 256;
          __qa.engine.master.connect(__qa.analyser);
        });
        const sounding = () => page.waitForFunction(() => {
          const samples = new Float32Array(256); __qa.analyser.getFloatTimeDomainData(samples);
          return samples.some(value => Math.abs(value) > .0001);
        });
        await sounding();
        for (const measure of [2, 1, 2]) {
          await page.evaluate(() => { __qa.onsets = []; });
          const label = page.locator('#score svg text').filter({hasText: new RegExp(`^${measure}\\s*$`)}).first();
          if (mobile) await label.tap(); else await label.click();
          const seek = await page.evaluate(measure => ({
            position: __qa.engine.basePosition,
            wanted: __qa.engine.secondsAtTick((measure - 1) * 4 * 960),
            onsets: __qa.onsets.filter(note => Math.abs(note.start - __qa.engine.basePosition) < 1e-6)
              .map(note => [note.track, note.key]).sort((a, b) => a[0] - b[0]),
          }), measure);
          assert.ok(Math.abs(seek.position - seek.wanted) < 1e-6, JSON.stringify(seek));
          assert.deepEqual(seek.onsets, measure === 1 ? [[0,72],[1,67],[2,48]] : [[0,76],[1,69],[2,53]],
            'clicked chord is scheduled exactly once, not skipped');
          await sounding();
        }
        await page.locator('#playPause').click();
        // Explicit scale choices survive reload instead of being overwritten by responsive defaults.
        if (mobile) await page.locator('#settingsToggle').click();
        const panHolds = await checkPanHolds(page, page, mobile, '__qa');
        await checkNumericClicks(page, page, mobile, '__qa');
        await settled();
        const volumeDrag = await checkVolumeDrag(page, page, mobile, '__qa',
          path.join(output, `volume-${mobile ? 'mobile' : 'desktop'}.png`));
        const boostedAudio = await checkBoostedAudio(page, '__qa');
        const savedVolumes = await page.locator('[data-volume-index]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.value)));
        const savedMetronome = Number(await page.locator('#metronome').getAttribute('data-value'));
        await page.locator('#metronome').press('End');
        await page.locator('[data-volume-index="0"]').press('End');
        await page.locator('[data-pan-index="1"]').press('Shift+Enter');
        assert.deepEqual(await page.locator('[data-pan-index]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.value))),
          [-100, 100, -100], 'separation is active before the persistence check');
        await page.locator('#verticalScale').press('ArrowUp');
        const saved = await page.locator('#verticalScale').getAttribute('data-value');
        const savedPractice = await page.evaluate(() => __qa.savedPractice.practicePart);
        const storedMixes = await page.evaluate(() => Object.values(localStorage).flatMap(value => {
          try { const data = JSON.parse(value); return Array.isArray(data?.pans) ? [data.pans] : []; }
          catch { return []; }
        }));
        assert.ok(storedMixes.some(pans => JSON.stringify(pans) === '[-100,100,-100]'),
          `pan separation is saved (${mobile ? 'mobile' : 'desktop'}): ${JSON.stringify(storedMixes)}`);
        await page.reload(); await settled();
        assert.equal(await page.locator('[data-volume-index="0"]').getAttribute('data-value'), '200', 'boost survives reload');
        assert.equal(await page.locator('#metronome').getAttribute('data-value'), '200', 'metronome boost survives reload');
        await page.evaluate(value=>{const s=__qa.pitchbar.captureSettingsState();s.metronome=value;__qa.pitchbar.applySettingsState(s);},savedMetronome);
        await page.evaluate(savedVolumes => {
          const state = __qa.pitchbar.captureSettingsState(); state.volumes = savedVolumes;
          __qa.pitchbar.applySettingsState(state);
        }, savedVolumes);
        assert.equal(await page.locator('#verticalScale').getAttribute('data-value'), saved);
        assert.equal(await page.locator('#partChooser').isVisible(), false, 'an answered chooser is not asked again');
        assert.equal(await page.evaluate(() => __qa.savedPractice.practicePart), savedPractice);
        assert.equal(await page.locator('#horizontalScale').getAttribute('data-value'), '400');
        assert.deepEqual(await page.locator('[data-pan-index]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.value))),
          [-100, 100, -100], 'pan separation survives reload');
        if (mobile && await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true')
          await page.locator('#settingsToggle').click();
        await page.locator('[data-pan-index="1"]').press('Shift+Enter');
        assert.deepEqual(await page.locator('[data-pan-index]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.value))),
          [0, 0, 0], 'reloaded separation still toggles back to center');
        if (mobile && await page.locator('#settingsToggle').getAttribute('aria-expanded') === 'true')
          await page.locator('#settingsToggle').click();
        await page.screenshot({path: path.join(output, `shared-${mobile ? 'mobile' : 'desktop'}.png`)});
        const scrubLabel = await checkScrubLabel(page, page, {mobile});
        const touchRows = await checkTouchRows(page, page, {mobile});
        const partLinks = await checkPartLinks(page, origin, settled, {names});
        const loopLinks = await checkLoopLinks(page, origin, settled, {mobile, output});
        const loopReload = await loopReloadCheck();
        const singPreferences = await singCheck();
        const timing = await timingCheck();
        const takePitch = await takePitchCheck();
        const compContext = await newContext(mobile);
        try {
          const compPage = await compContext.newPage();
          compPage.on('pageerror', error => errors.push(error.message));
          const compSettled = () => compPage.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
          await compPage.goto(origin);
          await compSettled();
          results.push({viewport:mobile?'mobile':'desktop',horizontalFollow:await checkHorizontalFollow(compPage)});
          results.push({viewport:mobile?'mobile':'desktop',microphone:await checkMicrophone(compPage,compPage,{output,label:mobile?'mobile':'desktop'})});
          results.push({viewport:mobile?'mobile':'desktop',staffFollow:await checkStaffFollow(compPage,compPage,{output,label:mobile?'mobile':'desktop'})});
          results.push({viewport:mobile?'mobile':'desktop',comp:await checkComp(compPage,compPage,{
            output,label:mobile?'mobile':'desktop',reload:async()=>{await compPage.reload();await compSettled();return compPage;},
          })});
          await compPage.reload(); await compSettled();
          results.push({viewport:mobile?'mobile':'desktop',layers:await checkLayeredTakes(compPage,compPage,{output,label:mobile?'mobile':'desktop'})});
          results.at(-1).hitAreas=await checkNoteHitAreas(compPage,compPage);
        } finally {await compContext.close();}
        // Sing tests now save actual recordings. Keep the loop-history fixture
        // independent rather than deleting sources protected by an earlier comp.
        const recorderContext = await newContext(mobile);
        let loopRecorder;
        try {
          const recorderPage = await recorderContext.newPage();
          recorderPage.on('pageerror', error => errors.push(error.message));
          const recorderSettled = () => recorderPage.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
          loopRecorder = await checkLoopRecorder(recorderPage, origin, recorderSettled, {mobile, output, temporary});
        } finally { await recorderContext.close(); }
        const pitchResolution = await pitchCheck();
        results.push({viewport: mobile ? 'mobile' : 'desktop', visibilitySubsets: 7, onsetChecks: 4, savedScale: saved,
          fullMeasureRests: {scales:[5,400], count:restLayout.length}, cursorEdges, panHolds, volumeDrag, boostedAudio, pitchbarSpacing,
          firstVisit, touchTip, themePalettes, scrubLabel, touchRows, partLinks, loopLinks, loopReload, loopRecorder, pitchResolution, takePitch, timing, singPreferences});
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    const report = {passed: true, freshGenericBuild: true, results, errors, externalRequests: requests};
    const reportName = process.env.QA_MIC_CHECK_ONLY ? 'microphone-check.json' : process.env.QA_COMP_ONLY ? 'comp-smoke.json' : process.env.QA_SECTIONS_ONLY ? 'settings-sections.json' : process.env.QA_LOOP_RELOAD_ONLY ? 'loop-reload.json' : process.env.QA_SING_ONLY ? 'sing-preferences.json' : process.env.QA_TIMING_ONLY ? 'playback-timing.json' : process.env.QA_TAKE_PITCH_ONLY ? 'take-pitch.json' : process.env.QA_PITCH_ONLY ? 'pitch-resolution.json' : process.env.QA_FILE_ORIGIN ? 'recorder-file-smoke.json' : process.env.QA_RECORDER_ONLY ? 'recorder-smoke.json' : 'shared-smoke.json';
    await fs.writeFile(path.join(output, process.env.QA_HORIZONTAL_FOLLOW_ONLY ? 'horizontal-follow.json'
      : process.env.QA_LYRICS_ONLY ? 'selective-lyrics.json'
      : process.env.QA_STAFF_FOLLOW_ONLY ? 'staff-follow.json' : reportName), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (errors.length) console.error('Browser errors:', errors);
    throw error;
  } finally {
    await browser?.close();
    await fs.rm(temporary, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
