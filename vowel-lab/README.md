# Vowel Lab

Serve this directory over HTTPS or localhost and open its index page. The browser
requests microphone access on entry and runs the tracker in a Web Worker. The
chart uses fixed Bark spacing with absolute F1 and F2 readings in Hz. Chart
settings save the trail duration on each device. The default is 0.5 seconds.

Click or touch the chart to hear a vowel. Hold and drag for a continuous glide.
The last reliable sung pitch is saved in this browser. A3 is the starting pitch
on a new device. An audible output context plays a harmonic source through
the two cursor-selected resonances, with two fixed higher resonances. The
microphone uses its own silent analysis context. The preview pitch stays fixed
through a gesture. With the chart focused, arrow keys position the cursor and
Space plays it.

The tracker analyzes 50 ms of audio, fits a 12th-order linear predictor at
10 kHz and identifies peaks in its spectral envelope. It takes a trailing
120 ms median and smooths the resulting frequencies with an 80 ms time
constant. It gates the dot at 15 dB estimated SNR. Wide harmonic spacing
limits accuracy on high notes. The chart marks those estimates with a hollow
dot. Speech landmarks are approximate.

On the website, Record clip saves the original float WAV and matching trace
together in the current browser. The offline rehearsal installation can use
its existing local recordings folder. Raw and displayed formants, analysis
timestamps and the analysis configuration are included in diagnostic clips.

The regression tests in `tests/vowel_tracking.test.cjs` generate audio with
known resonances and pitch, including a sustained vowel, a vowel change,
silence, noise and clipping.
