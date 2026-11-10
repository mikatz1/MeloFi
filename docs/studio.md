# MeloFi Studio — design

A pattern-based composer inside MeloFi, in the spirit of FL Studio: channels play patterns,
patterns are arranged on a playlist, everything goes through a mixer. It shares MeloFi's
instruments and sampler but is otherwise its own program (`renderer/studio/`).

## Concepts

| Term | Meaning |
|---|---|
| **Project** | One song: tempo, time signature, channels, patterns, playlist. Saved as `.mfproj` (JSON). |
| **Channel** | One instrument (any MeloFi instrument, including drum kits). Has volume, pan, reverb send, mute/solo, and a *step note* (the key its step sequencer plays). |
| **Pattern** | A loop of N bars holding notes for every channel. The channel rack's steps and the piano roll edit the same notes. |
| **Playlist** | Tracks (lanes) of pattern clips placed on bars. Song mode plays the playlist; pattern mode loops the current pattern. |
| **Mixer** | One strip per channel (fader, pan, send, mute/solo, meter) into a master strip with reverb and a limiter. |

Time is counted in ticks: 96 per quarter note, a 16th step = 24 ticks.

## Modules

| File | Job |
|---|---|
| `model.js` | Project data, defaults, time helpers, undo/redo history (snapshots). |
| `channel.js` | `SamplerChannel`: one sampler worklet node + gain/pan/send strip; loads an instrument (all velocity layers within a budget), schedules notes sample-accurately. |
| `engine.js` | `StudioEngine`: channels, master bus (reverb, limiter, meter), metronome click; also runs on an `OfflineAudioContext` for WAV export. |
| `transport.js` | Playback: lookahead scheduler for pattern / song mode, loop, position, recording live notes into the current pattern. |
| `io.js` | Save/open `.mfproj`, autosave, MIDI export (type 1, one track per channel), MIDI import, WAV export (offline render). |
| `ui/studio.js` | The studio window: toolbar, panels, shortcuts, wiring. |
| `ui/rack.js` | Channel rack with step sequencer. |
| `ui/roll.js` | Piano roll (canvas): draw / select / move / resize / velocity, snap, zoom, ghost notes. |
| `ui/playlist.js` | Playlist (canvas): place / move / resize / delete pattern clips. |
| `ui/mixer.js` | Mixer strips and meters. |

## Instruments

All MeloFi instruments are available. For production, drum kits are added:
synthesised 808 and 909 kits (rendered in-app like the synths) and an acoustic kit.

## Playback

The transport schedules notes ~150 ms ahead with exact `AudioContext` times (the sampler starts
voices on the exact sample), so timing does not depend on the UI thread. Pattern mode loops the
current pattern; song mode walks the playlist clips bar by bar.
