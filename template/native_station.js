/* Optional WASAPI transport. Ordinary files, public pages and mobile use Web Audio. */
((root) => {
  "use strict";
  const RATE = 48000, RENDER_RATE = 24000;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function configuration() {
    try {
      const value = root.top.MeleteNativeStationConfig;
      return root.MeleteStation?.requested() && value?.origin === root.top.location.origin
        && /^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin) ? value : null;
    } catch { return null; }
  }

  class Bridge {
    constructor(engine, config) {
      this.engine = engine;
      this.config = config;
      this.client = crypto.randomUUID();
      this.state = null;
      this.frame = 0;
      this.sequence = 0;
      this.history = new Float32Array(8192);
      this.listeners = new Set();
      this.assets = {};
      this.layerAssets = new Map();
      this.bufferIds = new WeakMap();
      this.counter = 0;
      this.inputEnabled = false;
      this.clock = {sampleRate: RATE, get currentTime() { return self.frame / RATE; },
        get state() { return self.state?.session ? "running" : "closed"; },
        resume: async () => { await self.open(); }, suspend: async () => {},
        createAnalyser: () => self.analyser(), addEventListener() {}};
      const self = this;
      root.addEventListener("pagehide", () => { void this.close(); });
    }
    async request(path, body, headers = {}, binary = false) {
      const response = await fetch(this.config.origin + "/native/" + path, {
        ...(body == null ? {} : {method: "POST", body: binary ? body : JSON.stringify(body)}),
        headers: {"X-Melete-Native": this.config.token, ...(binary ? {} : {"Content-Type": "application/json"}), ...headers},
        signal: AbortSignal.timeout(10000), cache: "no-store"});
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "The native station could not respond");
      }
      return path.startsWith("poll?") ? response.arrayBuffer() : response.json();
    }
    async control(kind, values = {}) {
      if (!this.state?.session) return null;
      const session = this.state.session;
      const job = (this.commands || Promise.resolve()).catch(() => {}).then(async () => {
        const state = await this.request("control", {session, kind, ...values});
        if (this.state?.session === session) this.acceptState(state);
        return state;
      });
      this.commands = job;
      return job;
    }
    acceptState(state) {
      if (this.state?.session === state.session && (state.frame < this.state.frame
        || state.frame === this.state.frame && (state.events?.at(-1)?.sequence || 0) < (this.state.events?.at(-1)?.sequence || 0))) return;
      this.state = state;
      this.received = performance.now();
    }
    async open() {
      if (this.state?.session) return;
      if (this.opening) return this.opening;
      this.opening = (async () => {
        await root.top.MeleteNativeStationClosing;
        const state = await this.request("open", {client: this.client});
        this.frame = 0;
        this.sequence = 0;
        this.assets = {};
        this.layerAssets.clear();
        this.guideKey = null;
        this.layerKey = null;
        this.pausePromise = null;
        this.acceptState(state);
        this.history.fill(0);
        this.failure = null;
        this.polling = this.poll();
        while (!this.frame && !this.failure) await sleep(5);
        if (this.failure) throw this.failure;
      })().finally(() => { this.opening = null; });
      return this.opening;
    }
    async poll() {
      const session = this.state.session;
      try {
        while (this.state?.session === session) {
          const data = await this.request(`poll?session=${session}&since=${this.frame}`);
          if (this.state?.session !== session) return;
          const n = new DataView(data).getUint32(0, true);
          const state = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, n)));
          const samples = new Float32Array(data, 4+n);
          if (state.firstFrame !== this.frame || state.frame-this.frame !== samples.length) throw new Error("Native capture frame discontinuity");
          for (const listener of this.listeners) listener.samples(this.frame, samples);
          if (samples.length >= this.history.length) this.history.set(samples.subarray(-this.history.length));
          else if (samples.length) {
            this.history.copyWithin(0, samples.length);
            this.history.set(samples, this.history.length-samples.length);
          }
          this.frame = state.frame;
          this.acceptState(state);
          if (state.fault) throw new Error(state.fault);
          for (const event of state.events) {
            if (event.sequence <= this.sequence) continue;
            this.sequence = event.sequence;
            if (event.kind === "loop" && this.engine.playing) {
              this.startFrame = event.frame;
              this.engine.basePosition = event.position;
              this.engine.onTransportChange?.("loop");
            }
            if (event.kind === "end" && this.engine.playing) {
              this.endFrame = state.stopFrame;
              this.engine.nativeEnded?.(event.position);
            }
          }
          await sleep(12);
        }
      } catch (error) {
        if (this.state?.session !== session) return;
        this.failure = error;
        for (const listener of this.listeners) listener.error(error);
        this.engine.nativeFailed?.(error);
        await this.close();
      }
    }
    analyser() {
      const self = this;
      return {context: this.clock, fftSize: 4096, smoothingTimeConstant: 0,
        getFloatTimeDomainData(samples) { samples.set(self.history.subarray(-samples.length)); }, disconnect() {}};
    }
    async microphone() {
      await this.open();
      this.inputEnabled = true;
      const bridge = this, track = new EventTarget();
      Object.defineProperty(track, "enabled", {get: () => this.inputEnabled, set: value => { this.inputEnabled = Boolean(value); }});
      track.muted = false;
      track.label = this.state.input + " (WASAPI)";
      Object.defineProperty(track, "readyState", {get: () => this.state?.session ? "live" : "ended"});
      track.getSettings = () => ({deviceId: "native-wasapi", sampleRate: RATE, channelCount: 1,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0});
      track.stop = () => { this.inputEnabled = false; if (!this.engine.playing && !this.listeners.size) void this.close(); };
      return {stream: {getAudioTracks: () => [track]}, context: this.clock, analyser: this.analyser(),
        source: {connect() {}, disconnect() {}, nativeCapture: (samples, error) => bridge.capture(samples, error)}};
    }
    async capture(samples, error) {
      await this.open();
      const listener = {samples, error};
      this.listeners.add(listener);
      return {stop: async () => {
        try {
          const stop = await this.pause();
          const deadline = performance.now()+1500;
          while (this.state?.session && this.frame < stop.stopFrame && performance.now() < deadline) await sleep(5);
          if (this.frame < stop.stopFrame && !this.failure) throw new Error("Native capture tail did not arrive; backup retained");
        } finally { this.listeners.delete(listener); }
      }};
    }
    position(audible = false) {
      const state = this.state;
      if (!state?.playing) return state?.position ?? this.engine.basePosition;
      // Only presentation interpolates network delivery. Stored samples always
      // retain the actual native frame numbers from the callback.
      const age = Math.min(.12, Math.max(0, (performance.now()-this.received)/1000)+Math.min(.02, state.callbackAge));
      return state.position+(age-(audible ? state.outputLatency : 0))*state.rate;
    }
    async upload(key, buffer, {origin, offset = 0, gain = 1} = {}) {
      const frames = buffer.length-offset, channels = buffer.numberOfChannels;
      const descriptor = {frames, channels, sampleRate: buffer.sampleRate, origin, rate: this.engine.rate};
      const sources = Array.from({length: channels}, (_, i) => buffer.getChannelData(i));
      const block = Math.floor(262144/channels);
      for (let at = 0; at < frames; at += block) {
        this.transfer = {key, frames:at, total:frames};
        const n = Math.min(block, frames-at), pcm = new Float32Array(n*channels);
        for (let c = 0; c < channels; c++) for (let f = 0; f < n; f++) pcm[f*channels+c] = sources[c][offset+at+f]*gain;
        await this.request("asset", pcm, {"X-Melete-Asset": JSON.stringify({session: this.state.session,
          key, offset: at*channels*4, ...(at === 0 ? {descriptor} : {})})}, true);
      }
      this.transfer = null;
      return key;
    }
    async guide() {
      const engine = this.engine, key = `${engine.rate}:${engine.divisiPlaybackKey}`;
      if (this.guideKey === key && this.assets.guide) return;
      const started=performance.now();
      const origin = engine.secondsAtTick(engine.leadInTicks);
      const channels = engine.trackStrips.length+1;
      const context = new OfflineAudioContext(channels, Math.ceil((engine.duration-origin)/engine.rate*RENDER_RATE), RENDER_RATE);
      const renderer = Object.create(Object.getPrototypeOf(engine));
      Object.assign(renderer, {context, rate: engine.rate, wave: engine.createWave(context),
        scheduled: new Set(), scheduledClicks: new Map(), metronomeVolume: 1});
      const merger = context.createChannelMerger(channels);
      merger.connect(context.destination);
      renderer.trackStrips = Array.from({length: channels-1}, (_, c) => {
        const gain = context.createGain(); gain.connect(merger, 0, c); return {gain};
      });
      renderer.master = context.createGain(); renderer.master.connect(merger, 0, channels-1);
      // Do not connect the whole song's future filters/oscillators at once.
      // Offline suspends keep the same continuous voices and exact schedule,
      // while limiting the active graph to a short lookahead.
      const notes=engine.playbackNotes || engine.notes, clicks=engine.clicks;
      let nextNote=0,nextClick=0;
      const ahead = until => {
        const position=origin+context.currentTime*engine.rate;
        const limit=origin+until*engine.rate;
        while(nextNote<notes.length && notes[nextNote].start<limit)renderer.scheduleNote(notes[nextNote++],position,0,engine.duration);
        while(nextClick<clicks.length && clicks[nextClick].time<limit)renderer.scheduleClick(clicks[nextClick++],position,0);
      };
      ahead(8);
      const batches=[];
      for(let t=4;t<context.length/RENDER_RATE;t+=4) {
        batches.push(context.suspend(t).then(() => {ahead(t+8);return context.resume();}));
      }
      const buffer = await context.startRendering();
      await Promise.all(batches);
      const rendered=performance.now();
      this.assets.guide = await this.upload("guide-"+(++this.counter), buffer, {origin});
      this.preparationTiming={renderMs:rendered-started, uploadMs:performance.now()-rendered};
      this.guideKey = key;
    }
    async layers() {
      const engine = this.engine;
      await engine.takeBalanceJob;
      const layers = [...engine.takeLayers.values()].filter(layer => layer.id !== engine.overdubLayerId
        && (!engine.recordingSingerId || layer.singerId === engine.recordingSingerId));
      const refs = [...engine.referenceLayers.values()];
      const assets = {};
      for (const [prefix, group] of [["recording", layers], ["reference", refs]]) {
        for (const [index, layer] of group.entries()) {
          if (!this.bufferIds.has(layer.buffer)) this.bufferIds.set(layer.buffer, ++this.counter);
          const gain = prefix === "reference" ? layer.playbackGain ?? 1 : layer.loudness?.gain ?? 1;
          const reverb = prefix === "recording" ? this.reverb || 0 : 0;
          const key = JSON.stringify([layer.loudnessKey || this.bufferIds.get(layer.buffer), layer.start, layer.end, layer.latency,
            layer.rate, layer.octave, layer.pan, gain, engine.rate, engine.duration, reverb]);
          let asset = this.layerAssets.get(key);
          if (!asset) {
            const rendered = await root.MeleteTakeMix.renderAudio([{...layer, loudness:{gain}}],
              {duration:engine.duration, rate:engine.rate, reverb, sampleRate:RENDER_RATE});
            asset = await this.upload("layer-"+(++this.counter), rendered.buffer,
              {origin:Math.min(0, layer.start), offset:rendered.offset});
            this.layerAssets.set(key, asset);
          }
          assets[`${prefix}:${index}`] = asset;
        }
      }
      this.recordingNormalization = root.MeleteTakeLoudness.mix(layers.map(x=>x.loudness), {reverb:this.reverb || 0}).gain;
      this.assets = {...(this.assets.guide ? {guide:this.assets.guide} : {}), ...assets};
    }
    async prepare() {
      await this.open();
      if (this.preparing) return this.preparing;
      this.preparing = (async () => {
        if (!this.state.playing && this.guideKey !== `${this.engine.rate}:${this.engine.divisiPlaybackKey}`) {
          this.pruneLayerCache(await this.control("assets", {assets:{}}));
          this.assets = {};
          this.layerKey = null;
        }
        await this.guide();
        await this.layers();
        const state = await this.control("assets", {assets: this.assets});
        this.pruneLayerCache(state);
        await this.mix();
      })().finally(() => { this.preparing = null; });
      return this.preparing;
    }
    pruneLayerCache(state) {
      if (state?.cachedAssets) for (const [key, asset] of this.layerAssets) {
        if (!state.cachedAssets.includes(asset)) this.layerAssets.delete(key);
      }
    }
    async mix(audible, volumes, pans) {
      if (audible) this.mixSettings = {gains: volumes.map((v, i) => audible.has(i) ? v/100 : 0), pans: pans.map(v => v/100)};
      if (!this.state?.session || !this.mixSettings) return;
      this.pendingMix = {...this.mixSettings, metronome: this.engine.metronomeVolume,
        recordings:(this.volume ?? 1)*(this.recordingNormalization ?? 1)};
      if (!this.mixing) this.mixing = (async () => {
        do {
          const values = this.pendingMix;
          this.pendingMix = null;
          await this.control("mix", values);
          // Drag events (including all-part pans) replace obsolete values;
          // they never restart transport or flood the capture connection.
          await sleep(25);
        } while (this.pendingMix && this.state?.session);
      })().finally(() => { this.mixing = null; });
      return this.mixing;
    }
    refreshLayers() {
      if (!this.state?.session) return;
      if (this.preparing) {
        if (!this.refreshPending) {
          this.refreshPending = true;
          void this.preparing.finally(() => { this.refreshPending = false; this.refreshLayers(); }).catch(() => {});
        }
        return;
      }
      void this.prepare().catch(error => this.engine.nativeFailed?.(error));
    }
    async play(position) {
      const generation = this.engine.startRequest;
      await this.prepare();
      const engine = this.engine;
      if (generation !== engine.startRequest) return;
      this.pausePromise = null;
      const end = engine.playbackEndSeconds(position);
      const state = await this.control("play", {position, rate: engine.rate, end: engine.playbackEndSeconds(position),
        loopStart: engine.hasLoop() && end === engine.loopEndSeconds ? engine.loopStartSeconds : null, record: this.listeners.size > 0,
        label: {song: root.document.title, target: engine.overdubLayerId}});
      this.startFrame = state.anchor;
      this.sequence = state.events.at(-1)?.sequence || this.sequence;
    }
    preview(note, channel, fullChord = false) {
      const key = "preview-"+(++this.counter);
      let released = false;
      const pending = (async () => {
        await this.open();
        const engine = this.engine, context = new OfflineAudioContext(1, RENDER_RATE*6, RENDER_RATE);
        const renderer = Object.create(Object.getPrototypeOf(engine));
        const gain = context.createGain(); gain.connect(context.destination);
        Object.assign(renderer, {context, rate: 1, wave: engine.createWave(context), scheduled: new Set(),
          master: gain, trackStrips: []});
        renderer.scheduleNote({...note, start: 0, end: 6}, 0, 0, 6);
        const buffer = await context.startRendering();
        if (released) return;
        await this.upload(key, buffer, {origin: 0});
        if (released) return;
        const pan = this.mixSettings?.pans[channel] || 0;
        const level = fullChord ? 1/Math.sqrt(engine.trackStrips.length) : this.mixSettings?.gains[channel] || 1;
        await this.control("preview", {key, pan, gain: level});
      })().catch(error => this.engine.nativeFailed?.(error));
      return {release: () => { released = true; void pending.then(() => this.control("release", {key})); }};
    }
    async diagnostic(buffer, pan = -1) {
      await this.open();
      if (this.engine.playing || this.listeners.size) throw new Error("Pause recording before testing the audio route");
      const key = "diagnostic-"+(++this.counter);
      await this.upload(key, buffer, {origin:0});
      const state = await this.control("preview", {key, pan, gain:1});
      return {frame:state.frame, stop:() => this.control("release", {key})};
    }
    async calibrate() {
      await this.open();
      const check = root.MeleteMicrophoneCheck, offsets = [.35,1.12,1.95,2.74], directions = [false,true,false,true];
      const buffer = this.engine.context.createBuffer(1, RATE*4, RATE);
      offsets.forEach((offset,i) => buffer.getChannelData(0).set(check.timingChirp(RATE,directions[i]),Math.round(offset*RATE)));
      const blocks = [], listener = {samples:(frame, samples) => blocks.push([frame,samples]), error:() => {}};
      let probe;
      this.listeners.add(listener);
      try {
        // The diagnostic does not save a take or route microphone sound back out.
        const key = "timing-"+(++this.counter);
        await this.upload(key,buffer,{origin:0});
        probe = await this.control("preview", {key,pan:-1,gain:1});
        const deadline = performance.now()+6000;
        while (this.frame < probe.frame+buffer.length && !this.failure && performance.now()<deadline) await sleep(10);
        if(this.failure || this.frame<probe.frame+buffer.length) throw this.failure || new Error("Native timing check was interrupted");
        const first=blocks[0]?.[0], last=blocks.at(-1);
        if(first===undefined) throw new Error("No microphone samples reached the timing check");
        const data=new Float32Array(last[0]+last[1].length-first);
        for(const [frame,samples] of blocks)data.set(samples,frame-first);
        const readings=check.chirpReadings(data,RATE,offsets.map(t=>t+(probe.frame-first)/RATE),directions);
        const result=check.fitChirps(readings);
        if(!result) throw new Error("Could not verify four consistent chirps. Existing calibration is unchanged.");
        await this.control("calibration",{result});
        return result;
      } finally { this.listeners.delete(listener); }
    }
    async stereoTest() {
      const buffer=this.engine.context.createBuffer(2,Math.round(RATE*1.05),RATE);
      for(const [delay,side,hz] of [[0,0,440],[.52,1,660],[.80,1,660]]) {
        const samples=buffer.getChannelData(side);
        for(let f=0;f<Math.round(.18*RATE);f++) {
          const t=f/RATE, envelope=Math.min(1,t/.02,(.18-t)/.04);
          samples[Math.round(delay*RATE)+f]=.055*envelope*Math.sin(2*Math.PI*hz*t);
        }
      }
      return this.diagnostic(buffer);
    }
    pause() {
      if (!this.state?.session) return Promise.resolve({stopFrame: this.frame});
      return this.pausePromise ||= this.control("pause");
    }
    async close() {
      if (this.closing) return this.closing;
      if (!this.state?.session) return;
      const session = this.state.session;
      this.state = null;
      this.closing = this.request("control", {session, kind:"close"}).catch(() => {}).finally(() => {this.closing=null;});
      return this.closing;
    }
  }
  root.MeleteNativeStation = {create(engine) { const config = configuration(); return config ? new Bridge(engine, config) : null; }};
})(globalThis);
