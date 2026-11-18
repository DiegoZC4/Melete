// Optional test-only output. Keep real Web Audio clocks/graphs and synthetic
// capture running without opening a rehearsal station's exclusive audio device.
function useSilentOutput(browser) {
  if (!process.env.QA_SILENT_OUTPUT) return;
  const create = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await create(...args);
    await context.addInitScript(() => {
      const RealAudioContext = window.AudioContext;
      if (!RealAudioContext) return;
      window.AudioContext = class extends RealAudioContext {
        constructor(options) { super({...options, sinkId:{type:'none'}}); }
        get sinkId() { return ''; }
        setSinkId(id) {
          if (id && id.type !== 'none')
            return Promise.reject(new DOMException('Use a virtual route in silent-output tests','NotFoundError'));
          return super.setSinkId({type:'none'});
        }
      };
    });
    return context;
  };
}
module.exports = {useSilentOutput};
