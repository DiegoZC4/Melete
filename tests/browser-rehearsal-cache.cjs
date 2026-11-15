const assert=require('node:assert/strict');
const {wavBytes}=require('../template/loop_recorder.js');

async function checkRehearsalCache(context,html,song,ref) {
  const date='2020-01-02',base='http://127.0.0.1:8809/melete/rehearsal.php';
  const stats={coverage:1,mean:6,median:4};
  const items=['One','Two','Three','Unopened'].map((singer,i)=>({
    song,id:String(i+1),singer,part:'Choir',number:1,kind:'source',origin:0,end:1,
    segments:[[0,1,1]],raw:stats,fitted:stats,alignment:{changed:true,shifts:[]},revision:1
  }));
  const media=[];
  let online=true;
  await context.addInitScript(()=>Object.defineProperty(window,'MeleteRehearsalReview',{configurable:true,set(review){
    const mount=review.mount;
    review.mount=adapter=>mount({...adapter,show(data,fitted,...args){
      const result=adapter.show(data,fitted,...args);
      window.archiveShown={id:data.row.id,fitted,cents:data.frames[0].cents,sample:data.buffer.getChannelData(0)[8]};
      return result;
    }});
    Object.defineProperty(window,'MeleteRehearsalReview',{value:review,configurable:true});
  }}));
  await context.route('**/melete/rehearsal.php*',async route=>{
    const q=new URL(route.request().url()).searchParams,action=q.get('action'),id=q.get('id');
    if (!action) return route.fulfill({body:html,contentType:'text/html'});
    if (action!=='catalog') media.push([action,id,q.get('timing')]);
    if (!online) return route.fulfill({status:403,json:{error:'Sign in'}});
    if (action==='catalog') return route.fulfill({json:{items}});
    const aligned=q.get('timing')==='aligned',cents=6000+Number(id)*10+Number(aligned);
    if(action==='pitch')return route.fulfill({json:{ref,frames:[[0,.1,cents]]}});
    assert.equal(action,'audio');
    const pcm=Int16Array.from({length:8000},(_,i)=>Math.round((aligned?1100:3800)*Math.sin(i*.08)));
    return route.fulfill({body:Buffer.from(wavBytes(pcm,8000)),contentType:'audio/wav'});
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const singer=page.getByRole('combobox',{name:'Singer',exact:true});
  const timing=page.getByRole('checkbox',{name:'Score-fit timing'});
  const chosen=async(id,aligned)=>{
    await page.waitForFunction(([id,aligned])=>window.archiveShown?.id===id&&archiveShown.fitted===aligned,[id,aligned]);
    const result=await page.evaluate(()=>archiveShown);
    assert.equal(result.cents,6000+Number(id)*10+Number(aligned));
    assert.ok(Math.abs(result.sample)>.0001);return result;
  };
  try {
    await page.goto(base+'?date='+date+'&timing=recorded');
    await singer.selectOption('One'); const recorded=await chosen('1',false);
    await timing.check();const aligned=await chosen('1',true);
    assert.notEqual(recorded.sample,aligned.sample);
    await singer.selectOption('Two');await chosen('2',true);
    await singer.selectOption('Three');await chosen('3',true);
    const firstRequests=media.length;assert.equal(firstRequests,8);
    await singer.selectOption('One');await chosen('1',true);
    assert.equal(media.length,firstRequests,'a singer switch beyond the decoded-buffer limit reads local media');
    await page.reload();await singer.selectOption('One');await chosen('1',false);
    await timing.check();await chosen('1',true);
    assert.equal(media.length,firstRequests,'both timing variants survive reload independently');
    online=false;await page.reload();await singer.selectOption('Two');await chosen('2',true);
    assert.equal(await timing.isDisabled(),true,'only the previously heard timing variant is available offline');
    assert.deepEqual(await singer.locator('option').allTextContents(),['Choose singer','One','Three','Two']);
    assert.equal(media.length,firstRequests);
    assert.deepEqual(errors,[]);
    return {firstRequests,repeatRequests:media.length-firstRequests,variants:2,offlineSingers:3};
  } finally {await page.close();}
}
module.exports={checkRehearsalCache};
