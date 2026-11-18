/* An isolated voice's spectral envelope and short, session-only vowel examples. */
((root, factory) => {
  const tools = factory();
  if (typeof module === "object" && module.exports) module.exports = tools;
  else root.MeleteVowels = tools;
})(globalThis, function vowelTools() {
  "use strict";
  const RATE = 10000, ORDER = 12, GAP_MS = 225;
  // A conservative acoustic limit for this prototype. Sparse upper harmonics
  // poorly constrain a microphone-only envelope (Joliveau et al., doi:10.1121/1.1791717).
  const MAX_FUNDAMENTAL = 330;
  const F1 = Object.freeze([175, 1250]), F2 = Object.freeze([500, 3500]);
  const f1Bark = F1.map(hzToBark), f2Bark = F2.map(hzToBark);
  const TAU = 2 * Math.PI;
  const median = values => {
    const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  };

  // Low-pass before downsampling. Reuse the fractional-delay filters for each input rate.
  function resampler(inputRate) {
    const radius = Math.ceil(5 * inputRate / RATE), cutoff = .46 * RATE / inputRate;
    const phases = Array.from({length: 64}, (_, phase) => {
      const weights = Float64Array.from({length: 2 * radius + 1}, (_, i) => {
        const x = i - radius - phase / 64;
        const sinc = Math.abs(x) < 1e-9 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x);
        return sinc * (.5 + .5 * Math.cos(Math.PI * x / (radius + 1)));
      });
      const sum = weights.reduce((a,b) => a+b);
      return weights.map(weight => weight/sum);
    });
    return input => {
      const count = Math.min(550, Math.floor((input.length - 2 * radius - 2) * RATE / inputRate));
      if (count < 300) return null;
      const wave = new Float64Array(count);
      const start = input.length - radius - 1 - count * inputRate / RATE;
      for (let i = 0; i < count; ++i) {
        const position = start + i * inputRate / RATE, whole = Math.floor(position);
        const weights = phases[Math.floor((position-whole) * 64)];
        for (let j = 0; j < weights.length; ++j) wave[i] += weights[j] * input[whole-radius+j];
      }
      return wave;
    };
  }

  // First minimum of the cumulative normalized difference. Pitch gates evidence only.
  function fundamental(wave) {
    const maxLag = Math.ceil(RATE / 65), span = wave.length - maxLag;
    let total = 0;
    const difference = new Float64Array(maxLag+1);
    for (let lag = 1; lag <= maxLag; ++lag) {
      let sum = 0;
      for (let i = 0; i < span; ++i) sum += (wave[i] - wave[i+lag]) ** 2;
      total += sum;
      difference[lag] = total > 0 ? sum * lag / total : 1;
      const k = lag-1;
      if (k >= 6 && difference[k] < .16 && difference[k] <= difference[k-1] && difference[k] < difference[lag]) {
        const curvature = difference[k-1] + difference[lag] - 2*difference[k];
        return RATE / (k + .5 * (difference[k-1]-difference[lag]) / curvature);
      }
    }
    return null;
  }

  // Autocorrelation LPC, solved by Levinson-Durbin. Peaks below come from this
  // smooth all-pole filter, not from individual harmonics of the microphone FFT.
  function prediction(frame) {
    const corr = new Float64Array(ORDER+1);
    for (let lag=0; lag<=ORDER; ++lag)
      for (let i=lag; i<frame.length; ++i) corr[lag] += frame[i] * frame[i-lag];
    let error = corr[0] * 1.00001;
    const a = new Float64Array(ORDER+1); a[0] = 1;
    for (let k=1; k<=ORDER; ++k) {
      let sum = corr[k];
      for (let j=1; j<k; ++j) sum += a[j] * corr[k-j];
      const reflection = -sum / error;
      if (!Number.isFinite(reflection) || Math.abs(reflection) >= 1) return null;
      const previous = a.slice(0,k);
      for (let j=1; j<k; ++j) a[j] += reflection * previous[k-j];
      a[k] = reflection;
      error *= 1 - reflection*reflection;
    }
    return a;
  }

  function hasHarmonics(frame, pitch) {
    // A sine or two narrow components can be periodic and still carry no vowel envelope.
    const powers = [];
    for (let f=pitch; f<=3800; f+=pitch) {
      const coefficient = 2 * Math.cos(TAU * f / RATE);
      let prev=0, older=0;
      for (const value of frame) {
        const next = value + coefficient*prev - older;
        older=prev; prev=next;
      }
      powers.push(prev*prev + older*older - coefficient*prev*older);
    }
    const floor = Math.max(...powers) * .001;
    return powers.filter(power => power > floor).length >= 5;
  }

  function makeEstimator() {
    let lastRate, sample;
    const step = 10, bins = 391;
    const cos = new Float64Array(bins*(ORDER+1)), sin = new Float64Array(cos.length);
    for (let i=0; i<bins; ++i) for (let j=1; j<=ORDER; ++j) {
      const phase = TAU * i * step * j / RATE, index = i*(ORDER+1)+j;
      cos[index] = Math.cos(phase); sin[index] = Math.sin(phase);
    }
    return (input, sampleRate) => {
      if (!Number.isFinite(sampleRate) || sampleRate < RATE || sampleRate > 192000) return null;
      if (lastRate !== sampleRate) { sample = resampler(sampleRate); lastRate = sampleRate; }
      const wave = sample(input);
      if (!wave) return null;
      const mean = wave.reduce((a,b) => a+b) / wave.length;
      for (let i=0; i<wave.length; ++i) wave[i] -= mean;
      const power = wave.reduce((sum, value) => sum + value*value, 0) / wave.length;
      if (!(power > .0025 ** 2)) return null;
      const f0 = fundamental(wave);
      if (!f0 || f0 > MAX_FUNDAMENTAL || f0 < 65) return null;
      const window = Float64Array.from(wave, (value,i) =>
        (value - .97*(wave[i-1] ?? value)) * (.54 - .46*Math.cos(TAU*i/(wave.length-1))));
      if (!hasHarmonics(window, f0)) return null;
      const a = prediction(window);
      if (!a) return null;
      const db = new Float64Array(bins);
      for (let i=0; i<bins; ++i) {
        let re=1, im=0;
        for (let j=1; j<=ORDER; ++j) { re+=a[j]*cos[i*(ORDER+1)+j]; im+=a[j]*sin[i*(ORDER+1)+j]; }
        db[i] = -10*Math.log10(re*re+im*im);
      }
      const peaks = [];
      for (let i=1; i<bins-1; ++i) if (db[i]>db[i-1] && db[i]>=db[i+1]) peaks.push(i);
      // Both resonances must rise above their shared valley and their outer shoulders.
      const [first, second] = peaks.filter((i,n) => {
        if (i*step < 120) return false;
        const left=Math.min(...db.subarray(peaks[n-1] ?? 0,i+1));
        const right=Math.min(...db.subarray(i,(peaks[n+1] ?? bins-1)+1));
        return db[i]-Math.max(left,right)>1.2;
      });
      if (second === undefined) return null;
      const f1=first*step, f2=second*step;
      if (f1 < Math.max(F1[0],1.45*f0) || f1>F1[1] || f2<F2[0] || f2>F2[1] || f2-f1<200) return null;
      const valley = Math.min(...db.subarray(first,second+1));
      if (Math.min(db[first],db[second])-valley < 2 || db[first]-Math.min(...db.subarray(0,first)) < 2
        || db[second]-Math.min(...db.subarray(second,Math.min(bins,second+46))) < 2) return null;
      return {f1, f2};
    };
  }

  // Zwicker & Terhardt (1980), eq. 1. The argument is absolute frequency in Hz.
  function hzToBark(hz) {
    return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan((hz / 7500) ** 2);
  }

  function chartPoint({f1, f2}) {
    return {
      x: (f2Bark[1] - hzToBark(f2)) / (f2Bark[1] - f2Bark[0]),
      y: (hzToBark(f1) - f1Bark[0]) / (f1Bark[1] - f1Bark[0]),
    };
  }

  // Disconnected runs retain their real onset times for diphthong comparisons.
  function strokes(frames) {
    const result = [];
    let previous;
    for (const frame of frames) {
      if (frame.f1 != null) {
        if (!previous || previous.f1 == null || frame.t-previous.t > GAP_MS) result.push([]);
        result.at(-1).push(frame);
      }
      previous = frame;
    }
    return result;
  }

  function referenceExample(frames) {
    const runs = strokes(frames);
    if (!runs.length) return null;
    const onset=runs[0][0].t, end=runs.at(-1).at(-1).t;
    // Drop attacks/releases and find a steady, central 300 ms from a single voiced run.
    // Keep the whole demonstrator's path separately, including the vowel closure.
    let middle, best=Infinity;
    for (const run of runs) {
      const trim = Math.min(140, (run.at(-1).t-run[0].t)*.12);
      const interior = run.filter(p => p.t>=run[0].t+trim && p.t<=run.at(-1).t-trim);
      for (let i=0; i<interior.length; ++i) {
        const group = interior.slice(i).filter(p => p.t-interior[i].t<=360);
        if (group.length<4 || group.at(-1).t-group[0].t<250) continue;
        const one=group.map(p=>p.f1), two=group.map(p=>p.f2);
        const spread1=Math.max(...one)-Math.min(...one), spread2=Math.max(...two)-Math.min(...two);
        if (spread1>105 || spread2>175) continue;
        const center=(group[0].t+group.at(-1).t)/2;
        const cost=spread1/105+spread2/175+.25*Math.abs(2*center-end-onset)/(end-onset);
        if (cost<best) { best=cost; middle={f1:median(one), f2:median(two)}; }
      }
    }
    return middle ? {middle, runs:runs.map(run=>run.map(({f1,f2,t})=>({f1,f2,t:t-onset})))} : null;
  }

  function referenceRegion(examples) {
    if (!examples.length) return null;
    const f1=examples.map(e=>e.middle.f1), f2=examples.map(e=>e.middle.f2);
    // The footprint also makes a single demonstration visible. It is a guide, not a grade.
    return {low1: Math.max(F1[0],Math.min(...f1)-35), high1: Math.min(F1[1],Math.max(...f1)+35),
      low2: Math.max(F2[0],Math.min(...f2)-80), high2: Math.min(F2[1],Math.max(...f2)+80)};
  }

  function workerSource() {
    return `const estimate = (${vowelTools.toString()})().makeEstimator();
      self.onmessage = ({data}) => {
        try { self.postMessage({result:estimate(data.input,data.sampleRate)}); }
        catch (error) { self.postMessage({error:error.message}); }
      };`;
  }
  return {makeEstimator, hzToBark, chartPoint, F1, F2, strokes, referenceExample, referenceRegion, workerSource, GAP_MS};
});
