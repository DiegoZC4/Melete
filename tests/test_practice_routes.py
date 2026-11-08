from pathlib import Path
import json
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import practice_routes as routes


class PracticeRoutesTests(unittest.TestCase):
    def setUp(self):
        self.xml = (ROOT / "tests/fixtures/handoffs.musicxml").read_text(encoding="utf-8")
        self.spec = json.loads((ROOT / "tests/fixtures/handoffs.config.json").read_text(encoding="utf-8"))["practiceRoutes"]

    def test_handoff_notes_lyrics_ties_and_source_preserved(self):
        xml, roles = routes.materialize(self.xml, self.spec)
        source, result = ET.fromstring(self.xml), ET.fromstring(xml)
        parts = result.findall("part")
        self.assertEqual(len(parts), 3)
        self.assertEqual(ET.tostring(source.findall("part")[0]), ET.tostring(parts[0]))
        solo = parts[2]
        solo.set("id", "P2")
        self.assertEqual(ET.tostring(source.findall("part")[1]), ET.tostring(solo))
        bars, events = routes.part_events(parts[1])
        lyrics = [(float(t), e.findtext("lyric/text")) for t, _, _, _, e in events if e.find("lyric") is not None]
        self.assertEqual(lyrics, [(0, "Before"), (3.5, "Join"), (4, "shared"), (8, "hold"), (9, "Return"), (12, "after")])
        self.assertFalse(parts[1].findall(".//tie"), "no dangling borrowed tie at the return")
        self.assertEqual(len(parts[1].findall(".//slur")), 2)
        self.assertEqual(roles[0]["handoffs"][0], {"startQuarter": 3.5, "endQuarter": 9.0, "sourcePart": 0})
        dynamics = [(float(t), e.find("sound").get("dynamics")) for t, _, _, _, e in events if e.find("sound") is not None]
        self.assertEqual(dynamics, [(0, "44"), (3.5, "57"), (9, "44")])

    def test_unsupported_or_ambiguous_routes_fail_loudly(self):
        for start, end in [("0", "2"), ("2", "1"), ("1.5", "3"), ("1.2", "3.2"), ("2.x", "3")]:
            spec = json.loads(json.dumps(self.spec))
            spec[0]["handoffs"][0].update(start=start, end=end)
            with self.subTest(start=start), self.assertRaises(ValueError):
                routes.materialize(self.xml, spec)
        with self.assertRaisesRegex(ValueError, "matching"):
            routes.materialize(self.xml.replace("<sign>G</sign>", "<sign>F</sign>", 1), self.spec)

    def test_no_routes_is_byte_preserving(self):
        self.assertEqual(routes.materialize(self.xml, []), (self.xml, []))

    def test_fresh_build_embeds_roles_and_keeps_verified_source_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "player"
            subprocess.run([sys.executable, str(ROOT / "build_trainer.py"),
                            str(ROOT / "tests/fixtures/handoffs.musicxml"),
                            "--config", str(ROOT / "tests/fixtures/handoffs.config.json"),
                            "--project-dir", str(project)], check=True, capture_output=True, timeout=60)
            data = json.loads((project / "assets/playback.json").read_text(encoding="utf-8"))
            self.assertEqual(len(data["parts"]), 3)
            self.assertEqual(data["practiceRoles"][0]["soloist"], 2)
            self.assertEqual(len(ET.parse(project / "assets/score.musicxml").getroot().findall("part")), 2)
            self.assertEqual(len(ET.parse(project / "assets/practice.musicxml").getroot().findall("part")), 3)
            metadata = json.loads((project / "assets/build-metadata.json").read_text(encoding="utf-8"))["build"]
            self.assertEqual(set(metadata["practiceReferenceFingerprints"]), {"1", "2"})
            self.assertIn("MeletePracticeRoutes", (project / "dist/index.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
