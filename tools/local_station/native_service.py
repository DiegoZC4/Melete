"""Same-origin, capability-protected native audio endpoints for the local station."""
import json
from concurrent.futures import Future
from pathlib import Path
import queue
import secrets
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit


class AudioOwner:
    """WASAPI/COM initialization and destruction must share a persistent thread."""
    def __init__(self, state, configuration):
        self.jobs = queue.Queue()
        self.thread = threading.Thread(target=self.run, args=(state, configuration), daemon=True)
        self.thread.start()

    def run(self, state, configuration):
        host = None
        try:
            from native_audio import NativeAudio, finite
            config = json.loads(configuration.read_text(encoding='utf-8'))
            finite(config['seconds'], 0, .5)
            host = NativeAudio(state, config, watchdog=False)
            while True:
                try:
                    name, args, future = self.jobs.get(timeout=1)
                except queue.Empty:
                    if host.session and time.monotonic()-host.last_seen > 5:
                        host.close(host.session)
                    continue
                if name == 'shutdown':
                    if host.session:
                        host.close(host.session)
                    future.set_result(None)
                    return
                try:
                    future.set_result(getattr(host, name)(*args))
                except Exception as error:
                    future.set_exception(error)
        except Exception as error:
            # Deliver initialization failures to the request that opened the host.
            while True:
                name, _, future = self.jobs.get()
                future.set_exception(error)
                if name == 'shutdown':
                    return

    def __getattr__(self, name):
        def invoke(*args):
            future = Future()
            self.jobs.put((name, args, future))
            return future.result(timeout=15)
        return invoke


class NativeService:
    def __init__(self, state, origin):
        self.state, self.origin = Path(state), origin
        self.token = secrets.token_hex(32)
        self.audio = None
        self.owner_lock = threading.Lock()
        self.configuration = self.state/'native-audio.json'

    def configuration_script(self):
        if sys.platform != 'win32' or not self.configuration.is_file():
            return ''
        saved = json.loads(self.configuration.read_text(encoding='utf-8'))
        config = json.dumps({'token': self.token, 'origin': self.origin, 'calibration':
            {key: saved.get(key) for key in ('seconds', 'spreadMs', 'residualMs', 'measuredAt')}})
        return '<script>window.MeleteNativeStationConfig='+config+';document.currentScript.remove();</script>'

    def instance(self):
        with self.owner_lock:
            if self.audio is None:
                if sys.platform != 'win32' or not self.configuration.is_file():
                    raise RuntimeError('Native audio is not configured on this station')
                deps = Path(__file__).with_name('native-deps')
                if deps.is_dir():
                    sys.path.insert(0, str(deps))
                self.audio = AudioOwner(self.state, self.configuration)
        return self.audio

    def handle(self, handler):
        url = urlsplit(handler.path)
        if not url.path.startswith('/native/'):
            return False
        if not secrets.compare_digest(handler.headers.get('X-Melete-Native', ''), self.token):
            handler.response(403)
            return True
        if handler.command == 'POST' and handler.headers.get('Origin') != self.origin:
            handler.response(403)
            return True
        try:
            api = self.instance()
            if handler.command == 'GET' and url.path == '/native/poll':
                query = parse_qs(url.query, strict_parsing=True)
                body = api.poll(query['session'][0], int(query['since'][0]))
                handler.response(200, body, 'application/octet-stream')
                return True
            if handler.command != 'POST':
                handler.response(405)
                return True
            size = int(handler.headers.get('Content-Length', '0'))
            if not 0 < size <= 4*1024**2:
                raise ValueError('Native request is too large')
            raw = handler.rfile.read(size)
            if len(raw) != size:
                raise ValueError('Native request was interrupted')
            if url.path == '/native/asset':
                meta = json.loads(handler.headers.get('X-Melete-Asset', '{}'))
                api.asset(meta['session'], meta['key'], meta['offset'], raw, meta.get('descriptor'))
                result = {'ok': True}
            else:
                body = json.loads(raw)
                if url.path == '/native/open':
                    result = api.open(body['client'])
                elif url.path == '/native/control':
                    result = api.command(body['session'], body)
                    if body['kind'] == 'close':
                        api.close(body['session'])
                else:
                    handler.response(404)
                    return True
            handler.response(200, json.dumps(result).encode(), 'application/json')
        except Exception as error:
            handler.response(409, json.dumps({'error': str(error)}).encode(), 'application/json')
        return True
