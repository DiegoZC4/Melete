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
  shift its position away from the visible rest. A delayed animation callback
  cannot leave subsequent pitchbar animation far ahead of the audio clock.
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

### November 18 desktop regression audit

The first shared build restored a retired Step control. Comparing its decoded
players with the preceding website and laptop builds identified the following
behaviors to restore in the shared template.

- Left and right arrow keys preview the selected part directly. A held key
  sustains its note through a score redraw until release. Key repeat and arrow presses during a take
  leave the transport alone. The Step button and its toolbar are removed.
- Continuous Pitchbar follows its own playhead horizontally. The printed
  cursor reaches the current barline before crossing into the next measure
  and retains the release's rendered-rest alignment.
- Shared Pitchbar links carry the view and mix between songs. Parts and
  passage boundaries stay specific to their song.
- Turning Sing on mid-playback uses the native punch-in frame and retains
  input blocks that arrive while the writer opens. An unavailable native
  microphone can be retried with one press.
- Audio Timing offers the recording input selector and headset guidance.
  An unidentified system output can be calibrated for the current session.
  A device change invalidates that measurement.
- Archived review takes use their capture dates when available. An unknown
  legacy time stays blank instead of acquiring a fictitious noon timestamp.
- The recording controls use the earlier compact desktop layout. Segments
  sits beside Mean cents and gets priority over secondary statistics when
  space is tight. Existing explicit column selections still apply.
- This build includes the subsequent fix for switching from Score to
  Pitchbar during capture with a different voice part.

The corrected two-song player has SHA-256
`03417f26ddae7465c88da21ee8d8005cd49afb3920801bf5d34c2a0da9c5caf7`.
The regular desktop shortcut served these bytes for both songs, with the
station's usual native configuration supplied at request time. Both songs
retained their previous score inputs, playback data and song configuration.
The tests used synthetic inputs and isolated browser storage. Physical USB
reliability, measured headphone latency and live cloud login/upload are
outside those checks.

### November 18 deployment and follow-up

The first 18 November artifact was deployed at `https://diegozc.com/autumn-seed/`
through the existing DZC/Hostinger hook and installed on the regular laptop
station. Both initially matched SHA-256
`256f8c5d91b8af3510121aa9ff915b683b834caabdef7e0b453e0f34773c732d`
(11,667,216 bytes), built from player source `d421020`.

Validation passed: 598 JavaScript tests; 151 Python tests with three optional
checks skipped; source CI on Windows, macOS and Linux; focused desktop/mobile
recording, comp, scoring, layered playback, station mixing, singer attribution,
cursor and timing checks; and both songs' take ordering, inline Undo, fullscreen
and Bark vowel-view checks. Original recording blobs, roster and native audio
configuration were verified unchanged after installation.

At deployment the full Linux browser gate was failing: [run 44378830688](https://github.com/DiegoZC4/Melete/actions/runs/44378830688)
timed out waiting for a live Pitchbar contour. Starting a recording in Score
could freeze the last part's Pitchbar range, clipping the current singer's
contour on a view switch even though pitch detection continued. The follow-up
source fix freezes only a current, visible scale. The desktop and mobile
regression now practices a low part first and checks that the higher part's
note and live contour appear without interrupting the take. This follow-up
does not change the deployed artifact or the hardware and cloud limitations above.

### Future releases

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
