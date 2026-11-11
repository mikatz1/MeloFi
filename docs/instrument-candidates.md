# Instrument candidates for the archive importer

Free sampled instruments that fill parts MeloFi still lacks, but that cannot be built straight from a
public GitHub git tree by `tools/build-instruments.mjs`. They are zip / 7z / SF2 / release-asset /
Freesound downloads, or they need a file format we do not read yet (EXS24, DecentSampler, one file per
patch). This list was collected on 2026-11-12. Libraries already added from GitHub are in
`tools/libs-more2.mjs`.

**Licence status:** "verified" means the licence was read on the library's own page or in its licence
file. Anything else is marked. Freesound downloads need a login, which the user has not given.

## High priority: parts the test songs use and MeloFi has no sampled version of

| name | part it fills | URL | licence | format | size | notes |
|---|---|---|---|---|---|---|
| Public Domain Orchestra Hits (astro_denticle) | **orchestra hit** (ORCH5-style stab, J-core / 80s pop) | https://freesound.org/people/astro_denticle/packs/44108/ | CC0 (verified on sound 822402; each hit is cut from PD/CC0 recordings, with provenance in its description) | WAV one-shots | small | Includes a hit from Stravinsky's *Firebird*, the piece ORCH5 came from. Needs a Freesound login. The hits are in various keys, so map them across the keyboard ourselves. |
| GeneralUser GS 2 (S. Christian Collins) | GM fill-ins: **orchestra hit, slap bass 1/2, fretless bass, shamisen, koto, shakuhachi**, choir aahs / voice oohs, synth voice, music box | https://github.com/mrbumpy409/GeneralUser-GS (licence: `documentation/LICENSE.txt`) | Custom permissive (verified): use without restriction, may be modified and used in software; host your own copy | SF2 in the git tree | ~30 MB | The SF2 needs an SF2→SFZ step (the sf2 path the archive importer already has for MuseScore_General). The author says sample origins are "not 100% certain", so use it only where nothing dedicated exists. |
| Rickenbacker 4001 (Project 16) | **slap bass** (Slap1/Slap2, long and short), muted and picked bass | https://github.com/sfzinstruments/Project16Rickenbacker4001 | CC BY-NC-SA 3.0, **modified** (README): "You are not allowed to use this product in a sampling library or in a related product" | SFZ + WAV (git tree) | 508 MB in total; Slapped is about a quarter | It sits in a GitHub tree but was **not added**: MeloFi's download centre is arguably a "related product". Ask the author (project16@rocketmail.com) or the user before adding. It is the only real multisampled slap bass found with a public licence. |
| Contrabass_Sounds (jdstarrett) | **fretless** bass (fretless electric contrabass, every pitch) | https://freesound.org/people/jdstarrett/packs/1394/ | CC BY 4.0 (verified on sound 22592) | WAV per note | small | Closest real fretless found. Freesound login needed. |
| Meta Open Sound: Steel Guitar / Nylon Guitar / Piano | steel-string acoustic (E2–C6, all six strings chromatic, 3 layers), nylon guitar, upright piano | https://github.com/facebookincubator/Meta-open-sound/releases | CC0 (verified in the repo README and LICENSE) | WAV 24/48 zip on Releases; the git tree has OGG only | ~hundreds of MB | The git tree holds only lossy OGG previews, so it was not added from git. Take the WAV release zips. The steel guitar would complement `acoustic` (Shinyguitar) for J-pop strumming. |
| JummBox SoundFont (stgiga) | **chiptune** GM bank: pulse 12.5/25/50 %, triangle, noise, FM | https://stgiga.itch.io/jummboxsoundfont | CC BY-SA 4.0 (itch page) | SF2 | ~1 GB | Rendered from the JummBox chip engine, which is what chiptune is; not a substitute. Name-your-price ($0). Fills the POLYBIUS GB / chip parts. |
| SampleScience Analog Waveforms v2 (samples) | looped saw / triangle / pulse multisamples (triangle bass, plain pulse lead) | https://samplescience2.bandcamp.com/album/analog-waveforms-v2-audio-demo | Samples placed in the public domain (bandcamp page; the plugin itself is not) | WAV 16/44.1 | 355 MB | Bandcamp name-your-price. No 12.5/25 % duty cycles. |

## Vintage synth multisamples (publicsamples / Modular Samples: public domain)

Every repository in https://github.com/orgs/publicsamples has an Unlicense-style "public domain"
LICENSE (verified in Roland-Juno-6 and Korg-Minilogue; check each). The SFZ files are in the git tree,
but the audio is on **GitHub Releases** (often split zips), except Korg-Minilogue, Synth-Hits,
Jen-SX-2000 and Korg-Volca-Keys-Construction-Kit. Two Minilogue programs are already added
(`minichorus`, `minibell`).

