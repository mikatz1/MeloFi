# Third-party notices

MeloFi uses the open-source software, models and sound libraries listed here. Each keeps its own
license. MeloFi's own license does not cover them. Models and sound libraries are downloaded from
their authors' pages when they are first used. They are not stored in this repository.

Licenses were checked on 2026-11-12 and are summarised below. Read each project's own license for the
exact terms. "Not stated" means the authors publish the files without naming a license. Treat such
files as all rights reserved unless the authors say otherwise.

## Analysis engine (installed on request, `tools/stems`)

| Component | Use in MeloFi | Code | Model weights | Commercial use of the weights |
|---|---|---|---|---|
| [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) | runs the separation models | MIT | n/a | n/a |
| BS-RoFormer ep 317 (viperx), BS-RoFormer SW 6-stem, Mel-Band RoFormer karaoke (aufr33, viperx), via [Music Source Separation Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) | vocal, instrument and lead/backing separation | MIT | not stated | unclear |
| [DrumSep MDX23C](https://github.com/inagoy/drumsep) (aufr33, jarredou) | kick, snare, hi-hat split | MIT | not stated | unclear |
| [Beat This!](https://github.com/CPJKU/beat_this) | beats, downbeats, tempo | MIT | MIT | allowed |
| [Basic Pitch](https://github.com/spotify/basic-pitch) | note transcription (default) | Apache-2.0 | Apache-2.0 | allowed |
| [MuScriptor](https://huggingface.co/MuScriptor/muscriptor-large) (Kyutai, Mirelo) | multi-instrument transcription (optional) | MIT | **CC BY-NC 4.0**, gated: each user accepts the terms with their own Hugging Face account | **not allowed** |
| [YourMT3+](https://github.com/mimbres/YourMT3) (YPTF.MoE+Multi, PS), run through [mt3-infer](https://pypi.org/project/mt3-infer/) | which instrument plays which notes, to split a mixed stem (optional component, 536 MB, installed on request into its own environment and run as a separate process) | YourMT3: **GPL-3.0**; mt3-infer: MIT | tagged Apache-2.0 where they are published | allowed by the tag; the code's GPL is why MeloFi does not link it and never ships it |
| [High-resolution Piano Transcription](https://github.com/bytedance/piano_transcription) (Kong et al.), run through [piano_transcription_inference](https://github.com/qiuqiangkong/piano_transcription_inference) with torchlibrosa | notes of an acoustic piano stem (optional component, 172 MB, installed on request into its own environment and run as a separate process) | piano_transcription_inference: MIT; bytedance/piano_transcription: Apache-2.0; torchlibrosa: MIT | [CC BY 4.0](https://zenodo.org/record/4034264); trained on [MAESTRO](https://magenta.tensorflow.org/datasets/maestro), **CC BY-NC-SA 4.0** | **treated as not allowed**: the training data is non-commercial, so MeloFi marks the channels made from it "(MIDI · 비상업)" |
| Bass transcription checkpoint "filobass" from [xavriley/midi-transcription-models](https://huggingface.co/xavriley/midi-transcription-models) (Riley, Edwards, Dixon), run through piano_transcription_inference | notes of a bass stem, where it finds most of the notes the general transcription finds (optional component, 99 MB, in the piano component's environment, run as a separate process; the file is read with the weights-only loader) | [hf_midi_transcription](https://github.com/xavriley/hf_midi_transcription): MIT (MeloFi uses the checkpoint, not this package) | tagged MIT; training data not documented | **treated as not allowed** until the training data is known: MeloFi marks the channels made from it "(MIDI · 비상업)" |
| [GAME](https://github.com/openvpi/GAME) (Generative Adaptive MIDI Extractor, OpenVPI), model 1.0 medium, with Lightning, torchmetrics, loguru, colorednoise, matplotlib, tensorboardX | notes of the lead vocal (optional component, about 190 MB plus its own environment, installed on request: the source at one commit and the model, each checked against its SHA-256; run as a separate process) | GAME: MIT; Lightning, torchmetrics: Apache-2.0; loguru, colorednoise, tensorboardX: MIT; matplotlib: PSF-based | **CC BY-NC-SA 4.0** | **not allowed**: MeloFi marks the channels made from it "(MIDI · 비상업)" or "(보컬 · 비상업)" |
| [Audio Spectrogram Transformer](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593) | instrument recognition | BSD-3-Clause (transformers: Apache-2.0) | as published by MIT | check the model card |
| PyTorch, torchaudio, librosa, onnxruntime, mir_eval, pretty_midi, soundfile, resampy | engine runtime | BSD / ISC / MIT | n/a | n/a |

Notes written by the piano, bass and vocal transcription models are treated the same way: MeloFi says so where the component is offered and marks its channels "(MIDI · 비상업)".

Results made with MuScriptor are for non-commercial use only. MeloFi shows this next to the option and
marks MIDI channels made from it "(MIDI · 비상업)". MeloFi does not download MuScriptor's weights
itself and never ships them.

## Singing voices (`vocal.js`)

Each voice is downloaded from its author's page together with its own terms. Most voices are for
non-commercial use only. The voice picker shows each voice's credit and whether commercial use is
allowed, and it opens the license text and the author's page. The OpenVPI vocoder and DiffSinger are published by
[OpenVPI](https://github.com/openvpi). The NNSVS voices come from [NNSVS](https://github.com/nnsvs/nnsvs).

## Virtual audio cable for 가상 마이크로 내보내기 (`vbcable.js`)

[VB-CABLE](https://www.vb-cable.com) by VB-Audio Software (Vincent Burel) is not included with MeloFi.
When the user asks for it, MeloFi downloads the official driver pack from vb-audio.com and opens
VB-CABLE's own setup, where the user installs it; MeloFi then sets the cable's internal buffer.
VB-CABLE is a donationware, all participations are welcome.

## Sampled instruments (`instruments/`)

Every instrument's author, license and source address are in its `instruments/<id>/manifest.json` and
in the app's instrument info. Only libraries under CC0, CC BY, CC BY-SA, CC Sampling Plus, MIT or
similar public licenses are used. Where a license requires attribution, the manifest holds it.

## App runtime (`package.json`)

| Package | License |
|---|---|
| Electron | MIT |
| electron-updater | MIT |
| lamejs (MP3 encoding) | LGPL-3.0 |
| mp4-muxer | MIT |
