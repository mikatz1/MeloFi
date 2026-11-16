# MeloFi Synth: user waveforms and wavetables

Each oscillator can play its own drawn waveform or wavetable. Choose the wave **사용자 파형**, or click
**파형 편집** in the oscillator's heading in the channel sheet.

## Where things are

| File | What it does |
|---|---|
| `renderer/studio/wavetable.js` | FFT, harmonics, points and curves (with tension), safe formula parser, spectral morph, mipmaps, Serum/Vital WAV read and write, pitch-detected cycles from audio |
| `renderer/studio/wavetable-worklet.js` | the band-limited oscillator (one voice) |
| `renderer/studio/synth.js` | wave choice 11, `wt1`/`wt2` tables, `wp1`/`wp2` table position, `wpe` position by the filter envelope, LFO target 4 = table position |
| `renderer/studio/ui/waveeditor.js`, `waveeditor.css` | the editor window |
| `renderer/studio/synth-user.js` | user presets and the 내 파형 library (`userData/synth-user.json`) |
| `tools/e2e/wavetable-e2e.js` | 16 headless checks (see below) |
| `tools/e2e/wt-alias.js` | the aliasing measurement in this report |

A table is stored in the project as `{ name, interp, n: 2048, data }`, where `data` is base64 of the float32
frames back to back. A frame read from a WAV goes back out with the same bytes. Projects without
`wt1`/`wt2` build exactly the same voices as before.

## Band-limited playback

- Each frame is converted to its spectrum once. The mipmap has 21 levels, half an octave apart, holding
  1024, 724, 512 … 1 harmonics.
- A note at frequency f uses only harmonics up to `FOLD = max(0.45·SR, SR − 18 kHz)`: 30 kHz at 48 kHz,
  26.1 kHz at 44.1 kHz. Anything above Nyquist therefore folds back above 18 kHz.
- Content below Nyquist reaches at least FOLD / √2. Moving towards the next level crossfades smoothly, so
  there is no step when a glide crosses an octave.
- Tables are oversampled 16× (up to 2048 samples) and read with 4-point Hermite interpolation. Moving
  between frames is interpolated per sample.
- **Spectral morph** (프레임 사이: 스펙트럼 모프) plays through up to 15 in-between frames per pair. They are
  made by interpolating magnitude and phase.
- A table that changes while notes sound fades in over 1024 samples. A change of table position glides
  with a 15 ms time constant.
- The live engine (`studio.js`) and every export (`StudioEngine.create`) load the same worklet module and
  pass it the same tables.

## Aliasing measurement

Run headless:

```bash
MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/wt-alias.js npx electron .
```

Test signal: a full-bandwidth sawtooth (1023 harmonics), drawn as a user waveform. Filter fully open,
single voice.

- **Stepped:** MIDI 72–124, one semitone per step, 150 ms each. The window is 4096 samples
  (Blackman-Harris). The measure is the energy away from the harmonics of f0 (more than 4 bins off),
  relative to the harmonic energy, from 40 Hz to 18 kHz.
- **Glide:** one note glides exponentially from 1 kHz to 12 kHz over 4 s. The measure is the energy below
  the fundamental (50 Hz to 0.8·f0), where only folded components can land, relative to the fundamental.

Results, 2026-11-14 (main). Worst case over the sweep; lower is better.

| | 48 kHz stepped | 48 kHz glide | 44.1 kHz stepped | 44.1 kHz glide |
|---|---|---|---|---|
| MeloFi user waveform | **−83.1 dB** (MIDI 89) | **−83.8 dB** | **−83.2 dB** (MIDI 87) | **−81.5 dB** |
| Chromium's own band-limited sawtooth (reference) | −86.3 dB | −103.4 dB | −87.0 dB | −105.8 dB |
| The same table without band limiting (linear interpolation) | −4.6 dB | — | −4.5 dB | — |

Per note at 48 kHz (dB):

| MIDI | 72 | 76 | 80 | 84 | 88 | 92 | 96 | 100 | 104 | 108 | 112 | 116 | 120 | 124 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | −87.3 | −86.0 | −89.7 | −86.7 | −83.5 | −87.1 | −86.6 | −97.7 | −86.9 | −89.3 | −97.5 | −102.3 | −87.2 | −95.6 |

Notes:

- The first version used 8× oversampled tables. Its worst case was −67.8 dB at MIDI 76, caused by
  interpolation error, not by folding. 16× brought it to −83.1 dB.
- The rest is mostly interpolation error spread as a low noise floor, about 3 dB above Chromium's own
  sawtooth. Above 18 kHz, components that fold there are intended and are not counted.
- `wavetable-e2e.js` fails if any note from MIDI 96 to 124 is worse than −60 dB. Today's worst is −87 dB.

## Serum and Vital WAV

- **Export:** 32-bit float, mono, 44.1 kHz, 2048 samples per frame, with a `clm ` chunk
  `<!>2048 X0000000 wavetable (MeloFi)`. X is 1 for crossfade and 2 for spectral morph.
- **Vital's rules:** Vital reads the first digit of the second word in the `clm ` chunk as its frame
  interpolation: 0 none, 1 time, 2 spectral. It always cuts frames of 2048 samples. Vital writes 16-bit
  PCM with `<!>2048 20000000 wavetable (vital.audio)`. Source: `src/interface/editor_sections/wavetable_edit_section.cpp`.
- **Import:** PCM 8/16/24/32-bit, float 32/64-bit, WAVE_FORMAT_EXTENSIBLE; stereo is mixed to mono.
  - The frame size comes from the `clm ` chunk (256–4096). Without one it is 2048 when the length allows,
    else a power of two (4096, 1024, 512, 256) that divides the length.
  - A short file without a `clm ` chunk is read as one cycle.
  - Frames that are not 2048 samples are resampled through their spectrum, so they stay band-limited.
- **Checked by the e2e test:**
  - MeloFi → Serum format → MeloFi gives identical frame bytes.
  - A Vital-style file (16-bit, 256 frames, spectral flag) imports exactly and keeps the spectral setting.
  - Files with 256-, 1024- and 4096-sample frames, and a single 600-sample cycle, import correctly.
- **Not yet tested with the real programs.** Neither is installed here. The Serum 2 demo and Vital Basic
  (free) both need an account on the maker's site.

## Tests

```bash
MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/wavetable-e2e.js MELOFI_USERDATA=<tmp> npx electron .
```

The 16 checks:

- the editor opens from the channel sheet
- a drawing changes the sound, and the live voice runs on the worklet
- points, curves and snapping
- harmonics ↔ drawing round trip
- tension, dB bars, all-frames processing, undo/redo, copy/paste/move
- formula, including the unsafe names it refuses
- crossfade and spectral morph, table position moved by the envelope and the LFO
- no click when the table or the position changes under a sounding note
- aliasing on high notes
- the same sound when rendered twice at different block offsets
- the Serum and Vital WAV checks above
- project save and load renders identically
- older projects build the same voices
- 내 파형 user presets and library
- screenshots of the editor in the dark and white themes (`wave-{dark,white}-{harm,draw,formula}.png`)