| repo | part it fills | notes |
|---|---|---|
| Roland-Juno-6 | Juno pads, strings, brass, bass (city pop, synth-wave, J-pop) | 19 patches, SFZ in tree, ~1.5 GB of releases: pick patches |
| Roland-Jupiter-4 | Jupiter poly: bass, keys, lead, pads, FX | ~9 GB of split zips (15 × ~954 MB): pick individual patches |
| Roland-JX-3P, Roland-JX-8p, Roland-HS-80 | JX pads, brass, strings (80s J-pop) | 62 / 6 / 16 SFZ in tree |
| Roland-Alpha-Juno | Alpha Juno **hoover / rave stabs** (J-core, hardcore) | 113 SFZ in tree |
| Roland-JD-800 | early-90s digital pads and bells (closest to D-50 / JV) | 13 SFZ |
| Roland-SH-2 | mono analog bass and lead (SH-101 / 303 territory) | 22 SFZ |
| Korg-DW-8000, Korg-Z1, Korg-MonoPoly | hybrid poly, Z1 physical-model leads | 14 / 53 SFZ |
| Oberheim-Xpander-Miscellany, -CK--Session-1, -CK-Session-2 | OB-style brass and pads | 168 SFZ in Miscellany |
| Sequential-MAX | Sequential (Prophet-family) | 9 SFZ |
| Elektronika-EM-25 | **string machine** (Soviet; the free stand-in for a Solina) | no SFZ in tree |
| Yamaha-CS30L | CS analog (closest to a CS-80 found) | Freesound copies by `modularsamples` are CC0 (verified on sound 281324) |
| Fender-Chroma-Polaris, Ensoniq-ESQ1, Kawai-K3, Akai-AX80, Novation-Ultranova, DSI-Tetra | assorted 80s/modern poly | 100 / 28 / 52 / 39 / 19 / 6 SFZ |
| Korg-Minilogue: "Long Wide Mini Saw" | wide saw lead / pad (supersaw-like) | Audio **is** in the git tree (131 MB, 1168 files), but the mapping exists only as EXS24/Kontakt; the file names carry a random suffix. Needs an EXS24 reader. |
| Jen-SX-2000 (Piano, Trumpet) | 70s Italian preset synth | Audio in the git tree; EXS24/Kontakt mappings only |
| Synth-Hits | one-shot synth drum and FX hits (Akai S612, CS-30L, Jupiter-4, Mono/Poly, SH-2, Xpander kits) | Audio in the git tree; drums, no mappings |

## Other candidates

