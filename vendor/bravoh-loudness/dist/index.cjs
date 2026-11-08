"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ABSOLUTE_GATE_LUFS: () => ABSOLUTE_GATE_LUFS,
  CHANNEL_LAYOUTS: () => CHANNEL_LAYOUTS,
  CHANNEL_WEIGHTS: () => CHANNEL_WEIGHTS,
  COMPLIANCE_CASES: () => COMPLIANCE_CASES,
  LOUDNESS_FORMAT_VERSION: () => LOUDNESS_FORMAT_VERSION,
  LOUDNESS_OFFSET_DB: () => LOUDNESS_OFFSET_DB,
  LRA_RELATIVE_GATE_LU: () => LRA_RELATIVE_GATE_LU,
  LoudnessMeter: () => LoudnessMeter,
  RELATIVE_GATE_LU: () => RELATIVE_GATE_LU,
  TARGETS: () => TARGETS,
  TruePeakDetector: () => TruePeakDetector,
  analyzeLoudness: () => analyzeLoudness,
  applyGain: () => applyGain,
  biquadMagnitudeDb: () => biquadMagnitudeDb,
  dbToLinear: () => dbToLinear,
  decodeWav: () => decodeWav,
  defaultOversampleFactor: () => defaultOversampleFactor,
  defaultRolesFor: () => defaultRolesFor,
  designHighPass: () => designHighPass,
  designKWeighting: () => designKWeighting,
  designPolyphaseInterpolator: () => designPolyphaseInterpolator,
  designPreFilter: () => designPreFilter,
  encodeWav: () => encodeWav,
  kWeightingMagnitudeDb: () => kWeightingMagnitudeDb,
  levelSteppedSine: () => levelSteppedSine,
  linearToDb: () => linearToDb,
  loudnessFromWav: () => loudnessFromWav,
  planGainFactor: () => planGainFactor,
  planNormalization: () => planNormalization,
  powerToLufs: () => powerToLufs,
  resolveTarget: () => resolveTarget,
  resolveWeights: () => resolveWeights,
  steadySine: () => steadySine,
  weightsFor: () => weightsFor
});
module.exports = __toCommonJS(index_exports);

// src/channels.ts
var CHANNEL_WEIGHTS = Object.freeze({
  left: 1,
  right: 1,
  centre: 1,
  lfe: 0,
  leftSurround: 1.41,
  rightSurround: 1.41,
  leftBack: 1.41,
  rightBack: 1.41
});
var CHANNEL_LAYOUTS = Object.freeze({
  mono: ["centre"],
  stereo: ["left", "right"],
  "5.1": ["left", "right", "centre", "lfe", "leftSurround", "rightSurround"],
  "7.1": [
    "left",
    "right",
    "centre",
    "lfe",
    "leftSurround",
    "rightSurround",
    "leftBack",
    "rightBack"
  ]
});
function defaultRolesFor(channelCount) {
  if (channelCount === 1) return [...CHANNEL_LAYOUTS.mono];
  if (channelCount === 2) return [...CHANNEL_LAYOUTS.stereo];
  if (channelCount === 6) return [...CHANNEL_LAYOUTS["5.1"]];
  if (channelCount === 8) return [...CHANNEL_LAYOUTS["7.1"]];
  if (channelCount < 1) throw new RangeError("at least one channel is required");
  return Array.from({ length: channelCount }, () => "left");
}
function weightsFor(roles) {
  return roles.map((role) => {
    const weight = CHANNEL_WEIGHTS[role];
    if (weight === void 0) throw new RangeError(`unknown channel role: ${String(role)}`);
    return weight;
  });
}
function resolveWeights(channelCount, options = {}) {
  if (options.channelRoles) {
    if (options.channelRoles.length !== channelCount) {
      throw new RangeError(
        `channelRoles has ${options.channelRoles.length} entries for ${channelCount} channels`
      );
    }
    return weightsFor(options.channelRoles);
  }
  if (options.layout) {
    const roles = CHANNEL_LAYOUTS[options.layout];
    if (!roles) throw new RangeError(`unknown layout: ${String(options.layout)}`);
    if (roles.length !== channelCount) {
      throw new RangeError(`layout ${options.layout} expects ${roles.length} channels`);
    }
    return weightsFor(roles);
  }
  return weightsFor(defaultRolesFor(channelCount));
}

