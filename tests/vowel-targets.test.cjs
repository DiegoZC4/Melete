const test = require("node:test");
const assert = require("node:assert/strict");
const {syllableAt, pronunciations, landmarks, notation} = require("../template/vowel_targets.js");

const beat = (start, text, pitch=60) => ({absolutePlaybackStart:start, playbackDuration:10,
  lyrics:text?[text]:[], notes:pitch===null?[]:[{realValue:pitch}], isRest:pitch===null});
const bar = (...voices) => ({voices:voices.map((beats,index)=>({index,beats}))});
async function tracks(...parts) {
  const {syllableTracks} = await import("../vowel_syllables.mjs");
  return syllableTracks({tracks:parts.map(bars=>({staves:[{bars}]}))});
}

test("timed syllables span sounding continuations and stop at rests, gaps and new lyrics", async () => {
  const data=await tracks([bar([beat(0,"Win-"),beat(10,null,63)]),
    bar([beat(20,null,63),beat(30,"ter."),beat(40,null,null),beat(50,null),
      beat(60,"oo"),beat(80,null)])], [bar([beat(0,"mm")])]);
  const at=tick=>syllableAt(data,0,tick);
  for (const tick of [0,9,10,20,29.99]) {
    assert.equal(at(tick).word,"Winter."); assert.equal(at(tick).index,0);
    assert.deepEqual(pronunciations({winter:["i","e"]},at(tick)),["i"]);
  }
  assert.equal(at(30).index,1);
  assert.deepEqual([40,50,70,80,-1].map(at),Array(5).fill(null));
  assert.equal(at(69).word,"oo"); assert.equal(syllableAt(data,1,0).word,"mm");
  assert.equal(syllableAt(data,null,0),null);
});

test("separate simultaneous lyric voices use the written divisi pitch", async () => {
  const data=await tracks([bar([beat(0,"moon",68)],[beat(0,"night",54)])]);
  assert.equal(syllableAt(data,0,4,54).word,"night");
  assert.equal(syllableAt(data,0,4,68).word,"moon");
  assert.equal(syllableAt(data,0,4,null),null);
  assert.equal(syllableAt(data,0,4,60),null);
});

test("consonant cues are silent and pronunciation counts must agree", () => {
  for (const word of ["mm","N","nn","(nn)","dm."])
    assert.deepEqual(pronunciations({[word]:["u"]},{word,index:0,count:1}),[]);
  const lexicon={"we're":["e/i","o"]};
  const hit={word:"We’re!",index:0,count:2};
  assert.deepEqual(pronunciations(lexicon,hit),["e","i"]);
  assert.equal(pronunciations(lexicon,{...hit,count:1}),null);
  assert.equal(pronunciations(lexicon,{...hit,word:"unlisted"}),null);
});

test("landmarks keep the ordered, absolute-Hz endpoints and missing/optional releases", () => {
  const data={anchors:{e:{men:[460,2000]},u:{men:[380,1000]},i:{women:[400,2300]}},
    trajectoryAnchors:{"e>u":{e:{men:[370,1890]}}}};
  const path=landmarks(data,"e>u","men");
  assert.deepEqual(path.map(p=>p.hz),[{f1:370,f2:1890},{f1:380,f2:1000}]);
  assert.deepEqual(landmarks(data,"e","men")[0].hz,{f1:460,f2:2000});
  assert.deepEqual(landmarks(data,"a>u","men").map(p=>p.hz),[null,{f1:380,f2:1000}]);
  assert.deepEqual(landmarks(data,"a>i(>ɹ)","women").map(p=>[p.hz,p.optional]),
    [[null,false],[{f1:400,f2:2300},false],[null,true]]);
  assert.equal(notation("a>i(>ɹ)"),"a → i (→ ɹ)");
});