| name | part it fills | URL | licence | format | size | notes |
|---|---|---|---|---|---|---|
| SHLD Music: Minifreak Pads, Wavestate Pads, PRO-1 packs | multisampled synth pads and leads | https://drolez.com/blog/music/ableton-free-sound-packs.php ; https://drolez.com/blog/music/pro1-analog-sample-packs.php | CC0 1.0 (verified on the drolez page) | SFZ + Ableton racks | Minifreak 265 MB, Wavestate 160 MB | Free Patreon posts; the page says no login is needed for "free" posts |
| Open Samples: Roland JV-2080 (1075 patches), Korg M1 (56), Korg X5DR (99), Kawai K1R (102) | 90s rompler sounds: orchestra hit (`OrchestraHit`, `Hardcore_Hit`, `Tekno_Hit_*`), slap bass, sitar, koto, shamisen, music box, TB-303, JP-8 strings, supersaw-ish `Saw_Mass` and more | https://github.com/pumodi/open-samples (`Synthesizers/`) | Open Samples Permissive Use License v2 (verified in `README.MD` / `docs/LICENSE.md`): free use, no resale, non-commercial redistribution only, no AI training | WAV in the git tree, **one file per patch** holding several notes | JV-2080 folder is large | Needs a slicer (onset detection + pitch) to split each file into notes. The ROM sounds are commercial factory content, so treat the licence with care. The music box from the same repo is added (`musicbox`). |
| Open Samples: Wurlitzer 200A, Carillon, Archive LoFi Piano, Dusty Upright, Bansuri, Antique Zither | lo-fi piano, carillon bells, bansuri flute | https://github.com/pumodi/open-samples | same as above | WAV in the git tree (Wurlitzer also NCW) | small | Not added: the note naming is incomplete (LoFi piano is `key01..23`; the carillon has 8 notes). These could be added with hand mappings later. |
| Benjamin Dehli DecentSampler libraries: 4-track music box, 4-track **toy piano**, 4-track glockenspiel, lo-fi tape piano, StyloPoly (Stylophone), SubC (sub bass), Strykebrett, Voltage Controlled Cassette Organ, Midnight Wurli, Omni-84 (Omnichord) | toy piano, lo-fi keys, Omnichord strum plates | https://github.com/benjamindehli (e.g. /4-track-toy-piano, /Omni-84) | GPL-3.0 (verified in each LICENSE), **no sample exception** | .dspreset in the tree; audio on Releases / product pages | 20–150 MB each | GPL-3 on samples without an exception: ask the user before using. They also need a DecentSampler (.dspreset XML) reader. |
| Unreal Instruments Koto (13-string) | **koto** | https://sfzinstruments.github.io/folk/koto (Google Drive) | "Custom": **licence unverified** (a forum summary says free, including commercial works) | SFZ + FLAC 48k | 212 MB | The only real multisampled koto found. Read the licence inside the zip first. |
| Etherealwinds Harp II CE (Versilian) | lever harp | https://versilian-studios.com/etherealwinds-harp/ | CC BY 4.0 (verified on the page) | SFZ + WAV zip | ~400 MB | VCSL already ships these Folk Harp recordings under CC0, and `folkharp` uses those. The CE adds round robins and more dynamics. |
| Univ. of Iowa MIS: Vibraphone (incl. **bowed**), Marimba, Xylophone, Bells, Crotales | mallet variants | https://theremin.music.uiowa.edu/MIS.html | "may be downloaded and used for any projects, without restrictions" (verified) | AIFF per note, zip per articulation | 2–5 MB per note | Raw recordings: they need trimming and mapping. |
| MSLP Vibes (Bandshed) | vibraphone variant | http://www.bandshed.net/sounds/sfz/vibes.zip | CC BY 3.0 per the sfzinstruments catalogue; the Bandshed index shows no licence | SFZ + WAV | 19 MB | |
| Bandshed toypiano.zip | toy piano | https://www.bandshed.net/sounds/sfz/ | **licence unverified** (bare directory index; possibly MSLP, CC BY-NC 3.0) | SFZ | 4.5 MB | |
| MF Tin Whistle (Markus Fiedler) | tin whistle in D (Celtic / fantasy) | http://www.fiedler-audio.de/cc-sounds/mf-tin-whistle2-ogg.zip | CC BY-NC-SA 3.0 "with modifications" (catalogue); the author's page returned 403 | SFZ + OGG | 10 MB | Non-commercial; the modifications are unverified |
| FreePats archive-only sets: Glass (water glasses), Clarinet (Tyler Dence), Synthesizer Percussion | tuned glass, clarinet variant, analog drum kit | https://freepats.zenvoid.org/ChromaticPercussion/glass.html ; /Reed/clarinet.html ; /Percussion/electric-percussion.html | CC0 (verified on each page) | SFZ + FLAC / WAV / SF2 (.7z, .tar.xz) | 2–22 MiB | Low priority: they overlap `glassharp` / `clarinet` / `synthperc` |
| Kay 5-String Banjo (FlameStudios) | 5-string banjo | https://github.com/sfzinstruments/FlameStudios.Kay5StringBanjo | GPL-3.0-or-later (LICENSE.txt), no sample exception | SFZ + WAV (git tree) | 425 MB | Not added: GPL without a sample exception, and `banjo` exists |
| Damien's Funky Guitar, Terkelsen's Mandolin / Marimba, Ovation Guitar, Picked Lapharp, Orgue Eglise, Krumhorn, Kastendieck Steel Drum (S. Christian Collins GigaSampler conversions) | funk guitar, mandolin, 12-string, lap harp | https://github.com/sfzinstruments (one repo each) | **no licence stated** in the repos or the catalogue | SFZ + WAV (git tree) | 5–50 MB | Not added for want of a licence. The funk guitar is the one worth chasing (electro swing / city pop). |
| Freesound packs found in the CC0 list by NeoSoundFonts | music box, fretless bass (Mr. Forfs), guitar harmonics (sleaf), ukulele (sadiquecat) | https://github.com/NeoSoundFonts/CC0-Samples-List | CC0 per that list (unverified per pack) | WAV | small | Freesound login needed |

## Rejected (licence does not allow it)

- **Mellotron archive** (`smpldsnds/archiveorg-mellotron`, from archive.org "mellotron-archive-cd-rom"): licence unknown, and these are commercial Mellotron Archive recordings.
- **Taijiguy Mellotron / Plogue Sforzatron:** "free as in beer". The packager says it cannot be released under a free licence.
- **Pianobook:** no redistribution.
- **Spitfire LABS** (including its Solina): plugin only, no redistribution.
- **99Sounds:** no redistribution.
- **Philharmonia Orchestra samples:** may not be made available as samples or as a sampler instrument.
- **YaruChipFont:** no redistribution.
- **Legowelt synth packs:** nothing granted on redistribution.
- **Ivy Audio:** no redistribution.
- **Samples From Mars freebies:** commercial-style licence.
- **HedSound accordion:** personal use only.
- **Emperador 12-string:** "don't share".
- **Game-ripped SoundFonts** (Pokémon, GB/GBA/NES rips): samples taken from commercial games.
- **Virtual Playing Orchestra:** mixed-source licence; the licence page returns 404.

## Gaps: no verifiable free source found yet

- a dedicated fretless bass guitar (only the fretless contrabass above)
- a real Mellotron / Chamberlin or a real Solina (EM-25 is the stand-in)
- CS-80, DX7 hardware, M1 / D-50 / JV hardware multisamples (only through Open Samples' one-file-per-patch recordings)
- a solo-section female "aah/ooh" choir (`chorus` / `largechorus` are mixed SATB)
- shamisen, guzheng, pipa, dizi, shakuhachi (only GM-bank quality in GeneralUser GS / MuseScore_General)
- 12-string and funk / muted electric guitar with a clear licence
