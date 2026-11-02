const {test} = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../template/written_accidentals.js');
const alpha = require('../vendor/alphatab/alphaTab.min.js');

const el = (localName, children = [], attrs = {}, text = '') => ({localName, children,
  textContent: text || children.map(node => node.textContent).join(''), getAttribute: name => attrs[name] ?? null});
const value = (name, text) => el(name, [], {}, String(text));
const note = (accidental, attrs = {}, extra = [], noteAttrs = {}) => el('note', [
  el('pitch', [value('step', 'C'), value('octave', 4)]),
  ...(accidental ? [el('accidental', [], attrs, accidental)] : []), ...extra,
], noteAttrs);
const doc = notes => ({documentElement: el('score-partwise', [el('part', [el('measure', notes)])])});

test('written accidental metadata preserves plain, parenthesized and bracketed marks only where specified', () => {
  const groups = tools.fromXml(doc([
    note('natural', {parentheses:'yes'}), note(), note('sharp', {cautionary:'yes'}),
    note('flat', {bracket:'yes'}), note('double-sharp', {editorial:'yes'}), note('flat-flat'),
    note('natural', {}, [], {'print-object':'no'}), note('natural', {'print-object':'no'}),
    note('natural', {}, [el('cue')]), note('natural', {}, [el('grace')]),
  ]));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].notes, [
    {type:'Natural',enclosure:'parentheses'}, null, {type:'Sharp',enclosure:null},
    {type:'Flat',enclosure:'bracket'}, {type:'DoubleSharp',enclosure:null}, {type:'DoubleFlat',enclosure:null},
    null, null, {type:'Natural',enclosure:null},
  ]);
});

test('staff/voice mapping retains chords, rests, grace notes and nonconsecutive voice numbers', () => {
  const groups = tools.fromXml(doc([
    note('natural'), note('flat', {}, [el('chord')]),
    el('note',[el('rest'),value('duration',4)]),
    note('sharp', {}, [value('voice', 2), el('grace')]),
    note('natural', {}, [value('voice', 2)]),
    note('flat-flat', {}, [value('voice', 5),value('staff',2)]),
  ]));
  assert.deepEqual(groups.map(g=>[g.staff,g.voice,g.notes.length]),[[0,0,2],[0,1,2],[1,4,1]]);
  const notes = Array.from({length:5},()=>({}));
  const voice = list => ({beats:list.map(n=>({notes:n?[n]:[]}))});
  const score = {tracks:[{staves:[{bars:[{voices:[{beats:[{notes:notes.slice(0,2)},{notes:[]}]},voice(notes.slice(2,4))]}]},
    {bars:[{voices:[null,null,null,null,voice([notes[4]])]}]}]}]};
  const result = tools.bind(score, groups);
  assert.equal(result.mapped,5); assert.equal(result.unmatched,0);
  assert.deepEqual(notes.map(n=>result.marks.get(n).type),['Natural','Flat','Sharp','Natural','DoubleFlat']);
  score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.pop();
  const rejected = tools.bind(score,groups);
  assert.equal(rejected.unmatched,2); assert.equal(rejected.marks.has(notes[0]),false);
});

