/* Shared fixed track/mix normalization and offline export. */
((root) => {
  "use strict";
  const TAIL = 1.4;
  function bus(context, destination, percent = 0, volume = 100) {
    const input = context.createGain(), dry = context.createGain(), wet = context.createGain(), output = context.createGain();
    let normalization = 1, master = volume / 100;
    const convolver = context.createConvolver();
    const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * TAIL), context.sampleRate);
    let seed = 0x53494e47;
    for (let c = 0; c < 2; c++) {
      const samples = impulse.getChannelData(c);
      let low = 0;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        low = .65 * low + .35 * (seed / 0x80000000 - 1);
        samples[i] = i < context.sampleRate * .015 ? 0 : low * Math.exp(-7 * i / samples.length);
      }
    }
    convolver.buffer = impulse;
    input.connect(dry).connect(output);
    input.connect(convolver).connect(wet).connect(output);
    output.connect(destination);
    const update = () => output.gain.setTargetAtTime(normalization * master, context.currentTime, .03);
    const set = value => {
      const amount = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
      wet.gain.setTargetAtTime(amount * .6, context.currentTime, .015);
      dry.gain.value = 1;
    };
    set(percent);
    update();
    return {input, output, set, setVolume(value) { master = Math.max(0, Math.min(200, value)) / 100; update(); },
      setNormalization(value) { normalization = value; update(); },
      disconnect() { input.disconnect(); dry.disconnect(); convolver.disconnect(); wet.disconnect(); output.disconnect(); }};
  }
  async function renderAudio(layers, {duration, rate = 1, reverb = 0, sampleRate = 48000} = {}) {
    if (!layers.length) throw new Error("Turn on Hear for at least one recording");
    if (!(duration > 0 && duration <= 1200 && rate > 0)) throw new Error("Invalid mix length");
    const origin = Math.min(0, ...layers.map(layer => layer.start));
    const lead = .25, length = Math.ceil((lead + (duration - origin) / rate + (reverb ? TAIL : 0)) * sampleRate);
    const context = new OfflineAudioContext(2, length, sampleRate), graph = bus(context, context.destination, reverb);
    const nodes = [];
    try {
      for (const layer of layers) {
        const window = root.MeleteRecording.takePlaybackWindow(layer, origin, rate, duration, 0);
        if (!window) continue;
        const start = lead + window.delay, end = start + (window.until-window.from) / window.ratio;
        const gate = context.createGain(), gain = layer.loudness?.gain ?? 1;
        gate.gain.setValueAtTime(0, 0);
        gate.gain.setValueAtTime(0, start);
        gate.gain.linearRampToValueAtTime(gain, start + Math.min(.003, (end-start)/2));
        gate.gain.setValueAtTime(gain, Math.max(start, end-.003));
        gate.gain.linearRampToValueAtTime(0, end);
        gate.connect(graph.input);
        if (layer.octave || Math.abs(window.ratio-1)>1e-6) {
          let buffer = layer.buffer;
          if (buffer.sampleRate !== sampleRate) {
            const resampler = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * sampleRate), sampleRate);
            const source = resampler.createBufferSource(); source.buffer = buffer;
            source.connect(resampler.destination); source.start();
            buffer = await resampler.startRendering();
          }
          const node = await root.MeleteTakeStretch.create(context, buffer);
          nodes.push(node);
          node.connect(gate);
          await node.start({active:true, output:start, input:window.from, rate:window.ratio, semitones:(layer.octave||0)*12,
            formantSemitones:0, formantCompensation:true});
          // The gate ends this layer. Signalsmith's schedule RPC advances its
          // playhead, so scheduling a future stop before offline render would
          // discard the start event and produce silence.
        } else {
          const source = context.createBufferSource(); source.buffer = layer.buffer;
          source.connect(gate); source.start(start, window.from, window.until-window.from);
        }
      }
      const buffer = await context.startRendering();
      return {buffer, offset:Math.round(lead*sampleRate)};
    } finally {
      nodes.forEach(node => { node.disconnect(); node.port.close(); });
      graph.disconnect();
    }
  }
  async function prepare(layers, options) {
    for (const layer of layers) layer.loudness ||= await root.MeleteTakeLoudness.track(layer.buffer);
    const rendered = await renderAudio(layers, options);
    const normalization = root.MeleteTakeLoudness.plan(await root.MeleteTakeLoudness.measure(rendered.buffer, rendered.offset));
    return {...rendered, normalization};
  }
  async function render(layers, options = {}) {
    const {buffer, offset, normalization} = await prepare(layers, options);
    const volume = Math.max(0, Math.min(200, options.volume ?? 100)) / 100;
    // Preserve the master setting, except where a loud export would clip.
    const ceiling = 10 ** ((root.MeleteTakeLoudness.CEILING - normalization.truePeakDbtp) / 20);
    const gain = Math.min(normalization.gain * volume, ceiling);
    const {wav} = await root.MeleteTakeLoudness.run(buffer, {encode:true, offset, gain});
    return {blob:new Blob([wav], {type:"audio/wav"}), gain, seconds:(buffer.length-offset)/buffer.sampleRate, normalization};
  }
  function encode(buffer, offset = 0) {
    const channels = Array.from({length:buffer.numberOfChannels}, (_, c) => buffer.getChannelData(c));
    let peak = 0;
    for (const samples of channels) for (let i=offset;i<samples.length;i++) peak=Math.max(peak,Math.abs(samples[i]));
    // One attenuation for the whole finished mix preserves the sung balance.
    const gain = peak > .98 ? .98/peak : 1, frames=buffer.length-offset, count=channels.length;
    const data=new ArrayBuffer(44+frames*count*2), view=new DataView(data);
    const text=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
    text(0,"RIFF");view.setUint32(4,data.byteLength-8,true);text(8,"WAVEfmt ");view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,buffer.sampleRate,true);
    view.setUint32(28,buffer.sampleRate*count*2,true);view.setUint16(32,count*2,true);view.setUint16(34,16,true);
    text(36,"data");view.setUint32(40,frames*count*2,true);
    for(let i=0;i<frames;i++)for(let c=0;c<count;c++)view.setInt16(44+(i*count+c)*2,Math.round(channels[c][i+offset]*gain*32767),true);
    return {blob:new Blob([data],{type:"audio/wav"}), gain, seconds:frames/buffer.sampleRate};
  }
  root.MeleteTakeMix = {bus, prepare, render, renderAudio, encode};
})(globalThis);
