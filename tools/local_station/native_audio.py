"""Optional local WASAPI host. The browser supplies rendered assets, never code.

One full-duplex stream owns playback and capture frame numbers. IPC arrival time
is not an audio timestamp. Microphone input is never routed to the output.
"""
import json
import math
from pathlib import Path
import queue
import secrets
import shutil
import struct
import sys
import threading
import time
import wave

RATE = 48000
RING_SECONDS = 12
MAX_ASSET_BYTES = 768 * 1024**2


def require_unprocessed_input(config):
    endpoint = config.get('inputEndpointId')
    if not endpoint:
        return
    if sys.platform != 'win32' or len(endpoint) != 38 or any(c not in '{}-0123456789abcdefABCDEF' for c in endpoint):
        raise RuntimeError('Cannot verify the configured Windows microphone endpoint.')
    import winreg
    path = '\\'.join([r'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture', endpoint, 'FxProperties'])
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as key:
            disabled, _ = winreg.QueryValueEx(key, '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5')
    except OSError as error:
        raise RuntimeError('Cannot verify Samson input enhancements. Check Windows Sound settings before recording.') from error
    if disabled != 1:
        raise RuntimeError('Windows microphone enhancements are enabled. Set Samson Audio enhancements to Off before recording.')
    return True


def finite(value, low, high):
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Invalid native audio parameter')
    return value


class Timeline:
    """Pure frame accounting, also tested without Windows or an audio device."""
    def __init__(self):
        self.frame = 0
        self.anchor = 0
        self.position = 0.
        self.rate = 1.
        self.playing = False

    def at(self, frame=None):
        return self.position + ((self.frame if frame is None else frame)-self.anchor)/RATE*self.rate if self.playing else self.position

    def play(self, position, rate):
        self.position = finite(position, -120, 1200)
        self.rate = finite(rate, .25, 1.5)
        self.anchor = self.frame
        self.playing = True
        return self.anchor

    def pause(self):
        self.position = self.at()
        self.anchor = self.frame
        self.playing = False


