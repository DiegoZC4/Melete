# Reference timing editor

This static authoring tool is separate from the singer player. Its only audio
input is the original recording. Serve the HTML, CSS and JS here alongside
`catalog.json` and one `<song-id>.json` per song. No microphone or account
is involved. The included beat-drag helper and guide synth come from the
Solstice audition editor; the small icon set uses the vendored Lucide license.

The catalog contains `songs: [{id, title}]` and, optionally, a local
`applyUrl`. Each song descriptor supplies `base` (the primary tick/absolute
source-second pairs, ending on the final vocal release), reviewed `anchors`,
`baseId`, an opaque project `revision`, `song`, a same-origin `audio` URL and
`sourceSeconds`, plus the playback JSON's `parts`, `notes`, `lyrics`,
`division`, `measures` and `endTick`. The first anchor is **not** necessarily
at 0 seconds. The source recording must include any lead-in specified in this
clock. The choir's `prepare_reference.py` is a working adapter.

For a static deployment, export from the toolbar and pass the JSON to
`tools/prepare_performance.py --review` with the same score, recording,
alignment report and beat groups. Where configured, the loopback Apply route
accepts the same export plus the expected revision and reports the revision
of the rebuilt project. Local drafts are not a substitute for applying or
exporting a reviewed map.
