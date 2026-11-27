import hashlib
import base64
import json
import struct
import zlib
import tempfile
import unittest
from pathlib import Path

from offline_player import MARKER, TOUCH_ICON, WORKER, PORTABLE, hosted_files, write_hosted, spans
from collection import pack_players, script_json


class OfflinePlayerTests(unittest.TestCase):
    def test_only_reference_is_split_and_portable_is_byte_exact(self):
        clip=(Path(__file__).parent/'fixtures/stereo-reference-24k.mp3').read_bytes()
        def song(raw):
            cfg={'referenceAudio':{'mime':'audio/mpeg','data':base64.b64encode(raw).decode()},'partsPdf':'untouched'}
            return ('<!doctype html><html><head><title>Melete</title></head><body>'
                    '<script id="trainer-config" type="application/json">'+script_json(cfg)+'</script>'
                    '<script id="playback-data" type="application/json">{}</script><script>void window.MeleteHostedMedia;</script></body></html>')
        sha=hashlib.sha256(clip).hexdigest()
        one=song(clip); f=hosted_files(one); manifest=json.loads(f['release.json'])
        self.assertEqual(f[PORTABLE],one.encode())
        self.assertEqual(f['media/'+sha+'.mp3'],clip)
        self.assertNotIn(base64.b64encode(clip),f['index.html'])
        self.assertEqual(manifest['sha256'],hashlib.sha256(f[PORTABLE]).hexdigest())
        self.assertEqual(manifest['hosted']['sha256'],hashlib.sha256(f['index.html']).hexdigest())
        self.assertEqual(manifest['hosted']['media'],[{'mp3':sha,'bytes':len(clip)}])
        bundle,inflater=pack_players([dict(id=i,title=i,html=one) for i in ['first','second']])
        multi=('<html><head></head><body><script id="melete-collection-data" type="application/json">'+script_json(bundle)+
               '</script><script id="melete-collection-inflater">'+inflater+'</script><script>void window.MeleteHostedMedia</script></body></html>')
        f=hosted_files(multi)
        self.assertEqual(f[PORTABLE],multi.encode())
        self.assertEqual([k for k in f if k.startswith('media/')],['media/'+sha+'.mp3'])
        html=f['index.html'].decode();i,j=spans(html)['melete-collection-data'];stored=json.loads(html[i:j])
        self.assertEqual(sum(isinstance(v,dict) for v in stored['assets'].values()),1)
        self.assertNotIn(base64.b64encode(clip[:60]),f['index.html'])

    def test_touch_icon_is_opt_in_and_versions_the_hosted_release(self):
        def png(level):
            def chunk(kind,data):
                return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
            return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',180,180,8,0,0,0,0))
                    +chunk(b'IDAT',zlib.compress((bytes([0])+bytes([level])*180)*180))+chunk(b'IEND',b''))
        html='<html><head><meta charset="utf-8"><link rel="icon" href="data:image/svg+xml,..."></head><body id="playback-data"></body></html>'
        self.assertNotIn(TOUCH_ICON,hosted_files(html))
        a=hosted_files(html,touch_icon=png(100));b=hosted_files(html,touch_icon=png(101))
        self.assertEqual(a[TOUCH_ICON],png(100))
        self.assertIn(('href="./apple-touch-icon.png?v='+hashlib.sha256(png(100)).hexdigest()[:12]+'"').encode(),a['index.html'])
        self.assertIn(b'sizes="180x180"',a['index.html'])
        self.assertNotEqual(a[WORKER],b[WORKER])
        self.assertIn(b'<link rel="icon"',a['index.html'])
        with self.assertRaisesRegex(ValueError,'180x180'):hosted_files(html,touch_icon=b'not a png')
    def test_hashes_final_bytes_and_preserves_embedded_html(self):
        for marker in ('playback-data', 'melete-collection-data'):
            inner = '<script>const innerHead="</head>";</script>'
            html = '<html><head><meta charset="utf-8">' + inner + '</head><body><script id="' + marker + '">{}</script></body></html>'
            files = hosted_files(html)
            player, worker = files['index.html'], files[WORKER]
            self.assertLess(player.index(b'charset='), player.index(MARKER.encode()))
            self.assertLess(player.index(MARKER.encode()), player.index(inner.encode()))
            self.assertIn(f'SHA = "{hashlib.sha256(player).hexdigest()}", BYTES = {len(player)}'.encode(), worker)
            self.assertNotIn(b'__MELETE_BUILD__', player + worker)
            self.assertEqual(json.loads(files['release.json']), dict(schema=1, kind='melete-player',
                nativeProtocol=1, player='index.html', bytes=len(player), sha256=hashlib.sha256(player).hexdigest()))
            self.assertEqual(files, hosted_files(html))
            with self.assertRaises(ValueError):
                hosted_files(player.decode())

    def test_only_original_player_can_be_packaged(self):
        with self.assertRaises(ValueError):
            hosted_files('<html><head></head><body>Authentication required</body></html>')
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'hosted'
            html = '<head></head><script id="playback-data">{}</script>'
            write_hosted(html, out)
            self.assertEqual({p.name: p.read_bytes() for p in out.iterdir()}, hosted_files(html))