// src/kweighting.ts
var SHELF_F0_HZ = 1681.974450955532;
var SHELF_GAIN_DB = 3.999843853973347;
var SHELF_Q = 0.7071752369554196;
var SHELF_VB_EXPONENT = 0.4996667741545416;
var HIGHPASS_F0_HZ = 38.13547087602444;
var HIGHPASS_Q = 0.5003270373238773;
function designPreFilter(sampleRateHz) {
  assertSampleRate(sampleRateHz);
  const k = Math.tan(Math.PI * SHELF_F0_HZ / sampleRateHz);
  const vh = 10 ** (SHELF_GAIN_DB / 20);
  const vb = vh ** SHELF_VB_EXPONENT;
  const denominator = 1 + k / SHELF_Q + k * k;
  return {
    b0: (vh + vb * k / SHELF_Q + k * k) / denominator,
    b1: 2 * (k * k - vh) / denominator,
    b2: (vh - vb * k / SHELF_Q + k * k) / denominator,
    a1: 2 * (k * k - 1) / denominator,
    a2: (1 - k / SHELF_Q + k * k) / denominator
  };
}
function designHighPass(sampleRateHz) {
  assertSampleRate(sampleRateHz);
  const k = Math.tan(Math.PI * HIGHPASS_F0_HZ / sampleRateHz);
  const denominator = 1 + k / HIGHPASS_Q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: 2 * (k * k - 1) / denominator,
    a2: (1 - k / HIGHPASS_Q + k * k) / denominator
  };
}
function designKWeighting(sampleRateHz) {
  return [designPreFilter(sampleRateHz), designHighPass(sampleRateHz)];
}
function createBiquadState() {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}
function filterBiquadInPlace(input, coefficients, state) {
  const { b0, b1, b2, a1, a2 } = coefficients;
  let { x1, x2, y1, y2 } = state;
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    input[i] = y0;
  }
  state.x1 = x1;
  state.x2 = x2;
  state.y1 = y1;
  state.y2 = y2;
}
function biquadMagnitudeDb(coefficients, frequencyHz, sampleRateHz) {
  const w = 2 * Math.PI * frequencyHz / sampleRateHz;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const { b0, b1, b2, a1, a2 } = coefficients;
  const numeratorReal = b0 + b1 * cos1 + b2 * cos2;
  const numeratorImaginary = -(b1 * sin1 + b2 * sin2);
  const denominatorReal = 1 + a1 * cos1 + a2 * cos2;
  const denominatorImaginary = -(a1 * sin1 + a2 * sin2);
  const numerator = Math.hypot(numeratorReal, numeratorImaginary);
  const denominator = Math.hypot(denominatorReal, denominatorImaginary);
  return 20 * Math.log10(numerator / denominator);
}
function kWeightingMagnitudeDb(frequencyHz, sampleRateHz) {
  const [preFilter, highPass] = designKWeighting(sampleRateHz);
  return biquadMagnitudeDb(preFilter, frequencyHz, sampleRateHz) + biquadMagnitudeDb(highPass, frequencyHz, sampleRateHz);
}
function assertSampleRate(sampleRateHz) {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz < 3e3 || sampleRateHz > 768e3) {
    throw new RangeError(`unsupported sample rate: ${sampleRateHz} Hz (expected 3000\u2013768000)`);
  }
}

