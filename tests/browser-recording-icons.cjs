const assert=require('node:assert/strict');
const path=require('node:path');

async function checkRecordingIcons(page,output) {
  const result=[];
  for(const theme of ['light','dark'])for(const recording of [false,true]) {
    const row=await page.evaluate(({theme,recording})=>{
      document.documentElement.dataset.theme=theme;
      const mic=document.getElementById('pitchCapture'),youtube=document.getElementById('demoVideo');
      mic.setAttribute('aria-pressed',String(recording));mic.classList.toggle('is-recording',recording);
      const stroke=getComputedStyle(mic.querySelector('svg')).stroke;
      const channels=stroke.match(/[\d.]+/g).map(Number);
      return {theme,recording,stroke,red:channels[0]>channels[1]*1.5&&channels[0]>channels[2]*1.5,
        youtubeFill:getComputedStyle(youtube.querySelector('svg')).fill,
        youtubeStroke:getComputedStyle(youtube.querySelector('svg')).stroke,
        ink:getComputedStyle(youtube).color};
    },{theme,recording});
    assert.ok(row.red,`Sing microphone has a red stroke: ${JSON.stringify(row)}`);
    assert.equal(row.youtubeFill,'none');assert.equal(row.youtubeStroke,row.ink);
    result.push(row);
  }
  if(output){
    await page.evaluate(()=>{
      const settings=document.getElementById('settingsToggle');
      if(settings.getAttribute('aria-expanded')!=='true')settings.click();
      document.getElementById('demoVideo').hidden=false;
    });
    const clip=await page.evaluate(()=>{
      const a=document.querySelector('.practice-group').getBoundingClientRect();
      const b=document.querySelector('.tools-group').getBoundingClientRect();
      return {x:a.x,y:Math.min(a.y,b.y),width:b.right-a.x,height:Math.max(a.bottom,b.bottom)-Math.min(a.y,b.y)};
    });
    await page.screenshot({path:path.join(output,'recording-icons.png'),clip});
  }
  return result;
}
module.exports={checkRecordingIcons};
