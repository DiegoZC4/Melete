import tempfile
import unittest
from pathlib import Path

from vowel_targets import load_vowel_targets


class VowelTargetConfigTests(unittest.TestCase):
    def test_song_section_relative_files_and_missing_landmarks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "words.txt").write_text("[one]\na a>i | lily\n[two]\ne/i | lily\n", encoding="utf-8")
            (root / "hz.tsv").write_text(
                "symbol\tmen_F1_Hz\tmen_F2_Hz\twomen_F1_Hz\twomen_F2_Hz\n"
                "i\t350\t2200\t420\t\n", encoding="utf-8")
            spec = {"song": "one", "lexicon": "words.txt", "anchors": "hz.tsv"}
            first = load_vowel_targets(spec, root)
            self.assertEqual({"lily": ["a", "a>i"]}, first["lexicon"])
            self.assertEqual({"i": {"men": [350, 2200]}}, first["anchors"])
            self.assertEqual(first, load_vowel_targets(first, root / "elsewhere"))
            self.assertEqual(["e/i"], load_vowel_targets({**spec, "song": "two"}, root)["lexicon"]["lily"])
            with self.assertRaisesRegex(ValueError, "No vowel lexicon entries"):
                load_vowel_targets({**spec, "song": "three"}, root)
