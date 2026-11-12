"""Offline updates replace only the player, with bounded and verified downloads."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('update_player', Path(__file__).resolve().parents[1] / 'tools/local_station/update_player.py')
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)
URL = 'https://example.org/practice/release.json'
OLD = b'<!doctype html><title>Melete old</title></html>'
NEW = b'<!doctype html><title>Melete new</title></html>'


class PlayerUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.player = self.root / 'Practice.html'
        self.player.write_bytes(OLD)
        self.state = self.root / 'native-audio.json'
        self.state.write_bytes(b'private calibration')

    def fetch(self, url, limit):
        if url == URL:
            return json.dumps(updater.release_manifest(NEW)).encode()
        self.assertEqual(url, 'https://example.org/practice/index.html')
        self.assertEqual(limit, len(NEW))
        return NEW

    def test_atomic_update_and_idempotent_retry_preserve_backup_and_state(self):
        result = updater.update(self.player, URL, self.fetch)
        self.assertTrue(result['updated'])
        self.assertEqual(self.player.read_bytes(), NEW)
        self.assertEqual(Path(result['backup']).read_bytes(), OLD)
        self.assertEqual(self.state.read_bytes(), b'private calibration')
        self.assertFalse(updater.update(self.player, URL, self.fetch)['updated'])
        self.assertEqual(Path(result['backup']).read_bytes(), OLD)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'Practice.html', 'Practice.previous.html', 'native-audio.json'})

    def test_offline_and_mismatched_release_leave_installed_player(self):
        for fetch in (lambda *_: (_ for _ in ()).throw(OSError('offline')),
                      lambda url, limit: self.fetch(url, limit) if url == URL else OLD):
            with self.assertRaises((OSError, ValueError)):
                updater.update(self.player, URL, fetch)
            self.assertEqual(self.player.read_bytes(), OLD)
            self.assertEqual(len(list(self.root.iterdir())), 2)

    def test_incompatible_host_or_unsafe_manifest_is_rejected(self):
        for change in ({'nativeProtocol': 2}, {'player': '../index.html'}, {'player': 'https://evil.test/p.html'},
                       {'bytes': 2**40}, {'sha256': 'wrong'}):
            info = {**updater.release_manifest(NEW), **change}
            with self.assertRaises(ValueError):
                updater.update(self.player, URL, lambda *_: json.dumps(info).encode())
            self.assertEqual(self.player.read_bytes(), OLD)
        with self.assertRaises(ValueError):
            updater.update(self.player, 'http://example.org/release.json', self.fetch)

    def test_failed_replacement_keeps_old_player_and_cleans_scratch(self):
        replace = updater.os.replace
        def fail_player(source, destination):
            if destination == self.player:
                raise OSError('file is locked')
            replace(source, destination)
        with patch.object(updater.os, 'replace', side_effect=fail_player), self.assertRaises(OSError):
            updater.update(self.player, URL, self.fetch)
        self.assertEqual(self.player.read_bytes(), OLD)
        self.assertFalse(any(p.name.startswith('.melete-') or p.suffix == '.lock' for p in self.root.iterdir()))

    def test_concurrent_update_does_not_remove_other_lock(self):
        lock = self.player.with_name(self.player.name + '.update.lock')
        lock.write_text('other process')
        with self.assertRaises(FileExistsError):
            updater.update(self.player, URL, self.fetch)
        self.assertEqual(lock.read_text(), 'other process')

    def test_incomplete_html_is_rejected(self):
        for data in (b'', b'<html>Melete</html>', b'<!doctype html>Melete', b'<!doctype html>unrelated</html>'):
            with self.assertRaises(ValueError):
                updater.release_manifest(data)
