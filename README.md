# Melete

Convert one or more MuseScore scores into **one self-contained HTML practice player**.
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

### Develop Autumn and The Seed on Windows

From the extracted or cloned Melete source folder, run:

```powershell
py -3 examples/autumn_seed.py ..\Melete-Rehearsal
```

This restores the editable MSCZ scores, song settings, PDFs and reference audio
from the [released singer player](https://diegozc.com/autumn-seed/) on the first
run. It never imports a singer's takes, roster, login or browser storage.
For an offline first run, pass `--player path\to\solstice-practice.html` to
use an already downloaded player. Add `--prepare-only` to restore the inputs
without installing other tools yet. Use a new project folder, not the repo.
With a private copy of the two matching MusicXML exports, add
`--exports path\to\Melete-score-exports.zip` on the first run. The archive
contains only `autumn.musicxml` and `the-seed.musicxml`; the builder verifies
both against the player. This avoids even the initial MuseScore installation.
The repository licenses the software, not the musical material.

For a choir station, keep the real `station-roster.json`, private scores and recordings in the choir owner's private Drive. Download the rehearsal folder before leaving Wi-Fi. The directory has a `singers` list, for example `{"singers":[{"name":"Example Singer","discord":"example.handle","voice":"T2"}]}`. Missing handles can stay blank. Install the directory beside the built player on either computer:

```sh
python3 tools/local_station/directory.py --directory "/path/to/Station setup/station-roster.json" --player "/path/to/index.html"
```

On Windows, use `py -3` instead of `python3`. The command reports the counts and keeps existing take credits and timing edits. Use `--check` for a dry run. To recover the original directory from an older Mac or Windows installation, add `--import-roster "/path/to/old/station-roster.json"` (a Melete `.js` sidecar works too). This merges the private names and handles locally without executing roster files; it stops on conflicting handles. Sync or upload the updated JSON to the same private Drive file so the other computer gets it. Do not sync a running Chrome profile. Use the verified session export or the lossless WAVs to move recorded takes.

Edit the shared code in `template/` or the song configurations in
`Melete-Rehearsal`, then repeat the command. It builds
`Melete-Rehearsal/index.html` using local inputs; it does not fetch the songs again.
Python and Node are required to build. Without matching exports, MuseScore
Studio is also required on the first native-score build.
Subsequent frontend builds reuse verified local exports without launching
MuseScore unless a native score changes. Playing the released HTML needs none of these tools.
For repeated recording tests, use the same browser profile and local origin;
a different origin has separate takes.

### Multiple Songs

Pass all the scores to the same command:

```sh
python3 build_trainer.py "Autumn.mscz" "The Seed.mscz" \
  --project-dir "solstice-web" --output "solstice.html"
```

The collection stores shared player code, libraries, fonts and identical downloads
only once, compressing those assets before embedding. It is still one offline
HTML file, with no CDN requests. Two songs use a compact toggle; larger collections
use a song menu. Visited songs retain their position and settings; switching stops
the previous song's audio/microphone and saves its recording. Song views remain
isolated, rather than sharing mutable player state. Only two-song collections
preload the other score; larger collections load songs when chosen.

One input keeps the usual single-song player. `--config` supplies common defaults;
for different song settings, repeat `--song-config` once per input, in the same order:

```sh
python3 build_trainer.py "Autumn.mscz" "The Seed.mscz" \
  --song-config autumn.json --song-config seed.json \
  --collection-title "Solstice Practice" --project-dir "solstice-web"
```

Each song needs a distinct `slug` (normally inferred from its score title). Keep
those slugs stable to retain browser preferences and recordings across rebuilds.
Links select a song with `?song=its-slug`. For a station drill, use
`?song=the-seed&mode=station&part=B2&loop=19-24`. A shared part or loop
stays in the address until you change it or switch songs. Old links such as
`?station#the-seed` and `?loop=19-24#the-seed` still work.

On Windows, an existing two-song collection can use a local address where Chrome
remembers microphone permission across reloads. Run
`python tools/local_station/station.py "path/to/player.html" "path/to/station-state"`
with the Chrome Default profile that holds the recordings. The first launch
copies that file's takes, tracks, edit history and Melete preferences, then checks
the copy against the source. The station binds to 127.0.0.1 and works offline.
Choose **Allow while visiting the site** on the first microphone prompt.
Use the same launcher for subsequent recording sessions.

For an installed station, update the **player file**, not the Chrome profile or
station-state directory. A maintainer can publish `release.json` beside the HTML,
using `tools/local_station/update_player.py`'s `release_manifest()` helper. Then:

```sh
python tools/local_station/update_player.py "path/to/player.html" --manifest "https://example.org/practice/release.json"
```

Run this explicitly while online, between rehearsals. It checks the release's
SHA-256, size and native-host protocol, replaces the HTML atomically, and retains
one `.previous.html` recovery copy. Offline or interrupted downloads leave the
installed player available. It never reloads a running tab, updates native audio
drivers/helpers, or changes recordings, calibration, singer credits or settings.
Finish recording before reopening the player. Keep the same local URL and browser
profile so the existing library remains available. This is independent of `git
pull` and rebuilding custom scores; those are for pipeline/source updates.

The optional Windows station audio host uses **native WASAPI exclusive** for
both playback and capture. The browser still draws the same player and keeps
the same take library. Ordinary builds, public pages, phones and stations without
a private native configuration continue to use Web Audio; an Electron wrapper
is not required. This is a local, device-calibrated option, not a zero-latency
claim or a recommendation to change an audio driver.

Install `tools/local_station/requirements-native.txt` in the station's Python
environment (or its sibling `native-deps` directory). The station state directory
needs a private `native-audio.json` naming the exact WASAPI input/output, measured
round-trip `seconds`, `reportedLatencySeconds` pair, `callbackFrames`,
`inputChannel`, and calibration date/spread. **Do not copy another computer's
latency numbers.** The current host uses a stereo 48 kHz duplex stream and captures
the configured input channel as mono. Audio setup's timing check updates this
native profile separately from browser calibration. Put a headphone against the
microphone with physical direct monitoring OFF for an acoustic check; remove it
before turning direct monitoring back on.

The host uses sample-frame positions, not HTTP arrival times, for capture and
score alignment. Detected discontinuities or a changed native buffer configuration
stop capture instead of silently grading a broken clock. Microphone audio is
never digitally monitored or processed with browser speech cancellation. Active
recordings also get local PCM recovery files in `native-recordings`; idle input
is only a bounded in-memory ring. The host refuses recordings near a disk-space
floor. Original browser takes and their timing are not rewritten.

Stations with the Windows input-enhancement guard resolve the currently active,
exact-name microphone each time audio opens. Saved endpoint installation IDs
can change after a Windows/driver update. Disconnected entries are ignored;
ambiguous devices, unreadable settings and enabled enhancements still block
capture. This check does not change Windows settings or the saved calibration.

Exclusive mode temporarily reserves those endpoints, so other apps may not be
able to play through them. Close the station to release them. Remove/rename its
private native config and restart to use the existing browser path again.
Keep the driver and sample rate stable. Recheck after changing the physical
route, driver, buffer settings or after a timing fault. Calibration aligns
recordings; it does not remove converter/USB/hardware latency, and brief lab
tests cannot guarantee behavior throughout every rehearsal.

The default collection folder is `FIRST-FILENAME-collection-web`,
with verified native-export caches under `players/`. Failed builds leave the last
good collection in place. The download button saves the whole collection, not
just the currently visible song. Recorded takes remain in browser storage, not
in the downloaded HTML.

### Manually Prepared Parts

The converter does not engrave or combine parts PDFs. Prepare the page order,
facing-page layout and bookmarks in MuseScore/your PDF tool, then attach the
finished file:

```sh
python3 build_trainer.py "Autumn.mscz" "The Seed.mscz" \
  --parts-pdf "Autumn and The Seed - Parts.pdf" --output "solstice.html"
```

Tools > PARTS opens those exact PDF bytes offline. In a collection, the shared
attachment is stored once, not once per song. The option also works with one
score and overrides configured `partsPdf`/`partsPdfUrl` values. Keep this source
PDF outside the generated project directory.

Ordinary singer builds omit `conductorScore`, including any inherited from an
older config. `--with-conductor` explicitly opts into that separately installed
private extension; it is not distributed with this repo. Use a separate output
and project directory for conductor builds. The choir HTML should not carry
reduction graphics, conductor PDFs/MSCs or timing-drill code.

## Pipeline Parameters

**Only the score filename is required.** Title, composer, parts, written pitches,
rhythm, lyrics, tempo and dynamics come from the score; no manual tempo/key setup
is needed. Run `python3 build_trainer.py --help` for the full command reference.

| Parameter | Purpose |
| --- | --- |
| `score [more scores ...]` | One or more `.mscz`, `.mscx`, `.musicxml` or `.xml` inputs. |
| `--output FILE.html` | Where to write the single HTML file. Default: `PROJECT/dist/index.html`. |
| `--project-dir DIR` | Generated development files and export cache. Default: a new `TITLE-practice-web` folder beside the input. |
| `--config FILE.json` | Optional appearance and initial practice settings, described below. |
| `--song-config FILE.json` | Per-song overrides; repeat once per input, in input order. |
| `--collection-title TEXT` | Collection title and download filename (multiple inputs only). |
| `--collection-icon TEXT` | Collection tab icon, an emoji or short text (multiple inputs only). |
| `--parts-pdf FILE.pdf` | Embed an existing, manually laid-out parts PDF unchanged, once for the collection. |
| `--with-conductor` | Private extension only: include configured conductor assets. Omitted by default. |
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
| `recordingCountInBeats` | Length of the permanent, seekable lead-in before measure 1, 1-16 beats (default 4). It does not automatically rewind playback or recording. |
| `partsPdf` | Optional base64 PDF, embedded in the standalone HTML behind Tools > PARTS. |
| `partsPdfUrl` | Optional PDF URL instead of embedding; requires access to that URL. |
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
- Hold a part's **See** cell to isolate it as the recording target. Divided lines
  have separate mixer channels even when notation shares a staff. All MIDI
  **Hear** cells can be off while recordings remain audible.
- The **Practice part** pager cycles through the voices. When faded, tap once
  to isolate your last part; if you have never chosen, it asks. **Tools > Copy
  practice link** shares the guide/backing mix and any active loop, not your
  name, takes, mic state, or voice part. For example,
  `?song=the-seed&myVol=150&otherVol=50&myPan=90&otherPan=-90` asks each
  singer for their part. Add `&part=B2` to bypass the picker. A refresh
  retains personal adjustments. Backing volume is per voice, not a bus gain.
- When you isolate another part, the guide's volume, pan and MIDI Hear setting
  move with you. Each part gets its backing settings back when it stops being
  the guide. Recorded **Hear** layers are independent of this handoff.
- With one part isolated, **Practice > Step** parks the score on a sung note.
  Tap either arrow to move silently; hold either to hear the current note.
  With Sing armed you can check your cents without saving a take. Space or
  Play leaves Step and starts normal timed practice from that note.
- For one-to-one practice, open the player with `?mode=station`. Pick a singer in
  **Practice → Singer** by tap, click, or arrow keys and Enter. Search a name,
  a part code such as A2, or the full part name. The first audio take is the baseline;
  later passes go to the working track without a manual stage switch.
  The chosen singer follows song changes in the same tab. Their assigned part
  is isolated in **See**. The beginner guide starts at **150% / fully right**;
  each other MIDI voice stays audible at **35% / 35% left**. Volume is playback
  gain, not headphone SPL or mic gain. Adjust during a sung phrase; the station
  carries your guide/backing balance to the next singer's assigned part.
  Each singer can still have their own practice speed. An uncertain part is
  chosen explicitly instead of silently recording against the last singer's notes.
  Named recordings stay on the device. A roster is optional and is not embedded.
- Clicking a saved take uses a separate **review mix**, remembered per song
  on this browser. Initially its MIDI part is muted, the other MIDI
  parts are centered at 35%, and the metronome is off. Adjust the ordinary Parts
  controls, recorded-audio volume or reverb without changing the recording mix.
  Tap the faded Practice part to return to recording. In station mode this also
  restores the chosen singer, and review playback never records over their track.
  Outside station mode, arming Sing or starting a pass restores the recording mix.
- The Record table fits columns by available width. Choosing columns manually
  (or **Show all**) overrides fitting. Download in the header exports the
  mastered mix of heard recordings; download in a row exports that take.
  Desktop history uses Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z; touch keeps buttons.
- In station mode, the **link icon** opens **Practice mix**. **Guide split** puts
  your guide and the other voices at two pan positions. **Choir layout** centers
  your seat, with higher sections to your right and lower ones to your left;
  **Stereo width** sets the distance between the outer seats. A soloist shares
  the section's seat. Choose **Preview as** and press Play to hear eight seconds
  of the score without moving the cursor or recording. During playback the mix
  changes live. Closing discards uncommitted edits.
  **Set station default** applies on this browser across songs to new and
  uncustomized singer mixes. **Copy choir link** shares the current draft and
  loop without changing that default or sharing station mode. Singers choose
  their own part, e.g. `?song=the-seed&layout=choir&width=70&myVol=150&otherVol=35`.
  An optional `choirShareUrl` in the song config points a local station's links
  at its published player; without it the hosted station shares its own address.
- Beside the takes table, use the chevrons to expand it down in place or choose which columns
  to show. Station fits columns to the available width by default. Manual
  choices persist across reloads. **CSV** exports every statistic, regardless
  of visible columns; the adjacent download/speaker icon exports audible takes.
  In station mode the empty **New** row comes first; completed tracks retain
  their column sort. Double-click the singer's name (double-tap on touch, Enter
  from the focused name button) to correct the credit. That cannot change the
  recorded part, audio, pitch data or score. Record against the right part for
  a wrong-part take. No final pass is required.
