"""Serve one installed practice player on loopback, with a verified local-file handoff."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlsplit
from urllib.request import urlopen

PORT = 18746
HOST = f'127.0.0.1:{PORT}'
ORIGIN = f'http://{HOST}'
TOOL = Path(__file__).resolve().parent
TARGET = '/practice?mode=station#autumn'

def station(player, state):
    token = secrets.token_hex(32)
    lock = Lock()
    package = state / 'handoff.tmp'
    expected = [None]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def response(self, code, body=b'', mime='text/plain; charset=utf-8', **headers):
            self.send_response(code)
            self.send_header('Content-Type', mime)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'SAMEORIGIN')
            for name, val in headers.items(): self.send_header(name, str(val))
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if body: self.wfile.write(body)
        def error(self, message):
            self.response(409, (message+' Your original recordings are unchanged. Reopen the desktop shortcut to retry.').encode())
        def allowed(self):
            return self.headers.get('Host') == HOST
        def local_file(self, file, kind, **headers):
            if not file.is_file(): return self.response(404)
            self.send_response(200)
            for k,v in {'Content-Type':kind,'Content-Length':str(file.stat().st_size),'Cache-Control':'no-store',
                        'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',
                        'Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',**headers}.items():self.send_header(k,v)
            self.end_headers()
            with file.open('rb') as f: shutil.copyfileobj(f, self.wfile, 1024*1024)
        def do_GET(self):
            if not self.allowed():return self.response(403)
            at=urlsplit(self.path).path
            if at=='/health':return self.response(200,b'Melete local recording station v1')
            if at=='/':
                if not (state/'verified').exists():return self.response(200,b'Open the Melete Choir Practice desktop shortcut to bring the existing takes into this station.')
                return self.response(302,Location=TARGET)
            if at=='/practice':
                if not (state/'verified').exists():return self.response(302,Location='/')
                return self.local_file(player,'text/html; charset=utf-8')
            if at=='/station-roster.json':
                f=player.parent/'station-roster.js'
                if not f.is_file():return self.response(404)
                data=json.loads(f.read_text(encoding='utf-8').split('window.MeleteLocalStationRoster =',1)[1].strip().removesuffix(';'))
                return self.response(200,json.dumps(data).encode(),'application/json',**{'Cross-Origin-Resource-Policy':'same-origin'})
            if at=='/transfer.js':return self.local_file(TOOL/'transfer.js','text/javascript; charset=utf-8')
            if at=='/store.js':return self.local_file(TOOL.parent.parent/'template'/'loop_recorder.js','text/javascript; charset=utf-8')
            if at=='/restore':
                return self.response(200,b'<!doctype html><meta charset=utf-8><title>Opening Melete</title><p id=stationProgress>Opening your local recordings...</p><script src=/store.js></script><script src=/transfer.js></script>','text/html; charset=utf-8')
            if at=='/package/'+token and expected[0]:
                with lock:return self.local_file(package,'application/octet-stream',**{'X-Melete-SHA256':expected[0]})
            self.response(404)
        def do_POST(self):
            if not self.allowed():return self.response(403)
            at=urlsplit(self.path).path
            if at=='/complete/'+token and self.headers.get('Origin')==ORIGIN:
                if self.headers.get('Content-Length')!='64':return self.response(403)
                with lock:
                    if self.rfile.read(64).decode('ascii')!=expected[0]:return self.response(403)
                    (state/'verified').write_text(expected[0],encoding='ascii')
                    package.unlink(missing_ok=True)
                    expected[0]=None
                return self.response(200,b'ok')
            m=re.fullmatch('/stage/'+token+'/([0-9a-f]{64})',at)
            if not m or self.headers.get('Origin') not in ('null',None):return self.response(403)
            content=re.fullmatch(r'multipart/form-data; boundary=([A-Za-z0-9-]{1,200})',self.headers.get('Content-Type',''))
            size=int(self.headers.get('Content-Length','0'))
            if not content or not 0<size<=2**31:return self.response(400)
            boundary=content[1].encode(); first=self.rfile.readline(256)
            if first!=b'--'+boundary+b'\r\n':return self.response(400)
            used=len(first)
            while used<4096:
                line=self.rfile.readline(2048);used+=len(line)
                if line==b'\r\n':break
                if not line:return self.response(400)
            else:return self.response(400)
            try:
                with lock:
                    pending=state/'incoming.tmp'; remaining=size-used
                    with pending.open('w+b') as out:
                        while remaining>0:
                            chunk=self.rfile.read(min(remaining,1024*1024))
                            if not chunk:raise ValueError('Transfer interrupted.')
                            remaining-=len(chunk);out.write(chunk)
                        checked=False
                        for suffix in (b'\r\n--'+boundary+b'--\r\n',b'\r\n--'+boundary+b'--'):
                            if out.tell()<len(suffix):continue
                            out.seek(-len(suffix),2)
                            if out.read()!=suffix:continue
                            out.seek(-len(suffix),2);out.truncate();checked=True;break
                        if not checked:raise ValueError('Incomplete recording package.')
                        out.seek(0)
                        if hashlib.file_digest(out,'sha256').hexdigest()!=m[1]:raise ValueError('Transfer verification failed.')
                    os.replace(pending,package);expected[0]=m[1]
            except (OSError,ValueError) as e:return self.error(str(e))
            self.response(303,Location='/restore#'+token)
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    (state/'launch-token').write_text(token,encoding='ascii')
    server.serve_forever()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('player',type=Path); parser.add_argument('state',type=Path)
    parser.add_argument('--serve',action='store_true');parser.add_argument('--start-only',action='store_true')
    args=parser.parse_args(); args.state.mkdir(parents=True,exist_ok=True)
    if args.serve:return station(args.player.resolve(),args.state.resolve())
    helper = args.player.resolve().with_name('melete-station-transfer.js')
    script = (TOOL / 'transfer.js').read_bytes()
    if not helper.exists() or helper.read_bytes()!=script:
        if helper.exists() and not helper.read_bytes().startswith(b'/* Offline, one-time handoff'):
            raise ValueError('The existing station transfer helper contains other edits.')
        temporary = helper.with_suffix('.js.tmp')
        temporary.write_bytes(script)
        os.replace(temporary, helper)
    def up():
        try:
            with urlopen(ORIGIN+'/health',timeout=0.5) as r:return r.read(128)==b'Melete local recording station v1'
        except OSError:return False
    if not up():
        subprocess.Popen([sys.executable,__file__,str(args.player),str(args.state),'--serve'],creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),close_fds=True)
        for _ in range(50):
            if up():break
            time.sleep(.1)
        else:raise RuntimeError('The local recording station could not start.')
    if args.start_only:return
    token=(args.state/'launch-token').read_text(encoding='ascii')
    address=ORIGIN+TARGET if (args.state/'verified').exists() else args.player.resolve().as_uri()+'?stationTransfer=1#'+token
    chrome=next(path for base in ['ProgramFiles','ProgramFiles(x86)','LOCALAPPDATA'] if os.getenv(base)
                for path in [Path(os.environ[base])/'Google'/'Chrome'/'Application'/'chrome.exe'] if path.exists())
    subprocess.Popen([str(chrome),'--profile-directory=Default',address],close_fds=True)

if __name__=='__main__':main()
