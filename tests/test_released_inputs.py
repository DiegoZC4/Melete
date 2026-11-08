import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import zlib

from collection import pack_players, script_json
from examples import autumn_seed as recipe


def fixture():
    songs = []
    b64 = lambda data: base64.b64encode(data).decode("ascii")
    digest = lambda data: hashlib.sha256(data).hexdigest()
    for slug, title, _ in recipe.SONGS:
        score, xml = title.encode(), ("<score-partwise>" + title + "</score-partwise>").encode()
        meta = {"build": {"source": {"sha256": digest(score)}, "normalizedScoreSha256": digest(xml), "fingerprint": "test"}}
        solo = {"name": "Extra", "short": "S2 solo"}
        cfg = {"sourceScore": {"data": b64(score)}, "printPdf": b64(b"pdf"), "partsPdf": b64(b"parts"),
               "referenceAudio": {"data": b64(b"audio"), "label": "Guide", "mime": "audio/mpeg"},
               "parts": [{"name": "Source"}, solo], "practiceRoutes": [{"soloist": solo}], "roster": ["PRIVATE"]}
        html = "".join(f'<script type="application/json" id="{k}">{script_json(v)}</script>'
                       for k, v in [("trainer-config", cfg), ("build-metadata", meta), ("portable-state", {"take": "PRIVATE"})])
        songs.append(dict(id=slug, title=title, html=html))
    manifest, _ = pack_players(songs)
    return manifest


class ReleasedProjectTest(unittest.TestCase):
    def test_offline_restore_and_corruption_guards(self):
        manifest = fixture()
        def html_doc(m):
            return '<script type="application/json" id="melete-collection-data">' + script_json(m) + "</script>"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            html, project = root / "choir.html", root / "Rehearsal"
            key = manifest["songs"][0]["chunks"][0]
            bad = base64.b64encode(zlib.compress(b"corrupt")).decode("ascii")
            for wrong in [{**manifest, "conductor": True}, {**manifest, "assets": {**manifest["assets"], key: bad}}]:
                html.write_text(html_doc(wrong), encoding="utf-8")
                with self.assertRaises(ValueError):
                    recipe.prepare(project, html)
                self.assertFalse(project.exists())
            html.write_text(html_doc(manifest), encoding="utf-8")
            bundle = root / "exports.zip"
            exports = {slug + ".musicxml": ("<score-partwise>" + title + "</score-partwise>").encode()
                       for slug, title, _ in recipe.SONGS}
            for bad_entries in [{**exports, "autumn.musicxml": b"wrong revision"}, {**exports, "../outside": b"no"}]:
                with zipfile.ZipFile(bundle, "w") as z:
                    for entry, value in bad_entries.items():
                        z.writestr(entry, value)
                with self.assertRaises(ValueError):
                    recipe.prepare(project, html, bundle)
                self.assertFalse(project.exists())
            with zipfile.ZipFile(bundle, "w") as z:
                for entry, value in exports.items():
                    z.writestr(entry, value)
            recipe.prepare(project, html, bundle)
            self.assertEqual((project / "players/autumn/assets/score.musicxml").read_bytes(), exports["autumn.musicxml"])
            self.assertEqual((project / "Autumn.mscz").read_bytes(), b"Autumn")
            cfg = json.loads((project / "the-seed.config.json").read_text(encoding="utf-8"))
            self.assertEqual(cfg["parts"], [{"name": "Source"}])
            self.assertNotIn("roster", cfg)
            self.assertNotIn("PRIVATE", str([p.read_bytes() for p in project.rglob("*") if p.is_file()]))
            with self.assertRaises(ValueError):
                recipe.prepare(project, html)
