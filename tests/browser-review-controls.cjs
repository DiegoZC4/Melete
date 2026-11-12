const assert=require('node:assert/strict');

async function checkReviewControls(context,url,options={}) {
  const {checkSingerReview}=require('./browser-singer-review.cjs');
  return checkSingerReview(context,url,{...options,inspect:async({page,frame,delayNext,isDelayed,release})=>{
    const row=name=>frame.locator('[data-cloud-id]').filter({has:frame.locator('.take-singer',{hasText:name})});
    const kathleen=row('Kathleen Fixture'),other=row('Other Fixture'),rapid=row('Rapid Fixture'),only=row('Only Here');
    assert.equal(parseFloat(await kathleen.locator('.comp-within').textContent()),100,'loaded contours supply the missing metric');
    assert.equal(parseFloat(await kathleen.locator('.comp-mean').textContent()),0,'loaded values use current shared scoring');
    const selected=await frame.evaluate(()=>reviewQA.selected());
    const waitDelayed=async()=>{
      for(let i=0;!isDelayed()&&i<100;i++)await page.waitForTimeout(20);
      assert.ok(isDelayed(),'fixture delays one download');
    };
    delayNext(await frame.evaluate(()=>reviewQA.song()));await other.locator('.take-hear').click();await waitDelayed();
    await rapid.locator('.take-hear').click();
    await frame.waitForFunction(()=>[...document.querySelectorAll('[data-cloud-id]')].some(r=>
      r.querySelector('.take-singer').textContent==='Rapid Fixture'&&r.querySelector('.take-hear').getAttribute('aria-pressed')==='true'));
    release();
    await frame.waitForFunction(()=>[...document.querySelectorAll('[data-cloud-id]')].filter(r=>
      ['Other Fixture','Rapid Fixture'].includes(r.querySelector('.take-singer').textContent))
      .every(r=>r.querySelector('.take-hear').getAttribute('aria-pressed')==='true'));
    assert.equal(await frame.evaluate(()=>reviewQA.selected()),selected,'Hear does not replace the inspected contour');
    delayNext(await frame.evaluate(()=>reviewQA.song()));await only.locator('.take-hear').click();await waitDelayed();
    await only.locator('.take-hear').click();release();await page.waitForTimeout(250);
    assert.equal(await only.locator('.take-hear').getAttribute('aria-pressed'),'false','clicking again cancels this track only');
    assert.equal(await other.locator('.take-hear').getAttribute('aria-pressed'),'true');

    await kathleen.locator('.take-octave').click();
    assert.equal(await kathleen.locator('.take-octave').getAttribute('data-value'),'1');
    const downloading=page.waitForEvent('download');await kathleen.locator('.take-download').click();
    const download=await downloading,stream=await download.createReadStream(),chunks=[];
    for await(const chunk of stream)chunks.push(chunk);
    const bytes=Buffer.concat(chunks);
    await download.delete();
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    const rate=bytes.readUInt32LE(24),pcm=bytes.subarray(44),periods=[];let previous=null;
    for(let i=1;i<pcm.length/2;i++)if(pcm.readInt16LE((i-1)*2)<=0&&pcm.readInt16LE(i*2)>0){
      if(previous!==null&&i-previous<rate/100)periods.push(i-previous);previous=i;
    }
    periods.sort((a,b)=>a-b);const hz=rate/periods[Math.floor(periods.length/2)];
    assert.ok(Math.abs(hz-220)<3,`row WAV stays at original pitch, not 440 Hz: ${hz}`);
    assert.equal(parseFloat(await kathleen.locator('.comp-within').textContent()),100,'octave playback never changes grading');

    await frame.locator('#openCloudLibrary').click();
    const checkbox=frame.locator('#compCloudAuto');await checkbox.waitFor({state:'visible'});
    const before=await checkbox.isChecked();await checkbox.press('Space');
    assert.equal(await checkbox.isChecked(),!before,'Space activates the focused native control');
    assert.equal(await frame.locator('#playPause').getAttribute('aria-label'),'Play score','modal Space does not start transport');
    await checkbox.press('Space');assert.equal(await checkbox.isChecked(),before);
    await frame.evaluate(()=>document.getElementById('compCloudDialog').close());
    await frame.locator('#playPause').press('Space');
    assert.equal(await frame.locator('#playPause').getAttribute('aria-label'),'Pause score','Space still works outside dialogs');
    await frame.locator('#playPause').press('Space');
    return {label:options.label,independentHear:true,cancelPendingHear:true,cloudMetrics:true,
      nativeModalSpace:true,originalPitchDownloadHz:hz,octaveDoesNotAlterGrading:true};
  }});
}
module.exports={checkReviewControls};
