// General MIDI → MeloFi: which MeloFi instrument plays each of the 128 GM programs, and which score
// parts are percussion. Candidates are in order of preference; the first one installed is used,
// then the family's other instruments, then the piano.
// 'piano' means "the piano the player has chosen"; 'kit' means a drum kit; null means silent
// (sound effects such as the helicopter or applause, which have no musical counterpart here).

const P = 'piano';
export const GM_PROGRAMS = [
  // 0–7 piano
  [P], [P], [P], [P], ['rhodes', 'wurlitzer', 'fmep'], ['fmep', 'rhodes'], ['harpsichord'], ['clavinet', 'synth', 'harpsichord'],
  // 8–15 chromatic percussion
  ['glockenspiel', 'fmbell'], ['glockenspiel'], ['kalimba', 'glockenspiel'], ['vibraphone'], ['marimba'], ['xylophone'], ['handbells', 'fmbell'], ['dantranh', 'harp'],
  // 16–23 organ
  ['drawbar', 'organ'], ['drawbar', 'organ'], ['drawbar', 'organ'], ['organ', 'drawbar'], ['drawbar', 'harmonica'], ['harmonica', 'drawbar'], ['harmonica'], ['harmonica', 'drawbar'],
  // 24–31 guitar
  ['acoustic', 'cleanguitar'], ['acoustic', 'cleanguitar'], ['cleanguitar', 'electric'], ['cleanguitar', 'electric'], ['cleanguitar', 'electric'], ['electric', 'cleanguitar'], ['electric', 'cleanguitar'], ['cleanguitar', 'acoustic'],
  // 32–39 bass
  ['upright', 'fingerbass'], ['fingerbass', 'ebass'], ['ebass', 'fingerbass'], ['fingerbass', 'upright'], ['fingerbass', 'ebass'], ['fingerbass', 'ebass'], ['synbass', 'sub808'], ['synbass', 'reese'],
  // 40–47 strings
  ['violin', 'strings'], ['strings', 'violin'], ['cello', 'strings'], ['contrabass', 'cello', 'upright'], ['strings'], ['stringspizz', 'strings'], ['harp'], ['kit'],
  // 48–55 ensemble
  ['strings'], ['strings'], ['synpad', 'strings'], ['synpad', 'strings'], ['vocal', 'choir'], ['oohs', 'choir', 'vocal'], ['choir', 'oohs'], ['brassstab', 'stringsstac'],
  // 56–63 brass
  ['trumpet', 'brassstab'], ['trombone', 'brassstab'], ['trombone', 'horn'], ['trumpet'], ['horn', 'trombone'], ['brassstab', 'trumpet'], ['synbrass', 'brassstab'], ['synbrass', 'brassstab'],
  // 64–71 reed
  ['altosax', 'tenorsax'], ['altosax', 'tenorsax'], ['tenorsax', 'altosax'], ['tenorsax', 'altosax'], ['oboe', 'clarinet'], ['oboe', 'clarinet'], ['clarinet', 'oboe'], ['clarinet', 'oboe'],
  // 72–79 pipe
  ['flute', 'recorder'], ['flute', 'recorder'], ['recorder', 'flute'], ['flute', 'recorder'], ['flute', 'recorder'], ['flute', 'recorder'], ['flute', 'recorder'], ['recorder', 'flute'],
  // 80–87 synth lead
  ['chip', 'synlead'], ['synlead', 'supersaw'], ['calliope', 'synlead', 'flute'], ['synlead', 'synpluck'], ['synlead', 'electric'], ['choir', 'synlead'], ['supersaw', 'synlead'], ['synlead', 'synbass'],
  // 88–95 synth pad
  ['synpad', 'strings'], ['synpad', 'strings'], ['supersaw', 'synpad'], ['choir', 'synpad'], ['strings', 'synpad'], ['fmbell', 'synpad'], ['choir', 'synpad'], ['synpad', 'strings'],
  // 96–103 synth effects
  ['fmbell', 'synpad'], ['synpad'], ['fmbell', 'glockenspiel'], ['brightness', 'synpad'], ['brightness', 'fmbell'], ['synpad'], ['brightness', 'synpad'], ['synpad'],
  // 104–111 ethnic
  ['dantranh', 'banjo'], ['banjo', 'acoustic'], ['dantranh', 'banjo'], ['dantranh', 'harp'], ['kalimba', 'marimba'], ['harmonica', 'oboe'], ['violin', 'erhu'], ['oboe', 'erhu'],
  // 112–119 percussive
  ['handbells', 'glockenspiel'], ['kit'], ['steeldrum', 'marimba'], ['kit'], ['kit'], ['kit'], ['kit'], ['cymbalswell'],
  // 120–127 sound effects
  ['fretnoise'], [null], ['oceandrum'], [null], [null], [null], [null], [null],
];

// percussive GM programs played on the kit: the drum each one sounds like (melodic toms follow the pitch)
const BY_NAME = [[/reverse ?cymbal|cymbal ?swell|riser/i, 'cymbalswell'], [/siren/i, 'siren'], [/scratch|fret ?noise/i, 'fretnoise'], [/\bbeeps?\b/i, 'chip'],
  [/ocean|sea ?shore|\bwaves?\b|\bwind\b/i, 'oceandrum']];