- **Sing** arms the microphone for both audio and scored pitch on the isolated part.
  Press Play or Space to record from the cursor, and again to save. An ordinary
  pause leaves Sing armed. During playback, turn Sing on to punch in or off
  to finish that segment and continue listening. No sign-in is required.
  The track being overdubbed stays silent; Hear-enabled backing still plays.
  A new station singer starts with Sing off. An old pitch-only preference
  cannot enable audio; existing Trace rows can still be reviewed or deleted.
  With Sing off the input track is disabled; leaving the song releases it.
  In **Record > Audio setup**, test the playback route without opening the
  microphone, select an output on supported browsers, or measure the physical
  headphone-to-microphone delay. **Audio log** exports recent audio interruptions
  and calibration events locally; it contains no takes or singer identities.
  To judge entrances, face one headphone cup toward the mic and choose
  **Measure timing**. Three chirps establish the offset; a fourth must land
  within 12 ms after correction. A failed check saves nothing. A successful
  check applies to new takes on that microphone and output, in the same browser
  profile and player origin. It does not expire by date. Changed devices,
  sample rates, capture processing or substantially different reported latency
  require a separate measurement. If a default device can't be identified,
  the check lasts only for the current tab; choose both devices by name to save it.
  Recording also checks the input and playback clocks for sustained divergence
  and warns when entrance timing is unreliable. This cannot detect every
  change inside an audio driver. It does not modify older takes.
  It removes equipment delay, not an individual singer's early or late attack.
  **Score** stays clear while recording. Select a saved take to see its contour
  on the staff; select it again to hide it. **Pitchbar** shows live pitch within
  each system's range at the start of the pass. During capture, out-of-range
  samples leave gaps without resizing the score. Drag previews and chord
  previews in Pitchbar use only the voice lines selected in **See**.
  On a laptop, click a Settings heading to fold or reopen it. Right-click the
  **Record** heading to keep just **Parts** and **Record** expanded. Melete
  remembers the layout on this device.
  Switching views mid-phrase keeps recording and scoring the same take.
  Changing the isolated part selects its most recently edited track. Column
  sorting remains in control, without pinning the selected row or scrolling to
  it. Recording audio updates the selected track; **Add track**
  explicitly creates another layer. Each comp keeps the number of its first take.
  Clicking a track isolates its exact part in See and mutes only that MIDI part.
  **Segments** counts source runs; **Tracked (%)** uses the whole song's written
  singing time for that part, excluding rests and preparation. Divided parts are
  scored against their own notes, not whichever division is closest.
