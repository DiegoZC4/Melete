"""Restore the published choir inputs once, then rebuild locally with this checkout."""

import argparse
import base64
from html.parser import HTMLParser
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import urllib.request
import zipfile
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_trainer import PROJECT_MARKER_NAME, atomic_write, build, load_config, parse_args, project_marker
from collection import render_collection

URL = "https://diegozc.com/autumn-seed/"
SONGS = (("autumn", "Autumn", "\U0001f341"), ("the-seed", "The Seed", "\U0001f331"))
LIMIT = 48 * 1024 * 1024
EXPORT_LIMIT = 8 * 1024 * 1024
MARKER = "melete-rehearsal-project-v1"
FIELDS = {"audition", "beatGroups", "browserTitle", "chapters", "choirShareUrl", "cloud",
          "composer", "demoVideo", "favicon", "parts", "practiceRoutes", "recordingCountInBeats",
          "schemaVersion", "slug", "title", "lyricCorrections"}


class DataScripts(HTMLParser):
    def __init__(self, document, names):
        super().__init__(convert_charrefs=False)
        self.active, self.values = None, {}
        self.names = set(names)
        self.feed(document)
        self.close()
        if self.values.keys() != self.names:
            raise ValueError("Expected a released Melete choir player")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script" and a.get("type") == "application/json" and a.get("id") in self.names:
            self.active = a["id"]
            if self.active in self.values:
                raise ValueError("Duplicate data script")
            self.values[self.active] = ""

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = None

    def handle_data(self, data):
        if self.active:
            self.values[self.active] += data


def inputs(document, directory):
    manifest = json.loads(DataScripts(document, ["melete-collection-data"]).values["melete-collection-data"])
    if manifest["version"] != 1 or manifest.get("conductor") or [s["id"] for s in manifest["songs"]] != [s[0] for s in SONGS]:
        raise ValueError("Use the Autumn/The Seed singer collection, not a conductor or different collection")
    parts_pdf, metadata = None, {}
    for entry, (slug, title, _) in zip(manifest["songs"], SONGS):
        # Read data nodes only. Never execute JavaScript or import portable singer state.
        document_bytes = bytearray()
        for key in entry["chunks"]:
            value = manifest["assets"][key]
            if value is None and key == manifest["inflater"]:
                continue
            decoder = zlib.decompressobj()
            raw = decoder.decompress(base64.b64decode(value, validate=True), LIMIT - len(document_bytes) + 1)
            if not decoder.eof or len(raw) + len(document_bytes) > LIMIT or hashlib.sha256(raw).hexdigest() != key:
                raise ValueError("Invalid or oversized collection asset")
            document_bytes.extend(raw)
        data = DataScripts(document_bytes.decode("utf-8"), ["trainer-config", "build-metadata"]).values
        config, meta = json.loads(data["trainer-config"]), json.loads(data["build-metadata"])
        metadata[slug] = meta
        score = base64.b64decode(config["sourceScore"]["data"], validate=True)
        if hashlib.sha256(score).hexdigest() != meta["build"]["source"]["sha256"]:
            raise ValueError(f"{title}: embedded score does not match build metadata")
        (directory / (title + ".mscz")).write_bytes(score)
        (directory / (title + ".pdf")).write_bytes(base64.b64decode(config["printPdf"], validate=True))
        shared = base64.b64decode(config["partsPdf"], validate=True)
        if parts_pdf is not None and shared != parts_pdf:
            raise ValueError("The two songs do not share the same parts PDF")
        parts_pdf = shared
        ref = config["referenceAudio"].copy()
        (directory / (slug + ".mp3")).write_bytes(base64.b64decode(ref.pop("data"), validate=True))
        label = ref.pop("label")
        ref.pop("mime")
        (directory / (slug + ".json")).write_text(json.dumps(ref), encoding="utf-8")
        settings = {k: v for k, v in config.items() if k in FIELDS}
        # The builder appends the soloist again from the editable handoff definition.
        extra = [r["soloist"] for r in settings.get("practiceRoutes", [])]
        if extra:
            if settings["parts"][-len(extra):] != extra:
                raise ValueError(f"{title}: unexpected generated practice parts")
            settings["parts"] = settings["parts"][:-len(extra)]
        settings["referenceAudio"] = {"path": slug + ".mp3", "label": label}
        (directory / (slug + ".config.json")).write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (directory / "parts.pdf").write_bytes(parts_pdf)
    (directory / MARKER).write_text("1\n", encoding="ascii")
    return metadata


