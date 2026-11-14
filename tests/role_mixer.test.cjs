const {test}=require('node:test');
const assert=require('node:assert/strict');
const {follow,project,reviewProfile}=require('../template/practice_mix.js');
const channels=['S1','T2','B1','B2'].map((short,source)=>({short,source}));
test('guide follows recording focus; hidden backing exceptions come back on their own part',()=>{
  const start={volumes:[40,60,180,40],pans:[-70,0,95,-70],audible:[true,false,true,true]};
  const first=follow(channels,start,2,1);
  assert.deepEqual(first.settings,{volumes:[40,180,40,40],pans:[-70,95,-70,-70],audible:[true,true,true,true]});
  first.settings.volumes[1]=165;
  const back=follow(channels,first.settings,1,2,first);
  assert.deepEqual(back.settings,{...start,volumes:[40,60,165,40]});
});
test('all MIDI off in review remains all off when the human part changes',()=>{
  const state=reviewProfile(channels,1);
  const initial=follow(channels,state,1,1);
  state.audible.fill(false);
  assert.deepEqual(follow(channels,state,1,3,initial).settings.audible,[false,false,false,false]);
});
test('choir seating recenters but keeps manual deviations',()=>{
  const layout={layout:'choir',width:60};
  const state={...project(channels,2,layout),audible:channels.map(()=>true)};
  state.pans[3]+=5;
  const next=follow(channels,state,2,1,null,layout);
  const expected=project(channels,1,layout).pans;expected[3]+=5;
  assert.deepEqual(next.settings.pans,expected);
});
test('choir seat changes remember pan beyond either rail, including after reload',()=>{
  const layout={layout:'choir',width:90};
  for(const [guide,next,backing,pan] of [[2,0,3,-95],[1,3,0,95]]){
    const state={...project(channels,guide,layout),audible:channels.map(()=>true)};
    state.pans[backing]=pan;
    const first=follow(channels,state,guide,next,null,layout);
    assert.equal(first.settings.pans[backing],Math.sign(pan)*100);
    const saved=JSON.parse(JSON.stringify(follow(channels,first.settings,next,next,first,layout)));
    assert.deepEqual(follow(channels,saved.settings,next,guide,saved,layout).settings.pans,state.pans);
    saved.settings.pans[backing]=Math.sign(pan)*80;
    const withoutMemory=follow(channels,saved.settings,next,guide,null,layout).settings.pans[backing];
    assert.equal(follow(channels,saved.settings,next,guide,saved,layout).settings.pans[backing],withoutMemory);
  }
});