class NativeAudio:
    def __init__(self, state, config, watchdog=True):
        import numpy as np
        import sounddevice as sd
        self.np, self.sd = np, sd
        self.state, self.config = Path(state), config
        self.use_watchdog = watchdog
        self.lock = threading.RLock()
        self.session = None
        self.stream = None
        self.timeline = Timeline()
        self.assets, self.pending = {}, {}
        self.ring = np.zeros(RATE*RING_SECONDS, dtype='float32')
        self.events = []
        self.sequence = 0
        self.fault = None
        self.settings = {'gains': [], 'pans': [], 'metronome': 0, 'recordings': 1}
        self.active_assets = {}
        self.boundary = 1200.
        self.loop = None
        self.recording = None
        self.stop_at = None
        self.last_seen = 0
        self.last_callback = 0
        self.output_latency = 0
        self.writer = None
        self.last_peak = 0
        self.output_rms = 0
        self.output_peak = 0
        self.limited_frames = 0
        self.previews = {}
        self.input_enhancements_verified = None

    def devices(self):
        apis = self.sd.query_hostapis()
        api = next(i for i, a in enumerate(apis) if a['name'] == 'Windows WASAPI')
        devices = list(self.sd.query_devices())
        result = []
        for direction in ['input', 'output']:
            name = self.config[direction]
            matches = [(i, d) for i, d in enumerate(devices) if d['hostapi'] == api
                       and d['name'] == name and d['max_'+direction+'_channels'] >= 2]
            if len(matches) != 1:
                raise RuntimeError('The calibrated '+direction+' is unavailable. No substitute device was selected.')
            result.append(matches[0])
        return result

    def open(self, client):
        with self.lock:
            if self.session:
                if self.client != client:
                    raise RuntimeError('Another Melete song/tab owns native audio. Stop it first.')
                self.last_seen = time.monotonic()
                return self.status()
            self.input_enhancements_verified = require_unprocessed_input(self.config)
            self.devices_info = self.devices()
            self.timeline = Timeline()
            self.events, self.sequence, self.fault = [], 0, None
            self.assets, self.pending, self.active_assets = {}, {}, {}
            self.previews = {}
            self.limited_frames = 0
            self.ring.fill(0)
            self.session, self.client = secrets.token_hex(24), str(client)
            self.last_seen = time.monotonic()
            extra = self.sd.WasapiSettings(exclusive=True, auto_convert=False)
            try:
                self.stream = self.sd.Stream(samplerate=RATE, channels=(2, 2), dtype='float32',
                    device=tuple(row[0] for row in self.devices_info), blocksize=0, latency='low',
                    extra_settings=(extra, extra), callback=self.callback)
                latency = list(self.stream.latency)
                expected = self.config['reportedLatencySeconds']
                if any(abs(a-b) > .00001 for a, b in zip(latency, expected)):
                    raise RuntimeError('Native buffer settings changed. Measure this route before recording.')
                self.output_latency = latency[1]
                self.stream.start()
            except Exception:
                if self.stream:
                    self.stream.close()
                self.stream = self.session = None
                raise
            if self.use_watchdog:
                threading.Thread(target=self.watchdog, args=(self.session,), daemon=True).start()
            return self.status()

    def require(self, session):
        if not self.session or session != self.session:
            raise ValueError('Native session expired')
        self.last_seen = time.monotonic()

    def watchdog(self, session):
        while self.session == session:
            time.sleep(.5)
            if time.monotonic()-self.last_seen > 5:
                self.close(session)
                break

    def event(self, kind, frame, **data):
        self.sequence += 1
        self.events.append(dict(sequence=self.sequence, kind=kind, frame=frame, **data))
        self.events = self.events[-100:]

    def status(self):
        t = self.timeline
        return dict(session=self.session, frame=t.frame, anchor=t.anchor, position=t.at(),
                    base=t.position, rate=t.rate, playing=t.playing, sampleRate=RATE,
                    latency=self.config['seconds'], outputLatency=self.output_latency,
                    callbackAge=max(0, time.monotonic()-self.last_callback), fault=self.fault,
                    peak=self.last_peak, events=list(self.events), stopFrame=self.stop_at,
                    input=self.config['input'], output=self.config['output'],
                    calibration=self.config.get('measuredAt'), spreadMs=self.config.get('spreadMs'),
                    residualMs=self.config.get('residualMs'), outputRms=self.output_rms,
                    outputPeak=self.output_peak, limitedFrames=self.limited_frames, backend='WASAPI exclusive',
                    recording=self.recording is not None)

    def poll(self, session, since):
        with self.lock:
            self.require(session)
            end = self.timeline.frame
            since = int(since)
            if since < max(0, end-len(self.ring)) or since > end:
                raise RuntimeError('Native capture delivery fell behind. Audio backup is retained; timing was not guessed.')
            count = end-since
            start = since % len(self.ring)
            data = self.np.concatenate((self.ring[start:min(start+count, len(self.ring))], self.ring[:max(0, start+count-len(self.ring))]))
            status = self.status()
            status['firstFrame'] = since
            header = json.dumps(status, separators=(',', ':')).encode()
            padding = (-len(header)) % 4
            header += b' '*padding
            return struct.pack('<I', len(header))+header+data.astype('<f4', copy=False).tobytes()

    def asset(self, session, key, offset, data, descriptor=None):
        with self.lock:
            self.require(session)
        if not key or len(key) > 80 or not all(c.isalnum() or c in '-_' for c in key):
            raise ValueError('Invalid asset identity')
        if descriptor is not None:
            channels = int(finite(descriptor['channels'], 1, 32))
            frames = int(finite(descriptor['frames'], 1, RATE*1200))
            size = frames*channels*4
            with self.lock:
                current = sum(a['pcm'].nbytes for a in self.assets.values())+sum(a['expected'] for a in self.pending.values())
            if current+size > MAX_ASSET_BYTES:
                raise ValueError('Native asset limit exceeded')
            # NumPy copies release the GIL. Growing a Python bytearray here can
            # block a 10 ms callback when the larger score needs reallocation.
            self.pending[key] = dict(pcm=self.np.empty((frames, channels), dtype='<f4'),
                received=0, expected=size, channels=channels,
                sampleRate=finite(descriptor['sampleRate'], 8000, RATE),
                origin=finite(descriptor['origin'], -120, 1200), rate=finite(descriptor['rate'], .25, 1.5))
        target = self.pending.get(key)
        if target is None or int(offset) != target['received'] or offset % 4 or len(data) % 4 or offset+len(data) > target['expected']:
            raise ValueError('Out-of-order native asset')
        self.np.copyto(target['pcm'].reshape(-1)[offset//4:(offset+len(data))//4], self.np.frombuffer(data, dtype='<f4'))
        target['received'] += len(data)
        if target['received'] != target['expected']:
            return
        pcm = target['pcm']
        if not self.np.all(self.np.isfinite(pcm)) or self.np.max(self.np.abs(pcm)) > 20:
            del self.pending[key]
            raise ValueError('Invalid audio samples')
        with self.lock:
            self.require(session)
            del self.pending[key]
            self.assets[key] = target

    def command(self, session, command):
        with self.lock:
            self.require(session)
            kind = command['kind']
            if kind == 'mix':
                gains = [finite(x, 0, 2) for x in command['gains']]
                pans = [finite(x, -1, 1) for x in command['pans']]
                if len(gains) != len(pans) or len(gains) > 24:
                    raise ValueError('Invalid native mixer')
                self.settings = dict(gains=gains, pans=pans,
                    metronome=finite(command['metronome'], 0, 4), recordings=finite(command.get('recordings', 1), 0, 2))
            elif kind == 'assets':
                assets = command['assets']
                if set(assets)-{'guide', 'recordings', 'reference'} or any(v not in self.assets for v in assets.values()):
                    raise ValueError('Missing native assets')
                self.active_assets = dict(assets)
                self.assets = {key: value for key, value in self.assets.items() if key in assets.values() or key in self.previews}
            elif kind == 'play':
                if self.fault:
                    raise RuntimeError(self.fault)
                rate = finite(command['rate'], .25, 1.5)
                if 'guide' not in self.active_assets or any(abs(self.assets[v]['rate']-rate) > 1e-6 for v in self.active_assets.values()):
                    raise ValueError('Native assets do not match playback speed')
                self.boundary = finite(command['end'], 0, 1200)
                self.loop = finite(command['loopStart'], -120, self.boundary) if command.get('loopStart') is not None else None
                if self.loop is not None and self.loop >= self.boundary:
                    raise ValueError('Invalid native loop')
                if command.get('record'):
                    self.begin_backup(command.get('label', {}))
                frame = self.timeline.play(command['position'], rate)
                self.stop_at = None
                self.event('play', frame, position=self.timeline.position)
            elif kind == 'pause':
                self.timeline.pause()
                self.stop_at = self.timeline.frame + math.ceil((self.config['seconds']+.025)*RATE)
                self.event('pause', self.timeline.frame, position=self.timeline.position)
            elif kind == 'range':
                self.boundary = finite(command['end'], 0, 1200)
                self.loop = finite(command['loopStart'], -120, self.boundary) if command.get('loopStart') is not None else None
                if self.loop is not None and self.loop >= self.boundary:
                    raise ValueError('Invalid native loop')
            elif kind == 'preview':
                key = command['key']
                if key not in self.assets or len(self.previews) >= 16:
                    raise ValueError('Native preview unavailable')
                self.previews[key] = dict(anchor=self.timeline.frame, release=None,
                    gain=finite(command.get('gain', 1), 0, 2), pan=finite(command.get('pan', 0), -1, 1))
            elif kind == 'release':
                if command['key'] in self.previews:
                    self.previews[command['key']]['release'] = self.timeline.frame
            elif kind == 'close':
                pass
            elif kind == 'calibration':
                if self.timeline.playing or self.recording:
                    raise RuntimeError('Stop recording before updating timing')
                result = command['result']
                config = dict(self.config, seconds=finite(result['seconds'], 0, .5),
                    spreadMs=finite(result['spreadMs'], 0, 10), residualMs=finite(result['residualMs'], -10, 10),
                    measuredAt=finite(result['measuredAt'], 1, 1e14))
                path = self.state/'native-audio.json'
                temporary = path.with_suffix('.pending')
                temporary.write_text(json.dumps(config, indent=2)+'\n', encoding='utf-8')
                temporary.replace(path)
                self.config = config
            else:
                raise ValueError('Unknown native command')
            return self.status()

    def samples(self, key, positions):
        asset = self.assets[self.active_assets[key]]
        pcm = asset['pcm']
        location = (positions-asset['origin'])/asset['rate']*asset['sampleRate']
        valid = (location >= 0) & (location < len(pcm)-1)
        first = self.np.clip(location.astype('int64'), 0, len(pcm)-1)
        last = self.np.minimum(first+1, len(pcm)-1)
        fraction = self.np.clip(location-first, 0, 1)[:, None]
        return ((pcm[first]*(1-fraction)+pcm[last]*fraction)*valid[:, None]).astype('float32')

    def mix(self, positions):
        np = self.np
        mixed = np.zeros((len(positions), 2), dtype='float32')
        if 'guide' in self.active_assets:
            guide = self.samples('guide', positions)
            for c, (gain, pan) in enumerate(zip(self.settings['gains'], self.settings['pans'])):
                if c >= guide.shape[1]-1:
                    break
                mixed[:, 0] += guide[:, c]*gain*math.cos((pan+1)*math.pi/4)*.92
                mixed[:, 1] += guide[:, c]*gain*math.sin((pan+1)*math.pi/4)*.92
            mixed += guide[:, -1, None]*self.settings['metronome']*.92/math.sqrt(2)
        for key in ('recordings', 'reference'):
            if key in self.active_assets:
                mixed += self.samples(key, positions)* (self.settings['recordings'] if key == 'recordings' else 1)
        return mixed

    def callback(self, indata, outdata, frames, clock, status):
        try:
            self.process(indata, outdata, frames, status)
        except Exception as error:
            outdata.fill(0)
            self.fault = 'Native audio callback failed: '+str(error)
            self.timeline.pause()

    def process(self, indata, outdata, frames, status):
        with self.lock:
            np, t = self.np, self.timeline
            outdata.fill(0)
            if status:
                self.fault = 'Native audio discontinuity: '+str(status)
                t.pause()
                self.event('fault', t.frame, message=self.fault)
            if frames != self.config['callbackFrames']:
                self.fault = 'Native callback size changed; calibration is no longer valid.'
                t.pause()
            mono = indata[:, int(self.config.get('inputChannel', 0))]
            self.last_peak = float(np.max(np.abs(mono)))
            start = t.frame % len(self.ring)
            n = min(frames, len(self.ring)-start)
            self.ring[start:start+n] = mono[:n]
            if n < frames:
                self.ring[:frames-n] = mono[n:]
            if self.recording is not None:
                try:
                    self.recording['queue'].put_nowait((t.frame, mono.copy()))
                except queue.Full:
                    self.fault = 'Native audio backup could not keep up. Recording stopped.'
                    t.pause()
                    self.finish_backup()
            cursor = 0
            while t.playing and cursor < frames:
                frame = t.frame+cursor
                position = t.at(frame)
                remaining = max(0, math.ceil((self.boundary-position)/t.rate*RATE-1e-7))
                count = min(frames-cursor, remaining)
                if count:
                    positions = position+np.arange(count)/RATE*t.rate
                    outdata[cursor:cursor+count] = self.mix(positions)
                    cursor += count
                if count == remaining:
                    if self.loop is not None:
                        t.position, t.anchor = self.loop, t.frame+cursor
                        self.event('loop', t.anchor, position=self.loop)
                    else:
                        t.playing, t.position = False, self.boundary
                        self.stop_at = t.frame+cursor+math.ceil((self.config['seconds']+.025)*RATE)
                        self.event('end', t.frame+cursor, position=self.boundary)
                elif count == 0:
                    break
            t.frame += frames
            for key, voice in list(self.previews.items()):
                asset = self.assets[key]
                elapsed = (self.np.arange(frames)+t.frame-frames-voice['anchor'])/RATE
                index = self.np.clip((elapsed*asset['sampleRate']).astype('int64'), 0, len(asset['pcm'])-1)
                sound = asset['pcm'][index]*voice['gain']
                if voice['release'] is not None:
                    sound *= self.np.clip(1-(self.np.arange(frames)+t.frame-frames-voice['release'])/(RATE*.024), 0, 1)[:, None]
                if sound.shape[1] == 2:
                    outdata += sound*.92
                else:
                    outdata[:, 0] += sound[:, 0]*math.cos((voice['pan']+1)*math.pi/4)*.92
                    outdata[:, 1] += sound[:, 0]*math.sin((voice['pan']+1)*math.pi/4)*.92
                if elapsed[-1] >= (len(asset['pcm'])-1)/asset['sampleRate'] or voice['release'] is not None and t.frame-voice['release'] >= RATE*.024:
                    del self.previews[key]
                    if key not in self.active_assets.values():
                        del self.assets[key]
            peak = float(np.max(np.abs(outdata)))
            if peak > .98:
                # Emergency linked-stereo attenuation avoids hard clipped samples.
                # Normal guide/take gain planning remains upstream.
                outdata *= .98/peak
                self.limited_frames += frames
            self.output_peak = float(np.max(np.abs(outdata)))
            self.output_rms = float(np.sqrt(np.mean(outdata*outdata)))
            self.last_callback = time.monotonic()
            if self.stop_at is not None and t.frame >= self.stop_at and self.recording is not None:
                self.finish_backup()

    def begin_backup(self, label):
        if self.recording is not None:
            raise RuntimeError('A native recording is already active')
        folder = self.state/'native-recordings'
        folder.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(folder).free < 512*1024**2:
            raise RuntimeError('Not enough disk space for a native recording. Existing recordings are retained.')
        name = time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(4)
        path = folder/(name+'.wav')
        record = dict(file=path.name, frame=self.timeline.frame, sampleRate=RATE,
                      latency=self.config['seconds'], label=label, client=self.client, backend='WASAPI exclusive',
                      input=self.config['input'], output=self.config['output'],
                      callbackFrames=self.config['callbackFrames'], calibration=self.config.get('measuredAt'),
                      windowsInputEnhancementsVerifiedOff=self.input_enhancements_verified)
        (folder/(name+'.json')).write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
        self.recording = dict(record, queue=queue.Queue(maxsize=500), done=threading.Event())
        self.writer = threading.Thread(target=self.write_backup, args=(path, self.recording), daemon=True)
        self.writer.start()

    def write_backup(self, path, record):
        try:
            with wave.open(str(path), 'wb') as out:
                out.setnchannels(1)
                out.setsampwidth(4)
                out.setframerate(RATE)
                checked = time.monotonic()
                while not record['done'].is_set() or not record['queue'].empty():
                    try:
                        item = record['queue'].get(timeout=.1)
                    except queue.Empty:
                        continue
                    if time.monotonic()-checked > 1:
                        checked = time.monotonic()
                        if shutil.disk_usage(path.parent).free < 128*1024**2:
                            raise OSError('Disk space is nearly full; existing audio retained')
                    _, pcm = item
                    out.writeframes((self.np.clip(pcm, -1, 1)*2147483647).astype('<i4').tobytes())
        except Exception as error:
            self.fault = 'Native backup failed: '+str(error)

    def finish_backup(self):
        record = self.recording
        self.recording = None
        if record:
            record['done'].set()

    def close(self, session):
        with self.lock:
            if self.session != session:
                return
            stream, self.stream = self.stream, None
            self.session = None
            if self.recording is not None:
                self.finish_backup()
        if stream:
            stream.stop()
            stream.close()
        if self.writer:
            self.writer.join(timeout=5)
        self.assets, self.pending, self.active_assets = {}, {}, {}
        self.ring.fill(0)
