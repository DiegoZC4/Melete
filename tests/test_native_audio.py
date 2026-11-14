import importlib.util
from contextlib import contextmanager
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]/'tools'/'local_station'
spec = importlib.util.spec_from_file_location('native_audio', ROOT/'native_audio.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
service_spec = importlib.util.spec_from_file_location('native_service', ROOT/'native_service.py')
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)


class NativeTimelineTests(unittest.TestCase):
    def test_optional_windows_enhancement_preflight(self):
        native.require_unprocessed_input({})
        registry = MagicMock()
        registry.REG_DWORD = 4
        config = {'inputEndpointId':'{00000000-0000-4000-8000-000000000001}',
                  'input':'Mic/Inst (Samson G-Track Pro)'}
        with patch.object(native.sys, 'platform', 'win32'), patch.dict(sys.modules, {'winreg':registry}), \
                patch.object(native, 'windows_input_endpoint', return_value=config['inputEndpointId']):
            registry.QueryValueEx.return_value = (1, 4)
            native.require_unprocessed_input(config)
            registry.QueryValueEx.return_value = (0, 4)
            with self.assertRaisesRegex(RuntimeError, 'enhancements are enabled'):
                native.require_unprocessed_input(config)
            registry.QueryValueEx.side_effect = OSError('missing endpoint')
            with self.assertRaisesRegex(RuntimeError, 'Cannot read'):
                native.require_unprocessed_input(config)
        with self.assertRaises(RuntimeError):
            native.require_unprocessed_input({'inputEndpointId':'invalid'})