// src/truepeak.ts
function defaultOversampleFactor(sampleRateHz) {
  if (sampleRateHz < 96e3) return 4;
  if (sampleRateHz < 192e3) return 2;
  return 1;
}
function besselI0(x) {
  let sum = 1;
  let term = 1;
  const half = x / 2;
  for (let k = 1; k < 64; k += 1) {
    term *= half / k * (half / k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}
function sinc(x) {
  if (x === 0) return 1;
  const piX = Math.PI * x;
  return Math.sin(piX) / piX;
}
var KAISER_BETA = 7;
function designPolyphaseInterpolator(factor, tapsPerPhase) {
  const totalTaps = factor * tapsPerPhase;
  const centre = factor * (tapsPerPhase >> 1);
  const halfWidth = centre + 0.5;
  const denominator = besselI0(KAISER_BETA);
  const prototype = new Float64Array(totalTaps);
  for (let n = 0; n < totalTaps; n += 1) {
    const ratio = (n - centre) / halfWidth;
    const window = besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - ratio * ratio))) / denominator;
    prototype[n] = sinc((n - centre) / factor) * window;
  }
  const phases = [];
  for (let phase = 0; phase < factor; phase += 1) {
    const branch = new Float64Array(tapsPerPhase);
    let sum = 0;
    for (let k = 0; k < tapsPerPhase; k += 1) {
      const tap = prototype[phase + k * factor];
      branch[k] = tap;
      sum += tap;
    }
    if (sum !== 0) for (let k = 0; k < tapsPerPhase; k += 1) branch[k] = branch[k] / sum;
    phases.push(branch);
  }
  return phases;
}
var TruePeakDetector = class {
  oversampleFactor;
  tapsPerPhase;
  phases;
  l1Norm;
  history;
  peak = 0;
  samplePeak = 0;
  constructor(sampleRateHz, options = {}) {
    this.oversampleFactor = options.oversampleFactor ?? defaultOversampleFactor(sampleRateHz);
    this.tapsPerPhase = options.tapsPerPhase ?? 16;
    if (!Number.isInteger(this.oversampleFactor) || this.oversampleFactor < 1) {
      throw new RangeError("oversampleFactor must be a positive integer");
    }
    if (!Number.isInteger(this.tapsPerPhase) || this.tapsPerPhase < 2) {
      throw new RangeError("tapsPerPhase must be an integer >= 2");
    }
    this.phases = designPolyphaseInterpolator(this.oversampleFactor, this.tapsPerPhase);
    let l1 = 0;
    for (const branch of this.phases) {
      let branchL1 = 0;
      for (const tap of branch) branchL1 += Math.abs(tap);
      l1 = Math.max(l1, branchL1);
    }
    this.l1Norm = l1;
    this.history = new Float64Array(this.tapsPerPhase);
  }
  push(samples) {
    const length = samples.length;
    if (length === 0) return;
    let chunkPeak = 0;
    for (let i = 0; i < length; i += 1) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > chunkPeak) chunkPeak = magnitude;
    }
    if (chunkPeak > this.samplePeak) this.samplePeak = chunkPeak;
    if (this.oversampleFactor === 1) {
      if (chunkPeak > this.peak) this.peak = chunkPeak;
      return;
    }
    const history = this.history;
    const taps = this.tapsPerPhase;
    let historyPeak = 0;
    for (let k = 0; k < taps; k += 1) {
      const magnitude = Math.abs(history[k]);
      if (magnitude > historyPeak) historyPeak = magnitude;
    }
    const bound = Math.max(chunkPeak, historyPeak) * this.l1Norm;
    if (bound <= this.peak) {
      if (length >= taps) {
        for (let k = 0; k < taps; k += 1) history[k] = samples[length - taps + k];
      } else {
        history.copyWithin(0, length);
        for (let k = 0; k < length; k += 1) history[taps - length + k] = samples[k];
      }
      return;
    }
    const phases = this.phases;
    const factor = this.oversampleFactor;
    let peak = this.peak;
    for (let i = 0; i < length; i += 1) {
      history.copyWithin(0, 1);
      history[taps - 1] = samples[i];
      for (let phase = 0; phase < factor; phase += 1) {
        const branch = phases[phase];
        let accumulator = 0;
        for (let k = 0; k < taps; k += 1) {
          accumulator += branch[k] * history[taps - 1 - k];
        }
        const magnitude = Math.abs(accumulator);
        if (magnitude > peak) peak = magnitude;
      }
    }
    this.peak = peak;
  }
  /** Linear true peak — never below the sample peak. */
  get linearPeak() {
    return Math.max(this.peak, this.samplePeak);
  }
  get linearSamplePeak() {
    return this.samplePeak;
  }
  reset() {
    this.peak = 0;
    this.samplePeak = 0;
    this.history.fill(0);
  }
};
function linearToDb(value) {
  if (value <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(value);
}
function dbToLinear(db) {
  return 10 ** (db / 20);
}

// src/types.ts
var LOUDNESS_FORMAT_VERSION = "loudness.v1";

// src/meter.ts
var LOUDNESS_OFFSET_DB = -0.691;
var ABSOLUTE_GATE_LUFS = -70;
var RELATIVE_GATE_LU = -10;
var LRA_RELATIVE_GATE_LU = -20;
var SUB_BLOCKS_PER_MOMENTARY = 4;
var SUB_BLOCKS_PER_SHORT_TERM = 30;
var LoudnessMeter = class {
  sampleRateHz;
  channels;
  channelWeights;
  subBlockFrames;
  preFilter;
  highPass;
  preFilterStates;
  highPassStates;
  truePeakDetectors;
  scratch;
  /** Σ_j G_j · Σ x² for each completed 100 ms sub-block. */
  subBlockSums = [];
  pendingSums;
  pendingFrames = 0;
  momentaryPowers = [];
  shortTermPowers = [];
  runningMomentary = 0;
  runningShortTerm = 0;
  totalFrames = 0;
  channelSamplePeaks;
  constructor(options) {
    const { sampleRateHz } = options;
    this.channels = options.channels ?? 2;
    if (!Number.isInteger(this.channels) || this.channels < 1) {
      throw new RangeError("channels must be a positive integer");
    }
    this.sampleRateHz = sampleRateHz;
    this.channelWeights = resolveWeights(this.channels, {
      ...options.channelRoles ? { channelRoles: options.channelRoles } : {},
      ...options.layout ? { layout: options.layout } : {}
    });
    this.subBlockFrames = Math.max(1, Math.round(sampleRateHz / 10));
    const [preFilter, highPass] = designKWeighting(sampleRateHz);
    this.preFilter = preFilter;
    this.highPass = highPass;
    this.preFilterStates = Array.from({ length: this.channels }, createBiquadState);
    this.highPassStates = Array.from({ length: this.channels }, createBiquadState);
    this.scratch = Array.from({ length: this.channels }, () => new Float64Array(0));
    this.pendingSums = new Float64Array(this.channels);
    this.channelSamplePeaks = new Float64Array(this.channels);
    const truePeak = options.truePeak ?? true;
    this.truePeakDetectors = truePeak === false ? null : Array.from(
      { length: this.channels },
      () => new TruePeakDetector(sampleRateHz, truePeak === true ? {} : truePeak)
    );
  }
  /** Feed one block of planar (per-channel) samples. */
  push(channels) {
    if (channels.length !== this.channels) {
      throw new RangeError(`expected ${this.channels} channels, received ${channels.length}`);
    }
    const frameCount = channels[0]?.length ?? 0;
    for (const channel of channels) {
      if (channel.length !== frameCount) {
        throw new RangeError("all channels must contain the same number of frames");
      }
    }
    if (frameCount === 0) return;
    for (let channel = 0; channel < this.channels; channel += 1) {
      const source = channels[channel];
      const buffer = this.ensureScratch(channel, frameCount);
      for (let i = 0; i < frameCount; i += 1) buffer[i] = source[i];
      this.truePeakDetectors?.[channel]?.push(buffer);
      let peak = this.channelSamplePeaks[channel];
      for (let i = 0; i < frameCount; i += 1) {
        const magnitude = Math.abs(buffer[i]);
        if (magnitude > peak) peak = magnitude;
      }
      this.channelSamplePeaks[channel] = peak;
      filterBiquadInPlace(buffer, this.preFilter, this.preFilterStates[channel]);
      filterBiquadInPlace(buffer, this.highPass, this.highPassStates[channel]);
    }
    this.accumulate(frameCount);
    this.totalFrames += frameCount;
  }
  /** Feed interleaved samples (`L R L R …`), the shape most decoders hand back. */
  pushInterleaved(samples) {
    const frameCount = Math.floor(samples.length / this.channels);
    if (frameCount === 0) return;
    const planar = [];
    for (let channel = 0; channel < this.channels; channel += 1) {
      const buffer = new Float64Array(frameCount);
      for (let frame = 0; frame < frameCount; frame += 1) {
        buffer[frame] = samples[frame * this.channels + channel];
      }
      planar.push(buffer);
    }
    this.push(planar);
  }
  ensureScratch(channel, frameCount) {
    let buffer = this.scratch[channel];
    if (buffer.length < frameCount) {
      buffer = new Float64Array(frameCount);
      this.scratch[channel] = buffer;
    }
    return buffer.length === frameCount ? buffer : buffer.subarray(0, frameCount);
  }
  /** Roll the filtered scratch buffers into 100 ms sub-block energies. */
  accumulate(frameCount) {
    let offset = 0;
    while (offset < frameCount) {
      const take = Math.min(this.subBlockFrames - this.pendingFrames, frameCount - offset);
      for (let channel = 0; channel < this.channels; channel += 1) {
        const buffer = this.scratch[channel];
        let sum = 0;
        for (let i = offset; i < offset + take; i += 1) {
          const value = buffer[i];
          sum += value * value;
        }
        this.pendingSums[channel] = this.pendingSums[channel] + sum;
      }
      this.pendingFrames += take;
      offset += take;
      if (this.pendingFrames === this.subBlockFrames) this.closeSubBlock();
    }
  }
  closeSubBlock() {
    let weighted = 0;
    for (let channel = 0; channel < this.channels; channel += 1) {
      weighted += this.channelWeights[channel] * this.pendingSums[channel];
      this.pendingSums[channel] = 0;
    }
    this.pendingFrames = 0;
    this.subBlockSums.push(weighted);
    this.runningMomentary += weighted;
    this.runningShortTerm += weighted;
    const count = this.subBlockSums.length;
    if (count > SUB_BLOCKS_PER_MOMENTARY) {
      this.runningMomentary -= this.subBlockSums[count - 1 - SUB_BLOCKS_PER_MOMENTARY];
    }
    if (count > SUB_BLOCKS_PER_SHORT_TERM) {
      this.runningShortTerm -= this.subBlockSums[count - 1 - SUB_BLOCKS_PER_SHORT_TERM];
    }
    if (count >= SUB_BLOCKS_PER_MOMENTARY) {
      this.momentaryPowers.push(
        this.runningMomentary / (SUB_BLOCKS_PER_MOMENTARY * this.subBlockFrames)
      );
    }
    if (count >= SUB_BLOCKS_PER_SHORT_TERM) {
      this.shortTermPowers.push(
        this.runningShortTerm / (SUB_BLOCKS_PER_SHORT_TERM * this.subBlockFrames)
      );
    }
  }
  /** Loudness of the most recent complete 400 ms block. */
  get momentaryLufs() {
    const last = this.momentaryPowers.at(-1);
    return last === void 0 ? Number.NEGATIVE_INFINITY : powerToLufs(last);
  }
  /** Loudness of the most recent complete 3 s window. */
  get shortTermLufs() {
    const last = this.shortTermPowers.at(-1);
    return last === void 0 ? Number.NEGATIVE_INFINITY : powerToLufs(last);
  }
  get momentaryMaxLufs() {
    return powerToLufs(maxOf(this.momentaryPowers));
  }
  get shortTermMaxLufs() {
    return powerToLufs(maxOf(this.shortTermPowers));
  }
  /** Gated integrated loudness over everything pushed so far. */
  get integratedLufs() {
    return this.gatedIntegrated().lufs;
  }
  /** EBU Tech 3342 loudness range, in LU. */
  get loudnessRangeLu() {
    const values = this.shortTermPowers;
    if (values.length < 2) return 0;
    const aboveAbsolute = values.filter((power) => powerToLufs(power) > ABSOLUTE_GATE_LUFS);
    if (aboveAbsolute.length < 2) return 0;
    const relativeGate = powerToLufs(mean(aboveAbsolute)) + LRA_RELATIVE_GATE_LU;
    const gated = aboveAbsolute.map(powerToLufs).filter((lufs) => lufs >= relativeGate).sort((a, b) => a - b);
    if (gated.length < 2) return 0;
    return percentile(gated, 0.95) - percentile(gated, 0.1);
  }
  get truePeakDbtp() {
    if (!this.truePeakDetectors) return Number.NaN;
    let peak = 0;
    for (const detector of this.truePeakDetectors) peak = Math.max(peak, detector.linearPeak);
    return linearToDb(peak);
  }
  get samplePeakDbfs() {
    let peak = 0;
    for (const value of this.channelSamplePeaks) peak = Math.max(peak, value);
    return linearToDb(peak);
  }
  get channelTruePeaksDbtp() {
    if (!this.truePeakDetectors) {
      return Array.from(this.channelSamplePeaks, (value) => linearToDb(value));
    }
    return this.truePeakDetectors.map((detector) => linearToDb(detector.linearPeak));
  }
  get frameCount() {
    return this.totalFrames;
  }
  /** Everything the meter knows, as one self-describing receipt. */
  result() {
    const { lufs, blocksUsed, relativeGateLufs } = this.gatedIntegrated();
    const truePeakDbtp = this.truePeakDbtp;
    return {
      version: LOUDNESS_FORMAT_VERSION,
      integratedLufs: lufs,
      loudnessRangeLu: this.loudnessRangeLu,
      momentaryMaxLufs: this.momentaryMaxLufs,
      shortTermMaxLufs: this.shortTermMaxLufs,
      truePeakDbtp,
      samplePeakDbfs: this.samplePeakDbfs,
      crestDb: Number.isFinite(truePeakDbtp) && Number.isFinite(lufs) ? truePeakDbtp - lufs : NaN,
      channelTruePeaksDbtp: this.channelTruePeaksDbtp,
      sampleRateHz: this.sampleRateHz,
      channels: this.channels,
      frameCount: this.totalFrames,
      durationMs: this.totalFrames / this.sampleRateHz * 1e3,
      gating: {
        absoluteGateLufs: ABSOLUTE_GATE_LUFS,
        relativeGateLufs,
        blocksUsed,
        blocksTotal: this.momentaryPowers.length
      }
    };
  }
  reset() {
    this.subBlockSums.length = 0;
    this.pendingSums.fill(0);
    this.pendingFrames = 0;
    this.momentaryPowers = [];
    this.shortTermPowers = [];
    this.runningMomentary = 0;
    this.runningShortTerm = 0;
    this.totalFrames = 0;
    this.channelSamplePeaks = new Float64Array(this.channels);
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.preFilterStates[channel] = createBiquadState();
      this.highPassStates[channel] = createBiquadState();
      this.truePeakDetectors?.[channel]?.reset();
    }
  }
  gatedIntegrated() {
    const powers = this.momentaryPowers;
    if (powers.length === 0) {
      return { lufs: Number.NEGATIVE_INFINITY, blocksUsed: 0, relativeGateLufs: null };
    }
    const aboveAbsolute = powers.filter((power) => powerToLufs(power) > ABSOLUTE_GATE_LUFS);
    if (aboveAbsolute.length === 0) {
      return { lufs: Number.NEGATIVE_INFINITY, blocksUsed: 0, relativeGateLufs: null };
    }
    const relativeGateLufs = powerToLufs(mean(aboveAbsolute)) + RELATIVE_GATE_LU;
    const gated = aboveAbsolute.filter((power) => powerToLufs(power) > relativeGateLufs);
    if (gated.length === 0) {
      return { lufs: Number.NEGATIVE_INFINITY, blocksUsed: 0, relativeGateLufs };
    }
    return { lufs: powerToLufs(mean(gated)), blocksUsed: gated.length, relativeGateLufs };
  }
};
function powerToLufs(power) {
  if (!(power > 0)) return Number.NEGATIVE_INFINITY;
  return LOUDNESS_OFFSET_DB + 10 * Math.log10(power);
}
function maxOf(values) {
  let max = 0;
  for (const value of values) if (value > max) max = value;
  return max;
}
function mean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

