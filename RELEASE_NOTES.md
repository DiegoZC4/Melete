# Shared player release — 2026-11-18

The website and offline station are built from the same template sources and
receive the same HTML artifact and SHA-256 release manifest. The local host
supplies device and latency configuration separately. Releasing the UI does
not require changing drivers, recordings, singer directories or audio settings.

## Included changes

- New tracks appear at the top and scroll into view. Choosing a singer prepares
  their first pass without saving an empty take. A Cloud-only filter switches to All when adding a
  local track, and ordinary table refreshes retain the scroll position.
- A singer's comp is presented once per song and playback speed, including
  passages recorded in different stages or voice parts. Source captures and
  grouped Undo history remain protected. Group edits exclude an unsaved next
  pass, and singer corrections recognize legacy captures' saved attribution.
- Delete/Undo stays beside the affected row. Automatic empty-take cleanup
  requires verified zero-valued audio and preserves protected sources.
- Local excludes uploaded recordings even when cached on the device. Cached
  cloud recordings retain their publication identity and cannot be overwritten
  or uploaded again as editable local recordings.
- Hear changes the playing mix immediately, including the native station host.
  Mixer pan and volume resets preserve the recording transport.
  Changing the station default also preserves a singer's custom pan and volume.
- Saved and live pitch contours share continuity rules. Singing during rests
  remains visible in red, while average cents error uses only samples that
  overlap written notes. Rest-only fragments do not count as sung segments.
- Ordinary rests retain breaths and room sound; attenuation is limited to the
  middle of rests longer than ten seconds. Source recordings remain intact.
- Reviewed audio is cached on the device, note previews start promptly, pitch
  contours remain visible on the score, and volume/pan labels support scrolling.
  CSV export and source filters live with the take-table column controls.
- Escape exits fullscreen before closing settings. Active practice requests a
  screen wake lock when the browser supports it.
- The score cursor uses rendered rest edges so platform font metrics do not
  shift its position away from the visible rest.
- The optional vowel view uses fixed Bark spacing, absolute F1/F2 in Hz, trails,
  pinned examples and timed syllable targets. Ties and melismas sustain targets;
  rests and non-vowel syllables clear them. No F0 is displayed or used to
  normalize formants. Restoring a published project preserves vowel settings.

## Limits and follow-up

- The vowel estimator remains experimental, particularly on high sung pitches.
  Landmarks are approximate speech references, not blend grades. Missing or
  uncertain estimates remain visibly unavailable. The separate full VocalTrack
  evaluation app is not folded into the practice player by this release.
- A USB microphone losing electrical power is not fixed by a UI release.
  Long-session physical-device reliability and headphone round-trip latency
  require hardware checks; existing native driver and calibration settings are
  retained.
- Source tests and isolated browser checks use synthetic recordings. They do
  not establish live Google login/upload behavior or physical audio quality.
  Deployment verification and exact test results belong in the release handoff.

## Release procedure

Run the source and browser gates in CONTRIBUTING.md. Build the song collection
once from the reviewed source revision, then create `release.json` with
`tools.local_station.update_player.release_manifest`. Preserve the previous
player, upload the new HTML and publish its manifest last, and verify a fresh
download against the manifest. Install those identical bytes on the laptop at
the existing origin after playback/recording stops. Verify song identities,
recording availability and unchanged native configuration. A GitHub push alone
does not update either deployed player.

For the current deployment, `DiegoZC4/Melete` holds the shared source.
Hostinger's active push webhook deploys `DiegoZC4/DZC` `main`; the built files
belong at `autumn-seed/index.html` and `autumn-seed/release.json` there.
The website repository contains the release artifact, not a second UI source.
