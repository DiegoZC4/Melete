"""Materialize explicit performer handoffs without editing the source score.

A NoteLine can mean several things. These routes are opt-in score content, not
an inference from arbitrary graphical lines. Boundaries use measure.beat.fraction.
"""

from copy import deepcopy
from fractions import Fraction
import xml.etree.ElementTree as ET


def position(value, measures):
    fields = str(value).split(".")
    if not 1 <= len(fields) <= 3 or not all(s.isdigit() for s in fields):
        raise ValueError(f"Invalid handoff position: {value}")
    bar, beat = int(fields[0]) - 1, int(fields[1]) if len(fields) > 1 else 1
    fraction = Fraction("0." + fields[2]) if len(fields) > 2 else Fraction(0)
    if bar == len(measures) and beat == 1 and fraction == 0:
        return measures[-1][0] + measures[-1][1]
    if not 0 <= bar < len(measures) or beat < 1:
        raise ValueError(f"Handoff position outside score: {value}")
    start, duration, _, denominator = measures[bar]
    offset = (beat - 1 + fraction) * Fraction(4, denominator)
    if offset >= duration:
        raise ValueError(f"Handoff beat outside measure: {value}")
    return start + offset


def part_events(part):
    """Read one monophonic staff, preserving chord members and exact fractions."""
    divisions, beats, denominator, absolute = 1, 4, 4, Fraction(0)
    bars, events = [], []
    for bar_index, measure in enumerate(part.findall("measure")):
        cursor, previous = Fraction(0), Fraction(0)
        for element in measure:
            if element.tag == "attributes":
                divisions = int(element.findtext("divisions", str(divisions)))
                beats = sum(int(n) for n in element.findtext("time/beats", str(beats)).split("+"))
                denominator = int(element.findtext("time/beat-type", str(denominator)))
                if int(element.findtext("staves", "1")) != 1:
                    raise ValueError("Practice handoffs currently require single-staff parts")
            if element.tag in ("backup", "forward"):
                raise ValueError("Practice handoffs currently require one rhythmic voice per part")
            duration = Fraction(int(element.findtext("duration", "0")), divisions)
            onset = previous if element.find("chord") is not None else cursor
            if element.tag == "note":
                if element.find("grace") is not None:
                    duration = Fraction(0)
                events.append((absolute + onset, duration, bar_index, divisions, element))
                if element.find("chord") is None:
                    previous = cursor
                    cursor += duration
            elif element.tag == "direction":
                offset = Fraction(int(element.findtext("offset", "0")), divisions)
                events.append((absolute + cursor + offset, Fraction(0), bar_index, divisions, element))
        duration = Fraction(beats * 4, denominator)
        if cursor != duration:
            raise ValueError(f"Handoff part measure {bar_index + 1} has {cursor} beats, expected {duration}")
        bars.append((absolute, duration, beats, denominator))
        absolute += duration
    return bars, events


def staff_states(part):
    state, states = {}, []
    def canonical(element):
        return (element.tag, (element.text or "").strip(),
                tuple(canonical(child) for child in element))
    for measure in part.findall("measure"):
        for attributes in measure.findall("attributes"):
            for child in attributes:
                if child.tag in ("divisions", "key", "clef", "transpose"):
                    state[child.tag] = canonical(child)
        states.append(dict(state))
    return states


def trim_rest(note, duration, divisions):
    if note.find("rest") is None or note.find("time-modification") is not None:
        raise ValueError("Place handoffs on note boundaries; only ordinary rests can be split")
    units = duration * divisions
    if units.denominator != 1:
        raise ValueError("Handoff needs a finer MusicXML division")
    note.find("duration").text = str(int(units))
    note.find("rest").attrib.pop("measure", None)
    for child in list(note):
        if child.tag in ("type", "dot"):
            note.remove(child)
    for name, base in (("whole", 4), ("half", 2), ("quarter", 1),
                       ("eighth", Fraction(1, 2)), ("16th", Fraction(1, 4)),
                       ("32nd", Fraction(1, 8)), ("64th", Fraction(1, 16))):
        for dots, factor in ((0, 1), (1, Fraction(3, 2)), (2, Fraction(7, 4))):
            if duration == base * factor:
                ET.SubElement(note, "type").text = name
                for _ in range(dots):
                    ET.SubElement(note, "dot")
                return
    raise ValueError(f"Cannot notate handoff rest of {duration} quarter beats")


def close_spanners(notes):
    """Discard ties/slurs whose other endpoint was left on a different route."""
    ties, slurs = {}, {}
    for note in notes:
        pitch = ET.tostring(note.find("pitch")) if note.find("pitch") is not None else None
        for tag, active, key_for in (("tie", ties, lambda e: pitch),
                                     ("notations/slur", slurs, lambda e: e.get("number", "1"))):
            for mark in list(note.findall(tag)):
                key = key_for(mark)
                kind = mark.get("type")
                if kind == "stop":
                    if key in active:
                        active.pop(key)
                    else:
                        remove_mark(note, mark)
                elif kind == "start":
                    if key in active:
                        remove_mark(*active.pop(key))
                    active[key] = (note, mark)
    for note, mark in [*ties.values(), *slurs.values()]:
        remove_mark(note, mark)


def remove_mark(note, mark):
    if mark.tag == "tie":
        for engraved in list(note.findall("notations/tied")):
            if engraved.get("type") == mark.get("type"):
                note.find("notations").remove(engraved)
        note.remove(mark)
    else:
        note.find("notations").remove(mark)


