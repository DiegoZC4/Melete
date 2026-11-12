import unittest
from xml.etree import ElementTree as ET

from build_trainer import BuildError, practice_lyric_corrections


class TestPracticeLyricCorrections(unittest.TestCase):
    word = '<note><lyric><text>end</text></lyric></note>'
    source = '<score-partwise>' + ''.join(
        '<part id="P%s">' % p + ''.join('<measure number="%s">%s</measure>' % (m, '<note><lyric><text>end</text></lyric></note>') for m in (21, 22)) + '</part>'
        for p in (1, 2)) + '</score-partwise>'
    rule = [{"parts": ["P2"], "measure": 22, "from": "end", "to": "wend"}]

    def test_scoped_and_repeatable(self):
        self.assertEqual(practice_lyric_corrections(self.source, []), self.source)
        result = practice_lyric_corrections(self.source, self.rule)
        self.assertEqual([w.text for w in ET.fromstring(result).iter("text")], ["end","end","end","wend"])
        self.assertEqual(practice_lyric_corrections(result, self.rule), result)

    def test_refuses_ambiguous_or_changed_sources(self):
        for xml in (self.source.replace(self.word, self.word * 2), self.source.replace(">end<", ">new<")):
            with self.assertRaises(BuildError):
                practice_lyric_corrections(xml, self.rule)
