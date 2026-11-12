const test=require('node:test'),assert=require('node:assert/strict');
const {lanes,mean,labelPaint}=require('../template/voice_palette.js');
test('unloaded recording labels reuse the mixer palette, not selection or row order',()=>{
  const names=['S1','S2','A1','A2','T1','T2','B1','B2'];
  const parts=names.map((short,i)=>({short,name:`${{S:'Soprano',A:'Alto',T:'Tenor',B:'Bass'}[short[0]]} ${short[1]}`,color:`var(--part-${i+1})`}));
  for(const part of parts) {
    assert.equal(labelPaint(part.short,[...parts].reverse()),part.color);
    assert.equal(labelPaint(` ${part.name.toLowerCase()} `,parts),part.color);
    assert.equal(labelPaint(`${part.short} \u00b7 80%`,parts),part.color);
  }
  assert.equal(labelPaint('S1',[...parts,parts[0]]),parts[0].color);
  assert.equal(labelPaint('S',parts),'','do not guess which division');
  assert.equal(labelPaint('Guest',parts),'');
  assert.equal(labelPaint(null,parts),'');
  assert.equal(labelPaint('S1',[...parts,{short:'S1',color:'red'}]),'','ambiguous labels remain neutral');
});
test('reattacks keep separate hit areas in a single-pitch divisi span',()=>{
  const {barNotes}=require('../template/voice_palette.js'), raw=[[0,0,2,60],[0,2,4,60],[0,0,4,67]];
  assert.deepEqual(barNotes({line:1},{notes:[[0,4,60]]},raw),[[0,2,60],[2,4,60]]);
});
test('sung duration, not attack count, sets the red-to-violet scale',()=>{
  assert.equal(mean([[0,1,84],[1,10,64],[15,15,35]]),66);
  const labels=['B2','S2 solo','S2','S1','A1','T1','Drums'];
  const pitches=[48,70,70,72,66,60,35];
  const channels=labels.map((short,source)=>({short,name:short,source,line:null}));
  const result=lanes(channels,pitches.map(p=>({maxLines:1,spans:[{start:1,end:8,pitches:[p]}]})),[{soloist:1}]);
  assert.deepEqual([result[3].hue,result[0].hue],[25,310]);
  assert.equal(result[1].hue,result[2].hue);
  assert.notEqual(result[1].paint,result[2].paint);
  assert.equal(result[4].hue,25+285*.25);
  assert.equal(result[5].hue,25+285*.5);
  assert.equal(result[6].paint,undefined);
});
test('divisi means follow the actual sung lane and count shared unisons in both',()=>{
  const channels=[0,1].map(line=>({source:0,line,short:'A'+(line+1)}));
  const analysis=[{maxLines:2,spans:[{start:0,end:4,pitches:[60]},{start:8,end:10,pitches:[67,61]}]}];
  const p=lanes(channels,analysis);
  assert.equal(p[0].mean,(60*4+67*2)/6);
  assert.equal(p[1].mean,(60*4+61*2)/6);
  assert.deepEqual(p[1].notes,[[0,4,60],[8,10,61]]);
});
