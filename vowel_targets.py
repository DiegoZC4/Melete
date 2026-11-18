"""Load a song's pronunciation lexicon and absolute-Hz speech landmarks."""

import csv
import math
from pathlib import Path


def load_vowel_targets(spec, base: Path):
    if not isinstance(spec, dict):
        raise ValueError("vowelTargets must be an object")
    if isinstance(spec.get("lexicon"), dict) and isinstance(spec.get("anchors"), dict):
        return spec  # Already embedded, e.g. in a collection's per-song config.
    song = spec["song"]
    words = {}
    section = None
    with (base / spec["lexicon"]).open(encoding="utf-8-sig") as source:
        for line in source:
            line = line.partition("#")[0].strip()
            if not line:
                continue
            if line.startswith("[") and line.endswith("]"):
                section = line[1:-1]
            elif section == song:
                vowels, separator, spellings = line.partition("|")
                if not separator or not vowels.split() or not spellings.split():
                    raise ValueError(f"Invalid vowel lexicon entry {line!r}")
                for word in spellings.split():
                    if word in words:
                        raise ValueError(f"Duplicate vowel lexicon entry {word!r}")
                    words[word] = vowels.split()
    if not words:
        raise ValueError(f"No vowel lexicon entries for {song!r}")

    anchors = {}
    with (base / spec["anchors"]).open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source, delimiter="\t"):
            points = {}
            for group in ("men", "women"):
                values = [row[f"{group}_F{i}_Hz"].strip() for i in (1, 2)]
                if all(values):
                    hz = [float(value) for value in values]
                    if not all(math.isfinite(n) and n > 0 for n in hz):
                        raise ValueError(f"Invalid landmark for {row['symbol']!r}")
                    points[group] = hz
            anchors[row["symbol"]] = points
    return {**spec, "lexicon": words, "anchors": anchors}
