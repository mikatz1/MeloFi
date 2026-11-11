# MeloFi

A virtual piano and music studio for Windows. Play right away on your computer keyboard, open a score and listen to it, write a song from scratch, or split a finished track into its instruments and turn each part into MIDI. Everything, including the audio analysis, runs on your own PC.

[한국어](README.md)

## Download

Get `MeloFi-Setup-<version>.exe` from [Releases](https://github.com/mikatz1/MeloFi/releases) and run it. Windows 10 and 11, 64-bit.

- The installer is not code-signed yet, so SmartScreen may warn you the first time. Click **More info → Run anyway**.
- MeloFi tells you when a new version is out. Nothing is downloaded or installed until you click.

## What it does

### Piano

- Play with your PC keyboard or a MIDI keyboard, with sustain, sostenuto and soft pedals.
- Open MuseScore, MusicXML or MIDI scores. MeloFi splits the hands and follows repeats, dynamics and pedalling.
- Export a performance as 4K 60 fps video, MP3, WAV or MIDI. Video is rendered frame by frame, so even dense pieces never drift.
- 12 themes, backgrounds, an audio spectrum and streaming-friendly window sizes.

### MeloFi Studio

A pattern-based composer: build patterns and arrange them in the Playlist, the way FL Studio works. Menus, the top toolbar and shortcuts follow FL Studio. A 13-lesson tour walks you through the screen the first time you open it.

- **Channel Rack and Piano Roll**: step sequencer, swing and groove, arpeggiator, scale lock, chord tools, slide notes, quantize, Riff Machine
- **Playlist**: pattern, audio and automation clips, markers, tempo changes, live mode, microphone recording
- **Mixer and mastering**: effect chains with EQ, compressor, reverb and sidechain, a true-peak limiter, LUFS-targeted auto mastering
- **Synth**: a built-in synth with 11 waveforms, FM and drive, and 141 presets
- **Vocals**: add lyrics to a melody and an open-source singing synthesizer sings it. Two male and two female voices can be installed from the app, and lyrics can be recognised from a recorded vocal and placed on the notes.
- **VST3 instruments**: load the VST3 instrument plugins installed on your PC as channels.
- **Sharing**: MIDI import and export, stems and REAPER projects, MIDI clock out

### Stem separation and MIDI conversion

- Splits an audio file into vocals, drums, bass, guitar, piano and more, and reads its beats, tempo and notes. Open-source models run on your PC; your audio is never uploaded.
- Each part is compared, timbre against timbre, with MeloFi's instruments, and the closest ones are suggested with a match percentage. Listen to the candidates and pick one.
- The analysis engine installs with one click. No separate Python install needed.

### Instruments

Over 220 instruments from freely licensed sample libraries: pianos, electric pianos, organs, synths (including Juno, JD-800 and SH-2 samples), orchestral strings and winds, guitars and basses, mallets, drum kits, and world instruments such as koto and shamisen.

- Apart from the default piano, instruments download on demand straight from their authors' own releases. For libraries published only as archives or SoundFonts, MeloFi fetches just the parts it needs and unpacks them on your PC.
- All samples are lossless, and every instrument has been measured and matched for pitch and loudness.

### Also

- Korean and English.
- Measures microphone and MIDI keyboard latency and corrects recordings for it.
- Projects saved by older versions open and sound the same.
- Error logs stay on your PC. Report a problem sends only what you have read yourself, as a file or a GitHub issue.

## Run from source

```bash
npm install
npm start
```

`npm run dist` builds the installer. Rebuilding the instrument samples needs ffmpeg.

```bash
node tools/build-instruments.mjs <instrument id>   # lossless FLAC and mapping from the original library
node tools/check-pitch.mjs <instrument id>         # pitch check
```

## Tests

End-to-end tests start the app without a window and use its features for real.

```bash
MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/studio-e2e.js MELOFI_USERDATA=out/ud npx electron .
node tools/e2e/compat-run.mjs
node tools/test-repeats.mjs
```

Studio, mastering, vocal, latency, compatibility and language tests live in `tools/e2e/`. Results and comparisons are in [`docs/`](docs) (mostly in Korean).

## Licences and credits

- MeloFi is distributed for non-commercial use only for now, because some instruments, voices and analysis models carry non-commercial licences. The app marks those items.
- Each instrument's author, licence and source are listed in the app's instrument info and in `instruments/<id>/manifest.json`. Only libraries with verified public licences are used: CC0, CC BY, CC BY-SA, CC Sampling Plus, MIT and similar.
- Many SFZ mappings build on the work of [sfzinstruments](https://github.com/sfzinstruments).
- Test scores come from the MuseScore test suite (GPL-3.0).
