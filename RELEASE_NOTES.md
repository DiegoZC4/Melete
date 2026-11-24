# Practice across tabs (2026-11-23)

- The Home Screen app checks a small release manifest on navigation. A verified
  new document can open on the first visit; slow or broken releases leave the
  cached copy usable. Windows stations can subscribe to the same manifest on
  login, wake and network reconnect without a polling process or new listener.

- Healthy offline storage never adds a playbar label. A verified new player
  is available on the next navigation without closing other tabs, interrupting
  a take or clearing site data. A broken download leaves the last good copy.
- Live and saved intonation contours blend from green through gold to red in
  OKLab, between 10 and 50 cents of error. The visual change does not rescore
  takes. These colors and offline behavior do not depend on a Google account.
- An armed, previously permitted microphone yields on tab switch and returns
  when Melete is visible again. An interrupted take is saved; coming back
  does not start playback or another recording. An unavailable chosen input
  is not silently swapped for a different device.

# Microphone recovery (2026-11-23)

- The wired iPad Home Screen stopwatch verifies the live microphone and leaves
  the system's audio-session category alone. It uses four individually coded
  sounds and checks the full 0-1500 ms range. A consistent long delay triggers
  one route reopen; a confirmed long result affects this session only. A
  weak or ambiguous fourth return is not a new calibration. Ordinary Safari,
  Bluetooth and other recording routes do not use the new coded sounds.
- If the wired iPad returns clear evidence of a large delay and the retry
  cannot verify timing, the previous short correction is no longer trusted.
  Sing still saves the original audio as a separate, ungraded take. It does
  not overwrite a comp or penalize the singer. A fresh verified measurement
  enables grading for new takes; it does not retroactively grade that take.

- The meter shows the actual open input, distinguishes unreported processing
  from processing confirmed off, and can restore an explicitly chosen iPad
  mic without changing the headphone output. A silent USB input is not
  automatically assumed to be a headphone accessory.
- The browser stopwatch warms the duplex route before sampling its two
  clocks. Four longer sweeps stay at the same peak volume; only three
  consistent returns and an independent fourth check can save a correction.

- Tap the input meter or the missing-signal warning to see the actual input
  state. A denied or unanswered prompt, an unavailable device, a flat input
  and clipping each have different guidance. Opening the panel does not
  request permission, start recording or stop a take.
- While paused, choose a replacement input and retry from the panel. During
  a take it is read-only. Unanswered requests time out and release late
  grants. The local audio diagnostic log now retains request and error types.

# Offline rehearsal (local, 2026-11-22)

- Prepare the existing Home Screen app once online. The full player is
  verified silently; check the download control's settings help for its status.
  A failed check shows **Retry offline** in Tools. An interrupted update
  does not replace the last good copy or clear recordings.
- A flat microphone during expected singing now raises a warning outside the
  settings panel. Rests do not count and recording continues when input returns.
- On a fresh collection launch, a remembered Sing setting says **Mic on Play**
  until the microphone actually opens. No new permission is requested merely
  by opening the app.

# Cross-browser recording (local, 2026-11-22)

- Fixed a WebKit startup race that could turn Sing off with “Pitch tracking
  unavailable.” The pitch worker now keeps its script until the browser has
  read it; failures and cancellation release it too.
- Added a Firefox, Chromium and WebKit recording gate for both songs in a
  freshly built collection. A take must have audible samples and tracked pitch,
  survive a reload, play with the MIDI muted, and download as a WAV.

# Repeated lyric attacks (local, 2026-11-22)

- Score and Pitchbar now keep each separately written word, even if the pitch
  and text repeat. Compact lyrics still abbreviate runs of backing syllables
  such as `mm`, `oo` and `dm`. Old display markers are recomputed on rebuild.
- This restores both bass parts' second "down" in The Seed m19 and B1's
  second "hold" in m20. Ties, audio, printed scores, and personal lyric masks
  are unchanged.

# Installed iPad playbar (local, 2026-11-22)