- After a comp edit, small triangles show changes from that track's preceding
  state: green for higher tracking/within-50-cents percentages or lower
  mean/median error, red for the reverse. Hover a value for the delta in cents
  or percentage points. Sorting and ordinary updates retain the comparison;
  equal-scoring edits clear it. Opening existing tracks does not invent a trend.
  Segment count is not graded. Undo/Redo compare with the state they replace.
- **Today** shows rounded recording minutes across songs on this browser origin,
  including repeated/overwritten passages and discarded short attempts. The
  separate daily ledger survives take deletion and reloads; midnight uses the
  device's local calendar. Mic monitoring and playback without recording do not
  count. Recorded rests/preparation do count: this is practice time, not a
  measure of vocal-fold activity or a safe daily dose. Surviving older recordings
  are backfilled once; already-deleted performances cannot be recovered. Cloud
  imports do not add practice time. Clearing site data also clears this ledger.
- Recording **Hear** toggles select the layered mix. In Pitchbar, audible reference contours
  are grey when one part is isolated in See; select a matching row for its
  pitch-error colors. With multiple parts visible in pitchbar view, every
  visible, Hear-enabled recording has its own graded contour, matched to its
  exact part/divisi. Hover a contour (or tap on touchscreens) to identify it.
  Hide a part or mute a recording to remove its contour. Recording requires
  one isolated See part; multiple-part playback does not record, even with
  Sing enabled. Bulk changes prepare the recordings first, then enable
  them together with one mix-normalization pass. Hold Hear to isolate one
  recording, or hold the only audible one to enable all recordings. Unselected,
  muted takes have no contour.
  There is no separate saved "last live contour" behind the take library.
  Pausing retains the selected row and contour. New captures save the live
  detector's timestamped estimates; a comp's visual replacement does not wait
  for audio decoding, assembly or loudness analysis. Missing legacy contours
  still require a first analysis.
  Fixed integrated-loudness gains balance each recording and the audible mix
  toward -14 LUFS, limited by -2 dBTP headroom. This preserves phrasing within
  tracks; it is not live automatic gain control. **Vol**, **Reverb** and
  **Download mix** affect those recordings, including their octave choices,
  not the MIDI accompaniment. Stored source audio is not gain-normalized.
