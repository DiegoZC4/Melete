"""Package a self-contained Melete player for cold offline launches over HTTPS."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

from build_trainer import atomic_write


TEMPLATES = Path(__file__).resolve().parent / 'template'
WORKER = 'melete-offline.js'
TOUCH_ICON = 'apple-touch-icon.png'
MARKER = '<script id="melete-offline-install">'


def hosted_files(html, *, touch_icon=None):
    head = re.search(r'<head\s*>(?:\s*<meta\s+charset=[^>]+>)?', html, flags=re.I)
    if MARKER in html or not head or not any(tag in html for tag in
            ('id="melete-collection-data"', 'id="playback-data"')):
        raise ValueError('Supply an original, self-contained Melete player')
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
    manifest={'schema':1,'kind':'melete-player','nativeProtocol':1,'player':'index.html','bytes':len(document),'sha256':sha}
    files={'index.html': document, WORKER: worker.encode(), 'release.json':(json.dumps(manifest,indent=2)+'\n').encode()}
    if touch_icon is not None:files[TOUCH_ICON]=touch_icon
    return files


def write_hosted(html, directory, *, touch_icon=None):
    for name, data in hosted_files(html,touch_icon=touch_icon).items():
        atomic_write(directory / name, data)


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
