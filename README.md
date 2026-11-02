# Melete

Convert a MuseScore score into **one self-contained HTML practice player**.
Hear individual parts, loop passages, slow playback, switch between notation and
pitchbars, hide lyrics for memorization, and record yourself with pitch feedback.
Local recordings can be layered and played an octave up or down.

The generated file includes the score, synthesizer, scripts, music font and
libraries. Open it in a browser or share it on a static HTTPS website. **No
account, API key, server, CDN or runtime package download is required.**
Recording stays in the singer's browser; nothing is uploaded. This repository
does not include choir repertoire, recordings, conductor scores or cloud services.

## Requirements

- [Python](https://www.python.org/downloads/) **3.11+**, standard library only.
- [Node.js](https://nodejs.org/en/download) **22+** for score extraction.
- [MuseScore Studio](https://musescore.org/en/download) **4.x** to convert
  `.mscz` or `.mscx`. Not needed for an existing `.musicxml` or `.xml` export.

No `pip install` or `npm install` is needed to run the converter. Runtime
dependencies and their licenses are already bundled. Playwright is only for
developers running browser tests.

## Quick Start

Clone the repo, or use GitHub's **Code > Download ZIP** and extract it:

```sh
git clone https://github.com/DiegoZC4/Melete.git
cd Melete
python3 build_trainer.py "/path/to/My Song.mscz"
```

On Windows, use `py -3` instead of `python3`:

```powershell
py -3 build_trainer.py "C:\Music\My Song.mscz"
```

The command prints the output path, normally
`<score folder>/my-song-practice-web/dist/index.html`. Open **that HTML file** in
a browser. It is the only file singers need, not the whole generated folder.
Keep your score and generated project **outside this repository**.

To try a small synthetic example without MuseScore or your own score:

```sh
python3 build_trainer.py tests/fixtures/shared-regressions.musicxml --project-dir ../melete-demo
```

Then open `../melete-demo/dist/index.html`. The fixture is a software test, not
a complete song.

## Pipeline Parameters

**Only the score filename is required.** Title, composer, parts, written pitches,
rhythm, lyrics, tempo and dynamics come from the score; no manual tempo/key setup
is needed. Run `python3 build_trainer.py --help` for the full command reference.

| Parameter | Purpose |
| --- | --- |
| `score` | Input `.mscz`, `.mscx`, `.musicxml` or `.xml`. |
| `--output FILE.html` | Where to write the single HTML file. Default: `PROJECT/dist/index.html`. |
| `--project-dir DIR` | Generated development files and export cache. Default: a new `TITLE-practice-web` folder beside the input. |
| `--config FILE.json` | Optional appearance and initial practice settings, described below. |
| `--musescore PATH` | MuseScore executable/command if automatic detection fails. `MUSESCORE` environment variable is equivalent. |
| `--refresh-score` | Force a fresh native export instead of reusing a verified export of the same source bytes. |

Example with explicit destinations:

```sh
python3 build_trainer.py "/path/to/My Song.mscz" \
  --project-dir "/path/to/my-song-web" \
  --output "/path/to/my-song.html" \
  --config examples/satb.config.json
```

### Optional JSON Config

Start with [examples/satb.config.json](examples/satb.config.json). All fields are
optional; leave the config out entirely for a normal conversion.

| Field | Meaning |
| --- | --- |
| `title`, `composer` | Override the score's displayed metadata. |
| `browserTitle` | Override the tab title; normally the song title followed by Melete. |
| `slug` | Stable song identifier for filenames and saved browser state. Use a different slug for different songs; keep it stable when rebuilding the same song. |
| `favicon` | One emoji or short text to use as the icon. |
| `demoVideo` | Optional HTTPS recording link; adds a YouTube button. It does not download/embed that recording. |
| `partColors` | Object mapping exact extracted part names to CSS colors. |
| `parts` | Array of per-part `{ "name", "short", "color" } overrides, in score order. Does not alter music. |
| `defaults.practicePart` | Initial part name, short name, source ID, or zero-based part index. Omit to let each singer choose. |
| `defaults.scoreView` | `"standard"` for notation or `"bars"` for pitchbars. |
| `defaults.flow` | `"wrap"` for vertical scrolling or `"continuous"` for horizontal scrolling. |
| `defaults.tempo` | Playback speed **percentage**, not BPM. Default `100`. |
| `defaults.metronome` | Click-track volume percentage. Default `0` (off). |
| `defaults.vertical`, `defaults.horizontal` | Initial scale/stretch percentages. Default horizontal `100`; vertical adapts to screen size. |
| `defaults.volumes`, `defaults.pans` | Arrays in part order: volume `0..200` percent; pan `-100` left to `100` right. |
| `defaults.annotationLayouts` | Compact Lyrics per screen size: e.g. `{ "desktop": "part", "mobile": "shared" }`. |

Saved browser preferences take precedence over initial defaults. Inspect the
generated `assets/score-metadata.json` for extracted part names and order.
Unsupported/complex score features may need a score-specific adapter; there is
no universal parameter that guarantees a faithful conversion of every score.

## MuseScore Detection And Troubleshooting

The builder searches standard macOS/Windows locations and `PATH`. Examples:

```sh
python3 build_trainer.py song.mscz --musescore "/Applications/MuseScore 4.app/Contents/MacOS/mscore"
```

```powershell
py -3 build_trainer.py song.mscz --musescore "C:\Program Files\MuseScore 4\bin\MuseScore4.exe"
```

For Linux or an AppImage, pass the executable's actual path. Native export can
require a working Qt display environment. If export fails, open the score in
MuseScore, export **uncompressed MusicXML**, and give that `.musicxml` file to
the same command. Compressed `.mxl` is not currently an input format.

The converter leaves the original score untouched. It refuses to overwrite an
unrelated nonempty output directory and stages builds before replacing a
previous generated project. Export/extraction errors leave the last good build
intact. An installed `heavy-run` supervisor is used automatically, but it is
optional and is not installed or needed on other machines.

## Sharing And Recording

- Send `dist/index.html`, or host it on any static **HTTPS** website.
- Ordinary playback works offline. Microphone access depends on the browser's
  permissions and secure-context rules; HTTPS or localhost is the reliable
  choice for recording, especially on phones.
- Takes and pitch contours stay in browser storage. They survive refreshes, but
  clearing site data, private browsing, browser eviction or switching origins
  can lose them. Download valuable recordings as WAVs.
- No Google login or cloud backend is configured by this converter. Other
  people's builds do not connect to the maintainer's website or accounts.
- Share a loop with `song.html?loop=19-24`: measures 19 through 23, end exclusive.
  Use `19.3` or `19.3.5` only when beat/fraction precision is needed.
- The HTML contains the score and lyrics. Only share music you have permission
  to distribute. The software license does not license the music.

## Getting Updates

```sh
git pull --ff-only
python3 build_trainer.py "/path/to/My Song.mscz"
```

An unchanged source reuses its verified MusicXML export and rebuilds with the
latest player. Replace/resend the generated HTML yourself: already-shared HTML
does not auto-update. ZIP users can download/extract a fresh repository ZIP.

## Limits

Responsive web engraving is not MuseScore's print layout. Playback uses a
practice synthesizer, not Muse Sounds. Review repeats/jumps, fermatas, swing,
tuplets, polyphonic voices and dynamics against the source before sharing.
Slurs use continuous synthesis with short pitch glides. Text instructions such
as "clap" do not generate percussion automatically. The converter does not
export a printable PDF or embed a source-download button by default.

Native conversion is tested locally on macOS with MuseScore 4.7.5. Source tests
cover Windows/Linux path detection; that is not a claim of native end-to-end
testing on every platform/version. Browser rendering and microphone support
also vary by device.

## Development And License

The minimal runtime consists of `build_trainer.py`, `extract_score.mjs`,
`practice_routes.py`, `template/`, `vendor/`, and the license notices. Tests and
Git history are not needed for conversion. Keep the bundled vendor files: they
make both the build and resulting player independent of CDNs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the regression gate.
Original code is [MIT licensed](LICENSE); bundled dependencies retain the
licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