- Listening and WAV exports mute likely breaths in new and
  existing recordings, using unvoiced pitch observations, broadband energy and
  distance from note boundaries. Ambiguous sounds are left alone. This cannot
  perfectly distinguish a gasp from every consonant; stored originals and cloud
  backups remain intact. A separate Stop cleanup fades an isolated terminal
  click only after observed unvoiced silence, never by always removing a fixed
  tail. Wrong but voiced notes and releases are protected; timing is unchanged.
  The named tuning constants are in `template/take_cleanup.js` (`SETTINGS`).
  Version 2 uses 40 ms voiced guards, 100/60 ms attack/release guards, a
  60-1200 ms breath-duration range and an 8 ms fade. It accepts softer and more
  colored inhalations, bridges 20 ms spectral gaps, and pads detected edges by
  up to 30 ms without crossing protected singing. It remains a heuristic;
  fricatives and untracked quiet vowels can still be ambiguous.
- Record's **Undo/Redo** buttons and `Cmd+Z` / `Cmd+Shift+Z` (`Ctrl` on Windows)
  share a maximum 20-edit history across the song's tracks. Extra source audio
  held only for history is also capped at 128 MiB across all songs on this
  browser origin. The first limit reached retires the oldest available history;
  current tracks, favorites and recovery audio do not count toward that cap
  and are never evicted to meet it. Recordings, track creation,
  deletion and cloud restores are reversible across reloads. Text fields retain
  native editing shortcuts. A new edit after Undo clears the Redo branch.
  Replaced source audio is automatically deleted once no track or retained
  history entry needs it, and so is the audio inside kept recordings that no
  track or history entry plays; there is no normal unused-takes table. Failed saves,
  processing failures and interrupted recordings retain a recovery surface.
  The optional audition mode still exposes its individual-take workflow.
- The pitchbar and top playbar include a permanent lead-in before measure 1.
  Seek into it to record or replay early consonants; recording otherwise starts
  wherever the playhead is. The ordinary metronome volume controls all clicks,
  including the lead-in. Preparation is excluded from pitch-error statistics.
  **Oct** is centered text in its table cell; click to cycle `-`, `8va`, `8vb`
  without changing column width, with formant preservation in both playback and
  Download Mix, without altering source audio or timing.
- Part sorting uses SATB then division number, with solo variants beside their
  main part. Dates omit a common year and repeat only the time when modification
  and creation occurred on the same date; full timestamps remain in tooltips.
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

The minimal runtime consists of `build_trainer.py`, `collection.py`, `extract_score.mjs`,
`practice_routes.py`, `template/`, `vendor/`, and the license notices. Tests and
Git history are not needed for conversion. Keep the bundled vendor files: they
make both the build and resulting player independent of CDNs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the regression gate.
Original code is [MIT licensed](LICENSE); bundled dependencies retain the
licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
