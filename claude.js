'use strict';
// Claude for the composer (main process): reads the analysis of an audio / video file and writes
// a report plus a MeloFi arrangement (channels, patterns, song order). Only the extracted musical
// features are sent — never the audio itself.
//
// The API key is stored encrypted with the OS (safeStorage) in userData/claude.json and never
// returned to the page. ANTHROPIC_API_KEY in the environment works too.
const path = require('node:path');
const fsp = require('node:fs/promises');
const { safeStorage } = require('electron');
const { default: Anthropic } = require('@anthropic-ai/sdk');

const MODELS = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5' };

// The arrangement Claude returns. Kept flat and small so it stays easy to validate.
const NOTE = {
  type: 'object', additionalProperties: false,
  required: ['ch', 't', 'd', 'n', 'v'],
  properties: {
    ch: { type: 'string', description: 'channel id' },
    t: { type: 'integer', description: 'start, in 16th notes from the start of the pattern' },
    d: { type: 'integer', description: 'length in 16th notes (1 or more)' },
    n: { type: 'integer', description: 'MIDI note (60 = middle C); for drum kits the GM drum key' },
    v: { type: 'integer', description: 'velocity 1-127' },
  },
};
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['analysis', 'arrangement'],
  properties: {
    analysis: {
      type: 'object', additionalProperties: false,
      required: ['summary', 'genre', 'mood', 'instruments', 'structure', 'harmony', 'production_notes', 'tips'],
      properties: {
        summary: { type: 'string', description: 'three to five sentences in Korean' },
        genre: { type: 'string' },
        mood: { type: 'string' },
        instruments: { type: 'array', items: { type: 'string' } },
        structure: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['name', 'start_bar', 'end_bar', 'description'],
            properties: { name: { type: 'string' }, start_bar: { type: 'integer' }, end_bar: { type: 'integer' }, description: { type: 'string' } } },
        },
        harmony: { type: 'string', description: 'the chord progression and key, in Korean' },
        production_notes: { type: 'string', description: 'drums, bass, sound design and mix, in Korean' },
        tips: { type: 'array', items: { type: 'string' }, description: 'what to try next in MeloFi, in Korean' },
      },
    },
    arrangement: {
      type: 'object', additionalProperties: false,
      required: ['name', 'bpm', 'key_root', 'scale', 'channels', 'patterns', 'playlist'],
      properties: {
        name: { type: 'string' },
        bpm: { type: 'number' },
        key_root: { type: 'integer', description: '0 = C … 11 = B' },
        scale: { type: 'string', enum: ['major', 'minor', 'dorian', 'mixolydian', 'pentaMajor', 'pentaMinor', 'blues', 'harmonic', 'japanese'] },
        channels: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'instrument', 'volume', 'pan', 'reverb', 'effect_preset'],
            properties: {
              id: { type: 'string' }, name: { type: 'string' },
              instrument: { type: 'string', description: 'an instrument id from the list' },
              volume: { type: 'number' }, pan: { type: 'number' }, reverb: { type: 'number' },
              effect_preset: { type: 'string', description: 'one effect preset name from the list, or empty' },
            } },
        },
        patterns: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'bars', 'notes'],
            properties: { id: { type: 'string' }, name: { type: 'string' }, bars: { type: 'integer' }, notes: { type: 'array', items: NOTE } } },
        },
        playlist: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['pattern', 'track', 'start_bar', 'bars'],
            properties: { pattern: { type: 'string' }, track: { type: 'integer' }, start_bar: { type: 'integer', description: '0-based' }, bars: { type: 'integer' } } },
        },
      },
    },
  },
};

const SYSTEM = `You are a record producer and arranger working inside MeloFi, a desktop composer.
You receive features extracted from an audio file by MeloFi's analyser — tempo, key, chords per bar (chord_beats gives the beat, 0-3, where each chord starts),
bass notes per beat, a rough melody, kick/snare/hat onsets per 16th step, sections and energy —
plus the user's request. The features are approximate: chords and melody come from spectral
analysis and can be off by an octave, mislabel extensions, or include noise. Use musical judgement
to clean them up instead of copying them blindly.

Return two things:
1. analysis — a clear report in Korean for a hobbyist: what the song is doing (structure,
   harmony, groove, instrumentation, production) and what to try next.
2. arrangement — a MeloFi project that the user can open and edit:
   - channels use only instrument ids from the provided list; drum kits play GM drum keys
     (36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 49 crash, 51 ride…)
   - patterns are short loops (1, 2, 4 or 8 bars) with notes on a 16th-note grid
     (t and d in 16ths, t counted from the pattern start); keep each pattern focused (a beat,
     a bass line, chords, a melody) so the user can reuse it
   - playlist places patterns on tracks (0-based start_bar) to rebuild the song structure;
     the whole song does not need every bar — repeat patterns the way a producer would
   - keep the total under about 1500 notes; prefer musical, playable parts over dense ones
Follow the user's style request (e.g. keep the original, or re-imagine it as lo-fi / K-pop / trap).`;

