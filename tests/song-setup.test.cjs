const test=require('node:test'),assert=require('node:assert/strict');
const {songSetup,projectSong}=require('../template/practice_mix.js');
const channels=(...names)=>names.map(short=>({short}));
const settings=(c,overrides={})=>({audible:c.map(()=>true),visibleChannels:c.map(()=>true),volumes:c.map(()=>100),
  pans:c.map(()=>0),tempo:80,metronome:0,takeVolume:70,takeReverb:10,scoreView:'bars',flow:'continuous',help:false,...overrides});
test('mixes travel by named part, not order; scales, passage and performance data are local',()=>{
  const a=channels('B2','S1','A1'),b=channels('A1','S1','B2','Viola');
  const original=settings(a,{audible:[false,false,false],volumes:[80,200,0],pans:[0,100,-80],
    visibleChannels:[false,true,false],horizontal:200,vertical:75,loopStart:8,takeId:'private'});
  const {settings:s}=projectSong(b,settings(b),songSetup(a,original));
  assert.deepEqual(s.audible,[false,false,false,false]);assert.deepEqual(s.volumes,[0,200,80,100]);
  assert.deepEqual(s.pans,[-80,100,0,0]);assert.deepEqual(s.visibleChannels,[false,true,false,false]);
  assert.equal(s.metronome,0);assert.equal(s.takeReverb,10);assert.equal(s.scoreView,'bars');
  for(const key of ['horizontal','vertical','loopStart','takeId'])assert.equal(key in s,false);
});
test('a combined soprano knob retains the distinct splits until explicitly adjusted',()=>{
  const a=channels('S1','S2','S2 Solo','A1'),b=channels('Alto','Soprano');
  const orig=settings(a,{volumes:[40,150,70,95],pans:[-60,80,20,0],visibleChannels:[false,true,false,false]});
  const travel=(dest,from,state,last)=>projectSong(dest,settings(dest),songSetup(from,state,last));
  const reduced=travel(b,a,orig);
  assert.deepEqual(reduced.settings.volumes,[95,150]);
  let back=travel(a,b,reduced.settings,reduced.memory);
  for(const key of ['volumes','pans','visibleChannels'])assert.deepEqual(back.settings[key],orig[key]);
  reduced.settings.volumes[1]=120;
  back=travel(a,b,reduced.settings,reduced.memory);
  assert.deepEqual(back.settings.volumes,[120,120,120,95]);assert.deepEqual(back.settings.pans,orig.pans);
});
test('a soloist follows their division, and an absent voice never silently retargets an armed singer',()=>{
  const a=channels('S1','S2','S2 solo'),b=channels('S1','S2'),c=channels('Bass');
  const setup=songSetup(a,settings(a,{visibleChannels:[false,false,true]}));
  assert.deepEqual(projectSong(b,settings(b),setup).settings.visibleChannels,[false,true]);
  assert.equal(projectSong(c,settings(c),setup).missingGuide,true);
});
