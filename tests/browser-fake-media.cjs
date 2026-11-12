// Chromium rotates synthetic endpoint IDs across reloads in some versions.
// Only named fake devices are aliased; real device routing is never changed.
async function stabilizeFakeMedia(surface, {virtualOutput = false} = {}) {
  await surface.addInitScript(({virtualOutput}) => {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) return;
    window.__qaVirtualOutput = window.__qaVirtualOutput || virtualOutput;
    if (!window.__qaFakeMediaAliases) {
      window.__qaFakeMediaAliases = true;
      const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const virtual = device => {
        const match = device.label.match(/^Fake Audio (Input|Output) (\d+)$/);
        return match && (match[1] === 'Input' || window.__qaVirtualOutput) ? {kind:device.kind, label:device.label,
          groupId:'cable-group-'+match[1].toLowerCase()+'-'+match[2],
          deviceId:'cable-'+match[1].toLowerCase()+'-'+match[2]} : device;
      };
      navigator.mediaDevices.enumerateDevices = async () => (await enumerate()).map(virtual);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const selected = constraints.audio?.deviceId?.exact;
        const devices = await enumerate();
        const device = selected?.startsWith('cable-input-')
          ? devices.find(item => virtual(item).deviceId === selected) : null;
        if(selected?.startsWith('cable-input-') && !device)throw new DOMException('Unknown virtual input','NotFoundError');
        const stream = await capture(device
          ? {...constraints,audio:{...constraints.audio,deviceId:{exact:device.deviceId}}} : constraints);
        for(const track of stream.getAudioTracks()) {
          const settings = track.getSettings.bind(track);
          const actual = device || devices.find(item => item.deviceId === settings().deviceId);
          if(actual) {
            const route = virtual(actual);
            track.getSettings = () => ({...settings(),deviceId:route.deviceId,groupId:route.groupId});
          }
        }
        return stream;
      };
    }
    if (!virtualOutput) return;
    // The acoustic cable goes straight into a MediaStream, not an OS speaker.
    const outputs = new WeakMap();
    Object.defineProperty(AudioContext.prototype, 'sinkId', {configurable:true,
      get() {return outputs.get(this)||'';}});
    AudioContext.prototype.setSinkId = async function(id) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if(id && !devices.some(device => device.kind === 'audiooutput' && device.deviceId === id))
        throw new DOMException('Unknown virtual output', 'NotFoundError');
      outputs.set(this,id);
    };
  }, {virtualOutput});
}

module.exports = {stabilizeFakeMedia};
