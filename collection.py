"""Content-addressed, offline collections of the ordinary standalone player."""

from __future__ import annotations

import base64
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import zlib


ROOT = Path(__file__).resolve().parent


def script_json(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c")


class AssetPool:
    def __init__(self, inflater):
        self.inflater = inflater
        self.inflater_id = self.key(inflater)
        self.assets = {}
        self.raw_bytes = {}

    @staticmethod
    def key(text):
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def add(self, text):
        key = self.key(text)
        if key not in self.assets:
            raw = text.encode("utf-8")
            self.raw_bytes[key] = len(raw)
            self.assets[key] = (None if key == self.inflater_id else
                                base64.b64encode(zlib.compress(raw, 9)).decode("ascii"))
        return key

    def read(self, key):
        value = self.assets[key]
        return self.inflater if value is None else zlib.decompress(base64.b64decode(value)).decode("utf-8")

    def json_chunks(self, value):
        # Large nested PDF/audio/image strings become independent assets, so an
        # identical download in two different song configurations is stored once.
        chunks, pending = [], []

        def flush():
            if pending:
                chunks.append(self.add("".join(pending)))
                pending.clear()

        def encode(item):
            if isinstance(item, str) and len(item) >= 1024:
                flush()
                chunks.append(self.add(script_json(item)))
            elif isinstance(item, dict):
                pending.append("{")
                for index, (key, child) in enumerate(item.items()):
                    if index:
                        pending.append(",")
                    pending.append(script_json(key) + ":")
                    encode(child)
                pending.append("}")
            elif isinstance(item, list):
                pending.append("[")
                for index, child in enumerate(item):
                    if index:
                        pending.append(",")
                    encode(child)
                pending.append("]")
            else:
                pending.append(script_json(item))

        encode(value)
        flush()
        return chunks


class PlayerChunks(HTMLParser):
    """Split only actual raw-text HTML nodes, never markup inside JS strings."""

    def __init__(self, document, pool):
        super().__init__(convert_charrefs=False)
        self.document, self.pool = document, pool
        self.lines = [0]
        self.lines.extend(match.end() for match in re.finditer("\n", document))
        self.pending = None
        self.spans = []

    def source_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.pending = (tag, dict(attrs), self.source_offset() + len(self.get_starttag_text()))

    def handle_endtag(self, tag):
        if self.pending and self.pending[0] == tag:
            _, attrs, start = self.pending
            self.spans.append((start, self.source_offset(), attrs.get("type") == "application/json"))
            self.pending = None

    def chunks(self):
        self.feed(self.document)
        self.close()
        if self.pending:
            raise ValueError("Unclosed player script/style element")
        result, cursor = [], 0
        for start, end, is_json in self.spans:
            result.append(self.pool.add(self.document[cursor:start]))
            content = self.document[start:end]
            if is_json and content.strip():
                result.extend(self.pool.json_chunks(json.loads(content)))
            elif content.startswith("\n" + self.pool.inflater + "\n"):
                # The loader and player use the very same bundled fflate source.
                result.extend(self.pool.add(part) for part in
                              ("\n", self.pool.inflater, content[len(self.pool.inflater) + 1:]))
            else:
                result.append(self.pool.add(content))
            cursor = end
        result.append(self.pool.add(self.document[cursor:]))
        return result


def pack_players(songs, *, title="Melete Collection", download_name="melete-collection.html"):
    if not songs:
        raise ValueError("A collection needs at least one song")
    inflater = (ROOT / "vendor/fflate/fflate.js").read_text(encoding="utf-8")
    pool = AssetPool(inflater)
    manifest = {"version": 1, "title": title, "downloadName": download_name,
                "inflater": pool.inflater_id, "songs": [], "assets": pool.assets}
    ids = set()
    original_bytes = 0
    for song in songs:
        song_id = song.get("id", "")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", song_id) or song_id in ids:
            raise ValueError("Collection songs need unique lowercase slugs; configure a different slug for each score")
        if not isinstance(song.get("title"), str) or not song["title"].strip():
            raise ValueError("Collection songs need nonempty titles")
        ids.add(song_id)
        document = song["html"]
        original_bytes += len(document.encode("utf-8"))
        chunks = PlayerChunks(document, pool).chunks()
        manifest["songs"].append({"id": song_id, "title": song["title"],
                                  "icon": song.get("icon", ""), "chunks": chunks})
    manifest["sizes"] = {"standaloneBytes": original_bytes,
                         "uniqueBytes": sum(pool.raw_bytes.values()),
                         "assetCount": len(pool.assets)}
    return manifest, inflater


def render_collection(songs, *, title="Melete Collection", favicon="",
                      download_name="melete-collection.html", conductor=False):
    from build_trainer import favicon_data_uri, verify_standalone

    for song in songs:
        verify_standalone(song["html"])
    manifest, inflater = pack_players(songs, title=title, download_name=download_name)
    if conductor:
        manifest["conductor"] = True
    template = (ROOT / "template/collection.html").read_text(encoding="utf-8")
    replacements = {
        "__COLLECTION_TITLE__": html.escape(title),
        "__COLLECTION_ICON__": html.escape(favicon_data_uri(favicon or "M"), quote=True),
        "__COLLECTION_DATA__": script_json(manifest),
        "__COLLECTION_INFLATER__": inflater,
        "__COLLECTION_RUNTIME__": (ROOT / "template/collection.js").read_text(encoding="utf-8"),
    }
    # Substitute in one pass: score titles and embedded scripts are data, not
    # further template instructions, even if they contain a marker spelling.
    for marker in replacements:
        if template.count(marker) != 1:
            raise ValueError(f"Collection template must contain {marker} exactly once")
    document = re.sub("|".join(map(re.escape, replacements)), lambda m: replacements[m[0]], template)
    # Each decoded player was checked above; its font is now compressed.
    verify_standalone(document, require_font=False)
    return document