class WindowsInputEndpointTests(unittest.TestCase):
    old = '{00000000-0000-4000-8000-000000000001}'
    current = '{00000000-0000-4000-8000-000000000002}'
    name = 'Mic/Inst (Samson G-Track Pro)'

    def setUp(self):
        self.config = {'inputEndpointId':self.old, 'input':self.name, 'seconds':.0405}
        self.keys = {}
        self.endpoints = []
        self.registry = types.SimpleNamespace(HKEY_LOCAL_MACHINE='HKLM', REG_DWORD=4,
            OpenKey=self.open, QueryValueEx=self.query, QueryInfoKey=lambda key:(len(self.endpoints), 0, 0),
            EnumKey=lambda key, index:self.endpoints[index])
        self.addCleanup(patch.stopall)
        patch.object(native.sys, 'platform', 'win32').start()
        patch.dict(sys.modules, {'winreg':self.registry}).start()

    @contextmanager
    def open(self, parent, child):
        path = child if parent == 'HKLM' else parent+'\\'+child
        if path != native.WINDOWS_CAPTURE and path not in self.keys:
            raise FileNotFoundError(path)
        yield path

    def query(self, key, name):
        if name not in self.keys.get(key, {}):
            raise FileNotFoundError(name)
        value = self.keys[key][name]
        if isinstance(value, Exception):
            raise value
        return value, 4 if isinstance(value, int) else 1

    def endpoint(self, endpoint, state=1, disabled=1, friendly=None, adapter='Samson G-Track Pro'):
        self.endpoints.append(endpoint)
        root = native.WINDOWS_CAPTURE+'\\'+endpoint
        self.keys[root] = {'DeviceState':state}
        self.keys[root+'\\Properties'] = {
            '{a45c254e-df1c-4efd-8020-67d146a850e0},2':'Mic/Inst',
            '{b3f8fa53-0004-438e-9003-51a46e139bfc},6':adapter}
        if friendly:
            self.keys[root+'\\Properties']['{a45c254e-df1c-4efd-8020-67d146a850e0},14'] = friendly
        self.keys[root+'\\FxProperties'] = {native.WINDOWS_DISABLE_FX:disabled}

    def test_reinstalled_input_resolves_new_guid_without_changing_calibration(self):
        self.endpoint(self.current)
        before = dict(self.config)
        self.assertTrue(native.require_unprocessed_input(self.config))
        self.assertEqual(self.config, before)

    def test_checks_current_device_not_old_disabled_enhancements(self):
        self.endpoint(self.old, state=4, disabled=1)
        self.endpoint(self.current, disabled=0)
        with self.assertRaisesRegex(RuntimeError, 'enhancements are enabled'):
            native.require_unprocessed_input(self.config)

    def test_stale_device_cannot_block_current_raw_input(self):
        self.endpoint(self.old, state=8, disabled=0)
        self.endpoint(self.current)
        self.assertTrue(native.require_unprocessed_input(self.config))

    def test_ambiguous_or_disconnected_input_is_not_guessed(self):
        self.endpoint(self.old)
        self.endpoint(self.current)
        with self.assertRaisesRegex(RuntimeError, 'uniquely identify'):
            native.require_unprocessed_input(self.config)
        for endpoint in (self.old, self.current):
            self.keys[native.WINDOWS_CAPTURE+'\\'+endpoint]['DeviceState'] = 8
        with self.assertRaisesRegex(RuntimeError, 'uniquely identify'):
            native.require_unprocessed_input(self.config)

    def test_unrelated_or_renamed_input_is_not_substituted(self):
        self.endpoint(self.current, adapter='Other USB microphone')
        with self.assertRaisesRegex(RuntimeError, 'uniquely identify'):
            native.require_unprocessed_input(self.config)
        self.endpoint(self.old, friendly='Renamed microphone')
        with self.assertRaisesRegex(RuntimeError, 'uniquely identify'):
            native.require_unprocessed_input(self.config)

    def test_explicit_friendly_name_matches(self):
        self.endpoint(self.current, friendly=self.name, adapter='Other adapter label')
        self.assertTrue(native.require_unprocessed_input(self.config))

    def test_missing_unreadable_or_malformed_fx_flag_is_not_accepted(self):
        self.endpoint(self.current)
        path = native.WINDOWS_CAPTURE+'\\'+self.current+'\\FxProperties'
        self.keys[path] = {}
        with self.assertRaisesRegex(RuntimeError, 'Cannot read'):
            native.require_unprocessed_input(self.config)
        self.keys[path][native.WINDOWS_DISABLE_FX] = PermissionError('denied')
        with self.assertRaisesRegex(RuntimeError, 'Cannot read'):
            native.require_unprocessed_input(self.config)
        self.keys[path][native.WINDOWS_DISABLE_FX] = '1'
        with self.assertRaisesRegex(RuntimeError, 'enhancements are enabled'):
            native.require_unprocessed_input(self.config)

    def test_identity_is_resolved_again_after_reconnection(self):
        self.endpoint(self.old)
        self.assertTrue(native.require_unprocessed_input(self.config))
        self.keys[native.WINDOWS_CAPTURE+'\\'+self.old]['DeviceState'] = 8
        self.endpoint(self.current, disabled=0)
        with self.assertRaisesRegex(RuntimeError, 'enhancements are enabled'):
            native.require_unprocessed_input(self.config)


class NativeTimelineBehaviorTests(unittest.TestCase):

    def test_frame_alignment_does_not_use_callback_or_network_time(self):
        t = native.Timeline()
        t.frame = 48000
        self.assertEqual(t.play(-2, 1.5), 48000)
        t.frame += 24000
        self.assertEqual(t.at(), -1.25)
        t.pause()
        t.frame += 400000
        self.assertEqual(t.at(), -1.25)

    def test_invalid_times(self):
        for value in [float('nan'), float('inf'), -200, 1500]:
            with self.assertRaises(ValueError):
                native.Timeline().play(value, 1)