def materialize(xml, specifications):
    if not specifications:
        return xml, []
    if not isinstance(specifications, list):
        raise ValueError("practiceRoutes must be a list")
    root = ET.fromstring(xml)
    originals = root.findall("part")
    definitions = root.find("part-list")
    role_metadata, used = [], set()
    for spec in specifications:
        target = spec["part"]
        if type(target) is not int or not 0 <= target < len(originals) or target in used:
            raise ValueError("Each practice route must identify a distinct zero-based source part")
        used.add(target)
        bars, _ = part_events(originals[target])
        target_states = staff_states(originals[target])
        total = bars[-1][0] + bars[-1][1]
        routes, prior = [], Fraction(0)
        for handoff in spec["handoffs"]:
            donor = handoff["sourcePart"]
            if type(donor) is not int or not 0 <= donor < len(originals) or donor == target:
                raise ValueError("Invalid handoff sourcePart")
            start, end = position(handoff["start"], bars), position(handoff["end"], bars)
            if not prior <= start < end <= total:
                raise ValueError("Handoffs must be ordered, nonoverlapping and nonempty")
            donor_bars, _ = part_events(originals[donor])
            if donor_bars != bars:
                raise ValueError("Handoff staves have different measure timing")
            donor_states = staff_states(originals[donor])
            for index, (bar_start, duration, _, _) in enumerate(bars):
                if bar_start < end and bar_start + duration > start and donor_states[index] != target_states[index]:
                    raise ValueError("Handoffs require matching divisions, key, clef and transposition")
            routes.append((start, end, donor))
            prior = end
        if not routes:
            raise ValueError("Practice route has no handoffs")
        solo = deepcopy(originals[target])
        solo_index = len(root.findall("part"))
        solo_id = f"MeleteRole{solo_index + 1}"
        if root.find(f"part[@id='{solo_id}']") is not None:
            raise ValueError("Generated role ID conflicts with a source part")
        solo.set("id", solo_id)
        for instrument in solo.iter("instrument"):
            instrument.set("id", solo_id + "I")
        definition = deepcopy(definitions.find(f"score-part[@id='{originals[target].get('id')}']"))
        definition.set("id", solo_id)
        definition.find("part-name").text = spec["soloist"]["name"]
        short = definition.find("part-abbreviation")
        if short is None:
            short = ET.SubElement(definition, "part-abbreviation")
        short.text = spec["soloist"]["short"]
        for element in definition.iter():
            if element.tag in ("score-instrument", "midi-instrument"):
                element.set("id", solo_id + "I")
        definitions.append(definition)
        root.append(solo)

        intervals, cursor = [], Fraction(0)
        for start, end, donor in routes:
            if start > cursor:
                intervals.append((cursor, start, target))
            intervals.append((start, end, donor))
            cursor = end
        if cursor < total:
            intervals.append((cursor, total, target))
        replacement = deepcopy(originals[target])
        for measure in replacement.findall("measure"):
            for element in list(measure):
                if element.tag in ("note", "direction"):
                    measure.remove(element)
        for start, end, donor in intervals:
            _, source_events = part_events(originals[donor])
            section_notes = []
            dynamics = [(t, element) for t, _, _, _, element in source_events
                        if t <= start and element.find("direction-type/dynamics") is not None]
            if start and dynamics and dynamics[-1][0] < start:
                dynamic = deepcopy(dynamics[-1][1])
                for element in list(dynamic):
                    if element.tag == "offset":
                        dynamic.remove(element)
                bar = next(i for i, (t, d, _, _) in enumerate(bars) if t <= start < t + d)
                replacement.findall("measure")[bar].append(dynamic)
            for onset, duration, bar, divisions, element in source_events:
                if element.tag == "direction":
                    if not start <= onset < end:
                        continue
                    if element.find("offset") is not None:
                        raise ValueError("Offset directions in a handoff need explicit normalization")
                elif duration and not (onset < end and onset + duration > start):
                    continue
                elif not duration and not start <= onset < end:
                    continue
                copy = deepcopy(element)
                if element.tag == "note":
                    kept = min(onset + duration, end) - max(onset, start)
                    if duration and kept != duration:
                        trim_rest(copy, kept, divisions)
                    section_notes.append(copy)
                replacement.findall("measure")[bar].append(copy)
            close_spanners(section_notes)
        for measure in replacement.findall("measure"):
            for barline in list(measure.findall("barline")):
                if barline.get("location", "right") == "right":
                    measure.remove(barline)
                    measure.append(barline)
        # The unmodified originals remain available as donors for later routes.
        root.remove(originals[target])
        root.insert(list(root).index(solo), replacement)
        role_metadata.append({"part": target, "soloist": solo_index,
                              "name": spec["soloist"]["name"], "short": spec["soloist"]["short"],
                              "handoffs": [{"startQuarter": float(s), "endQuarter": float(e),
                                            "sourcePart": p} for s, e, p in routes]})
    # Keep the original part indices stable, appending only new roles.
    by_id = {p.get("id"): p for p in root.findall("part")}
    for part in list(root.findall("part")):
        root.remove(part)
    for definition in definitions.findall("score-part"):
        root.append(by_id[definition.get("id")])
    return ET.tostring(root, encoding="unicode"), role_metadata
