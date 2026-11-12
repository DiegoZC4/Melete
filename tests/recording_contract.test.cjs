const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../template/app.js'),'utf8');
const mic=require('../template/microphone_check.js');
function fn(name){const start=app.indexOf('  function '+name+'(');assert.ok(start>=0);return app.slice(start,app.indexOf('\n  }',start)+4);}
test('rapid Play after Stop resumes once after the save; a second press or hidden tab cancels',async()=>{
  for(const mode of ['resume','cancel','hide','fault']){
    let finish,runs=0;const c=vm.createContext({preparingCapture:null,queuedTakeReplay:null,takeState:'stopping',takeNotice:'',
      pitchCapturePageActive:true,document:{hidden:false},takeStopPromise:new Promise(r=>finish=r),
      engine:{playing:false,startTransport(){runs++;}}});
    vm.runInContext(fn('togglePracticePlayback'),c);c.togglePracticePlayback();assert.equal(runs,0);
    if(mode==='cancel')c.togglePracticePlayback();
    if(mode==='hide')c.document.hidden=true;
    if(mode==='fault')c.takeNotice='Storage full.';
    c.takeState='off';finish();await new Promise(setImmediate);assert.equal(runs,mode==='resume'?1:0);
  }
});
test('audio diagnostics are bounded, local, and optional when storage is blocked',()=>{
  let value;const store={getItem:()=>value,setItem:(_k,v)=>{value=v;}};
  for(let i=0;i<50;i++)mic.deviceEvent(store,'test',{sequence:i});
  const result=mic.deviceEvents(store);assert.equal(result.length,40);assert.equal(result[0].sequence,10);
  assert.equal(result.at(-1).sequence,49);assert.ok(Date.parse(result[0].at));
  assert.doesNotThrow(()=>mic.deviceEvent(null,'event',{}));
});
test('a station visit neither grants audio permission to ordinary practice nor clears a previous explicit choice',()=>{
  for(const saved of [null,{sing:true},{sing:true,singRecordsAudio:true},{sing:false,singRecordsAudio:true}]){
    let value=JSON.stringify(saved);
    const c=vm.createContext({parts:[{}],rehearsalReview:null,compPanel:null,linkedPracticeState:null,preferenceKey:'song',rememberReviewMix(){},
      window:{MeleteStation:{requested:()=>true}},currentPreferenceState:()=>({sing:true,singRecordsAudio:true}),
      localStorage:{getItem:()=>value,setItem:(_k,v)=>{value=v;}}});
    vm.runInContext(fn('savePreferences'),c);c.savePreferences();
    assert.equal(JSON.parse(value).sing,Boolean(saved?.sing && saved?.singRecordsAudio));
  }
});
