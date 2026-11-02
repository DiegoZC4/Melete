const assert = require('node:assert/strict');
const path = require('node:path');

const staffFollowProbe = `follow: { bounds: playbackCursorBounds, box: notationFollowBox,
  rawBox: masterBarLayoutBox, next: nextVerticalSystemTransition, direction: playbackDirection,
  scroll: scrollToPlayback, choose: choosePracticePart,
  get detached() { return playbackDetached; }, get animating() { return verticalFollowAnimationFrame; },
  get count() { return parts.length; }, get tick() { return engine.tickAtSeconds(engine.currentSeconds()); } },`;

async function checkStaffFollow(frame, page, {probe='__qa',output,label}) {
  if(await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  const initial=await frame.evaluate(name=>window[name].pitchbar.captureSettingsState(),probe);
  const viewport=page.viewportSize();
  let overlayClosed=false;
  const settled=()=>frame.waitForFunction(name=>window[name]&&!window[name].busy,probe);
  const snapshot=()=>frame.evaluate(name=>{
    const q=window[name],bounds=q.follow.bounds();
    return {bounds,top:document.querySelector('.transport').getBoundingClientRect().height+8,
      bottom:innerHeight-20,scrollY,detached:q.follow.detached,tick:q.follow.tick};
  },probe);
  const visible=()=>frame.waitForFunction(name=>{
    const q=window[name],b=q.follow.bounds(),top=document.querySelector('.transport').getBoundingClientRect().height+8;
    return b&&!q.follow.animating&&b.top>=top-2&&b.bottom<=innerHeight-18;
  },probe,{timeout:10000});
  try {
    await page.setViewportSize({...viewport,height:600});
    await frame.evaluate(name=>{
      const q=window[name],state=q.pitchbar.captureSettingsState();
      q.engine.pauseTransport();
      q.pitchbar.applySettingsState({...state,practicePart:q.follow.count-1,visible:state.visible.map(()=>true),
        scoreView:'standard',flow:'wrap',vertical:q.follow.count>4?100:160,horizontal:400,
        loopStart:null,loopEnd:null,loopStartTick:null,loopEndTick:null});
    },probe);
    await settled();
    // The phone settings drawer overlays notation; review playback with it closed.
    if(await frame.locator('#settingsPanel').evaluate(panel=>getComputedStyle(panel).position==='absolute')) {
      await frame.locator('#settingsToggle').click();
      overlayClosed=true;
    }
    await frame.evaluate(name=>{const q=window[name];q.api.tickPosition=0;window.scrollTo({top:0,behavior:'instant'});},probe);
    await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const before=await snapshot();
    assert.equal(before.bounds.focused,true,JSON.stringify({message:'fixture must exercise an oversized system',before,
      state:await frame.evaluate(name=>window[name].pitchbar.captureSettingsState(),probe),
      geometry:await frame.evaluate(name=>{const q=window[name];return {
        raw:q.follow.rawBox(0),staves:q.api.boundsLookup.findMasterBarByIndex(0).bars.map(b=>({
          track:b.bar.staff.track.index,real:b.realBounds,visual:b.visualBounds}))};},probe)}));
    assert.ok(before.bounds.bottom>before.bottom,'lower staff starts below the visible area');
    await frame.locator('#playPause').click();
    await frame.waitForFunction(name=>window[name].engine.playing,probe);
    await visible();
    const first=await snapshot();
    await page.screenshot({path:path.join(output,`staff-follow-${label}.png`)});

    const transition=await frame.evaluate(name=>{
      const q=window[name],next=q.follow.next(q.follow.bounds());
      if(next) q.engine.seek(Math.max(0,q.engine.secondsAtTick(next.tick)-.7));
      return next;
    },probe);
    assert.ok(transition,'fixture must contain a second system');
    await frame.waitForFunction(({name,tick})=>window[name].follow.tick>=tick,{name:probe,tick:transition.tick});
    await visible();
    const next=await snapshot();
    assert.ok(next.scrollY>first.scrollY,'new system follows the same lower staff');
    await page.screenshot({path:path.join(output,`staff-follow-${label}-next.png`)});

    const loop=await frame.evaluate(({name,tick})=>{
      const q=window[name],measures=q.pitchbar.sequence.measures;
      const start=measures.findIndex(m=>m[0]===tick),end=start;
      const state=q.pitchbar.captureSettingsState();
      q.pitchbar.applySettingsState({...state,loopEnabled:true,loopStart:start,loopEnd:end,loopStartTick:null,loopEndTick:null});
      const endTick=measures[start][0]+measures[start][1];
      q.engine.seek(q.engine.secondsAtTick(endTick)-.2);
      return {startTick:tick,endTick};
    },{name:probe,tick:transition.tick});
    assert.equal(await frame.evaluate(name=>window[name].engine.hasLoop(),probe),true);
    // Capture visible geometry and loop position together; separate protocol
    // round trips can land on the next loop boundary while audio keeps running.
    const wrappedHandle=await frame.waitForFunction(({name,start,end})=>{
      const q=window[name],tick=q.follow.tick,bounds=q.follow.bounds();
      const top=document.querySelector('.transport').getBoundingClientRect().height+8,bottom=innerHeight-20;
      if(tick>=start&&tick<start+(end-start)/2&&bounds&&!q.follow.animating&&bounds.top>=top-2&&bounds.bottom<=bottom+2)
        return {bounds,top,bottom,scrollY,detached:q.follow.detached,tick};
      return false;
    },{name:probe,start:loop.startTick,end:loop.endTick},{timeout:10000}).catch(async error=>{
      const state=await frame.evaluate(name=>{const q=window[name];return {settings:q.pitchbar.captureSettingsState(),
        looping:q.engine.hasLoop(),playing:q.engine.playing,animation:q.follow.animating};},probe);
      throw new Error(JSON.stringify({label,loop,state,snapshot:await snapshot()}),{cause:error});
    });
    const wrapped=await wrappedHandle.jsonValue();await wrappedHandle.dispose();
    assert.ok(wrapped.tick>=loop.startTick&&wrapped.tick<loop.endTick,JSON.stringify({label,loop,wrapped}));

    await frame.evaluate(()=>{
      window.dispatchEvent(new WheelEvent('wheel',{deltaY:-500}));
      window.scrollTo({top:0,behavior:'instant'});
    });
    try {await frame.waitForFunction(name=>window[name].follow.detached,probe,{timeout:5000});}
    catch(error) {throw new Error(JSON.stringify({label,loop,wrapped,afterScroll:await snapshot()}),{cause:error});}
    await frame.waitForTimeout(250);
    assert.equal((await snapshot()).scrollY,0,'deliberate detachment is not reclaimed');
    await frame.locator('#playbackReturn').click();
    await visible();
    assert.equal((await snapshot()).detached,false);
    await frame.evaluate(name=>window[name].follow.choose(0),probe);
    await visible();
    const upper=await snapshot();

    await frame.evaluate(name=>{
      const q=window[name],state=q.pitchbar.captureSettingsState();q.engine.pauseTransport();
      q.pitchbar.applySettingsState({...state,practicePart:q.follow.count-1,
        visible:state.visible.map((_,i)=>i!==q.follow.count-1)});
    },probe);
    await settled();
    assert.equal((await snapshot()).bounds.focused,undefined,'hidden practice part is not revealed or followed');
    await frame.evaluate(name=>{
      const q=window[name],state=q.pitchbar.captureSettingsState();
      q.pitchbar.applySettingsState({...state,vertical:70,visible:state.visible.map((_,i)=>i===q.follow.count-1)});
    },probe);
    await settled();
    assert.equal((await snapshot()).bounds.focused,undefined,'a fitting one-staff system remains the target');
    return {first,next,wrapped,upper,manualDetachment:true,returnToPlayback:true,hiddenPartPreserved:true,smallSystemUnchanged:true};
  } finally {
    await frame.evaluate(({name,state})=>{
      const q=window[name];q.engine.pauseTransport();q.pitchbar.applySettingsState(state);
    },{name:probe,state:initial});
    await page.setViewportSize(viewport);
    await settled();
    if(overlayClosed&&await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') {
      await frame.locator('#settingsToggle').click();
    }
  }
}

module.exports={staffFollowProbe,checkStaffFollow};