// src/analyze.ts
function analyzeLoudness(channels, options) {
  if (channels.length === 0) throw new RangeError("at least one channel is required");
  const meter = new LoudnessMeter({ ...options, channels: channels.length });
  const chunkFrames = Math.max(meter.subBlockFrames, 1 << 16);
  const frameCount = channels[0]?.length ?? 0;
  for (let offset = 0; offset < frameCount; offset += chunkFrames) {
    const take = Math.min(chunkFrames, frameCount - offset);
    meter.push(channels.map((channel) => sliceOf(channel, offset, take)));
  }
  return meter.result();
}
function sliceOf(channel, offset, length) {
  if (ArrayBuffer.isView(channel) && "subarray" in channel) {
    return channel.subarray(offset, offset + length);
  }
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) out[i] = channel[offset + i];
  return out;
}

// src/targets.ts
var TARGETS = {
  /** EBU R128 — European broadcast. */
  "ebu-r128": {
    label: "EBU R128",
    lufs: -23,
    truePeakDbtp: -1,
    source: "EBU R128 (2020): programme loudness \u221223 LUFS, max true peak \u22121 dBTP"
  },
  /** ATSC A/85 — North American broadcast. */
  "atsc-a85": {
    label: "ATSC A/85",
    lufs: -24,
    truePeakDbtp: -2,
    source: "ATSC A/85: anchor loudness \u221224 LKFS, max true peak \u22122 dBTP"
  },
  /** The de-facto music-streaming normalisation point. */
  streaming: {
    label: "Streaming (music)",
    lufs: -14,
    truePeakDbtp: -1,
    source: "Common playback-normalisation target across music streaming services"
  },
  /** Apple Music's Sound Check reference. */
  "apple-music": {
    label: "Apple Music",
    lufs: -16,
    truePeakDbtp: -1,
    source: "Apple Digital Masters guidance: \u221216 LUFS reference, \u22121 dBTP ceiling"
  },
  /** Spoken-word delivery. */
  podcast: {
    label: "Podcast",
    lufs: -16,
    truePeakDbtp: -1,
    source: "AES TD1004 recommends \u221216 LUFS for stereo podcast delivery"
  }
};
function resolveTarget(target) {
  if (typeof target === "string") {
    const found = TARGETS[target];
    if (!found) throw new RangeError(`unknown target: ${target}`);
    return found;
  }
  return target;
}
function planNormalization(result, target = "streaming") {
  const resolved = resolveTarget(target);
  const { integratedLufs, truePeakDbtp } = result;
  if (!Number.isFinite(integratedLufs)) {
    return {
      target: resolved,
      loudnessGainDb: 0,
      gainDb: 0,
      resultingTruePeakDbtp: truePeakDbtp,
      resultingLufs: integratedLufs,
      peakLimited: false,
      limiterGainReductionDb: 0,
      summary: "programme is silent \u2014 nothing to normalise"
    };
  }
  const loudnessGainDb = resolved.lufs - integratedLufs;
  const peakHeadroomDb = Number.isFinite(truePeakDbtp) ? resolved.truePeakDbtp - truePeakDbtp : Number.POSITIVE_INFINITY;
  const gainDb = Math.min(loudnessGainDb, peakHeadroomDb);
  const peakLimited = gainDb < loudnessGainDb - 1e-9;
  const limiterGainReductionDb = peakLimited ? loudnessGainDb - gainDb : 0;
  return {
    target: resolved,
    loudnessGainDb,
    gainDb,
    resultingTruePeakDbtp: truePeakDbtp + gainDb,
    resultingLufs: integratedLufs + gainDb,
    peakLimited,
    limiterGainReductionDb,
    summary: peakLimited ? `apply ${formatDb(gainDb)} to reach ${resolved.truePeakDbtp} dBTP; ${formatDb(limiterGainReductionDb)} more needs a limiter to hit ${resolved.lufs} LUFS` : `apply ${formatDb(gainDb)} \u2014 lands on ${resolved.lufs} LUFS at ${(truePeakDbtp + gainDb).toFixed(1)} dBTP`
  };
}
function planGainFactor(plan) {
  return dbToLinear(plan.gainDb);
}
function applyGain(channels, gainDb) {
  const factor = dbToLinear(gainDb);
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) channel[i] = channel[i] * factor;
  }
}
function formatDb(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

// src/wav.ts
var FORMAT_PCM = 1;
var FORMAT_FLOAT = 3;
var FORMAT_EXTENSIBLE = 65534;
function readFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}
function decodeWav(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") {
    throw new TypeError("decodeWav: not a RIFF/WAVE file");
  }
  let formatCode = 0;
  let channels = 0;
  let sampleRateHz = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      formatCode = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRateHz = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      if (formatCode === FORMAT_EXTENSIBLE && chunkSize >= 26) {
        formatCode = view.getUint16(body + 24, true);
      }
    } else if (chunkId === "data") {
      dataOffset = body;
      dataLength = Math.min(chunkSize, bytes.byteLength - body);
    }
    offset = body + chunkSize + (chunkSize & 1);
  }
  if (channels < 1 || channels > 64) throw new TypeError("decodeWav: unsupported channel count");
  if (sampleRateHz < 1) throw new TypeError("decodeWav: missing sample rate");
  if (dataOffset < 0) throw new TypeError("decodeWav: no data chunk");
  const bytesPerSample = bitsPerSample >> 3;
  if (bytesPerSample < 1) throw new TypeError("decodeWav: unsupported bit depth");
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataLength / frameSize);
  if (frameCount < 1) throw new TypeError("decodeWav: empty data chunk");
  const out = [];
  for (let channel = 0; channel < channels; channel += 1) out.push(new Float32Array(frameCount));
  const readSample = sampleReader(view, formatCode, bitsPerSample);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const base = dataOffset + frame * frameSize;
    for (let channel = 0; channel < channels; channel += 1) {
      out[channel][frame] = readSample(base + channel * bytesPerSample);
    }
  }
  return { channels: out, sampleRateHz, frameCount };
}
function sampleReader(view, formatCode, bitsPerSample) {
  if (formatCode === FORMAT_FLOAT) {
    if (bitsPerSample === 32) return (o) => view.getFloat32(o, true);
    if (bitsPerSample === 64) return (o) => view.getFloat64(o, true);
    throw new TypeError("decodeWav: unsupported float bit depth");
  }
  if (formatCode === FORMAT_PCM) {
    if (bitsPerSample === 8) return (o) => (view.getUint8(o) - 128) / 128;
    if (bitsPerSample === 16) return (o) => view.getInt16(o, true) / 32768;
    if (bitsPerSample === 24) {
      return (o) => {
        const raw = view.getUint8(o) | view.getUint8(o + 1) << 8 | view.getUint8(o + 2) << 16;
        const signed = raw & 8388608 ? raw - 16777216 : raw;
        return signed / 8388608;
      };
    }
    if (bitsPerSample === 32) return (o) => view.getInt32(o, true) / 2147483648;
    throw new TypeError("decodeWav: unsupported PCM bit depth");
  }
  throw new TypeError(`decodeWav: unsupported WAV format 0x${formatCode.toString(16)}`);
}
function loudnessFromWav(input, options = {}) {
  const { channels, sampleRateHz } = decodeWav(input);
  return analyzeLoudness(channels, { ...options, sampleRateHz });
}
function encodeWav(channels, sampleRateHz, options = {}) {
  const float = options.format === "float32";
  const bytesPerSample = float ? 4 : 2;
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset2, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset2 + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = channels[channel][frame];
      if (float) {
        view.setFloat32(offset, value, true);
      } else {
        view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
      }
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}

