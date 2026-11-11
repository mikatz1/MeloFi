# Instruments from archives and SoundFonts

Most MeloFi instruments download sample by sample from their GitHub repository. Many good free
libraries are not published that way: FreePats ships `.tar.xz` / `.tar.bz2` / `.7z`, Versilian a
`.zip`, linuxaudio.org a `.tar.7z`, and a lot of General MIDI material only exists inside SoundFonts
(`.sf2`). This document describes how MeloFi installs those **from the original publisher, on the
user's PC** — nothing is re-hosted.

## Manifest `source` kinds

`instruments/<id>/manifest.json` keeps its usual `samples` and `regions`. `source` says where the
app gets each sample (`s/0000.flac` etc. — the name is only a key; the bytes are whatever the
library ships, WAV or FLAC, and the audio decoder sniffs the format):

| kind | fields | what the app does |
|---|---|---|
| *(none)* | `repo, branch, files` | unchanged: one raw.githubusercontent.com request per sample |
| `archive` | `url, format, size, sha256, bytes, files, sha` (+ `zip` for zips) | see below |
| `sf2` | `url, size, sha256, smpl, sm24, bytes, ranges, files` | see below |

`files` maps each sample to its path inside the archive, or `{ stereo: [left, right], frames }`
for two mono files that are joined into one stereo file. `sha` (archive) / `files[].sha256` (sf2) is
the SHA-256 of every finished sample as produced at build time; the app checks each one, so it
plays exactly what was auditioned.

### Archives (`lib/install-source.js`)

* **zip on a host that honours HTTP Range** (`source.zip` holds each entry's data offset, sizes,
  method, CRC): only the entries the program uses are fetched, inflated with Node's zlib and
  CRC-checked. Etherealwinds Harp II CE: 79 MB instead of 215 MB.
* **everything else**, or when the host answers a Range request with the whole file: the archive is
  downloaded once to `userData/instruments/_downloads/<id>.<format>` (resumable from its `.part`,
  progress, cancel), checked against `sha256`, unpacked in a worker thread — only the files the
  instrument needs, written straight to `userData/instruments/<id>/s/` — and deleted.
* Formats: `zip`, `7z`, `tar.xz`, `tar.bz2`, `tar.gz`, `tar`, `tar.7z`.

### GitHub release assets

Many libraries keep their SFZ programs in the git tree but the audio in **GitHub Releases** — often
one zip cut into parts (`Audio.zip.001`, `.002`, …). That is an `archive` source whose `url` is the
release download URL, or whose `parts: [{ url, size }]` list the pieces in order. The parts are one
file cut up, so the app reads a byte span across them (a zip entry may straddle two parts); GitHub's
release downloads redirect to a CDN that honours Range, so only the needed entries are fetched. The
whole-file fallback downloads every part, joins them and unpacks. Release assets publish no hash, so
`sha256` may be null for them; every sample produced is still checked against its own SHA-256.

At build time the program comes from the git tree (`sfzFrom`), placed where its relative sample paths
point into the zip (e.g. `juno6/SFZ/…` for `../Audio/…`), optionally rewritten (`transform`: Meta Open
Sound's maps point at `ogg/*.ogg` previews and add per-string MIDI channels 2–7; they are pointed at
the release's lossless WAVs and cut to channel 1).

Samples stored as **AIFF** (publicsamples) are rewritten as WAV by the app: same samples, byte order
only (`lib/wav.js` `playable()`), because Chromium's audio decoder doesn't read AIFF.

### SoundFonts

At build time `lib/sf2.js` reads the SF2's RIFF structure (only the `pdta` list — presets,
instruments, zones and sample headers; the sample data is never parsed) and plans one preset:

