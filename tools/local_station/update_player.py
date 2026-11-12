"""Explicit, verified offline-player updates; never touch station state or reload a tab."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

NATIVE_PROTOCOL = 1
MAX_PLAYER_BYTES = 128 * 1024 * 1024


def validate_player(data):
    if not 0 < len(data) <= MAX_PLAYER_BYTES:
        raise ValueError('Player size is outside the update limit')
    if not data.lstrip().lower().startswith(b'<!doctype html') or b'</html>' not in data[-256:].lower():
        raise ValueError('Not a complete HTML player')
    if b'Melete' not in data[:8192]:
        raise ValueError('Not a Melete player')


def release_manifest(data, player='index.html'):
    validate_player(data)
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.html', player):
        raise ValueError('Player must be an HTML filename, not a path')
    return {'schema': 1, 'kind': 'melete-player', 'nativeProtocol': NATIVE_PROTOCOL,
            'player': player, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def https_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('Updates require a public HTTPS URL without credentials')
    return parsed


def download(url, limit):
    source = https_url(url)
    deadline = time.monotonic() + 120
    request = Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Melete-Offline-Updater/1'})
    with urlopen(request, timeout=20) as response:
        final = https_url(response.url)
        if (final.hostname, final.port) != (source.hostname, source.port):
            raise ValueError('Update redirected to a different host')
        if int(response.headers.get('Content-Length', '0')) > limit:
            raise ValueError('Update is too large')
        chunks, size = [], 0
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError('Update download timed out')
            chunk = response.read(min(262144, limit + 1 - size))
            if not chunk:
                return b''.join(chunks)
            chunks.append(chunk)
            size += len(chunk)
            if size > limit:
                raise ValueError('Update is too large')


def atomic_copy(source, destination):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.melete-', delete=False) as out:
            temporary = Path(out.name)
            with source.open('rb') as incoming:
                shutil.copyfileobj(incoming, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def update(player, manifest_url, fetch=download):
    player = Path(player).absolute()
    if player.is_symlink() or not player.is_file() or player.suffix.lower() != '.html':
        raise ValueError('Choose an existing installed HTML player, not a symlink')
    https_url(manifest_url)
    lock = player.with_name(player.name + '.update.lock')
    # Concurrent updates must not overwrite each other's last-known-good copy.
    with lock.open('x') as held:
        held.write(str(os.getpid()))
    pending = None
    try:
        info = json.loads(fetch(manifest_url, 16384))
        if info.get('schema') != 1 or info.get('kind') != 'melete-player':
            raise ValueError('Unknown player release format')
        if type(info.get('nativeProtocol')) is not int or info['nativeProtocol'] != NATIVE_PROTOCOL:
            raise ValueError('This release needs a native-host update; installed player left unchanged')
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.html', str(info.get('player', ''))):
            raise ValueError('Invalid release filename')
        size, digest = info.get('bytes'), info.get('sha256')
        if type(size) is not int or not 0 < size <= MAX_PLAYER_BYTES or not re.fullmatch(r'[0-9a-f]{64}', str(digest)):
            raise ValueError('Invalid release size or hash')
        prior = hashlib.sha256(player.read_bytes()).hexdigest()
        result = {'player': str(player), 'sha256': digest, 'previousSha256': prior, 'updated': False}
        if prior == digest:
            return result
        payload = fetch(urljoin(manifest_url, info['player']), size)
        if len(payload) != size or hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError('Published player and release manifest do not match; retry later')
        validate_player(payload)
        with tempfile.NamedTemporaryFile(dir=player.parent, prefix='.melete-', delete=False) as out:
            pending = Path(out.name)
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        if hashlib.sha256(player.read_bytes()).hexdigest() != prior:
            raise ValueError('Installed player changed during the download; not replaced')
        backup = player.with_name(player.stem + '.previous.html')
        if backup.is_symlink():
            raise ValueError('Previous-player backup must not be a symlink')
        atomic_copy(player, backup)
        os.replace(pending, player)
        return {**result, 'updated': True, 'backup': str(backup)}
    finally:
        if pending:
            pending.unlink(missing_ok=True)
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('player', type=Path)
    parser.add_argument('--manifest', required=True, help='Published HTTPS release.json URL')
    args = parser.parse_args()
    try:
        result = update(args.player, args.manifest)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Update not installed: {error}\nThe existing player is still available offline.\n')
    print(json.dumps(result, indent=2))
    print('Updated. Finish any recording, then reopen Melete to use it.' if result['updated'] else 'Already up to date.')
    print('Recordings, settings, singer directory and native audio calibration are unchanged.')


if __name__ == '__main__':
    main()