export const GM_PERC_NOTE = { 47: 45, 113: 67, 115: 76, 116: 41, 117: null, 118: 45 };

const FAMILY_OF = (id, instruments) => instruments.find((i) => i.id === id)?.family;
const DRUM_NAME = /drum|kick|snare|hi.?hat|\bhats?\b|cymbal|crash|ride|perc|amen|clap|tom\b|toms\b|break|beat/i;

// a part's percussion kind: 'gm' (MIDI channel 10: GM drum numbers), 'named' (a melodic channel
// whose name says drums: its numbers are someone's own kit, mapped by name and register), or null
export function percussionOf(line) {
  if (line.drum) return 'gm';
  // an effects part ("FX Sounds", "Impacts"): a few keys that each fire a hit, whatever program
  // the file happens to carry (playing them on that instrument puts it far outside its range)
  if (/\bs?fx\b|\beffects?\b|\bimpacts?\b|\bhits?\b/i.test(line.name || '') && !BY_NAME.some(([re]) => re.test(line.name || ''))) return 'fxhit';
  if (GM_PERC_NOTE[line.program] !== undefined && line.program != null) return 'perc';
  if (DRUM_NAME.test(line.name || '')) return 'named';
  return null;
}

// the GM drum number to play for a note of a percussion part
// the one drum a part's name names, when it names just one ("Snares", "Amen Kick", "Ride")
function singleDrum(name) {
  if (/&|\band\b|,|\+/i.test(name)) return null;
  const hits = [[/kick|bass ?drum/i, 36], [/snare/i, 38], [/clap/i, 39], [/ride/i, 51], [/hi.?hat|\bhats?\b/i, 42], [/crash|cymbal/i, 49], [/\btoms?\b/i, 45]]
    .filter(([re]) => re.test(name)).map(([, k]) => k);
  return hits.length === 1 ? hits[0] : null;
}

// the line's middle note: where a pitched drum part plays its drum at its own pitch
function centerOf(line) {
  if (line._center == null) {
    const ns = line.notes.map((x) => x.n).sort((a, b) => a - b);
    line._center = ns.length ? ns[ns.length >> 1] : 60;
  }
  return line._center;
}

// What to play for a note of a percussion part: { key: GM drum number, shift: semitones }.
// A part that names one drum (a "Snares" track on a melodic channel, as producers write snare
// build-ups) plays that drum, pitched up and down with its notes around the part's middle note.
// Channel 10 plays GM numbers; numbers outside the GM set follow the part's name.
export function drumHit(kind, line, n) {
  const name = line.name || '';
  const one = singleDrum(name);
  if (kind === 'gm') {
    if (n >= 35 && n <= 81) return { key: n, shift: 0 };
    return { key: one ?? (n < 35 ? 36 : 42), shift: 0 };
  }
  if (kind === 'fxhit') return { key: n < 48 ? 36 : 49, shift: 0 }; // low: an impact (kick), else a crash
  if (kind === 'perc') { const f = GM_PERC_NOTE[line.program]; return { key: f ?? (n < 50 ? 41 : n < 62 ? 45 : 48), shift: 0 }; }
  if (one != null) return { key: one, shift: Math.max(-12, Math.min(12, n - centerOf(line))) };
  if (n >= 35 && n <= 81) return { key: n, shift: 0 }; // a mixed part already in GM numbers
  return { key: n < 48 ? 36 : n < 72 ? 38 : 42, shift: 0 }; // by register: low kick, middle snare, high hats
}

export const drumNote = (kind, line, n) => drumHit(kind, line, n).key;

// Which installed MeloFi instrument plays a part: { inst: id | 'piano' | null, kit: bool }


export function instrumentFor(line, instruments, kitId) {
  const named = BY_NAME.find(([re]) => re.test(line.name || ''))?.[1];
  if (named && instruments.some((i) => i.id === named)) {
    const ok = instruments.some((i) => i.id === named && i.installed);
    return { inst: ok ? named : null, kit: false, wanted: named };
  }
  const kind = percussionOf(line);
  if (kind) return { inst: kitId, kit: true, kind };
  const prog = line.program ?? (line.piano ? 0 : null);
  if (prog == null) return { inst: P, kit: false };
  const want = GM_PROGRAMS[prog] || [P];
  if (want[0] === null) return { inst: null, kit: false };
  if (want[0] === 'kit') return { inst: kitId, kit: true, kind: 'perc' };
  const installed = (id) => id === P || instruments.some((i) => i.id === id && i.installed);
  const hit = want.find(installed);
  if (hit) return { inst: hit, kit: false, wanted: want[0] };
  // nothing on the list installed: another instrument of the same family, else the piano
  const fam = FAMILY_OF(want[0], instruments);
  const same = fam && instruments.find((i) => i.family === fam && i.installed);
  return { inst: same ? same.id : P, kit: false, wanted: want[0] };
}

// the kit for percussion parts: the recorded kit when installed, else the 808 MeloFi synthesises
export function kitFor(instruments) {
  return instruments.some((i) => i.id === 'acousticdrums' && i.installed) ? 'acousticdrums' : 'drums808';
}