def install_exports(directory, metadata, bundle):
    # Accept an explicitly supplied local attachment, never fetch or redistribute it.
    with bundle.open("rb") as stream:
        data = stream.read(EXPORT_LIMIT + 1)
    if len(data) > EXPORT_LIMIT:
        raise ValueError("Score export archive is too large")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sorted(archive.namelist()) != sorted(s + ".musicxml" for s, _, _ in SONGS):
            raise ValueError("Expected just autumn.musicxml and the-seed.musicxml")
        for slug, _, _ in SONGS:
            with archive.open(slug + ".musicxml") as source:
                xml = source.read(EXPORT_LIMIT + 1)
            meta = metadata[slug]
            if len(xml) > EXPORT_LIMIT or hashlib.sha256(xml).hexdigest() != meta["build"]["normalizedScoreSha256"]:
                raise ValueError(f"{slug}: score export does not match the released player")
            project = directory / "players" / slug
            atomic_write(project / "assets/score.musicxml", xml)
            atomic_write(project / "assets/build-metadata.json", json.dumps(meta))
            atomic_write(project / PROJECT_MARKER_NAME, project_marker(meta["build"]["fingerprint"]))


def prepare(directory, player=None, exports=None):
    if directory.exists() and (not directory.is_dir() or any(directory.iterdir())):
        raise ValueError("Choose an empty project folder; existing inputs will not be overwritten")
    directory.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory.parent) as temp:
        staged = Path(temp) / "inputs"
        staged.mkdir()
        stream = player.open("rb") if player else urllib.request.urlopen(URL, timeout=45)
        with stream:
            payload = stream.read(LIMIT + 1)
        if len(payload) > LIMIT:
            raise ValueError("Input is too large")
        metadata = inputs(payload.decode("utf-8"), staged)
        if exports:
            install_exports(staged, metadata, exports)
        if directory.exists():
            directory.rmdir()
        staged.rename(directory)


def rebuild(directory, musescore=None):
    songs = []
    with tempfile.TemporaryDirectory() as temp:
        for slug, title, icon in SONGS:
            score = directory / (title + ".mscz")
            cfg = load_config(directory / (slug + ".config.json"))
            cfg["sourceScore"] = {"filename": score.name, "data": base64.b64encode(score.read_bytes()).decode("ascii")}
            cfg["printPdf"] = base64.b64encode(score.with_suffix(".pdf").read_bytes()).decode("ascii")
            path = Path(temp) / (slug + ".json")
            path.write_text(json.dumps(cfg), encoding="utf-8")
            project = directory / "players" / slug
            args = [str(score), "--project-dir", str(project), "--config", str(path), "--parts-pdf", str(directory / "parts.pdf")]
            if musescore:
                args.extend(["--musescore", str(musescore)])
            build(parse_args(args))
            songs.append(dict(id=slug, title=title, icon=icon, html=(project / "dist/index.html").read_text(encoding="utf-8")))
    atomic_write(directory / "index.html", render_collection(songs, title="Solstice Practice", favicon="\U0001f330",
                                                             download_name="solstice-practice.html"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, help="Working folder outside the Melete checkout")
    parser.add_argument("--player", type=Path, help="Use an already downloaded choir HTML instead of fetching it")
    parser.add_argument("--exports", type=Path, help="Optional private ZIP of matching MusicXML exports, for first setup without MuseScore")
    parser.add_argument("--prepare-only", action="store_true", help="Extract editable inputs without building")
    parser.add_argument("--musescore", type=Path, help="Native MuseScore executable for a changed/new MSCZ")
    args = parser.parse_args()
    directory = args.project.resolve()
    if args.player or args.exports or not (directory / MARKER).is_file():
        prepare(directory, args.player, args.exports)
    if not args.prepare_only:
        rebuild(directory, args.musescore)
    print(directory if args.prepare_only else directory / "index.html")
