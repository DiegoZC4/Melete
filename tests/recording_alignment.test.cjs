const assert=require('node:assert/strict');
const {test}=require('node:test');
test('default endpoint identity follows the physical jack across page loads, not rotating group IDs',()=>{
  const {physicalEndpoint}=require('../template/microphone_check.js');
  const endpoint=(deviceId,groupId,label,kind='audiooutput')=>({kind,deviceId,groupId,label});
  for(const group of ['old tab','new tab']){
    const devices=[endpoint('default',group,'Default - Jack'),endpoint('jack',group,'Jack'),endpoint('usb','other','USB')];
    assert.equal(physicalEndpoint(devices,'audiooutput',''),'jack');
    assert.equal(physicalEndpoint(devices,'audiooutput','jack'),'jack');
    devices[0]=endpoint('default','other','Default - USB');
    assert.equal(physicalEndpoint(devices,'audiooutput','default'),'usb');
    assert.equal(physicalEndpoint(devices,'audioinput','default'),'');
  }
  const ambiguous=[endpoint('default','shared','Default'),endpoint('one','shared','Samson'),endpoint('two','shared','Samson')];
  assert.equal(physicalEndpoint(ambiguous,'audiooutput','default'),'');
  assert.equal(physicalEndpoint([],'audiooutput',{type:'none'}),'');
});
test('verified timing survives months on the same route; buffer, processing and rate changes invalidate it',()=>{
  const {timingProfile,freshCalibration}=require('../template/microphone_check.js');
  const profile=(s={},o={})=>timingProfile({channelCount:1,latency:.012,echoCancellation:false,...s},
    {sampleRate:48000},{sampleRate:48000,baseLatency:.01,outputLatency:.014,...o});
  const r={seconds:.041,measuredAt:1000,residualMs:-1,spreadMs:2,profile:profile()};
  const later=1000+90*86400000;
  assert.equal(freshCalibration(r,later,profile({},{outputLatency:.016})),r);
  for(const changed of [profile({echoCancellation:true}),profile({channelCount:2}),profile({latency:.032}),
    profile({},{sampleRate:44100}),profile({},{outputLatency:.060})])assert.equal(freshCalibration(r,later,changed),null);
  assert.equal(freshCalibration({...r,residualMs:13},later,profile()),null);
  assert.equal(freshCalibration({...r,residualMs:null},later,profile()),null);
  assert.equal(freshCalibration({...r,profile:undefined},later,profile()),null);
});
test('steady clock offset and render-block jitter are not drift; sustained divergence in either direction is flagged once',()=>{
  const {watchClocks,clockDivergence}=require('../template/microphone_check.js');
  for(const rate of [0,.00035,-.00035]){
    const w=watchClocks(13,29), flagged=[];
    for(let t=1;t<=275;t++){
      const v=clockDivergence(w,13+t*(1+rate)+(t%2===0?.003:-.003)+(t===20?.095:0),29+t);
      if(v!==null)flagged.push(v);
    }
    assert.equal(flagged.length,rate?1:0);
    if(rate)assert.equal(Math.sign(flagged[0]),Math.sign(rate));
  }
  const w=watchClocks(10,10);
  assert.equal(clockDivergence(w,60,58),null);
  for(let n=1;n<9;n++)assert.equal(clockDivergence(w,60+n,58+n),null);
});
test('three quiet chirps recover an acoustic delay and reject silence or inconsistent detections', () => {
  const {timingChirp, measuredLatency}=require('../template/microphone_check.js');
  const rate=48000, starts=[.08,.8,1.52], chirp=timingChirp(rate), length=Math.ceil(2.3*rate);
  let seed=17;
  const capture=delays=>{
    const samples=Float32Array.from({length},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return .001*(seed/2**32-.5);});
    delays.forEach((delay,i)=>{if(delay===null)return;const first=Math.round((starts[i]+delay)*rate);
      chirp.forEach((v,j)=>{samples[first+j]+=.7*v;});}); return samples;
  };
  assert.ok(Math.abs(measuredLatency(capture([.137,.137,.137]),rate,starts)-.137)<.002);
  assert.equal(measuredLatency(capture([.137,null,.137]),rate,starts),.137);
  assert.equal(measuredLatency(capture([null,null,null]),rate,starts),null);
  assert.equal(measuredLatency(capture([.1,.19,.28]),rate,starts),null);
  const {calibration,freshCalibration}=require('../template/microphone_check.js');
  const result=calibration(capture([.135,.136,.14]),rate,starts,1000);
  assert.ok(Math.abs(result.seconds-.136)<.001 && result.spreadMs===5);
  assert.equal(freshCalibration(result,1001),result);
  assert.equal(freshCalibration(result,1000+12*3600000),null);
  assert.equal(freshCalibration(result,999),null);
  assert.equal(calibration(capture([.135,null,.135]),rate,starts),null);
  assert.equal(calibration(capture([.135,.136,.175]),rate,starts),null);
});
test('a delayed transport callback cannot shift the recorded audio or the detector frame',()=>{
  const {passClock,sampleScoreTime}=require('../template/microphone_check.js');
  for(const speed of [.75,1,1.25])for(const delay of [0,.027,.180]){
    const sr=48000,clock=passClock(12+delay,90+delay,90,3,3,speed,sr,.137);
    assert.equal(clock.frame,12*sr);
    for(const realError of [-.075,0,.075]){
      const center=12+.4+realError+.137;
      const live=sampleScoreTime(clock,center+.042,.042);
      const saved=clock.position+((center*sr-clock.frame)/sr-clock.latency)*speed;
      assert.ok(Math.abs(live-saved)<1e-9);
      assert.ok(Math.abs(live-(3+(.4+realError)*speed))<1e-9);
    }
  }
});

test('direction-coded earpiece calibration fits three and must independently predict the fourth',()=>{
  const {timingChirp,chirpReadings,fitChirps}=require('../template/microphone_check.js');
  const rate=44100, starts=[.12,.91,1.75,2.53], down=[false,true,false,true];
  function check(delays,echo=false){
    let seed=73;
    const audio=Float32Array.from({length:3.5*rate},(_,i)=>{
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      return .002*Math.sin(2*Math.PI*80*i/rate)+.00009*(seed/2**32-.5);
    });
    delays.forEach((delay,k)=>{
      if(delay===null)return;
      const at=Math.round((starts[k]+delay)*rate), probe=timingChirp(rate,down[k],1.7);
      probe.forEach((v,j)=>{audio[at+j]+=.001*v;if(echo)audio[at+j+rate*.08]+=.001*v;});
    });
    return fitChirps(chirpReadings(audio,rate,starts,down),100);
  }
  const pass=check([.133,.135,.134,.136]);
  assert.ok(pass && Math.abs(pass.seconds-.134)<.002 && Math.abs(pass.residualMs-2)<=1);
  assert.equal(check([.134,.134,.134,.195]),null,'held-out pulse disagrees');
  assert.equal(check([.134,.134,.134,null]),null,'held-out pulse missing');
  assert.equal(check([null,null,null,null]),null,'unrelated input is never a calibration');
  assert.equal(check([.134,.134,.134,.134],true),null,'two comparable acoustic paths are ambiguous');
});