- The sticky player header is opaque. Only the installed iPad player reserves
  32 additional points above its controls for the native status-bar blur.
  Regular Safari, phones, desktop, and true fullscreen keep their normal spacing.
- On a physical iPad the original screenshot showed the blur over Play and Seek
  but the web-only capture did not. In the on-device preview, the seek center
  moved from 23 to 55 points below the web viewport. This does not hide or
  change the system microphone indicator.

# Tablet settings and choir player (2026-11-22)

- Touch devices use the available viewport, not a phone-width settings strip.
  Parts sizes to all mixer columns including Ref. Groups wrap side by side;
  on small phones only an oversized mixer needs to scroll horizontally.
- Ordinary builds no longer include the vowel panel or its matching scripts.
  The separate Vowel Lab is unchanged. For development only, the legacy
  integrated experiment can be built with `--experimental-vowel-panel`.
- Tested on a physical iPadOS 27 Safari viewport (1032 by 1244), both real
  scores, and a generic nine-part score plus Ref down to a 320-pixel phone.

# Song handoff and recording (2026-11-22)

- Switching songs carries Sing, the metronome, tempo, viewing mode and the
  part mixer. Matching uses part names and divisi rather than column order;
  horizontal and vertical scale, passages, and recordings remain per song.
- Punching in silences the previous audio of the comp being replaced, including
  when it is selected or explicitly audible. Independent backing dubs retain
  their Hear state. Punching out does not change the listening mix.
- Live and saved pitch contours no longer draw a dark outline over the color.
- Verified with synthetic capture in desktop and phone-sized browsers.
  Native asset ordering has an automated test, not a new physical Windows test.

# Standalone Vowel Lab — 2026-11-22

- Autumn and The Seed each have 11 rehearsal vowel groups. Syllables still
  select their exact pronunciations and recordings; diphthongs, consonantal
  endings and cross-song borrowing are not flattened into family averages.
- Reference clips play the exact decoded sample interval, including when the
  server does not support byte-range seeking.
- The website serves the chart at `/vowels` with no redirect. Song and part
  are query parameters on that same path.

# Shared player release — 2026-11-21

The website and offline station are built from the same template sources and
receive the same HTML artifact and SHA-256 release manifest. The local host
supplies device and latency configuration separately. Releasing the UI does
not require changing drivers, recordings, singer directories or audio settings.

## Included changes

- The standalone Vowel Lab now runs VoiceSu’s trained MFCC tracker (green circle)
  and its LPC tracker (violet square) on a shared audio clock. A saved clip can
  be replayed and scrubbed with both traces even when the microphone is paused.
  The laptop keeps the model offline. The website fetches its weights and
  computes the readings on the device. Smoothness tests cover one diagnostic
  clip and synthetic vowel changes. Accuracy across singers remains unverified.

- The intonation histogram keeps one-cent detail through ±100 cents. Errors
  beyond that range share one flat or one sharp overflow bucket. Each tail
  shows its total measurement count and duration in the detailed table.

- Vowel Lab maps score-aligned choir reference regions for Autumn and The Seed.
  Song colors link IPA keys to each part’s written lyric syllables. Select a
  syllable to hear the best available excerpts and read their F1/F2 in Hz.
  Missing measurements and partial glides remain visible in the key. Optional
  borrowed examples and speech landmarks identify their source.

- Vowel Lab plays the vowel under the cursor at the last reliable sung pitch.
  Holds and drags sound a continuous vowel transition on the fixed Bark axes.

- The take number, sort order and review label follow the most recent capture used in the singer's comp.
  Hover over the number for the saved pass times and the captures used in the mix.
- A successful acoustic calibration realigns earlier local recordings from the same observed audio chain
  across songs. Audio playback, the saved contour and intonation statistics use the new delay.
  Original PCM, capture timing and published versions are preserved. Older recordings need a matching
  previous acoustic measurement to establish their route.

- New tracks appear at the top and scroll into view. Choosing a singer prepares
  their first pass without saving an empty take. A Cloud-only filter switches to All when adding a
  local track, and ordinary table refreshes retain the scroll position.
