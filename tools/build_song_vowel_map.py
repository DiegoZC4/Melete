"""Build one song's Vowel Lab map from its original MusicXML and aligned reference mix.

Usage: build_song_vowel_map.py PROJECT SLUG --traces fresh-lpc.json --output DIRECTORY
The trace dictionary maps each song slug to [time_ms, fresh_F1_Hz, fresh_F2_Hz, ...]
rows. Missing updates must be null. Only these first three columns are read.
Requires numpy and praat-parselmouth. Output includes short reference excerpts.
"""
import argparse
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from hashlib import sha256
import json
from pathlib import Path
import unicodedata
import wave
import xml.etree.ElementTree as ET

import numpy as np
import parselmouth


NASALS = {"mm", "n", "nn", "(nn)", "dm"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def spelling(text):
    return unicodedata.normalize("NFC", text).replace("’", "'").replace("‘", "'").strip(" .,;:!?“”\"").lower()


@dataclass(eq=False)
class Syllable:
    start: int
    measure: int
    text: str
    kind: str
    word: str = ""
    vowels: str = ""


@dataclass
class Beat:
    end: int
    pitches: list = field(default_factory=list)
    lyric: tuple | None = None


def score_lanes(part, measures, division, corrections):
    lanes = defaultdict(dict)
    divisions = 1
    for index, measure in enumerate(part.findall("measure")):
        start, duration = measures[index][:2]
        tick = previous = Fraction(start)
        for e in measure:
            if e.tag == "attributes" and e.find("divisions") is not None:
                divisions = int(e.findtext("divisions"))
            if e.tag not in ("note", "backup", "forward") or e.find("grace") is not None:
                continue
            length = Fraction(int(e.findtext("duration", "0")) * division, divisions)
            if e.tag != "note":
                tick += length if e.tag == "forward" else -length
                continue
            onset = previous if e.find("chord") is not None else tick
            if e.find("chord") is None:
                previous, tick = onset, onset + length
            if onset.denominator != 1 or length.denominator != 1 or not start <= onset < onset+length <= start+duration:
                raise ValueError(f"Invalid note timing in {part.get('id')} m{index+1}")
            onset, end = int(onset), int(onset + length)
            lane = lanes[e.findtext("staff", "1"), e.findtext("voice", "1")]
            beat = lane.setdefault(onset, Beat(end))
            beat.end = max(end, beat.end)
            pitch = e.find("pitch")
            if pitch is None:
                continue
            midi = 12*(int(pitch.findtext("octave")) + 1) + dict(C=0,D=2,E=4,F=5,G=7,A=9,B=11)[pitch.findtext("step")]
            beat.pitches.append((midi+int(pitch.findtext("alter", "0")), end))
            for lyric in e.findall("lyric"):
                if lyric.get("number", "1") != "1" or not lyric.findtext("text", "").strip():
                    continue
                label = lyric.findtext("text").strip()
                label = corrections.get((part.get("id"), index+1, label), label)
                beat.lyric = (index+1, label, lyric.findtext("syllabic", "single"))
                break
    return lanes


def read_score(xml, seq, config):
    corrections = {(p, rule["measure"], rule["from"]): rule["to"]
                   for rule in config.get("lyricCorrections", []) for p in rule["parts"]}
    lexicon = dict(config["vowelTargets"]["lexicon"])
    for (_, _, source), target in corrections.items():
        if source in lexicon:
            lexicon.setdefault(spelling(target), lexicon[source])
    notes, parts = [], []
    for i, part in enumerate(ET.parse(xml).getroot().findall("part")):
        entries = []
        for (staff, _), events in score_lanes(part, seq["measures"], seq["division"], corrections).items():
            untexted = not any(beat.lyric for beat in events.values())
            previous_end, current, pending = -1, None, []
            for start, beat in sorted(events.items()):
                if start > previous_end or not beat.pitches:
                    current = None
                if beat.lyric:
                    m, label, kind = beat.lyric
                    current = Syllable(start, m, label.strip("-­"), kind)
                    entries.append(current)
                    if kind in ("begin", "single"):
                        pending = []
                    pending.append(current)
                    if kind in ("end", "single"):
                        word = spelling("".join(s.text for s in pending))
                        values = lexicon.get(word, [])
                        for j, s in enumerate(pending):
                            s.word = word
                            if len(values) == len(pending) and word not in NASALS and values[j] != "-":
                                s.vowels = values[j]
                        pending = []
                notes.extend((start, end, i, midi, current, untexted, staff) for midi, end in beat.pitches)
                previous_end = beat.end
        lines = defaultdict(list)
        seen = set()
        for s in sorted(entries, key=lambda s: s.start):
            identity = (s.start, s.word, s.text, s.vowels)
            if identity in seen:
                continue
            seen.add(identity)
            lines[s.measure].append([s.text, s.word, s.vowels, s.kind])
        parts.append({"id": seq["parts"][i]["short"], "name": seq["parts"][i]["name"],
                      "lines": list(lines.items())})
    return notes, parts


def shared_syllables(notes, measure_starts, seconds_per_tick):
    boundaries = defaultdict(list)
    for note in notes:
        boundaries[note[0]].append((True, note))
        boundaries[note[1]].append((False, note))
    active, passages = set(), []
    times = sorted(boundaries)
    for tick, end in zip(times, times[1:]):
        for entering, note in boundaries[tick]:
            if entering:
                active.add(note)
            else:
                active.discard(note)
        if not active:
            continue
        printed = defaultdict(set)
        for _, _, p, _, s, _, staff in active:
            if s:
                printed[p, staff].add(s)
        syllables, pitches, singing = set(), set(), set()
        for _, _, p, midi, s, untexted, staff in active:
            local = printed[p, staff]
            if s is None and untexted and len({(v.word, v.text, v.vowels) for v in local}) == 1:
                s = min(local, key=lambda v: v.start)
            syllables.add(s)
            singing.add(p)
            pitches.add(midi)
        if None in syllables or any(not s.vowels or "/" in s.vowels for s in syllables):
            continue
        keys = {(spelling(s.text), s.vowels) for s in syllables}
        if len(keys) != 1:
            continue
        first = min(syllables, key=lambda s: (s.start, s.word))
        # A repeated lyric with a fresh attack in every voice starts another exemplar.
        if passages and passages[-1]["end"] == tick and passages[-1]["ids"] & syllables:
            row = passages[-1]
        else:
            row = {"start": tick, "measure": bisect_right(measure_starts, tick), "syllable": first.text,
                   "symbol": first.vowels, "word": first.word, "parts": set(), "unison": 0}
            passages.append(row)
        row.update(end=end, ids=syllables)
        row["parts"].update(singing)
        if len(pitches) == 1:
            row["unison"] += (end-tick)*seconds_per_tick
    return passages


def bark(hz):
    return 13*np.arctan(.00076*hz) + 3.5*np.arctan((hz/7500)**2)


def frames_for(audio, trace):
    frames = np.asarray(trace, dtype=float)[:, :3]
    times = frames[:, 0]/1000
    if not np.isfinite(times).all() or not np.all(np.diff(times) > 0):
        raise ValueError("Fresh LPC frame times must increase")
    if abs(audio.duration-times[-1]) > 0.3:
        raise ValueError("Reference duration differs from the independent LPC trace")
    positions = []
    for ceiling in (5000, 5500):
        formants = audio.to_formant_burg(time_step=.01, max_number_of_formants=5,
                                          maximum_formant=ceiling, window_length=.03, pre_emphasis_from=50)
        positions.append(np.array([[formants.get_value_at_time(k, t) for k in (1, 2)] for t in times]))
    primary, alternate = positions
    difference = np.maximum(abs(bark(primary)-bark(alternate)), abs(bark(primary)-bark(frames[:, 1:3])))
    usable = (np.isfinite(difference).all(axis=1) & (difference.max(axis=1) <= 1)
              & (primary[:, 0] >= 175) & (primary[:, 0] <= 1250) & (primary[:, 1] >= 500)
              & (primary[:, 1] <= 3500) & (primary[:, 0] < primary[:, 1]))
    return times, primary, difference, usable, alternate, frames[:, 1:3]


def hull(observations):
    # Compute a convex boundary in chart (Bark) space and store its vertices in Hz.
    points = sorted(set(tuple(p) for p in observations.round().astype(int).tolist()))
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    def half(order):
        stack = []
        for pair in order:
            item = (bark(np.asarray(pair)), pair)
            while len(stack)>1 and cross(stack[-2][0], stack[-1][0], item[0]) <= 0:
                stack.pop()
            stack.append(item)
        return stack
    if len(points) <= 2:
        return points
    return [p for _, p in half(points)[:-1]+half(reversed(points))[:-1]]


def measure(frames, lo, hi, cropped=False, pooled=False):
    times, positions, difference, usable, alternate, independent = frames
    a, b = np.searchsorted(times, [lo, hi])
    mask = usable[a:b]
    if pooled:
        # For an entire predeclared vowel phase, compare robust frame statistics
        # across the three fits. Never use this looser test to hunt for subwindows.
        primary = positions[a:b]
        mask = (np.isfinite(difference[a:b]).all(axis=1)
                & (primary[:, 0] >= 175) & (primary[:, 0] <= 1250)
                & (primary[:, 1] >= 500) & (primary[:, 1] <= 3500) & (primary[:, 1] > primary[:, 0]))
    count = int(mask.sum())
    coverage = count / max(1, len(mask))
    min_frames, min_coverage = (5, .50) if pooled else (7, .80 if cropped else .60)
    if count < min_frames or coverage < min_coverage:
        return None
    hz = positions[a:b][mask]
    perceptual = bark(hz)
    if pooled and any(np.any(np.median(abs(perceptual-bark(model[a:b][mask])), axis=0)>1)
                      for model in (alternate, independent)):
        return None
    center = np.median(perceptual, axis=0)
    spread = np.ptp(np.percentile(perceptual, [10, 90], axis=0), axis=0)
    if spread.max() > (1.0 if cropped else 1.5):
        return None
    scale = np.maximum(np.median(abs(perceptual-center), axis=0), .08)
    distances = np.sum(((perceptual-center)/scale)**2, axis=1)
    central = hz[distances <= np.quantile(distances, .80)]
    agreement = np.median(difference[a:b][mask].max(axis=1))
    ranking = coverage - .30*agreement - .20*spread.max() + .07*min(1, hi-lo) - (.25 if pooled else 0)
    return {"center": np.median(hz, axis=0).round().astype(int).tolist(), "hull": hull(central),
            "window": [round(lo, 3), round(hi, 3)], "frames": count, "coverage": round(coverage, 3),
            "agreement": "window" if pooled else "frame",
            "rank": ranking, "radius": float(np.median(np.linalg.norm(perceptual-center, axis=1)))}


def best_window(frames, lo, hi):
    full = measure(frames, lo, hi)
    if full:
        return full
    # A fixed set of interior windows may rescue a sustained vowel with a noisy edge.
    # They must pass stricter agreement coverage and stability than a full window.
    if hi-lo >= .36:
        width = min(.45, max(.25, (hi-lo)/2))
        options = [measure(frames, start, start+width, True) for start in np.linspace(lo, hi-width, 5)]
        best = max((w for w in options if w), key=lambda w: w["rank"], default=None)
        if best:
            return best
    return measure(frames, lo, hi, pooled=True)


def exemplar(row, seconds, frames, parts):
    lo, hi = row["start"]*seconds, row["end"]*seconds
    duration = hi-lo
    if duration < .30:
        return None
    if ">" in row["symbol"]:
        if duration < .5:
            return None
        early = best_window(frames, lo+.15*duration, lo+.45*duration)
        late = best_window(frames, lo+.67*duration, lo+.92*duration)
        locations = [("early", early), ("late", late)]
        motion = False
        if early and late:
            distance = np.linalg.norm(bark(np.array(early["center"])) - bark(np.array(late["center"])))
            motion = bool(distance > max(.4, early["radius"]+late["radius"]))
    else:
        trim = max(.06, .2*duration)
        locations = [("steady", best_window(frames, lo+trim, hi-trim))]
        motion = False
    patches = [{"phase": phase, **w} for phase, w in locations if w]
    if not patches:
        return None
    rank = min(p["rank"] for p in patches) + .08*row["unison"]/duration
    for p in patches:
        del p["rank"], p["radius"]
    return {"word": row["word"], "syllable": row["syllable"], "m": row["measure"], "from": round(lo, 3), "to": round(hi, 3),
            "parts": [parts[i]["id"] for i in sorted(row["parts"])], "patches": patches,
            "motion": motion, "rank": round(rank, 4)}


def write_examples(audio, entries, filename):
    # Pack only the short, score-aligned reference examples into a single offline asset.
    rate = 22050
    mono = audio.resample(rate).values[0]
    offset = 0
    with wave.open(str(filename), "wb") as out:
        out.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        for row in entries:
            patches = row["patches"]
            first, last = patches[0]["window"][0], patches[-1]["window"][1]
            if len(patches) == 1 and last-first > 1.45:
                mid = (first+last)/2
                first, last = mid-.725, mid+.725
            lo = max(row["from"], first-.12)
            hi = min(row["to"], last+.14)
            samples = mono[round(lo*rate):round(hi*rate)].copy()
            ramp = np.linspace(0, 1, min(round(.012*rate), len(samples)//2))
            samples[:len(ramp)] *= ramp
            samples[-len(ramp):] *= ramp[::-1]
            row["audio"] = [round(offset/rate, 5), round((offset+len(samples))/rate, 5)]
            out.writeframes(np.clip(samples*32767, -32768, 32767).astype("<i2").tobytes())
            gap = round(.12*rate)
            out.writeframes(bytes(2*gap))
            offset += len(samples)+gap


def build(project, slug, trace_path, output):
    cfg = read(project/f"{slug}.config.json")
    assets = project/"players"/slug/"assets"
    seq = read(assets/"playback.json")
    xml = assets/"score.musicxml"
    reference = project/cfg["referenceAudio"]["path"]
    audio = parselmouth.Sound(str(reference)).convert_to_mono()
    notes, parts = read_score(xml, seq, cfg)
    if len(seq["tempos"]) != 1 or seq["tempos"][0][0] != 0:
        raise ValueError("This build expects a reference aligned to one score tempo")
    seconds = 60/(seq["division"]*seq["tempos"][0][1])
    rows = shared_syllables(notes, [m[0] for m in seq["measures"]], seconds)
    frames = frames_for(audio, read(trace_path)[slug])
    choices = sorted({v for part in parts for _, line in part["lines"] for _, _, vowels, _ in line
                      for v in vowels.split("/") if v})
    samples = {choice: [] for choice in choices}
    for row in rows:
        example = exemplar(row, seconds, frames, parts)
        if example:
            samples[row["symbol"]].append(example)
    vowels = {}
    for symbol, candidates in samples.items():
        # Prefer both observed phases of a glide, then agreement, stability, coverage and unison.
        ranked = sorted(candidates, key=lambda e: (-len(e["patches"]), -e["rank"], e["from"]))
        chosen = ranked[:3]
        for e in chosen:
            del e["rank"]
        vowels[symbol] = {"accepted": len(candidates), "examples": chosen}
    output.mkdir(parents=True, exist_ok=True)
    audio_name = f"{slug}-vowel-examples.wav"
    write_examples(audio, (e for v in vowels.values() for e in v["examples"]), output/audio_name)
    result = {"version": 1, "id": slug, "title": cfg["title"], "parts": parts, "vowels": vowels,
              "audio": audio_name, "referenceSha256": sha256(reference.read_bytes()).hexdigest(),
              "scoreSha256": sha256(xml.read_bytes()).hexdigest()}
    (output/f"{slug}-vowel-map.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)+"\n", encoding="utf-8")
    print(f"{slug}: {len(parts)} parts, {sum(bool(v['examples']) for v in vowels.values())}/{len(vowels)} "
          f"vowels with some acoustic evidence, {sum(len(v['examples']) for v in vowels.values())} selected excerpts")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("slug")
    parser.add_argument("--traces", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.project, args.slug, args.traces, args.output)
