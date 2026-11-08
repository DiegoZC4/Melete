const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../template/app.js'),'utf8');
const source=name=>{const start=app.indexOf(`  function ${name}(`);return app.slice(start,app.indexOf('\n  }',start)+4);};
test('A2 live feedback never switches target to a nearby A1 pitch, including rests and octave singing',()=>{
  const spans=[{start:0,end:100,pitches:[69,65]}];
  const c=vm.createContext({practicePartIndex:0,practiceDivisi:[1],partDivisi:[{maxLines:2,spans}],
    divisiSpanAt:()=>spans[0],divisiLineFor:line=>line,window:{MeleteTakePitch:require('../template/take_pitch.js')},
    pitchRestState:()=> 'sing',clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    sequence:{notes:[[0,0,100,69],[0,0,100,65]]},pitchNoteSource:null,pitchNoteCount:0,pitchNotesByPart:new Map()});
  for(const f of ['expectedPitchAt','expectedPitchErrorCents','pitchTraceLaneAt'])vm.runInContext(source(f),c);
  assert.equal(c.pitchTraceLaneAt(50,6900),1);
  assert.equal(c.expectedPitchErrorCents(50,6900),400);
  assert.equal(c.expectedPitchErrorCents(50,6500),0);
  assert.equal(c.expectedPitchErrorCents(50,5300),0);
  assert.deepEqual(Array.from(c.expectedPitchAt(105),n=>n[3]),[65]);
  c.practiceDivisi[0]=0;
  assert.equal(c.pitchTraceLaneAt(50,6500),0);
  assert.equal(c.expectedPitchErrorCents(50,6500),-400);
});