- Holding a different voicepart in See keeps Sing armed and selects that
  singer’s track for the chosen part. A new part shows a selected empty row
  until its first pass. Switching during a recording saves the previous part
  and arms the new part for the next Play.
- Starting a rehearsal on a new local date gives each singer a separate take
  for each song, part, divisi line and speed. **+** starts another independent
  take that day. Play and Stop keep pickups together within the selected take.
  Older recordings created with **+** appear individually with their original audio.
- Switching songs carries Sing, the selected station singer and a matching
  voice part. Switching during a pass saves it with the outgoing song.
  A linked part takes precedence. Turning Sing off also carries across songs.
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
`b4cc11a919ae577ac57e9feabd8495c8039fc5ccd1b13949f5c461e8b89f1b73`.
The regular desktop shortcut served these bytes for both songs, with the
station's usual native configuration supplied at request time. Both songs
retained their previous score inputs, playback data and song configuration.
The player was built from `1e31175` and published through `DiegoZC4/DZC@8b86512`.
A fresh download of the [website player](https://diegozc.com/autumn-seed/)
and its release manifest matched the installed 11,668,811-byte file.

All 604 JavaScript source tests and 151 Python tests passed locally. Three
optional Python checks were skipped. The source jobs passed on Windows,
macOS and Linux, and the full Linux Chromium browser suite passed in the
[release workflow](https://github.com/DiegoZC4/Melete/actions/runs/44393422737).
Isolated desktop and phone-sized Chrome checks covered held arrow notes,
rest-aligned cursors, scores, column layout and the low-to-high part switch.
Both layouts saved a punch-out near the end of a later loop pass.
Both Autumn and The Seed passed new-take placement, inline Undo and fullscreen
Escape checks. Those checks used generated audio and disposable storage.

Windows Chrome's simulated acoustic calibration intermittently missed one
of four chirps or measured inconsistent intervals in both the previous and
corrected players. In those runs Melete rejected the estimate and retained
the current calibration. The silent-output loop recorder check also remains
intermittent on Windows. For a 3.33-second fixture, saved synthetic takes
measured 3.28 seconds on the preceding build and 3.24 seconds on this one.
Every 100 ms window tested contained the mic tone. The signal check also
rejected an injected one-second gap and guide bleed. Physical USB reliability,
headphone latency and live cloud login/upload remain unverified.

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
note and live contour appear without interrupting the take. The corrected
desktop and website release documented above includes this follow-up.

### Take creation and intonation statistics

- Clicking **+** creates a visible draft for the selected part, including when
  a rehearsal singer is selected. It starts at the top with **0% tracked** and
  dashes for pitch, segments and recording dates. A subsequent sung pass fills
  the draft. The singer's recorded passages still appear in one combined comp.
- **+** selects the draft and immediately mutes all earlier recordings,
  including takes enabled with **Hear** and uploads still loading. The score
  keeps playing. Pressing **Rec** during creation waits for the draft to save,
  then records into it at the playhead using the current singer's recording mix.
- **Tracked** measures how much written singing time is covered by the saved
  pitch contour. The table counts the same short, continuous strokes as the
  score view. Explicit silence, long dropouts and source changes break a stroke.
  Rests and count-in contribute no time to the denominator.
- Click a take's **Mean (¢)** value to see its signed one-cent histogram and an
  exact table of measurement counts and durations. Negative values are flat.
  Positive values are sharp. Mean, median and the 50-cent statistic use actual
  on-note measurements. The histogram retains the scorer's octave equivalence.
- Older local takes can be rescored from their stored contour. For an uploaded
  take, opening its mean retrieves the pitch data and recalculates its table
  metrics. An unopened upload can still show the summary saved at publication.

The take-table browser checks cover Autumn and The Seed, named and unnamed
drafts, and signed bucket counts. Cloud checks cover pitch-only requests and
offline playback using a simulated authenticated server. Physical microphone
capture and the live cloud service are outside these checks.

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