* zones are resolved per the SF2 2.04 rules: instrument-level generators are absolute (local zone
  over global zone over defaults), preset-level ones are added on top, key/velocity ranges are
  intersected; root key = `overridingRootKey` or the sample's own pitch; tuning = coarse·100 + fine
  + the sample's pitch correction; `initialAttenuation` uses FluidSynth's EMU-compatible 0.4 scale
  (MuseScore General was voiced on FluidSynth); release = 0.4 × `releaseVolEnv` (MeloFi's release
  is exponential, SF2's is linear in dB — this matches the decay slope); attack passes through.
* `scaleTuning` ≠ 100 (taiko, effects) becomes one region per key with the pitch moving
  `scaleTuning` cents per key.
* a linked left/right sample pair on the same keys becomes one stereo file; the same mono sample
  layered twice (panned left and right) is kept once.
* **lossless**: a sample that plays as stored is copied bit for bit into a 16-bit WAV (24-bit when the
  font has `sm24`). MeloFi's sampler has no decay stage, so where the SF2 volume envelope *decays* a
  looped sample (celesta, electric piano, koto, …) the decay is rendered into the file: the loop is
  unrolled with the envelope applied until the sustain level is reached, then the file ends on one copy
  of the loop at that constant level and loops it (or ends under −90 dB when the sustain is silence).
  Baked files are 24-bit so the gain change adds no audible quantisation. Capped at 30 s.
* the byte ranges of the font that hold those samples are recorded (merged when less than 256 KB
  apart) with a SHA-256 each. The app fetches **only those ranges** (HTTP Range) — e.g. 0.1–5.5 MB per
  preset out of MuseScore_General.sf2's 216 MB — and renders the WAVs with the same code. If the host
  ignores Range, it downloads the whole font (checked against its SHA-256), renders, and deletes it.

**Premixed layers (opt-in, `premix`):** a preset whose one-shot zones sound together (GeneralUser's Orchestra
Hit: two hits panned hard left and right, one tuned −12.25 semitones from the other) is rendered as an SF2 synth sums
it: per key range with the same set of layers, each layer with its attenuation, pan (constant-power, centre = 1),
root key, tuning and volume envelope, resampled (Blackman-windowed sinc, 32 zero crossings) to the layer with the
highest sample rate, which is copied at step 1. 24-bit; a mix that would clip is scaled down as a whole and the
region gain gives it back. Checked: the reference channel equals Hit-2 × its gain to the LSB, the other layer's
main partial moved −8.27 st (spec −8.25), mix peak −1.1 dBFS; the app re-creates both files to their pinned hashes.

Not modelled (MeloFi has no per-voice filter/LFO/modulators): `initialFilterFc`, modulation
envelopes and LFOs, default modulators. Presets that sound **several zones at once** are refused by the
build (`planPreset().layers > 1`): MeloFi plays one region per note, so they would not sound as
designed. That leaves out GM FM Electric Piano, Music Box, Chiffer Lead, Charang, Solo Vox, Metal Pad,
Halo Pad, Atmosphere and Echo Drops — they become possible if the sampler learns to layer regions.

### Programs that pan separate L/R files

FreePats' Percussive and Rock Organ Emulations map a left and a right mono file onto every key with
`pan=±100`, and the two have different loop starts. The build joins each pair into a stereo file
(the app does the same interleave, bit for bit) and picks a common loop start where both channels
continue smoothly — value and slope both match, at least one second of loop. The worst seam is
3.6× an ordinary sample step, below the originals' own worst seam (4.5×).

## Why our own extractor (`lib/unpack/`)

The app needs xz, bzip2, 7z (LZMA/LZMA2) and zip, with no native modules (Electron rebuilds,
code signing) and no network dependencies at runtime. The options were:

* **Windows' `tar.exe`** (libarchive) reads all of these on current Windows 11, but older Windows 10
  builds ship it without xz/bzip2/7z support — not something to depend on.
* **npm packages**: `7z-wasm` (whole 7-Zip in WebAssembly, ~1.5 MB, LGPL with the unRAR restriction),
  `lzma-native` (native), `xz-decompress` (wasm, xz only), `unbzip2-stream` / `seek-bzip` (bz2 only).
  Several packages and licences for four formats.
* **a small pure-JS decoder set** (~1,100 lines, Node built-ins only): LZMA/LZMA2 after the public-domain
  reference decoder in the LZMA SDK, the .xz container, bzip2, a streaming tar reader, the 7z header
  and folder format (Copy, LZMA, LZMA2, BZip2, Deflate, Delta), and zip (zlib for inflate).

We chose the last one. Checks run here: every archive below was unpacked with it and compared
byte-for-byte with libarchive (bsdtar) output — FreePats tar.xz ×3, tar.bz2, a 7-Zip-made FreePats
7z, and bsdtar-made 7z archives with LZMA1, LZMA2, BZip2, Deflate and Copy, plus zip — all identical.
Speed: ~9 MB/s of LZMA output (the 502 MB tar inside Salamander's 7z: 83 s), run in a worker thread
with the archive deleted afterwards. Unsupported on purpose: encrypted archives and executable
branch filters (BCJ), which sample libraries don't use.

## Build side

`tools/libs-archive.mjs` defines the entries; `tools/build-instruments.mjs` merges them and calls two
hooks: `prepare()` (download/unpack, or fetch zip entries / plan the SF2 preset and write an SFZ next
to the WAVs) and `sourceFor()` (the manifest `source`). Archives are cached in
`instruments/_dl/_archives/` and checked against the pinned SHA-256 and size; a changed file at the
publisher stops the build instead of shipping a mismatched manifest.

* `node tools/sf2-preset.mjs <file.sf2>` lists presets; `… <bank> <program>` shows zones, files,
  ranges and envelopes of one.
* `node tools/check-pitch.mjs <id>` — plus `node tools/check-pitch-loops.mjs . <id>` for instruments
  whose samples are shorter than check-pitch's window (it plays the loop like the sampler does).
* End to end, headless, through the app's own IPC:
  `MELOFI_USERDATA=<scratch> MELOFI_SHOT=<dir> MELOFI_SCRIPT=tools/e2e/archive-e2e.js electron .`
  (download → extract/convert → load → render a phrase and two held notes → loudness and pitch).
  `MELOFI_TEST_NO_RANGE=1` forces the whole-file fallback.

## Light drum kits

Multi-mic kits store every hit once per microphone with many velocity layers (Virtuosity Drums
1.5 GB, Naked Drums 1.3 GB on GitHub). MeloFi plays one region per note, so a light build keeps per
key **one microphone** — the drum's own close mic (kick in, snare top, toms, hi-hat, ride, percussion),
the overheads for crashes/splashes/china and anything without a close mic — and **at most four velocity
layers** spread over the range (softest and loudest always kept). Samples are the originals, untouched;
round robins are reduced to the first, as for every MeloFi instrument. The program is written as an SFZ
next to the library (`_melofi/<id>.sfz`) and downloads like any GitHub instrument.

## Instruments added

| id | source | licence | download |
|---|---|---|---|
| drawbarorgan | FreePats Drawbar Organ Emulation (tar.xz) | CC0 | 6.0 MB |
| percorgan | FreePats Percussive Organ Emulation (tar.xz, L/R joined) | CC0 | 12.4 MB |
| rockorgan | FreePats Rock Organ Emulation (tar.xz, L/R joined) | CC0 | 12.6 MB |
| steelguitar | FreePats FSS Steel String Guitar (tar.xz) | GPL-3.0+ with the FreePats sample exception | 13.1 MB |
| jawharp | FreePats Jaw Harp (tar.bz2) | CC0 | 1.9 MB |
| harp2 | Etherealwinds Harp II CE, Versilian Studios (zip, Range) | CC BY 4.0 | 78.7 MB of 215 MB |
| koto, shamisen, shakuhachi, taiko, panflute, gmbagpipe, gmcelesta, harmonium, gmaccordion, churchorgan, clav, tineep, warmpad, polysynth | MuseScore_General.sf2 0.2 presets (SF2, Range; sitar and shehnai left to the Discord GM bank versions on main) | MIT — FluidR3 © Frank Wen, FluidR3Mono © Michael Cowgill, MuseScore_General © S. Christian Collins (notices kept in each credit) | 0.04–5.5 MB each |
| salamanderkit | Salamander Drumkit, linuxaudio.org (tar.7z) | CC BY-SA 3.0 (music made with it is free) | 360 MB archive, ~60 samples kept |
| virtuositylight | Virtuosity Drums (sfzinstruments/virtuosity_drums), light: 138 of 735 samples of the basic kit | CC0 | 57 MB (repo 1.5 GB) |
| nakeddrums | Naked Drums (sfzinstruments/WilkinsonAudio.NakedDrums), light: 63 of 207 samples of the CR program | CC BY 4.0 | 21 MB (repo 1.3 GB) |
| avlblackpearl, avlredzeppelin | AVL Drumkits (studiorack/avl-drumkits), kept whole: one mono mix, 5 layers | CC BY-SA 3.0 | 9.0 / 10.5 MB |
| junopad, junopulsebass, junosawbass, junopluck | publicsamples Roland Juno-6 (release Audio.zip, AIFF) | Public domain (Unlicense text) | 81 / 20 / 8 / 17 MB of 960 MB |
| sh2rezzysaw, sh2wowbass, sh2pwm | publicsamples Roland SH-2 (release zip) | Public domain | 27 / 15 / 3 MB of 1.07 GB |
| jd800lead, jd800digi, jd800pluck | publicsamples Roland JD-800 (split release zip, 2 parts) | Public domain | 57 / 20 / 102 MB of 1.66 GB |
| jx8ppad | publicsamples Roland JX-8P (split release zip, 3 parts) | Public domain | 96 MB of 2.5 GB |
| metasteel, metanylon, metapiano | Meta Open Sound (release WAV zips; SFZ from the tree) | CC0 1.0 | 3 / 3 / 4 velocity layers; see the manifest `bytes` |
| guslapbass, gufretless, guorchhit | GeneralUser GS 2.0.3 (SF2 in the git tree, commit-pinned, Range) | GeneralUser GS License v2.0 (free use, also in software; the author can't vouch for every sample's origin) | < 10 MB each |

Measured pitch of the vintage synth patches (they are mapped as played: key = the note sent to the
hardware). The Juno-6 pads and basses and the JX-8P pad carry a strong sub-oscillator one octave
down (−4 … +14 dB against the played note), so check-pitch reads −12, like the setBfree organs' 16′.
Some SH-2 patches were recorded in a low footage and are dominated by the octave or two below the
played key (Short PWM: two octaves down +29 … +38 dB). If song matching wants sounding pitch, these
need a `shift` per instrument.

Not added from the candidate list, and why:
* **JummBox SoundFont** — only on itch.io, whose download links are one-time signed URLs; there is no
  stable address the app can fetch from.
* **SHLD Minifreak / Wavestate pads** — Patreon attachments; their URLs carry expiring tokens, so the
  app would have to call Patreon's API at install time.
* **GeneralUser Slap Bass 2** — it sounds two *looped* zones per note; loops of different lengths can't be
  summed into one seamless loop, so it needs the sampler to layer regions.
* **Alpha Juno** (no hoover patch; a construction kit of chorus saws in 8 layers), **Korg DW-8000** (its
  release zip doesn't match the tree's sample paths), **Xpander**, **EM-25** (no SFZ), **Jupiter-4**:
  possible with the same mechanism, left for a follow-up.

Licences were read on the publishers' own pages on 2026-11-12: freepats.zenvoid.org
(Organ/electric-organ, Guitar/steel-acoustic-guitar, Ethnic/jaw-harp), versilian-studios.com/etherealwinds-harp,
ftp.osuosl.org MuseScore_General_License.md and MuseScore_General_Sample_Sources.csv (every preset used is
FluidR3 or S. Christian Collins material), the Salamander Drumkit readme inside the archive and archive.org's
record, and the LICENSE files of the GitHub kits.

## Test results (2026-11-12)

* `node tools/test-archive-import.mjs`: 22/22 — six real archives (tar.xz ×4, tar.bz2, 7z) unpack identical
  to bsdtar; all 16 SoundFont instruments re-render from the font to their pinned SHA-256 and their ranges match.
* Pitch: `tools/check-pitch.mjs` on every melodic addition — within ±0.2 semitone, except where the check
  can't apply: the three setBfree organs read −12 because the GM drawbar registration (88 8000 000) includes
  the 16′ sub-octave (the spectrum shows 16′, 5⅓′ and 8′ partials of the mapped key); jaw harp and taiko are
  unpitched; samples shorter than the check window (shanai, reed organ, shakuhachi) were checked with
  `tools/check-pitch-loops.mjs` (it plays the loop): within ±0.07.
* Headless end to end (`tools/e2e/archive-e2e.js`, scratch userData), 22 different instruments over four runs:
  each downloads through the app's IPC, installs, renders a phrase that is not silent (−23 … −40 LUFS) and
  held notes on pitch (±0.08 st for melodic instruments). Range mode: tar.xz, stereo-joined tar.xz, tar.bz2,
  remote zip (harp2: 79 MB of 215 MB), SF2 presets, the four GitHub kits; Salamander's 360 MB tar.7z in 270 s
  with the archive deleted afterwards. Whole-file fallback (`MELOFI_TEST_NO_RANGE=1`): harp2's zip and the
  216 MB SoundFont both pass. Cancel keeps the `.part` and the next install resumes from it; a corrupted
  `.part` is caught by the hash and downloaded fresh once.

Found on the way: the Studio sampler (`renderer/studio/channel.js`) ignored the manifest's loop (`ls`/`le`)
and attack (`a`), so in Studio every looped instrument stopped when its sample ran out; fixed (one line).
Baked SF2 files are 24-bit and longer than their source, so some take more disk than they download
(Clavinet: 0.2 MB fetched, 20 MB on disk).
