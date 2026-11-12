const assert = require('node:assert/strict');
const {PNG} = require(require.resolve('playwright-core/lib/utilsBundle',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));

const luminance=(bytes,i)=>[.2126,.7152,.0722].reduce((s,w,j)=>{
  const x=bytes[i+j]/255;return s+w*(x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
},0);
async function checkNotationInk(page,frame,theme){
  const painted=()=>frame.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(()=>ok(true)))));
  await frame.waitForFunction(()=>!document.querySelector('#score.is-rendering-score')&&
    !(window.__qa || window.__probe)?.busy &&
    [...document.querySelectorAll('#score .at-surface-svg g.at text')].some(n=>/[\uE0A0-\uE0AF]/u.test(n.textContent)));
  await frame.evaluate(()=>document.fonts.ready.then(()=>true));await painted();
  // Selecting a part can scroll or resize the header. Pixel contrast must be
  // measured on visible notation, not on whichever scroll position it leaves.
  await frame.evaluate(()=>[...document.querySelectorAll('#score .at-surface-svg g.at text')]
    .find(n=>/[\uE0A0-\uE0AF]/u.test(n.textContent)&&!n.closest('.melete-range-low,.melete-range-high'))
    ?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  await painted();
  const rects=await frame.evaluate(()=>{
    const rects=[];for(const n of document.querySelectorAll('#score .at-surface-svg g.at text')){
      if(!/[\uE0A0-\uE0AF]/u.test(n.textContent)||n.closest('.melete-range-low,.melete-range-high'))continue;
      const b=n.getBoundingClientRect();if(b.width<1||b.height<1||b.bottom<0||b.top>=innerHeight||b.left>=innerWidth||b.right<0)continue;
      rects.push([b.left,b.top,b.right,b.bottom]);n.dataset.qaNoteInk='';
    }return rects;
  });assert.ok(rects.length,'actual engraved noteheads in the viewport');
  const origin=page===frame?{x:0,y:0}:await (await frame.frameElement()).boundingBox();
  const shot=async()=>PNG.sync.read(await page.screenshot({animations:'disabled',scale:'css'}));
  const before=await shot(),style=await frame.addStyleTag({content:'[data-qa-note-ink]{visibility:hidden!important;}'});
  let hidden;
  try{await painted();hidden=await shot();}finally{await style.evaluate(n=>n.remove());await frame.evaluate(()=>document.querySelectorAll('[data-qa-note-ink]').forEach(n=>delete n.dataset.qaNoteInk));}
  let legible=0,maxContrast=1;
  for(const [l,t,r,bottom] of rects)for(let y=Math.max(0,Math.floor(t+origin.y));y<Math.min(before.height,Math.ceil(bottom+origin.y));y++)
  for(let x=Math.max(0,Math.floor(l+origin.x));x<Math.min(before.width,Math.ceil(r+origin.x));x++){
    const i=(y*before.width+x)*4;
    const a=luminance(before.data,i),b=luminance(hidden.data,i);
    if(theme==='dark'?a<=b:a>=b)continue;
    const contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    maxContrast=Math.max(contrast,maxContrast);if(contrast>=4.5)legible++;
  }
  assert.ok(legible>=3,`${theme} actual note ink: only ${legible} high-contrast pixels, peak ${maxContrast.toFixed(2)}:1`);
  return {legible,maxContrast:Number(maxContrast.toFixed(2))};
}
module.exports={checkNotationInk};
