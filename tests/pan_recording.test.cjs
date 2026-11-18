const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../template/app.js'),'utf8');
const start=app.indexOf('    setLoop(startTick, endTick) {');
const method=app.slice(start,app.indexOf('\n    }',start)+6);
function fixture(native,loopStartSeconds=2,loopEndSeconds=10){
 const c=vm.createContext({});vm.runInContext(`this.Engine=class {${method}}`,c);
 const events=[],commands=[],seeks=[];
 const engine=Object.assign(new c.Engine(),{playing:true,loopStartSeconds,loopEndSeconds,duration:30,
  currentSeconds:()=>-2,secondsAtTick:t=>t/100,withinLoop:()=>false,
  onTransportChange:kind=>events.push(kind),stopTakeReviewAudio:()=>events.push('stop-review'),
  seek:seconds=>seeks.push(seconds),native:native?{state:{},control:(...args)=>commands.push(args)}:null});
 return {engine,events,commands,seeks};
}
for(const native of [false,true]){
 test(`pan reset reapplying a loop preserves its recording lead-in (${native?'native':'browser'} audio)`,()=>{
  const {engine,events,commands,seeks}=fixture(native);
  engine.setLoop(200,1000);
  assert.deepEqual(events,[]);assert.deepEqual(commands,[]);assert.deepEqual(seeks,[]);
  assert.equal(engine.playing,true);
 });
 test(`reapplying no loop is inert; a real range change still notifies recording (${native?'native':'browser'} audio)`,()=>{
  const {engine,events,commands,seeks}=fixture(native,null,null);
  engine.setLoop(null,null);assert.deepEqual(events,[]);assert.deepEqual(commands,[]);
  engine.setLoop(200,1000);
  assert.deepEqual(events,['range','stop-review']);assert.deepEqual(seeks,[2]);
  assert.equal(commands.length,native?1:0);
 });
}
