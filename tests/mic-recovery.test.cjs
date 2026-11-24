const {test}=require('node:test');
const assert=require('node:assert/strict');
const {failureKind,inputAdvice,requestStream}=require('../template/microphone_check.js');
const {tabletBuiltin,resolveInputChoice,reportedInput}=require('../template/microphone_check.js');
test('an unknown iPad processing flag is not represented as disabled',()=>{
  const {captureProfile,processingReadout}=require('../template/microphone_check.js');
  assert.equal(processingReadout(captureProfile({getSettings:()=>({echoCancellation:false})})),
    'Echo cancellation: off; Noise suppression: not reported; Auto gain: not reported.');
  assert.match(processingReadout({echoCancellation:'remote-only',noiseSuppression:true,autoGainControl:false}),
    /Echo cancellation: on; Noise suppression: on; Auto gain: off/);
});

test('an ambiguous USB label is not a built-in choice; only explicit intent follows a unique iPad input',()=>{
  const device=(label,deviceId,kind='audioinput')=>({label,deviceId,kind});
  const nav={userAgent:'Desktop Safari',platform:'MacIntel',maxTouchPoints:5};
  const listed=[device('USB Audio','usb'),device('USB Audio','usb2'),device('iPad Microphone','default'),
    device('iPad Microphone','out','audiooutput'),device(' iPad Microphone ','built')];
  const found=tabletBuiltin(listed,nav);assert.equal(found.deviceId,'built');
  assert.equal(tabletBuiltin([...listed,device('iPad Microphone','built2')],nav),null);
  assert.equal(tabletBuiltin(listed.slice(0,4),nav),null);
  assert.equal(tabletBuiltin(listed,{...nav,maxTouchPoints:0}),null);
  assert.equal(resolveInputChoice('old','old',found),'built');assert.equal(resolveInputChoice('old','old',null),'old');
  assert.equal(resolveInputChoice('usb','old',found),'usb');assert.equal(resolveInputChoice('','old',found),'');
  assert.equal(reportedInput(' USB Audio'),'usb');assert.equal(reportedInput(''),'unknown');
});

test('permission, no answer, processing, silence and overload have different recourse',()=>{
  for(const [error,kind] of [[{name:'NotAllowedError'},'permission'],[{name:'MicPromptTimeout'},'pending'],
    [{name:'OverconstrainedError',constraint:'echoCancellation'},'processing'],[{name:'NotReadableError'},'busy'],
    [{name:'NotFoundError'},'device'],[{message:'No microphone samples arrived'},'frames']])assert.equal(failureKind(error),kind);
  assert.match(inputAdvice('error','permission','','ipad-home')[1],/Privacy & Security/);
  assert.match(inputAdvice('error','pending','','apple-safari')[0],/unanswered/i);
  assert.match(inputAdvice('silent')[1],/splitter/);assert.match(inputAdvice('clipping')[1],/gain/);
});
test('an unanswered prompt times out; a late grant is closed and never reused',async()=>{
  let grant, stopped=0,count=0;
  const pending=requestStream({getUserMedia(){count++;return new Promise(r=>{grant=r;});}}, {},5);
  assert.equal(count,1);await assert.rejects(pending,{name:'MicPromptTimeout'});
  grant({getTracks:()=>[{stop(){stopped++;}}]});await new Promise(setImmediate);assert.equal(stopped,1);
  const stream={getTracks:()=>[]};assert.equal(await requestStream({getUserMedia:async()=>stream},{},100),stream);
});