class NativeAudioTests(unittest.TestCase):
    def setUp(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest('Optional native station tests need numpy')
        self.np = np
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        with patch.dict(sys.modules, {'sounddevice': types.SimpleNamespace()}):
            self.host = native.NativeAudio(Path(self.temp.name), {'seconds': .036, 'callbackFrames': 480,
                'inputChannel': 0, 'input': 'Test input', 'output': 'Test output'})
        self.host.session = 'test-session'
        self.host.client = 'test-client'

    def asset(self, key='g', channels=2):
        data = self.np.zeros((48000, channels), dtype='<f4')
        data[:, 0] = .2
        self.host.asset('test-session', key, 0, data.tobytes(), {
            'channels': channels, 'frames': len(data), 'sampleRate': 48000, 'origin': 0, 'rate': 1})
        return data

    def command(self, kind, **args):
        return self.host.command('test-session', dict(kind=kind, **args))

    def callback(self, status=''):
        inputs = self.np.tile(self.np.array([.05, -.7], dtype='float32'), (480, 1))
        output = self.np.empty((480, 2), dtype='float32')
        self.host.callback(inputs, output, 480, None, status)
        return output

    def test_failed_input_check_never_opens_the_audio_stream(self):
        self.host.session = None
        self.host.sd.Stream = MagicMock()
        with patch.object(self.host, 'devices', return_value=[]), \
                patch.object(native, 'require_unprocessed_input', side_effect=RuntimeError('enhancements are enabled')):
            with self.assertRaisesRegex(RuntimeError, 'enhancements are enabled'):
                self.host.open('new-client')
        self.host.sd.Stream.assert_not_called()
        self.assertIsNone(self.host.session)

    def test_status_reports_actual_input_check_result(self):
        self.host.input_enhancements_verified = True
        self.assertIs(self.host.status()['windowsInputEnhancementsVerifiedOff'], True)
        self.host.input_enhancements_verified = None
        self.assertIsNone(self.host.status()['windowsInputEnhancementsVerifiedOff'])

    def play(self, **kwargs):
        self.asset()
        self.command('assets', assets={'guide': 'g'})
        self.command('mix', gains=[1], pans=[1], metronome=0)
        return self.command('play', position=0, rate=1, end=.5, **kwargs)

    def test_hard_pan_and_raw_capture_have_same_frame_origin(self):
        start = self.play()
        output = self.callback()
        self.assertEqual(start['anchor'], 0)
        self.assertLess(float(self.np.max(self.np.abs(output[:, 0]))), 1e-7)
        self.assertAlmostEqual(float(output[0, 1]), .184, places=6)
        payload = self.host.poll('test-session', 0)
        n = struct.unpack_from('<I', payload)[0]
        meta = json.loads(payload[4:4+n])
        samples = self.np.frombuffer(payload, offset=4+n, dtype='<f4')
        self.assertEqual(meta['firstFrame'], 0)
        self.assertEqual(meta['frame'], 480)
        self.assertTrue(self.np.all(samples == self.np.float32(.05)))

    def test_pan_changes_preserve_recording_and_frame_continuity(self):
        self.play(record=True,label={'test':'pan'})
        for i in range(40):
            self.command('mix',gains=[1],pans=[(i%3)-1],metronome=0)
            self.callback()
        self.assertTrue(self.host.timeline.playing)
        self.assertIsNotNone(self.host.recording)
        self.assertEqual(self.host.timeline.frame,40*480)
        self.assertIsNone(self.host.fault)

    def test_audible_layers_reuse_assets_and_mix_once(self):
        self.asset('one');self.asset('two')
        state=self.command('assets',assets={'recording:0':'one','recording:1':'two'})
        self.command('mix',gains=[],pans=[],metronome=0,recordings=.5)
        out=self.host.mix(self.np.array([0]))
        self.assertAlmostEqual(float(out[0,0]),.2,places=6)
        self.command('assets',assets={})
        self.assertIn('one',self.host.assets)
        self.assertIn('two',state['cachedAssets'])
        self.command('assets',assets={'recording:0':'one'})

    def test_loop_event_uses_exact_boundary_inside_callback(self):
        self.play()
        self.host.boundary = .006
        self.host.loop = 0
        self.callback()
        self.assertEqual(self.host.events[-1]['kind'], 'loop')
        self.assertEqual(self.host.events[-1]['frame'], 288)
        self.assertAlmostEqual(self.host.timeline.at(), .004)

    def test_dropouts_stop_playback_instead_of_grading_bad_clock(self):
        self.play()
        output = self.callback('input overflow')
        self.assertFalse(self.host.timeline.playing)
        self.assertTrue(self.np.all(output == 0))
        self.assertIn('discontinuity', self.host.fault)
        with self.assertRaises(RuntimeError):
            self.command('play', position=0, rate=1, end=.5)

    def test_callback_exception_still_stops_when_a_fault_already_exists(self):
        self.play()
        self.host.fault = 'Previous failure'
        with patch.object(self.host, 'process', side_effect=ValueError('fixture')):
            output = self.callback()
        self.assertFalse(self.host.timeline.playing)
        self.assertTrue(self.np.all(output == 0))
        self.assertIn('fixture', self.host.fault)

    def test_late_consumer_is_not_given_fabricated_samples(self):
        self.host.timeline.frame = native.RATE*(native.RING_SECONDS+1)
        with self.assertRaisesRegex(RuntimeError, 'fell behind'):
            self.host.poll('test-session', 0)

    def test_asset_integrity_and_speed_guards(self):
        self.asset()
        with self.assertRaises(ValueError):
            self.host.asset('wrong-session', 'g', 0, b'1234')
        with self.assertRaises(ValueError):
            self.host.asset('test-session', '../x', 0, b'1234')
        self.command('assets', assets={'guide': 'g'})
        with self.assertRaisesRegex(ValueError, 'speed'):
            self.command('play', position=0, rate=.5, end=.5)

    def test_idle_audio_is_not_written_to_disk(self):
        self.callback()
        self.assertFalse(any(Path(self.temp.name).iterdir()))

    def test_storage_floor_refuses_play_before_recording_starts(self):
        with patch.object(native.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=100)):
            with self.assertRaisesRegex(RuntimeError, 'disk space'):
                self.play(record=True)
        self.assertFalse(self.host.timeline.playing)

    def test_calibration_persists_separately_from_browser_profiles(self):
        result={'seconds':.038, 'spreadMs':1, 'residualMs':0, 'measuredAt':1794442943439}
        self.command('calibration',result=result)
        saved=json.loads((Path(self.temp.name)/'native-audio.json').read_text())
        self.assertEqual(saved['seconds'],.038)
        self.assertEqual(saved['input'],'Test input')
        self.play()
        with self.assertRaisesRegex(RuntimeError,'Stop recording'):
            self.command('calibration',result=result)

    def test_chunked_assets_do_not_expose_partial_buffers(self):
        pcm=self.np.full((960,2),.1,dtype='<f4')
        descriptor={'channels':2,'frames':960,'sampleRate':48000,'origin':0,'rate':1}
        self.host.asset('test-session','split',0,pcm[:480].tobytes(),descriptor)
        self.assertNotIn('split',self.host.assets)
        with self.assertRaisesRegex(ValueError,'Out-of-order'):
            self.host.asset('test-session','split',4,pcm[480:].tobytes())
        self.host.asset('test-session','split',480*2*4,pcm[480:].tobytes())
        self.assertTrue(self.np.array_equal(self.host.assets['split']['pcm'],pcm))

    def test_recording_backup_is_local_raw_pcm_and_closes(self):
        self.play(record=True, label={'song': 'Synthetic fixture'})
        self.callback()
        self.host.finish_backup()
        self.host.writer.join(2)
        import wave
        paths = list((Path(self.temp.name)/'native-recordings').glob('*.wav'))
        self.assertEqual(len(paths), 1)
        with wave.open(str(paths[0]), 'rb') as audio:
            self.assertEqual(audio.getnframes(), 480)
            self.assertEqual(audio.getframerate(), 48000)
            self.assertEqual(audio.getnchannels(), 1)
        metadata=json.loads(paths[0].with_suffix('.json').read_text())
        self.assertEqual(metadata['input'],'Test input')
        self.assertEqual(metadata['output'],'Test output')
        self.assertEqual(metadata['latency'],.036)
        self.assertIsNone(metadata['windowsInputEnhancementsVerifiedOff'])


class NativeSecurityTests(unittest.TestCase):
    def test_capability_and_origin_checked_before_audio_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            api = service.NativeService(tmp, 'http://127.0.0.1:18746')
            results = []
            handler = types.SimpleNamespace(path='/native/open', command='POST', headers={},
                response=lambda status, *args: results.append(status))
            self.assertTrue(api.handle(handler))
            self.assertEqual(results, [403])
            handler.headers = {'X-Melete-Native': api.token, 'Origin': 'https://example.com'}
            api.handle(handler)
            self.assertEqual(results, [403, 403])
            self.assertIsNone(api.audio)


if __name__ == '__main__':
    unittest.main()
