# Vowel Lab

Serve this directory over HTTPS or localhost and open its index page. The browser
requests microphone access on entry and runs the tracker in a Web Worker. The
chart uses fixed Bark spacing with absolute F1 and F2 readings in Hz. Chart
settings save the trail duration on each device. The default is 0.5 seconds.

Click or touch the chart to hear a vowel. Hold and drag for a continuous glide.
The amber trail follows the same duration setting as the microphone trail.
The last reliable sung pitch is saved in this browser. A3 is the starting pitch
on a new device. An audible output context plays a harmonic source through
the two cursor-selected resonances, with two fixed higher resonances. The
microphone uses its own silent analysis context. The preview pitch stays fixed
through a gesture. With the chart focused, arrow keys position the cursor and
Space plays it.

VoiceSu's MFCC Gaussian-mixture readout drives the green circle. Its LPC pole
tracker drives the violet square. Both use fixed 512-sample frames at 11,025 Hz
and advance 60 times per second on the audio clock. Each uses a trailing median
and exponential smoothing. The SNR threshold is 15 dB. High notes can still
make formants ambiguous. Chart coordinates and trace exports are absolute Hz.
Pins use the MFCC trace. Speech landmarks are approximate.

The adapter pins upstream revision `cc54abd3887eca90a3c096e0bfc8ca446c0d4e1e`.
The website downloads its modules and weights from jsDelivr. For offline use,
serve that revision of [VoiceSu](https://github.com/brentenjackson/voicesu) at
`./voicesu/` and set the document's `data-voicesu` attribute to `local`.
The laptop's station supplies that path automatically. Both estimators run in
the browser. Replaying a clip computes both tracks from its WAV on this device.
Run `node tests/check-voicesu.cjs PATH_TO_VOICESU` from the Melete root to check
both engines against synthetic vowels, silence and different input rates. The
browser synthesis test also accepts a local checkout through `VOICESU_ROOT`.

On the website, Record clip saves the original float WAV and matching trace
together in the current browser. The offline rehearsal installation can use
its existing local recordings folder. Raw and displayed formants, analysis
timestamps and the analysis configuration are included in diagnostic clips.

The regression tests in `tests/vowel_tracking.test.cjs` generate audio with
known resonances and pitch, including a sustained vowel, a vowel change,
silence, noise and clipping.

## Song maps

Choose a song above the chart, then select a vowel or a syllable in a voice part.
Each selected exemplar has an audio button and F1/F2 readings in Hz. Its patch
encloses the central 80% of paired frames by robust distance in the Bark plane.
Multiple excerpts retain separate boundaries. Early and late diphthong regions
come from the same sung syllable. A triangle marks the late reading and a ring
marks the early reading. An arrow requires displacement beyond their scatter.
Pronunciation alternatives remain individual entries. Hums have no coordinates.
Optional examples from the other song carry its name and a dashed outline.

Run the map builder with Python, NumPy and praat-parselmouth for a score project:

    python tools/build_song_vowel_map.py PROJECT SLUG --traces fresh-lpc.json --output VOWEL_LAB_DIRECTORY

The builder reads the original score, the aligned reference performance, the
song’s pronunciation dictionary and fresh VoiceSu LPC frames in score time.
The trace input is a JSON object keyed by song slug. Each row begins with time
in milliseconds, F1 and F2 in Hz. Use nulls for stale or unvoiced frames.
The output JSON and listening WAV belong with the song deployment. The generic
source checkout contains code and synthetic tests. Standalone links accept
`?song=autumn` and `?song=the-seed`, with an optional `part` equal to the
printed part abbreviation.

The acoustic screen uses the middle 60% of steady syllables and the 15–45% and
67–92% windows of glides. A region needs stable Burg measurements at a 5 kHz
ceiling and agreement with both a 5.5 kHz fit and the classical LPC check.
Strict windows require at least seven agreeing frames and 60% coverage.
Shorter subwindows within the same phase require 80% coverage. A whole phase can
also qualify when at least five fresh samples cover half its frames and median
disagreement stays within one Bark per axis. The displayed Hz range describes
variation in the ensemble recording. Measuring differences between individual
singers requires separate voices.
