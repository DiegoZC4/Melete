const assert = require('node:assert/strict');
const path = require('node:path');
const {choosePart, stopRecording} = require('./browser-sing.cjs');

async function checkEnsembleContours(page, frame, {output, label}) {
  console.log(`Ensemble contours: ${label}`);
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  await choosePart(frame, 0);
  const recordSection = frame.locator('[data-settings-section="takes"] .settings-section-toggle');
  if (await recordSection.getAttribute('aria-expanded') === 'false') await recordSection.click();
  const count = await frame.locator('[data-visible-index]').count(), tracks = [];
  for (let index = 0; index < count; index++) {
    await choosePart(frame, index);
    tracks.push(await frame.evaluate(async index => {
      const q = window.__qa || window.__probe, descriptor = q.compDescriptor;
      const from = descriptor.reference.notes[0][0], to = Math.min(from + 8, descriptor.reference.seconds);
      const start = q.engine.tickAtSeconds(from), end = q.engine.tickAtSeconds(to);
      const ref = q.pitchReference({start,end,rate:1}); ref.latency = 0;
      const id = crypto.randomUUID(), sampleRate = 8000, length = Math.ceil(ref.seconds * sampleRate);
      const pcm = Int16Array.from({length}, (_,i) => 2000 * Math.sin(2 * Math.PI * (220 + index * 55) * i / sampleRate));
      const take = await q.takeStore.append({id,song:q.takeSong,sampleRate,createdAt:Date.now(),replaces:true,
        part:descriptor.label,start,end,rate:1,pitchReference:ref},0,pcm,{finalized:true,complete:true});
      const frames = Array.from({length:Math.ceil(length/80)},(_,i) => {
        const start = i/100, end = Math.min((i+1)/100,length/sampleRate);
        const note = ref.notes.find(n => n[0] <= start && n[1] > start);
        return {start,end,cents:note ? note[2][0]*100+(index===1?100:5) : null};
      });
      await q.takeStore.pitchScore(id,length,ref,MeleteTakePitch.scoreFrames(frames,ref,ref.seconds),MeleteTakePitch.packContour(frames,take));
      await q.reloadTakes(); await q.refreshComp();
      return {id:`comp:${q.compState.key}`,source:id,part:ref.part,line:ref.line,index,start,
        label:descriptor.label,frames:length};
    },index));
  }
  const hear = id => frame.locator(`#compRows [data-comp-key=${JSON.stringify(id.slice(5))}] .take-hear`);
  for (const track of tracks) if (await hear(track.id).getAttribute('aria-pressed') !== 'true') await hear(track.id).click();
  await frame.waitForFunction(count => (window.__qa||window.__probe).engine.takeLayers.size===count,count);
  await frame.locator(`[data-visible-index="${count-1}"]`).press('Shift+Enter');
  if (await frame.locator('[data-view="bars"]').getAttribute('aria-selected') !== 'true') await frame.locator('#scoreViewToggle').click();
  const displayed = () => frame.evaluate(() => [...new Set([...document.querySelectorAll('#barScore .take-pitch-trace-edge')].map(p=>p.dataset.takeId))].sort());
  await frame.waitForFunction(count => new Set([...document.querySelectorAll('#barScore .take-pitch-trace-edge')].map(p=>p.dataset.takeId)).size===count,count);
  assert.deepEqual(await displayed(), tracks.map(t=>t.id).sort());
  assert.equal(await frame.locator('[data-visible-index][aria-pressed="true"]').count(),count);
  assert.equal(await frame.locator('#barScore [data-reference="true"]').count(),0,'ensemble contours are all graded');
  const grades = await frame.evaluate(tracks => tracks.map(t=>{
    const paths=[...document.querySelectorAll('#barScore .take-pitch-trace-edge')].filter(p=>p.dataset.takeId===t.id);
    return {id:t.id,colors:[...new Set(paths.map(p=>p.getAttribute('stroke')))]};
  }),tracks);
  assert.ok(grades[0].colors.includes('rgb(0 255 0)'),JSON.stringify(grades));
  assert.ok(grades[1].colors.includes('rgb(255 0 0)'),JSON.stringify(grades));
  assert.ok(!grades[1].colors.includes('rgb(0 255 0)'), 'a wrong note is not accepted from a different visible part');
  await hear(tracks[0].id).click();
  await frame.waitForFunction(id=>![...document.querySelectorAll('#barScore .take-pitch-trace-edge')].some(p=>p.dataset.takeId===id),tracks[0].id);
  assert.deepEqual(await displayed(),tracks.slice(1).map(t=>t.id).sort());
  await hear(tracks[0].id).click();
  await frame.locator('[data-visible-index="1"]').press('Enter');
  await frame.waitForFunction(id=>![...document.querySelectorAll('#barScore .take-pitch-trace-edge')].some(p=>p.dataset.takeId===id),tracks[1].id);
  assert.deepEqual(await displayed(),tracks.filter(t=>t.index!==1).map(t=>t.id).sort());
  assert.equal(await hear(tracks[1].id).getAttribute('aria-pressed'),'true');
  await frame.locator('[data-visible-index="1"]').press('Enter');
  await frame.waitForFunction(count=>new Set([...document.querySelectorAll('#barScore .take-pitch-trace-edge')].map(p=>p.dataset.takeId)).size===count,count);
  const group=frame.locator('#barScore .take-pitch-trace-group').first();
  const title=await group.locator('title').textContent();
  assert.match(title, /.+: .+/);
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')==='true') await frame.locator('#settingsToggle').click();
  await group.scrollIntoViewIfNeeded();
  const point=await group.locator('.take-pitch-trace-hit').evaluate(path=>{
    const length=path.getTotalLength();
    for(let i=1;i<40;i++) {
      const p=path.getPointAtLength(length*i/40),at=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());
      if(document.elementFromPoint(at.x,at.y)?.closest('.take-pitch-trace-group')===path.parentElement) return {x:at.x,y:at.y};
    }
    return null;
  });
  if(!point) {
    await page.screenshot({path:path.join(output,`${label}-contour-hit-failure.png`)});
    const details=await group.locator('.take-pitch-trace-hit').evaluate(path=>{
      const p=path.getPointAtLength(path.getTotalLength()/2),at=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());
      return {point:{x:at.x,y:at.y},target:document.elementFromPoint(at.x,at.y)?.outerHTML.slice(0,500),
        box:path.getBoundingClientRect().toJSON(),header:document.getElementById('transport').getBoundingClientRect().toJSON()};
    });
    assert.fail('Contour hit target unavailable: '+JSON.stringify(details));
  }
  const offset=frame===page?{x:0,y:0}:await (await frame.frameElement()).boundingBox();
  if (label.includes('mobile')) {
    await page.touchscreen.tap(point.x+offset.x,point.y+offset.y);
    assert.equal(await frame.locator('#toastMessage').textContent(),title);
  } else await page.mouse.move(point.x+offset.x,point.y+offset.y);
  assert.equal(await frame.locator('[data-visible-index][aria-pressed="true"]').count(),count);
  await page.screenshot({path:path.join(output,`${label}-ensemble-contours.png`)});
  // Remembered Sing must not block listening or record an ambiguous target.
  await frame.evaluate(start=>{const q=window.__qa||window.__probe;q.engine.seek(q.engine.secondsAtTick(start));},tracks[0].start);
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  const practice=frame.locator('[data-settings-section="practice"] .settings-section-toggle');
  if(await practice.getAttribute('aria-expanded')==='false') await practice.click();
  const before = await frame.evaluate(()=>(window.__qa||window.__probe).recording.takes.length);
  await frame.locator('#pitchCapture').click();
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.playing);
  await frame.waitForFunction(() => [...(window.__qa||window.__probe).engine.takeLayers.values()].some(r=>r.source));
  await page.waitForTimeout(250);
  const state = await frame.evaluate(()=>{const q=window.__qa||window.__probe;return {state:q.recording.state,takes:q.recording.takes.length,part:q.savedPractice.practicePart};});
  assert.deepEqual(state,{state:'off',takes:before,part:null});
  await stopRecording(frame);
  // Ordinary isolation enables capture. Expanding See ends capture safely.
  await choosePart(frame,0);
  await frame.waitForFunction(()=>new Set([...document.querySelectorAll('#barScore .take-pitch-trace-edge')].map(p=>p.dataset.takeId)).size===1);
  if(await frame.locator('#pitchCapture').getAttribute('aria-pressed')!=='true')await frame.locator('#pitchCapture').click();
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.state==='recording');
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.takes.some(t=>t.active&&t.seconds>.6));
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  await frame.locator('[data-visible-index="1"]').press('Enter');
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.state==='off');
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).savedPractice.practicePart),null);
  await stopRecording(frame);
  const rawLengths=await frame.evaluate(async tracks=>{
    const q=window.__qa||window.__probe;
    const result=[];for(const t of tracks) result.push((await q.takeStore.wav(t.source)).size);
    return result;
  },tracks);
  assert.deepEqual(rawLengths,tracks.map(t=>44+2*t.frames),'source recordings are not rewritten for ensemble display');
  return {parts:count,grades,hearAndSeeIndependent:true,ensemblePlaybackWithSing:true,singlePartRecording:true,
    stopOnAmbiguousPart:true,label,sourceAudioUnchanged:true};
}
module.exports = {checkEnsembleContours};
