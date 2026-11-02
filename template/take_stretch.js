/* Buffered, timestamped octave playback. Raw WAVs and scoring data stay untouched. */
((root) => {
  let factory;
  async function create(context, buffer) {
    factory ||= (async () => {
      const url = URL.createObjectURL(new Blob([root.MeleteStretchSource], {type: "text/javascript"}));
      try { return (await import(url)).default; }
      finally { URL.revokeObjectURL(url); }
    })().catch(error => { factory = null; throw error; });
    const node = await (await factory)(context, {numberOfInputs: 1, numberOfOutputs: 1,
      outputChannelCount: [buffer.numberOfChannels]});
    try {
      await node.configure({preset: "default"});
      const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i).slice());
      await node.addBuffers(channels, channels.map(c => c.buffer));
      return node;
    } catch (error) { node.disconnect(); node.port.close(); throw error; }
  }
  root.MeleteTakeStretch = {create};
})(globalThis);
