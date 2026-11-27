"""Package a self-contained Melete player for cold offline launches over HTTPS."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

from build_trainer import atomic_write
from collection import AssetPool, PlayerChunks, script_json


TEMPLATES = Path(__file__).resolve().parent / 'template'
WORKER = 'melete-offline.js'
TOUCH_ICON = 'apple-touch-icon.png'
MARKER = '<script id="melete-offline-install">'
PORTABLE = 'melete-portable.html'


def spans(html):
    parser = PlayerChunks(html, None)
    parser.feed(html)
    parser.close()
    return parser.named


def external_references(html):
    """Only externalize the author-supplied referenceAudio.data, never singer data."""
    media = {}
    def descriptor(ref):
        if not ref or ref.get('mime') != 'audio/mpeg' or not ref.get('data'):
            return None
        data = base64.b64decode(ref['data'], validate=True)
        sha = hashlib.sha256(data).hexdigest()
        media['media/' + sha + '.mp3'] = data
        return {'mp3': sha, 'bytes': len(data)}

    def config(doc, nodes):
        if 'trainer-config' not in nodes:
            return {}
        start, end = nodes['trainer-config']
        return json.loads(doc[start:end])

    nodes = spans(html)
    if 'melete-collection-data' in nodes:
        start, end = nodes['melete-collection-data']
        bundle = json.loads(html[start:end])
        originals = bundle.get('assets', {})
        refs, decoded = {}, {}
        def unpack(key):
            if key not in decoded:
                if key == bundle['inflater']:
                    i, j = nodes['melete-collection-inflater']
                    decoded[key] = html[i:j]
                else:
                    decoded[key] = zlib.decompress(base64.b64decode(originals[key])).decode()
            return decoded[key]
        for song in bundle.get('songs', []):
            doc = ''.join(map(unpack, song['chunks']))
            ref = config(doc, spans(doc)).get('referenceAudio')
            desc = descriptor(ref)
            if desc:
                key = AssetPool.key(script_json(ref['data']))
                if key not in song['chunks'] or 'MeleteHostedMedia' not in doc:
                    raise ValueError('Rebuild the source player with hosted reference support first')
                refs[key] = desc
        if refs:
            if 'MeleteHostedMedia' not in html:
                raise ValueError('Rebuild the source collection before hosting split audio')
            originals.update(refs)
            html = html[:start] + script_json(bundle) + html[end:]
    elif 'trainer-config' in nodes:
        value = config(html, nodes)
        desc = descriptor(value.get('referenceAudio'))
        if desc:
            if 'MeleteHostedMedia' not in html:
                raise ValueError('Rebuild the source player with hosted reference support first')
            start, end = nodes['trainer-config']
            value['referenceAudio']['data'] = desc
            html = html[:start] + script_json(value) + html[end:]
    return html, media


def hosted_files(html, *, touch_icon=None):
    head = re.search(r'<head\s*>(?:\s*<meta\s+charset=[^>]+>)?', html, flags=re.I)
    if MARKER in html or not head or not any(tag in html for tag in
            ('id="melete-collection-data"', 'id="playback-data"')):
        raise ValueError('Supply an original, self-contained Melete player')
    portable = html.encode()
    html, media = external_references(html)
    head = re.search(r'<head\s*>(?:\s*<meta\s+charset=[^>]+>)?', html, flags=re.I)
    client = (TEMPLATES / 'offline_install.js').read_text(encoding='utf-8')
    # Separate the in-page build ID from the hash of the final bytes to avoid a circular digest.
    icon_link = ''
    if touch_icon is not None:
        if (touch_icon[:16]!=b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' or len(touch_icon)<33
                or struct.unpack('>II',touch_icon[16:24])!=(180,180)):
            raise ValueError('The Home Screen icon must be a 180x180 PNG')
        version=hashlib.sha256(touch_icon).hexdigest()[:12]
        icon_link=f'\n<link rel="apple-touch-icon" sizes="180x180" href="./{TOUCH_ICON}?v={version}">'
    build = hashlib.sha256((html + icon_link + client).encode()).hexdigest()
    # Insert after the charset but before any scripts (which can themselves contain HTML).
    document = (html[:head.end()] + icon_link + '\n' + MARKER + client.replace('__MELETE_BUILD__', build)
                + '</script>\n' + html[head.end():]).encode()
    sha = hashlib.sha256(document).hexdigest()
    worker = (TEMPLATES / 'offline_worker.js').read_text(encoding='utf-8')
    worker = worker.replace('__MELETE_BUILD__', build).replace('__DOCUMENT_SHA__', sha).replace('__DOCUMENT_BYTES__', str(len(document)))
    refs = [{'mp3':Path(name).stem, 'bytes':len(data)} for name,data in sorted(media.items())]
    worker = worker.replace('__MELETE_MEDIA__', script_json(refs))
    hosted = {'player':'index.html','bytes':len(document),'sha256':sha}
    manifest = {'schema':1,'kind':'melete-player','nativeProtocol':1, **hosted}
    files = {'index.html':document, WORKER:worker.encode(), **media}
    if media:
        # Existing one-file station updaters must never install a shell without its MP3s.
        files[PORTABLE] = portable
        manifest.update(player=PORTABLE, bytes=len(portable), sha256=hashlib.sha256(portable).hexdigest(),
                        hosted={**hosted, 'media':refs})
    files['release.json'] = (json.dumps(manifest,indent=2)+'\n').encode()
    if touch_icon is not None:files[TOUCH_ICON]=touch_icon
    return files


def write_hosted(html, directory, *, touch_icon=None):
    files = hosted_files(html,touch_icon=touch_icon)
    for name in sorted(files, key=lambda n: (n == 'release.json', not n.startswith('media/'))):
        path = directory / name
        if not (name.startswith('media/') and path.is_file() and path.read_bytes() == files[name]):
            atomic_write(path, files[name])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('player', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--touch-icon',type=Path,help='Optional 180x180 PNG for the iPad/iPhone Home Screen icon.')
    args = parser.parse_args()
    if (args.output_dir / 'index.html').resolve() == args.player.resolve():
        parser.error('Choose an output directory separate from the source player')
    write_hosted(args.player.read_text(encoding='utf-8'), args.output_dir,
                 touch_icon=args.touch_icon.read_bytes() if args.touch_icon else None)
