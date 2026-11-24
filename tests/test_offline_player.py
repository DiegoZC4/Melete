import hashlib
import json
import struct
import zlib
import tempfile
import unittest
from pathlib import Path

from offline_player import MARKER, TOUCH_ICON, WORKER, hosted_files, write_hosted


class OfflinePlayerTests(unittest.TestCase):
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