function register(ipcMain, { app }) {
  const FILE = () => path.join(app.getPath('userData'), 'claude.json');
  let key = null;
  let running = null;

  async function load() {
    if (key) return key;
    try {
      const s = JSON.parse(await fsp.readFile(FILE(), 'utf8'));
      if (s.key && safeStorage.isEncryptionAvailable()) key = safeStorage.decryptString(Buffer.from(s.key, 'base64'));
    } catch { /* none saved */ }
    return key || process.env.ANTHROPIC_API_KEY || null;
  }

  ipcMain.handle('claude:status', async () => ({ hasKey: !!(await load()), fromEnv: !key && !!process.env.ANTHROPIC_API_KEY, models: MODELS }));

  ipcMain.handle('claude:setKey', async (_e, value) => {
    const v = String(value || '').trim();
    if (v && !/^sk-ant-[\w-]{20,}$/.test(v)) return { ok: false, message: 'Anthropic API 키 형식이 아닙니다 (sk-ant-로 시작).' };
    key = v || null;
    await fsp.mkdir(path.dirname(FILE()), { recursive: true });
    const enc = key && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : null;
    await fsp.writeFile(FILE(), JSON.stringify({ key: enc }));
    return { ok: true };
  });

  ipcMain.handle('claude:cancel', () => { running?.abort(); return true; });

  // payload: { features, request, style, instruments: [{ id, name, family }], presets: [name], model, effort }
  ipcMain.handle('claude:arrange', async (e, payload) => {
    const apiKey = await load();
    if (!apiKey) return { ok: false, error: 'no_key', message: 'Anthropic API 키를 먼저 넣어 주세요.' };
    const client = new Anthropic({ apiKey });
    const model = MODELS[payload.model] ? payload.model : 'claude-opus-5-5';
    const send = (p) => { if (!e.sender.isDestroyed()) e.sender.send('claude:progress', p); };
    const user = [
      `요청: ${payload.style || '원곡 느낌 그대로 재구성'}${payload.request ? `\n추가 요청: ${payload.request}` : ''}`,
      `파일: ${payload.fileName || '(이름 없음)'}`,
      `쓸 수 있는 악기 (id · 이름 · 분류):\n${payload.instruments.map((i) => `${i.id} · ${i.name} · ${i.family}`).join('\n')}`,
      `이펙트 프리셋: ${payload.presets.join(', ')}`,
      `분석 결과 (JSON):\n${JSON.stringify(payload.features)}`,
    ].join('\n\n');
    const ac = new AbortController();
    running = ac;
    try {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: payload.effort || 'high', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }, { signal: ac.signal });
      let chars = 0, thinking = '';
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'thinking_delta') { thinking += ev.delta.thinking; send({ phase: 'thinking', text: thinking.slice(-400) }); }
          else if (ev.delta.type === 'text_delta') { chars += ev.delta.text.length; send({ phase: 'writing', chars }); }
        }
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') return { ok: false, error: 'refusal', message: 'Claude가 이 요청을 처리하지 않았습니다.' };
      if (msg.stop_reason === 'max_tokens') return { ok: false, error: 'max_tokens', message: '결과가 너무 길어 중간에 끊겼습니다. 곡의 일부 구간만 골라 다시 시도해 주세요.' };
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      let data;
      try { data = JSON.parse(text); } catch { return { ok: false, error: 'parse', message: 'Claude의 답을 읽지 못했습니다. 다시 시도해 주세요.' }; }
      return { ok: true, data, model: msg.model, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
    } catch (err) {
      if (ac.signal.aborted) return { ok: false, error: 'cancelled', message: '취소했습니다.' };
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'auth', message: 'API 키가 맞지 않습니다.' };
      if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, error: 'permission', message: '이 API 키로는 이 모델을 쓸 수 없습니다.' };
      if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'rate', message: '요청이 많아 잠시 막혔습니다. 조금 뒤 다시 시도해 주세요.' };
      if (err instanceof Anthropic.BadRequestError) return { ok: false, error: 'bad_request', message: `요청을 처리하지 못했습니다: ${err.message}` };
      if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: 'offline', message: '인터넷에 연결할 수 없습니다.' };
      if (err instanceof Anthropic.APIError) return { ok: false, error: 'api', message: `Claude API 오류 (${err.status}): ${err.message}` };
      return { ok: false, error: 'error', message: String(err.message || err) };
    } finally {
      running = null;
    }
  });
}

module.exports = { register, SCHEMA };
