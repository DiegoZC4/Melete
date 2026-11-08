const {test}=require('node:test'),assert=require('node:assert/strict');
const mixer=require('../template/divisi_mixer.js');
test('divisions create independently named channels without changing source identities',()=>{
  const parts=['S','A','T','B'].map((short,index)=>({short,name:short,index}));
  const channels=mixer.channels(parts,[{maxLines:2},{maxLines:2},{maxLines:1},{maxLines:2}]);
  assert.deepEqual(channels.map(p=>p.short),['S1','S2','A1','A2','T','B1','B2']);
  assert.deepEqual(channels.map(p=>p.source),[0,0,1,1,2,3,3]);
  const old={audible:[true,false,true,true],volumes:[80,70,60,50],pans:[-30,-10,10,30],practicePart:3};
  const next=mixer.preferences(old,channels,4);
  assert.deepEqual(next.volumes,[80,80,70,70,60,50,50]);
  assert.equal(next.practicePart,3);
  assert.equal(mixer.preferences(next,channels,4),next);
  assert.equal(old.volumes.length,4);
});
test('shared unisons use one oscillator routed to both channels; divided notes stay independent',()=>{
  const channels=mixer.channels([{short:'S',name:'S'}],[{maxLines:2}]);
  const notes=[{track:0,start:0,end:1,key:60},{track:0,start:1,end:2,key:64},{track:0,start:1,end:2,key:60}];
  const routed=mixer.route(notes,channels,(notes,part,line)=>notes.filter(n=>n.start===0||n.key===(line?60:64)));
  assert.deepEqual(routed.map(n=>n.mixChannels),[[0,1],[0],[1]]);
  assert.ok(notes.every(n=>!n.mixChannels));
});
