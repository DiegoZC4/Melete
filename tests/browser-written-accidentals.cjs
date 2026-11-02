const assert = require('node:assert/strict');
const path = require('node:path');

async function checkWrittenAccidentals(page, frame, {output, label}) {
  await frame.waitForFunction(() => document.querySelectorAll('#score .written-accidental').length === 4);
  const read = () => frame.evaluate(() => [...document.querySelectorAll('#score .written-accidental')].map(group => {
    const box=group.getBoundingClientRect();
    const id=Number([...group.classList].find(c=>/^n\d+$/.test(c)).slice(1));
    const api=__qa.api, note=api.score.tracks.flatMap(t=>t.staves.flatMap(s=>s.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.flatMap(b=>b.notes))))).find(n=>n.id===id);
    const bounds=api.boundsLookup.findBeat(note.beat).notes.find(n=>n.note===note).noteHeadBounds;
    const score=document.getElementById('score'),origin=score.getBoundingClientRect().left-score.scrollLeft;
    return {classes:group.getAttribute('class'),text:group.textContent,
      width:box.width,height:box.height,
      clearance:bounds.x-(box.right-origin),
      symbols:[...group.querySelectorAll('text')].flatMap(node=>[...node.textContent].map(c=>c.codePointAt(0)))};
  }));
  const marks=await read();
  assert.equal(marks.filter(m=>m.classes.includes('written-parentheses')).length,2);
  assert.equal(marks.filter(m=>m.classes.includes('written-bracket')).length,1);
  assert.equal(marks.filter(m=>m.classes.includes('written-plain')).length,1);
  for(const mark of marks) {
    assert.ok(mark.width>2&&mark.height>5,'explicit accidentals have visible ink');
    assert.equal(mark.symbols.filter(s=>s===0xE261).length,1,'exactly one natural glyph');
    assert.ok(mark.clearance>=.5,`written accidental clears its notehead: ${JSON.stringify(mark)}`);
    if(mark.classes.includes('written-parentheses'))assert.deepEqual(mark.symbols,[0xE26A,0xE261,0xE26B]);
    if(mark.classes.includes('written-bracket'))assert.deepEqual(mark.symbols,[0xE26C,0xE261,0xE26D]);
  }
  await page.screenshot({path:path.join(output,`written-accidentals-${label}.png`)});
  const state=await frame.evaluate(()=>__qa.pitchbar.captureSettingsState());
  let compact;
  try {
    await frame.evaluate(()=>{const s=__qa.pitchbar.captureSettingsState();s.horizontal=5;__qa.pitchbar.applySettingsState(s);});
    await frame.waitForFunction(()=>!__qa.busy&&!document.querySelector('.score-render-snapshot')&&document.querySelectorAll('#score .written-accidental').length===4);
    compact=await read();
    for(const mark of compact)assert.ok(mark.clearance>=.5,`low stretch must retain accidental padding: ${JSON.stringify(mark)}`);
    await page.screenshot({path:path.join(output,`written-accidentals-${label}-compact.png`)});
  } finally {
    await frame.evaluate(state=>__qa.pitchbar.applySettingsState(state),state);
    await frame.waitForFunction(()=>!__qa.busy&&!document.querySelector('.score-render-snapshot')&&document.querySelectorAll('#score .written-accidental').length===4);
  }
  return {count:marks.length,marks,compact};
}

module.exports={checkWrittenAccidentals};