test('decorated glyphs reserve full enclosure width before layout and do not accumulate padding', () => {
  const metrics = new alpha.Settings().display.resources.engravingSettings;
  for (const type of ['Natural','Sharp','Flat','DoubleSharp','DoubleFlat']) for (const enclosure of ['parentheses','bracket',null]) {
    const symbol = alpha.model.MusicFontSymbol[`Accidental${type}`], calls=[];
    const glyph = {x:10,y:20,symbol,glyphScale:.75,renderer:{smuflMetrics:metrics},
      doLayout(){this.width=metrics.glyphWidths.get(symbol)*this.glyphScale;this.height=metrics.glyphHeights.get(symbol)*this.glyphScale;},
      getBoundingBoxTop(){return this.y-metrics.glyphTop.get(symbol)*this.glyphScale;},
      getBoundingBoxBottom(){return this.y-metrics.glyphBottom.get(symbol)*this.glyphScale;},
      paint(x,y){calls.push(['accidental',x+this.x,y+this.y]);},
    };
    glyph.doLayout(); const nativeWidth=glyph.width;
    tools.decorate(glyph,{type,enclosure},{id:1}); tools.decorate(glyph,{type,enclosure},{id:1});
    glyph.doLayout(); const dimensions=[glyph.width,glyph.height,glyph.getBoundingBoxTop(),glyph.getBoundingBoxBottom()];
    glyph.doLayout(); assert.deepEqual([glyph.width,glyph.height,glyph.getBoundingBoxTop(),glyph.getBoundingBoxBottom()],dimensions);
    if(enclosure) assert.ok(glyph.width>nativeWidth);
    else assert.equal(glyph.width,nativeWidth);
    const canvas={color:'black',beginGroup:name=>calls.push(['group',name]),endGroup:()=>calls.push(['end']),
      fillMusicFontSymbol:(...args)=>calls.push(['enclosure',...args])};
    glyph.paint(100,200,canvas);
    assert.equal(calls.filter(c=>c[0]==='accidental').length,1);
    assert.equal(calls.filter(c=>c[0]==='enclosure').length,enclosure?2:0);
    assert.equal(canvas.color,'black');
    if(enclosure){const sides=calls.filter(c=>c[0]==='enclosure');assert.equal(sides[0][1],110);assert.ok(sides[1][1]<110+glyph.width);}
  }
});

test('adapter forces explicit symbols while preserving native accidental state and unmarked behavior', () => {
  let calls=0;
  const factory={staffId:'score',create:()=>({accidentalHelper:{applyAccidental(){calls++;return 0;}},addBeatGlyph(){}})};
  const api={...alpha,Environment:{defaultRenderers:[factory]}};
  const prepare=tools.install(api,doc([note('natural',{parentheses:'yes'}),note()]));
  const first={},second={},score={tracks:[{staves:[{bars:[{voices:[{beats:[{notes:[first]},{notes:[second]}]}]}]}]}]};
  assert.deepEqual(prepare(score),{mapped:1,unmatched:0});
  const create=factory.create;
  tools.install(api,doc([])); assert.equal(factory.create,create,'factory is wrapped only once');
  const helper=factory.create().accidentalHelper;
  assert.equal(helper.applyAccidental(first),alpha.model.AccidentalType.Natural);
  assert.equal(helper.applyAccidental(second),alpha.model.AccidentalType.None);
  assert.equal(calls,2,'native helper still updates its note/ledger/accidental state');
  const replacement={tracks:[{staves:[{bars:[{voices:[{beats:[{notes:[{}]},{notes:[{}]}]}]}]}]}]};
  prepare(replacement);
  assert.equal(helper.applyAccidental(first),0,'reload drops stale note ownership');
});

test('actual MusicXML import preserves note order for multi-voice chords and grace accidentals', () => {
  const xml=`<score-partwise><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><grace/><pitch><step>C</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type><accidental parentheses="yes">natural</accidental></note>
    <note><pitch><step>D</step><alter>1</alter><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><accidental>sharp</accidental></note>
    <note><chord/><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><accidental bracket="yes">flat</accidental></note>
    <backup><duration>16</duration></backup>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><accidental>natural</accidental></note>
  </measure></part></score-partwise>`;
  const score=alpha.importer.ScoreLoader.loadScoreFromBytes(Buffer.from(xml),new alpha.Settings());
  const groups=tools.fromXml(doc([note('natural',{parentheses:'yes'},[el('grace')]),note('sharp'),
    note('flat',{bracket:'yes'},[el('chord')]),note('natural',{},[value('voice',2)])]));
  const before=require('node:v8').serialize(score);
  const bound=tools.bind(score,groups);
  const voice=score.tracks[0].staves[0].bars[0].voices[0];
  assert.deepEqual(voice.beats.flatMap(b=>b.notes.map(n=>[n.realValue,bound.marks.get(n)?.type])),[[72,'Natural'],[75,'Sharp'],[70,'Flat']]);
  assert.equal(bound.mapped,4); assert.equal(bound.unmatched,0);
  assert.deepEqual(require('node:v8').serialize(score),before,'notation metadata leaves the score model unchanged');
});