// src/ebu.ts
function levelSteppedSine(segments, options = {}) {
  const sampleRateHz = options.sampleRateHz ?? 48e3;
  const frequencyHz = options.frequencyHz ?? 1e3;
  const channelCount = options.channels ?? 2;
  const totalFrames = segments.reduce(
    (frames, segment) => frames + Math.round(segment.seconds * sampleRateHz),
    0
  );
  const mono = new Float32Array(totalFrames);
  const step = 2 * Math.PI * frequencyHz / sampleRateHz;
  let frame = 0;
  for (const segment of segments) {
    const frames = Math.round(segment.seconds * sampleRateHz);
    const amplitude = segment.peakDbfs === null ? 0 : 10 ** (segment.peakDbfs / 20);
    for (let i = 0; i < frames; i += 1, frame += 1) {
      mono[frame] = amplitude * Math.sin(step * frame);
    }
  }
  const channels = Array.from({ length: channelCount }, () => mono.slice());
  return { channels, sampleRateHz };
}
function steadySine(peakDbfs, seconds, options = {}) {
  return levelSteppedSine([{ seconds, peakDbfs }], options);
}
var FIVE_ONE = [
  "left",
  "right",
  "centre",
  "lfe",
  "leftSurround",
  "rightSurround"
];
var COMPLIANCE_CASES = [
  {
    id: "3341-1",
    standard: "EBU Tech 3341",
    description: "stereo 1 kHz sine at \u221223 dBFS, 20 s",
    expected: { integratedLufs: -23, toleranceLu: 0.1 },
    build: (sampleRateHz = 48e3) => steadySine(-23, 20, { sampleRateHz })
  },
  {
    id: "3341-2",
    standard: "EBU Tech 3341",
    description: "stereo 1 kHz sine at \u221233 dBFS, 20 s",
    expected: { integratedLufs: -33, toleranceLu: 0.1 },
    build: (sampleRateHz = 48e3) => steadySine(-33, 20, { sampleRateHz })
  },
  {
    id: "3341-3",
    standard: "EBU Tech 3341",
    description: "\u221236 dBFS 10 s, \u221223 dBFS 60 s, \u221236 dBFS 10 s (relative gate keeps the loud part)",
    expected: { integratedLufs: -23, toleranceLu: 0.1 },
    build: (sampleRateHz = 48e3) => levelSteppedSine(
      [
        { seconds: 10, peakDbfs: -36 },
        { seconds: 60, peakDbfs: -23 },
        { seconds: 10, peakDbfs: -36 }
      ],
      { sampleRateHz }
    )
  },
  {
    id: "3341-4",
    standard: "EBU Tech 3341",
    description: "\u221272 dBFS 10 s, \u221223 dBFS 60 s, \u221272 dBFS 10 s (absolute gate drops the quiet part)",
    expected: { integratedLufs: -23, toleranceLu: 0.1 },
    build: (sampleRateHz = 48e3) => levelSteppedSine(
      [
        { seconds: 10, peakDbfs: -72 },
        { seconds: 60, peakDbfs: -23 },
        { seconds: 10, peakDbfs: -72 }
      ],
      { sampleRateHz }
    )
  },
  {
    id: "3341-5",
    standard: "EBU Tech 3341",
    description: "\u221226 dBFS 20 s, \u221220 dBFS 20.1 s, \u221226 dBFS 20 s",
    expected: { integratedLufs: -23, toleranceLu: 0.1 },
    build: (sampleRateHz = 48e3) => levelSteppedSine(
      [
        { seconds: 20, peakDbfs: -26 },
        { seconds: 20.1, peakDbfs: -20 },
        { seconds: 20, peakDbfs: -26 }
      ],
      { sampleRateHz }
    )
  },
  {
    id: "3341-6",
    standard: "EBU Tech 3341",
    description: "5.1: L/R \u221228 dBFS, C \u221224 dBFS, LFE silent, Ls/Rs \u221230 dBFS (surround weighting)",
    expected: { integratedLufs: -23, toleranceLu: 0.1 },
    build: (sampleRateHz = 48e3) => {
      const levels = [-28, -28, -24, null, -30, -30];
      const channels = levels.map((peakDbfs) => {
        const programme = levelSteppedSine([{ seconds: 20, peakDbfs }], {
          sampleRateHz,
          channels: 1
        });
        return programme.channels[0];
      });
      return { channels, sampleRateHz, channelRoles: FIVE_ONE };
    }
  },
  {
    id: "3342-1",
    standard: "EBU Tech 3342",
    description: "20 s at \u221220 LUFS then 20 s at \u221230 LUFS \u2192 10 LU of range",
    expected: { loudnessRangeLu: 10, toleranceLu: 1 },
    build: (sampleRateHz = 48e3) => levelSteppedSine(
      [
        { seconds: 20, peakDbfs: -20 },
        { seconds: 20, peakDbfs: -30 }
      ],
      { sampleRateHz }
    )
  },
  {
    id: "3342-2",
    standard: "EBU Tech 3342",
    description: "20 s at \u221220 LUFS then 20 s at \u221215 LUFS \u2192 5 LU of range",
    expected: { loudnessRangeLu: 5, toleranceLu: 1 },
    build: (sampleRateHz = 48e3) => levelSteppedSine(
      [
        { seconds: 20, peakDbfs: -20 },
        { seconds: 20, peakDbfs: -15 }
      ],
      { sampleRateHz }
    )
  }
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ABSOLUTE_GATE_LUFS,
  CHANNEL_LAYOUTS,
  CHANNEL_WEIGHTS,
  COMPLIANCE_CASES,
  LOUDNESS_FORMAT_VERSION,
  LOUDNESS_OFFSET_DB,
  LRA_RELATIVE_GATE_LU,
  LoudnessMeter,
  RELATIVE_GATE_LU,
  TARGETS,
  TruePeakDetector,
  analyzeLoudness,
  applyGain,
  biquadMagnitudeDb,
  dbToLinear,
  decodeWav,
  defaultOversampleFactor,
  defaultRolesFor,
  designHighPass,
  designKWeighting,
  designPolyphaseInterpolator,
  designPreFilter,
  encodeWav,
  kWeightingMagnitudeDb,
  levelSteppedSine,
  linearToDb,
  loudnessFromWav,
  planGainFactor,
  planNormalization,
  powerToLufs,
  resolveTarget,
  resolveWeights,
  steadySine,
  weightsFor
});
//# sourceMappingURL=index.cjs.map