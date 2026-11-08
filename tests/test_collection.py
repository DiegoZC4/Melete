import base64
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock
import zlib

import build_trainer as builder
from collection import AssetPool, pack_players, render_collection, script_json


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/shared-regressions.musicxml"


class Scripts(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.values, self.current = {}, None
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.current = dict(attrs).get("id")
            if self.current:
                self.values[self.current] = ""

    def handle_data(self, data):
        if self.current:
            self.values[self.current] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.current = None


def unpack(document):
    scripts = Scripts(document).values
    bundle = json.loads(scripts["melete-collection-data"])
    assets = {key: scripts["melete-collection-inflater"] if value is None else
              zlib.decompress(base64.b64decode(value)).decode("utf-8")
              for key, value in bundle["assets"].items()}
    return bundle, assets, ["".join(assets[key] for key in song["chunks"]) for song in bundle["songs"]]


class CollectionTests(unittest.TestCase):
    def test_shared_assets_nested_downloads_and_raw_script_roundtrip(self):
        binary = base64.b64encode(bytes(range(256)) * 12).decode("ascii")
        script = 'const nested = "<head><style>not HTML</style>";\n' * 200
        songs = []
        for title in ("First", "Second"):
            config = {"title": title, "partsPdf": binary, "nested": {"again": binary},
                      "unsafe": "</script><script>alert(1)</script>", "unicode": "\u266b"}
            songs.append({"id": title.lower(), "title": title, "html":
                          '<!doctype html><html><head><style>body {color:inherit}</style></head><body>'
                          + '<script>const font="data:font/woff2;base64,YQ==";</script>'
                          + '<script id="library">' + script + '</script>'
                          + '<script id="trainer-config" type="application/json">' + script_json(config)
                          + '</script></body></html>'})
        document = render_collection(songs, title='Bad </script> __COLLECTION_RUNTIME__')
        bundle, assets, pages = unpack(document)
        self.assertEqual(len([value for value in assets.values() if value == script]), 1)
        self.assertEqual(len([value for value in assets.values() if value == script_json(binary)]), 1)
        for original, page in zip(songs, pages):
            before, after = Scripts(original["html"]).values, Scripts(page).values
            self.assertEqual(before["library"], after["library"])
            self.assertEqual(json.loads(before["trainer-config"]), json.loads(after["trainer-config"]))
            builder.verify_standalone(page)
        self.assertEqual(bundle["title"], 'Bad </script> __COLLECTION_RUNTIME__')
        self.assertNotIn("<script>alert(1)", document)

    def test_inflater_is_not_stored_twice(self):
        inflater = (ROOT / "vendor/fflate/fflate.js").read_text(encoding="utf-8")
        document = '<html><head></head><body><script>\n' + inflater + '\nconst done=true;</script></body></html>'
        packed, _ = pack_players([{"id": "a", "title": "A", "html": document}])
        self.assertIsNone(packed["assets"][packed["inflater"]])
        pool = AssetPool(inflater)
        pool.assets = packed["assets"]
        self.assertEqual("".join(pool.read(key) for key in packed["songs"][0]["chunks"]), document)

    def test_empty_duplicate_or_unsafe_song_ids_fail(self):
        with self.assertRaises(ValueError):
            pack_players([])
        song = {"id": "one", "title": "One", "html": "<html></html>"}
        with self.assertRaisesRegex(ValueError, "unique"):
            pack_players([song, song])
        with self.assertRaises(ValueError):
            pack_players([{**song, "id": "../bad"}])

    def test_multi_input_build_cache_and_failure_leave_last_good_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = [root / f"Song {index}.mscz" for index in (1, 2)]
            configs = [root / f"song-{index}.json" for index in (1, 2)]
            parts_pdf = root / "reviewed-parts.pdf"
            pdf_bytes = b"%PDF-1.4\nmanual page order and bookmarks fixture\n%%EOF\n" * 40
            parts_pdf.write_bytes(pdf_bytes)
            for index, (source, config) in enumerate(zip(sources, configs), 1):
                source.write_bytes(b"synthetic native source " + str(index).encode())
                config.write_text(json.dumps({"title": f"Song {index}", "slug": f"song-{index}",
                                              "partsPdf": "old-pdf", "conductorScore": {"private": "do not ship"}}))
            before = [source.read_bytes() for source in sources]
            project, output = root / "collection", root / "rehearsal.html"
            argv = [*map(str, sources), "--project-dir", str(project), "--output", str(output),
                    "--song-config", str(configs[0]), "--song-config", str(configs[1]),
                    "--parts-pdf", str(parts_pdf)]

            def export(_source, destination, _project, **_kwargs):
                destination.write_bytes(FIXTURE.read_bytes())

            with mock.patch.object(builder, "export_with_musescore", side_effect=export) as exporter:
                result = builder.build(builder.parse_args(argv))
                self.assertEqual(exporter.call_count, 2)
            self.assertEqual([song["slug"] for song in result["songs"]], ["song-1", "song-2"])
            bundle, assets, pages = unpack(output.read_text(encoding="utf-8"))
            self.assertEqual(len(pages), 2)
            libraries = [Scripts(page).values["alphatab-runtime"] for page in pages]
            self.assertEqual(libraries[0], libraries[1])
            self.assertEqual(list(assets.values()).count(libraries[0]), 1)
            for page in pages:
                builder.verify_standalone(page)
                config = json.loads(Scripts(page).values["trainer-config"])
                self.assertNotIn("conductorScore", config)
                self.assertEqual(base64.b64decode(config["partsPdf"]), pdf_bytes)
                self.assertNotIn("window.MeleteOnsetSource =", page)
            self.assertEqual(parts_pdf.read_bytes(), pdf_bytes)
            self.assertEqual(list(assets.values()).count(script_json(base64.b64encode(pdf_bytes).decode())), 1)
            self.assertLess(result["bytes"], sum(len(page.encode()) for page in pages) * .5)
            self.assertEqual((project / "dist/index.html").read_bytes(), output.read_bytes())
            with mock.patch.object(builder, "export_with_musescore", side_effect=AssertionError("cache not used")):
                second = builder.build(builder.parse_args(argv))
            self.assertTrue(all(song["scoreConversion"] == "verified-cache" for song in second["songs"]))
            good = output.read_bytes()
            marker = (project / builder.PROJECT_MARKER_NAME).read_bytes()
            configs[1].write_text('{"slug":"song-1"}')
            with self.assertRaisesRegex(builder.BuildError, "unique"):
                builder.build(builder.parse_args(argv))
            self.assertEqual(output.read_bytes(), good)
            self.assertEqual((project / builder.PROJECT_MARKER_NAME).read_bytes(), marker)
            self.assertEqual([source.read_bytes() for source in sources], before)
            self.assertFalse(list(root.glob("*.stage-*")))
            self.assertFalse(list(root.glob(".*.stage-*")))

    def test_single_score_attachment_and_explicit_private_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf, config = root / "parts.pdf", root / "config.json"
            pdf.write_bytes(b"%PDF-1.4\nreviewed parts fixture\n%%EOF\n")
            config.write_text(json.dumps({"partsPdfUrl": "https://example.org/old.pdf",
                                          "conductorScore": {"version": 1, "private": "manual reduction"}}))
            original = config.read_bytes()
            argv = [str(FIXTURE), "--project-dir", str(root / "singer"),
                    "--config", str(config), "--parts-pdf", str(pdf)]
            with mock.patch.object(builder, "conductor_assets", wraps=builder.conductor_assets) as extension:
                built = builder.build(builder.parse_args(argv))
            self.assertNotIn("conductorScore", extension.call_args.args[0])
            saved = json.loads(Scripts(Path(built["output"]).read_text(encoding="utf-8")).values["trainer-config"])
            self.assertEqual(base64.b64decode(saved["partsPdf"]), pdf.read_bytes())
            self.assertNotIn("partsPdfUrl", saved)
            self.assertNotIn("conductorScore", saved)
            with mock.patch.object(builder, "conductor_assets", return_value=("/* optional conductor */", "")) as extension:
                private = builder.build(builder.parse_args(argv + ["--with-conductor"]))
            self.assertEqual(extension.call_args.args[0]["conductorScore"]["version"], 1)
            self.assertIn("optional conductor", Path(private["output"]).read_text(encoding="utf-8"))
            self.assertEqual(config.read_bytes(), original)
            pdf.write_bytes(b"not a PDF")
            with self.assertRaisesRegex(builder.BuildError, "PDF document"):
                builder.build(builder.parse_args(argv))
            with self.assertRaisesRegex(builder.BuildError, "requires conductorScore"):
                builder.build_config({}, builder.parse_args([str(FIXTURE), "--with-conductor"]))

    def test_collection_input_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, second = root / "one.xml", root / "two.xml"
            first.write_bytes(FIXTURE.read_bytes())
            second.write_bytes(FIXTURE.read_bytes())
            with self.assertRaisesRegex(builder.BuildError, "once"):
                builder.build(builder.parse_args([str(first), str(first)]))
            with self.assertRaisesRegex(builder.BuildError, "once per input"):
                builder.build(builder.parse_args([str(first), str(second), "--song-config", "missing.json"]))
            project = root / "owned"
            project.mkdir()
            (project / builder.PROJECT_MARKER_NAME).write_text(builder.project_marker("test"))
            inside = project / "input.xml"
            inside.write_bytes(FIXTURE.read_bytes())
            with self.assertRaisesRegex(builder.BuildError, "contain an input"):
                builder.build(builder.parse_args([str(first), str(inside), "--project-dir", str(project)]))
            self.assertTrue(inside.exists())
            pdf = project / "hand-made.pdf"
            pdf.write_bytes(b"%PDF-1.4\nmanual PDF fixture")
            with self.assertRaisesRegex(builder.BuildError, "contain.*input"):
                builder.build(builder.parse_args([str(first), str(second), "--project-dir", str(project),
                                                 "--parts-pdf", str(pdf)]))
            with self.assertRaisesRegex(builder.BuildError, "contain.*input"):
                builder.build(builder.parse_args([str(first), "--project-dir", str(project),
                                                 "--parts-pdf", str(pdf)]))
            self.assertTrue(pdf.exists())


if __name__ == "__main__":
    unittest.main()
