const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {stabilizeFakeMedia} = require('./browser-fake-media.cjs');

function fixture() {
  const context = vm.createContext({DOMException, generation: 1, requests: []});
  vm.runInContext(`
    globalThis.window = globalThis;
    const devices = () => [
      {kind:'audioinput',label:'Fake Audio Input 1',deviceId:'input-'+generation,groupId:'group-'+generation},
      {kind:'audiooutput',label:'Fake Audio Output 1',deviceId:'output-'+generation,groupId:'speaker-'+generation},
      {kind:'audioinput',label:'Real microphone',deviceId:'real-input',groupId:'real-group'}
    ];
    globalThis.navigator = {mediaDevices:{
      enumerateDevices: async () => devices(),
      getUserMedia: async options => {
        requests.push(options);
        const device = devices().find(d => d.deviceId === options.audio?.deviceId?.exact) || devices()[0];
        const track = {getSettings: () => ({deviceId:device.deviceId,groupId:device.groupId,sampleRate:48000})};
        return {getAudioTracks: () => [track]};
      }
    }};
    globalThis.AudioContext = class {async setSinkId() {throw Error('Real output must not open in the cable fixture');}};
  `, context);
  return {context, addInitScript: (fn, options) => vm.runInContext(`(${fn})(${JSON.stringify(options)})`, context)};
}

test('fake microphone aliases survive ID rotation without changing real devices or outputs', async () => {
  const f = fixture();
  await stabilizeFakeMedia(f);
  const devices = await f.context.navigator.mediaDevices.enumerateDevices();
  assert.equal(devices[0].deviceId, 'cable-input-1');
  assert.equal(devices[1].deviceId, 'output-1');
  assert.equal(devices[2].deviceId, 'real-input');
  f.context.generation = 2;
  const stream = await f.context.navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:'cable-input-1'}}});
  assert.equal(f.context.requests[0].audio.deviceId.exact, 'input-2');
  assert.equal(stream.getAudioTracks()[0].getSettings().sampleRate, 48000);
  assert.equal(stream.getAudioTracks()[0].getSettings().deviceId, 'cable-input-1');
  assert.equal((await f.context.navigator.mediaDevices.enumerateDevices())[0].deviceId, 'cable-input-1');
});

test('virtual acoustic outputs are explicit, idempotent, and reject unknown routes', async () => {
  const f = fixture();
  await stabilizeFakeMedia(f);
  await stabilizeFakeMedia(f, {virtualOutput:true});
  await stabilizeFakeMedia(f);
  assert.equal((await f.context.navigator.mediaDevices.enumerateDevices())[1].deviceId, 'cable-output-1');
  const audio = new f.context.AudioContext();
  await audio.setSinkId('cable-output-1');
  assert.equal(audio.sinkId, 'cable-output-1');
  await assert.rejects(audio.setSinkId('missing-output'), {name:'NotFoundError'});
  assert.equal(audio.sinkId, 'cable-output-1');
});
