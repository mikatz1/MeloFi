// Mastering window: the master chain (EQ, multiband, imager, saturation, clipper, maximizer), the
// meters a mastering engineer reads (BS.1770 loudness M / S / I, LRA, true peak, PLR, gain
// reduction, correlation, vectorscope, spectrum with the EQ curve and a reference track), an
// assistant that sets the chain for a loudness target, ready-made chains, A/B against the
// unmastered mix (loudness-matched) and against a reference song.
import { h, knob, popup } from './dom.js';
import { FX_TYPES, MASTER_FX, fxDefaults, fmtParam } from '../fx.js';
import { uid } from '../model.js';
import { renderMix } from '../io.js';
import { measure, limit, gain as gainMix, dB } from '../master-dsp.js';
import { LoudnessMeter, TARGETS } from '../meter.js';

const f = (x, d = 1) => (x <= -69.5 ? '—' : x.toFixed(d));

// the same ratio and threshold in all five bands of the multiband compressor
const mb = (r, t) => Object.fromEntries([1, 2, 3, 4, 5].flatMap((i) => [[`r${i}`, r], [`t${i}`, t]]));

// ready-made chains: [name, hint, [[type, params]]]
export const MASTER_CHAINS = [
  ['깔끔하게 (스트리밍)', '대부분의 곡: 가볍게 다듬고 -14 LUFS', [
    ['peq', { hpF: 25, lsG: 0.5, p2F: 300, p2G: -1, p3F: 3000, p3G: 0.5, hsF: 10000, hsG: 1 }],
    ['mbcomp', mb(1.5, -20)],
    ['imager', { w1: 0.5, w2: 1, w3: 1.05, w4: 1.1 }],
    ['maximizer', { gain: 9, ceiling: -1, release: 0.15 }]]],
  ['크게 (EDM · 케이팝)', '단단하고 큰 소리: 클리퍼 + 맥시마이저', [
    ['peq', { hpF: 28, lsF: 70, lsG: 1, p2F: 250, p2G: -1.5, p3F: 2500, p3G: 1, hsF: 9000, hsG: 1.5, hsW: 2 }],
    ['mbcomp', { ...mb(2, -22), r1: 2.5, attack: 0.01, release: 0.12 }],
    ['exciter', { mode: 0, drive: 0.25, mix: 0.3 }],
    ['imager', { w1: 0.2, w2: 1, w3: 1.1, w4: 1.25 }],
    ['clipper', { drive: 2, knee: 0.5, ceiling: -0.5 }],
    ['maximizer', { gain: 13, ceiling: -1, release: 0.08 }]]],
  ['따뜻하게 (로파이 · 어쿠스틱)', '테이프 질감, 고음은 살짝 눕히기', [
    ['peq', { hpF: 30, lsF: 120, lsG: 1, p3F: 3500, p3G: -1, hsF: 9000, hsG: -1.5 }],
    ['exciter', { mode: 0, drive: 0.4, mix: 0.45 }],
    ['mbcomp', { ...mb(1.6, -21), attack: 0.03, release: 0.3 }],
    ['maximizer', { gain: 8, ceiling: -1, release: 0.25 }]]],
  ['부드럽게 (발라드 · 클래식)', '다이내믹을 살리는 가벼운 마스터', [
    ['peq', { hpF: 20, hsF: 12000, hsG: 0.5 }],
    ['mbcomp', { ...mb(1.3, -25), attack: 0.04, release: 0.4 }],
    ['maximizer', { gain: 6, ceiling: -1, release: 0.4 }]]],
  ['방송용 (EBU R128)', '-23 LUFS, 피크 -1 dBTP', [
    ['peq', { hpF: 30 }],
    ['mbcomp', mb(1.5, -27)],
    ['maximizer', { gain: 0, ceiling: -1, release: 0.2 }]]],
];

// a radix-2 FFT (in place) for the spectrum of a whole render
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// average spectrum in 1/3-octave bands (dB), from up to 400 frames spread over the song
export const BANDS = Array.from({ length: 31 }, (_, i) => 20 * 2 ** (i / 3)); // 20 Hz .. ~20 kHz
export function bandSpectrum(left, right, rate) {
  const N = 8192, frames = Math.min(400, Math.max(1, Math.floor(left.length / N)));
  const step = Math.max(N, Math.floor((left.length - N) / frames));
  const pow = new Float64Array(N / 2), win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  let used = 0;
  for (let s = 0; s + N <= left.length; s += step) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = 0.5 * (left[s + i] + right[s + i]) * win[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  return BANDS.map((fc) => {
    const lo = Math.floor((fc / 2 ** (1 / 6)) / rate * N), hi = Math.max(lo + 1, Math.ceil((fc * 2 ** (1 / 6)) / rate * N));
    let p = 0;
    for (let k = lo; k < Math.min(hi, N / 2); k++) p += pow[k];
    return 10 * Math.log10(p / Math.max(1, used) + 1e-20);
  });
}

// a balanced master's spectrum leans down about 4.5 dB per octave (pink-ish) above ~100 Hz
const targetCurve = (fc) => -4.5 * Math.log2(Math.max(fc, 100) / 1000) - (fc < 40 ? (40 - fc) / 3 : 0);

export class MasteringWindow {
  constructor(studio) {
    this.S = studio;
    this.meter = new LoudnessMeter();
    this.sel = null;          // master fx id shown in the editor
    this.ref = null;          // { name, buf, I, bands }
    this.refOn = false; this.bypass = false; this.match = true;
    this.offI = null; this.onI = null; // loudness of the mix without / with the chain (for A/B)
    this.mixBands = null;
    this.target = studio.app.settings.get('masterTarget') || 'spotify';
    let head;
    this.el = h('section', { id: 'mastering', class: 'ch-float ms-float', hidden: true },
      h('div', { class: 'sheet-card ms-card' },
        head = h('div', { class: 'sheet-head ch-drag', title: '끌어서 옮기기' }, h('h2', {}, '마스터링'), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
        this.bar = h('div', { class: 'ms-bar' }),
        h('div', { class: 'ms-main' },
          this.chainEl = h('div', { class: 'ms-chain' }),
          h('div', { class: 'ms-meters' },
            this.nums = h('div', { class: 'ms-nums' }),
            h('div', { class: 'ms-row' },
              h('div', { class: 'ms-box' }, h('span', { class: 'ms-cap' }, '게인 리덕션'), this.grEl = h('div', { class: 'ms-gr' })),
              h('div', { class: 'ms-box' }, h('span', { class: 'ms-cap' }, '벡터스코프 · 위상'), this.scope = h('canvas', { class: 'ms-scope' }), this.corrEl = h('div', { class: 'ms-corr' }, h('i')))),
            h('div', { class: 'ms-box' }, h('span', { class: 'ms-cap' }, '스펙트럼 · EQ 곡선', h('em', { class: 'ms-legend' }, h('i', { class: 'mix' }), '믹스 ', h('i', { class: 'eq' }), 'EQ ', h('i', { class: 'ref' }), '레퍼런스 ', h('i', { class: 'tg' }), '균형 기준')), this.spec = h('canvas', { class: 'ms-spec' })),
            h('div', { class: 'ms-box' }, h('span', { class: 'ms-cap' }, '음량 흐름 (3초 단위)'), this.hist = h('canvas', { class: 'ms-hist' })))),
        this.foot = h('div', { class: 'ms-foot' })));
    this.pos = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { this.pos = { x: Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) }; this.place(); };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.history = [];
    document.body.append(this.el);
  }

  get proj() { return this.S.proj; }
  get E() { return this.S.engine; }
  get tgt() { return TARGETS.find((t) => t[0] === this.target) || TARGETS[0]; }

  place() {
    const p = this.pos || { x: Math.max(10, innerWidth / 2 - 470), y: 70 };
    this.el.style.left = `${p.x}px`; this.el.style.top = `${p.y}px`;
  }

  show() {
    this.el.hidden = false;
    this.place();
    this.onBlock ||= (b) => { this.meter.push(b); if (this.meter.S > -70 && this.S.transport.playing) { this.history.push(this.meter.S); if (this.history.length > 1800) this.history.shift(); } };
    this.E.blockListeners?.add(this.onBlock);
    this.render();
    cancelAnimationFrame(this.raf);
    const loop = () => { if (this.el.hidden) return; this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    this.E.blockListeners?.delete(this.onBlock);
    if (this.refOn) this.toggleRef(false);
    this.E.setMono(false);
    if (this.bypass) this.toggleBypass(false);
  }

  // ---------- chain ----------
  get fx() { return this.proj.master.fx; }

  setChain(list, label) {
    const made = list.map(([type, params]) => ({ id: uid('f'), type, on: true, params: { ...fxDefaults(type), ...params } }));
    this.S.edit(() => { this.proj.master.fx = made; }, true, label);
    this.sel = made.find((x) => x.type === 'maximizer')?.id || made[0]?.id || null;
    this.S.syncAudio();
    this.render();
  }

  add(type) {
    const fx = { id: uid('f'), type, on: true, params: fxDefaults(type) };
    // keep the limiting stage last
    this.S.edit(() => { const i = this.fx.findIndex((x) => ['maximizer', 'limiter'].includes(x.type)); if (i >= 0 && !['maximizer', 'limiter'].includes(type)) this.fx.splice(i, 0, fx); else this.fx.push(fx); });
    this.sel = fx.id;
    this.S.syncAudio();
    this.render();
  }

  render() {
    const S = this.S;
    // toolbar
    this.bar.replaceChildren(
      h('label', { class: 'ms-tg' }, '목표', h('select', { onchange: (e) => { this.target = e.target.value; S.app.settings.set({ masterTarget: this.target }); this.render(); } },
        ...TARGETS.map(([k, n, l, c]) => h('option', { value: k, selected: k === this.target }, `${n} · ${l} LUFS / ${c} dBTP`)))),
      h('button', { class: 'btn sm primary', disabled: !!this.busy, title: '믹스를 분석해서 EQ·멀티밴드·이미저·맥시마이저를 목표에 맞게 설정해요', onclick: () => this.assist() }, this.busy ? '분석 중…' : '자동 마스터링'),
      h('button', { class: 'btn sm', onclick: (e) => popup(e.clientX, e.clientY, [{ group: '마스터 체인 프리셋 (지금 체인을 바꿔요)' }, ...MASTER_CHAINS.map(([n, hint, chain]) => ({ label: n, hint, act: () => this.setChain(chain, `마스터 프리셋: ${n}`) }))]).classList.add('tall') }, '프리셋 ▾'),
      h('span', { class: 'sp' }),
      h('button', { class: `btn sm${this.bypass ? ' on' : ''}`, title: '마스터 체인을 끈 소리와 비교 (음량은 맞춰서)', onclick: () => this.toggleBypass(!this.bypass) }, this.bypass ? '원본 듣는 중' : '원본과 비교'),
      h('button', { class: `btn sm${this.E.mono ? ' on' : ''}`, title: '모노로 듣기: 휴대폰 스피커나 매장 스피커에서 소리가 빠지지 않는지 확인', onclick: () => { this.E.setMono(!this.E.mono); this.render(); } }, '모노'),
      h('button', { class: 'btn sm', title: '비교할 곡 파일 불러오기 (WAV · MP3 · FLAC)', onclick: () => this.pickRef() }, this.ref ? '레퍼런스 바꾸기' : '레퍼런스 곡…'),
      ...(this.ref ? [
        h('button', { class: `btn sm${this.refOn ? ' on' : ''}`, onclick: () => this.toggleRef(!this.refOn) }, this.refOn ? '레퍼런스 듣는 중' : '레퍼런스 듣기'),
        h('label', { class: 'ms-chk', title: '레퍼런스를 내 믹스와 같은 음량으로 들어요' }, h('input', { type: 'checkbox', checked: this.match, onchange: (e) => { this.match = e.target.checked; this.applyRefGain(); } }), '음량 맞춤')] : []));
    // chain
    if (!this.fx.some((x) => x.id === this.sel)) this.sel = this.fx[0]?.id || null;
    const slots = this.fx.map((x, i) => h('div', { class: `ms-slot${x.id === this.sel ? ' sel' : ''}${x.on === false ? ' off' : ''}` },
      h('span', { class: 'no' }, String(i + 1)),
      h('button', { class: 'nm', title: FX_TYPES[x.type]?.hint || '', onclick: () => { this.sel = x.id; this.render(); },
        oncontextmenu: (e) => { e.preventDefault(); popup(e.clientX, e.clientY, [
          { label: '위로', act: () => { S.edit(() => { if (i > 0) this.fx.splice(i - 1, 0, ...this.fx.splice(i, 1)); }); S.syncAudio(); this.render(); } },
          { label: '아래로', act: () => { S.edit(() => { if (i < this.fx.length - 1) this.fx.splice(i + 1, 0, ...this.fx.splice(i, 1)); }); S.syncAudio(); this.render(); } },
          { sep: true },
          { label: '삭제', act: () => { S.edit(() => this.fx.splice(i, 1)); S.syncAudio(); this.render(); } },
        ]); } }, FX_TYPES[x.type]?.name || x.type),
      h('input', { type: 'checkbox', checked: x.on !== false, title: '켜기 / 끄기', onchange: () => { S.edit(() => { x.on = x.on === false; }); S.syncAudio(); this.render(); } })));
    this.chainEl.replaceChildren(
      h('div', { class: 'ms-cap' }, '마스터 체인'),
      ...(slots.length ? slots : [h('p', { class: 'ms-empty' }, '비어 있어요. 자동 마스터링이나 프리셋으로 시작하거나, 아래에서 하나씩 넣어 보세요.')]),
      h('button', { class: 'btn sm ghost ms-add', onclick: (e) => popup(e.clientX, e.clientY, [{ group: '마스터링' }, ...MASTER_FX.map((t) => ({ label: FX_TYPES[t].name, hint: FX_TYPES[t].hint, act: () => this.add(t) })), { group: '그 밖의 이펙트' }, ...['eq', 'comp', 'width', 'limiter', 'reverb'].map((t) => ({ label: FX_TYPES[t].name, hint: FX_TYPES[t].hint, act: () => this.add(t) }))]).classList.add('tall') }, '+ 넣기'),
      this.editor());
    this.renderFoot();
  }

  editor() {
    const x = this.fx.find((q) => q.id === this.sel);
    if (!x) return h('div', { class: 'ms-ed' });
    const S = this.S, def = FX_TYPES[x.type];
    return h('div', { class: 'ms-ed' }, h('b', {}, def.name),
      h('div', { class: 'ms-ed-body' }, ...def.params.map((p) => {
        const val = x.params[p.key] ?? p.def;
        if (p.choices) return h('label', { class: 'fx-p' }, h('span', {}, p.label), h('select', { onchange: (ev) => { S.edit(() => { x.params[p.key] = +ev.target.value; }, false); S.applyFx('master'); } }, ...p.choices.map((c, i) => h('option', { value: i, selected: Math.round(val) === i }, c))));
        const out = h('b', {}, fmtParam(p, val));
        const k = knob({ value: val, min: p.min, max: p.max, def: p.def, size: 26, title: p.label, fmt: (v) => fmtParam(p, v), target: `fx:master:${x.id}:${p.key}`,
          onInput: (v) => { x.params[p.key] = p.step ? Math.round(v / p.step) * p.step : v; out.textContent = fmtParam(p, x.params[p.key]); S.applyFx('master'); },
          onChange: () => S.changed() });
        return h('label', { class: 'fx-p k' }, k, h('span', {}, p.label), out);
      })));
  }

  renderFoot() {
    const parts = [];
    if (this.note) parts.push(h('span', {}, this.note));
    if (this.ref) parts.push(h('span', {}, `레퍼런스: ${this.ref.name} · ${f(this.ref.I)} LUFS · 피크 ${f(this.ref.tp)} dBTP · LRA ${this.ref.LRA.toFixed(1)}`));
    if (!parts.length) parts.push(h('span', {}, '곡을 재생하면 미터가 움직여요. 전체(통합) 라우드니스는 재생한 구간 전체로 재요. 미터를 비우려면 초기화를 누르세요.'));
    this.foot.replaceChildren(...parts);
  }

  // ---------- A/B ----------
  // the chain off (engine only, the project keeps it), level-matched when both loudnesses are known
  toggleBypass(on) {
    this.bypass = on;
    const ms = this.E.masterStrip;
    ms.setFx(on ? [] : this.fx);
    this.E.limiter.parameters.get('threshold').value = on ? 0.8414 : (this.fx.some((x) => x.on !== false && ['limiter', 'maximizer', 'clipper'].includes(x.type)) ? 1 : 0.8414);
    const match = on && this.offI != null && this.onI != null ? this.onI - this.offI : 0;
    this.E.out.gain.setTargetAtTime(10 ** (Math.min(12, match) / 20), this.E.ctx.currentTime, 0.02);
    this.render();
  }

  async pickRef() {
    const inp = h('input', { type: 'file', accept: 'audio/*,.flac,.wav,.mp3,.m4a,.ogg' });
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      this.note = '레퍼런스를 읽는 중…'; this.renderFoot();
      try {
        const buf = await this.E.ctx.decodeAudioData(await file.arrayBuffer());
        const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
        const m = measure(L, R, buf.sampleRate);
        this.ref = { name: file.name, buf, I: m.I, tp: m.tp, LRA: m.LRA, bands: bandSpectrum(L, R, buf.sampleRate) };
        this.note = '';
      } catch (err) { this.note = `레퍼런스를 열지 못했어요: ${err.message}`; }
      this.render();
    };
    inp.click();
  }

  applyRefGain() {
    if (!this.refGain) return;
    const mine = this.meter.I > -70 ? this.meter.I : this.onI ?? -14;
    const g = this.match && this.ref ? mine - this.ref.I : 0;
    this.refGain.gain.setTargetAtTime(10 ** (Math.max(-30, Math.min(12, g)) / 20), this.E.ctx.currentTime, 0.02);
  }

  // the reference plays instead of the mix (from the same point in time, looping), into the meters
  toggleRef(on) {
    const E = this.E, c = E.ctx;
    if (this.refSrc) { try { this.refSrc.stop(); } catch { /* ended */ } this.refSrc = null; }
    this.refOn = on && !!this.ref;
    if (this.refOn) {
      this.refGain ||= c.createGain();
      try { this.refGain.disconnect(); } catch { /* fresh */ }
      this.refGain.connect(c.destination);
      if (E.meterNode) this.refGain.connect(E.meterNode);
      const src = c.createBufferSource(); src.buffer = this.ref.buf; src.loop = true;
      src.connect(this.refGain);
      const pos = this.S.transport.playing ? (this.S.transport.songSec?.() ?? 0) : 0;
      src.start(c.currentTime + 0.02, pos % this.ref.buf.duration);
      this.refSrc = src;
      this.applyRefGain();
      E.out.gain.setTargetAtTime(0, c.currentTime, 0.02);
    } else {
      E.out.gain.setTargetAtTime(1, c.currentTime, 0.02);
      if (this.refGain) try { this.refGain.disconnect(); } catch { /* gone */ }
    }
    this.meter.reset(); this.history = [];
    this.render();
  }

  // ---------- assistant ----------
  async assist() {
    const S = this.S, [, name, target, ceiling] = this.tgt;
    this.busy = true; this.render();
    const say = (t) => { this.note = t; this.renderFoot(); };
    try {
      say('믹스를 렌더링하는 중… (마스터 체인 없이)');
      const raw = await renderMix(this.proj, { noMaster: true, tail: 0.5, onProgress: (ph, x) => say(ph === 'load' ? `악기 불러오는 중 ${Math.round(x * 100)}%` : '믹스를 렌더링하는 중… (마스터 체인 없이)') });
      say('믹스를 분석하는 중…');
      await new Promise((r) => setTimeout(r, 20));
      const m0 = measure(raw.left, raw.right, raw.rate);
      if (m0.I <= -60) throw new Error('소리가 거의 없어요. 곡을 먼저 만들어 주세요.');
      const bands = bandSpectrum(raw.left, raw.right, raw.rate);
      this.mixBands = bands;
      // tonal balance against the target curve, measured relative to the 1 kHz region
      const off = (lo, hi) => { const ix = BANDS.map((fc, i) => [fc, i]).filter(([fc]) => fc >= lo && fc <= hi); return ix.reduce((a, [fc, i]) => a + bands[i] - targetCurve(fc), 0) / ix.length; };
      const ref = off(700, 1400);
      const dev = { low: off(40, 120) - ref, mud: off(180, 450) - ref, pres: off(2000, 5000) - ref, air: off(8000, 16000) - ref };
      // gentle: a third of the gap, a little more room to cut than to boost; the 300 Hz region is
      // only ever cut (lifting it makes a master boxy)
      const fix = (d, up = 1.5, down = 2.5) => Math.max(-down, Math.min(up, -d * 0.35));
      // stereo: how much of the low end is in the sides
      let sLow = 0, mLow = 0, a1 = 0;
      for (let i = 0; i < raw.left.length; i++) { const mm = 0.5 * (raw.left[i] + raw.right[i]), ss = 0.5 * (raw.left[i] - raw.right[i]); a1 += 0.02 * (ss - a1); sLow += a1 * a1; mLow += mm * mm; }
      const sideLow = 10 * Math.log10((sLow + 1e-12) / (mLow + 1e-12));
      const chain = [
        ['peq', { hpF: 25, lsF: 90, lsG: fix(dev.low), p2F: 300, p2G: fix(dev.mud, 0), p2Q: 1, p3F: 3200, p3G: fix(dev.pres), p3Q: 0.8, hsF: 10000, hsG: fix(dev.air) }],
        ['mbcomp', { ...mb(1.6, Math.round(m0.I - 4)), r1: 1.8, r2: 1.8, t5: Math.round(m0.I - 6), attack: 0.02, release: 0.18 }],
        ['imager', { w1: sideLow > -20 ? 0.3 : 0.6, w2: 1, w3: 1.05, w4: 1.1 }],
        ['maximizer', { gain: 0, ceiling, release: 0.15 }],
      ];
      // loudness after EQ / multiband: render once more with the chain, the maximizer at 0 dB
      this.setChain(chain, '자동 마스터링');
      say('설정한 체인으로 다시 렌더링하는 중…');
      const pre = await renderMix(this.proj, { tail: 0.5, onProgress: () => {} });
      const m1 = measure(pre.left, pre.right, pre.rate);
      // the maximizer gain that lands on the target: search on the loudest 30 s with the same limiter
      say('목표 음량에 맞는 맥시마이저 게인을 찾는 중…');
      await new Promise((r) => setTimeout(r, 20));
      const seg = loudest(pre, 30);
      const segI = measure(seg.left, seg.right, seg.rate).I;
      let lo = 0, hi = 24, g = 0;
      for (let k = 0; k < 9; k++) {
        g = (lo + hi) / 2;
        const out = limit(seg.left, seg.right, seg.rate, { ceilingDb: ceiling, gainDb: g, releaseMs: 150 });
        const I = measure(out.left, out.right, out.rate).I + (m1.I - segI);
        if (I < target) lo = g; else hi = g;
      }
      g = Math.round(((lo + hi) / 2) * 10) / 10;
      const mx = this.fx.find((x) => x.type === 'maximizer');
      S.edit(() => { mx.params.gain = g; }, false);
      S.applyFx('master');
      // check the result with the real chain, and correct the gain (up to twice) until it lands
      let m2;
      for (let pass = 0; pass < 3; pass++) {
        say(pass ? `목표에 맞추는 중… (${pass + 1}/3)` : '결과를 확인하는 중…');
        const fin = await renderMix(this.proj, { tail: 0.5, onProgress: () => {} });
        m2 = measure(fin.left, fin.right, fin.rate);
        const miss = target - m2.I;
        if (Math.abs(miss) < 0.3 || pass === 2) break;
        // past the knee a limiter gives back about half of every extra dB
        const step = miss * (m2.tp > ceiling - 0.3 ? 1.8 : 1);
        const ng = Math.max(0, Math.min(24, Math.round((g + step) * 10) / 10));
        if (ng === g) break;
        g = ng;
        S.edit(() => { mx.params.gain = g; }, false);
        S.applyFx('master');
      }
      this.offI = m0.I; this.onI = m2.I;
      const eq = chain[0][1];
      this.note = `자동 마스터링 (${name}): ${f(m0.I)} → ${f(m2.I)} LUFS · 피크 ${f(m2.tp)} dBTP · LRA ${m2.LRA.toFixed(1)} LU · `
        + `EQ 저음 ${eq.lsG.toFixed(1)} / 300Hz ${eq.p2G.toFixed(1)} / 3.2kHz ${eq.p3G.toFixed(1)} / 고음 ${eq.hsG.toFixed(1)} dB · 맥시마이저 +${g} dB`
        + (m2.I < target - 1.5 ? ' · 목표까지 올리면 소리가 찌그러질 수 있어 여기서 멈췄어요' : '');
    } catch (err) {
      this.note = `자동 마스터링을 하지 못했어요: ${err.message}`;
    }
    this.busy = false;
    this.render();
  }

  // ---------- drawing ----------
  draw() {
    const m = this.meter, [, , target, ceiling] = this.tgt;
    const tp = m.TP, I = m.I;
    const cell = (k, v, unit, cls = '') => h('div', { class: `ms-num ${cls}` }, h('span', {}, k), h('b', {}, v), h('small', {}, unit));
    const now = performance.now();
    if (!this.lastNums || now - this.lastNums > 150) {
      this.lastNums = now;
      this.nums.replaceChildren(
        cell('순간', f(m.M), 'LUFS'), cell('3초', f(m.S), 'LUFS'),
        cell('전체 (통합)', f(I), 'LUFS', I > -70 ? (Math.abs(I - target) <= 1 ? 'ok' : I > target + 1 ? 'hot' : '') : ''),
        cell('라우드니스 범위', m.LRA.toFixed(1), 'LU'),
        cell('실제 피크', f(tp), 'dBTP', tp > ceiling + 0.05 ? 'hot' : ''),
        cell('PLR', I > -70 ? (tp - I).toFixed(1) : '—', 'dB'),
        h('button', { class: 'btn sm ghost', onclick: () => { this.meter.reset(); this.history = []; } }, '초기화'));
      // gain reduction: maximizer and each multiband band
      const bars = [];
      for (const x of this.fx) {
        const u = this.E.masterStrip.unit(x.id);
        if (!u) continue;
        if (x.type === 'maximizer') bars.push(['맥시마이저', u.gr || 0]);
        if (x.type === 'mbcomp' && u.reduction) u.reduction().forEach((r, i) => bars.push([['서브', '저음', '중음', '중고음', '고음'][i], r]));
        if (x.type === 'dyneq' && u.gains) u.gains.forEach((gdb, i) => bars.push([`다이내믹 ${i + 1}`, -gdb]));
      }
      this.grEl.replaceChildren(...(bars.length ? bars.map(([n, r]) => h('div', { class: 'ms-grrow' }, h('span', {}, n), h('div', { class: 'ms-grbar' }, h('i', { style: `width:${Math.min(100, (r / 12) * 100)}%` })), h('b', {}, r > 0.05 ? `-${r.toFixed(1)}` : '0'))) : [h('span', { class: 'ms-empty' }, '맥시마이저나 멀티밴드를 넣으면 여기서 보여요')]));
      const cv = Math.max(-1, Math.min(1, m.corr));
      this.corrEl.firstChild.style.left = `${((cv + 1) / 2) * 100}%`;
      this.corrEl.title = `위상 상관도 ${cv.toFixed(2)} (+1 모노 · 0 넓음 · 음수면 모노에서 소리가 빠짐)`;
      this.corrEl.classList.toggle('bad', cv < 0);
    }
    this.drawScope();
    this.drawSpec();
    this.drawHist(target);
  }

  canvas(cv) {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (!r.width) return null;
    if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    const g = cv.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    return [g, r.width, r.height];
  }

  drawScope() {
    const c = this.canvas(this.scope);
    if (!c) return;
    const [g, W, H] = c, s = this.meter.scope, R = Math.min(W, H) / 2 - 4;
    g.fillStyle = 'rgba(11,12,15,0.35)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#24252b'; g.beginPath(); g.moveTo(W / 2, H / 2 - R); g.lineTo(W / 2, H / 2 + R); g.moveTo(W / 2 - R, H / 2); g.lineTo(W / 2 + R, H / 2); g.stroke();
    g.fillStyle = '#e0a440';
    // mid up, side across (rotated 45 degrees, as a goniometer)
    for (let i = 0; i + 1 < s.length; i += 2) {
      const l = s[i], r = s[i + 1], x = W / 2 + ((l - r) / Math.SQRT2) * R, y = H / 2 - ((l + r) / Math.SQRT2) * R;
      g.fillRect(x, y, 1.2, 1.2);
    }
  }

  drawSpec() {
    const c = this.canvas(this.spec);
    if (!c) return;
    const [g, W, H] = c, E = this.E, an = E.spec;
    const bins = this.bins && this.bins.length === an.frequencyBinCount ? this.bins : (this.bins = new Float32Array(an.frequencyBinCount));
    an.getFloatFrequencyData(bins);
    g.fillStyle = '#0b0c0f'; g.fillRect(0, 0, W, H);
    const X = (fq) => (Math.log(fq / 20) / Math.log(1000)) * W;
    g.fillStyle = '#1f2026'; g.font = '9px "Segoe UI", sans-serif';
    for (const fq of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = X(fq); g.fillRect(x, 0, 1, H); g.fillStyle = '#4a4b52'; g.fillText(fq >= 1000 ? `${fq / 1000}k` : String(fq), x + 2, H - 3); g.fillStyle = '#1f2026'; }
    const sr = E.ctx.sampleRate, Y = (db) => H - ((db + 100) / 90) * H;
    // live spectrum, averaged over 1/6 octave around each point and eased over time
    const pts = Math.floor(W / 2);
    if (!this.sm || this.sm.length !== pts) this.sm = new Float32Array(pts).fill(-100);
    g.beginPath();
    for (let p = 0; p < pts; p++) {
      const x = p * 2, fq = 20 * Math.pow(1000, x / W);
      const lo = Math.max(0, Math.floor((fq / 2 ** (1 / 12) / (sr / 2)) * bins.length)), hi = Math.min(bins.length - 1, Math.max(lo, Math.ceil((fq * 2 ** (1 / 12) / (sr / 2)) * bins.length)));
      let pw = 0; for (let i = lo; i <= hi; i++) pw += 10 ** (bins[i] / 10);
      const dbv = 10 * Math.log10(pw / (hi - lo + 1) + 1e-12) + 4.5 * Math.log2(fq / 1000); // +4.5 dB/oct: a balanced mix reads flat
      this.sm[p] = Math.max(dbv, this.sm[p] * 0.8 + dbv * 0.2);
      const y = Y(Math.max(-100, this.sm[p]));
      if (p === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = '#c9c4b8'; g.lineWidth = 1; g.stroke();
    // reference and the balance line, tilted the same way, lined up at 1 kHz with the live view
    const tilt = (fc) => 4.5 * Math.log2(fc / 1000);
    const curve = (vals, color, dash) => {
      const at1k = vals[BANDS.findIndex((fc) => fc >= 1000)];
      g.beginPath();
      BANDS.forEach((fc, i) => { const x = X(fc), y = Y(-45 + vals[i] - at1k + tilt(fc)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
    };
    curve(BANDS.map(targetCurve), '#3f6f4a', [4, 4]);
    if (this.ref?.bands) curve(this.ref.bands, '#7fb0ff');
    // the EQ's response (±12 dB over the height)
    const peq = this.fx.find((x) => x.type === 'peq' && x.on !== false), u = peq && E.masterStrip.unit(peq.id);
    if (u?.response) {
      const n = Math.floor(W / 2), freqs = Float32Array.from({ length: n }, (_, i) => 20 * Math.pow(1000, i / (n - 1)));
      const mag = u.response(freqs);
      g.beginPath();
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * W, y = H / 2 - (dB(mag[i]) / 12) * (H / 2 - 6); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokeStyle = '#e0a440'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#2a2b31'; g.fillRect(0, H / 2, W, 1);
    }
  }

  drawHist(target) {
    const c = this.canvas(this.hist);
    if (!c) return;
    const [g, W, H] = c, v = this.history;
    g.fillStyle = '#0b0c0f'; g.fillRect(0, 0, W, H);
    const Y = (l) => H - ((l + 40) / 40) * H; // -40 .. 0 LUFS
    g.fillStyle = '#2f4a36'; g.fillRect(0, Y(target + 1), W, Y(target - 1) - Y(target + 1));
    g.fillStyle = '#4a4b52'; g.font = '9px "Segoe UI", sans-serif'; g.fillText(`목표 ${target}`, 4, Y(target) - 3);
    if (v.length < 2) return;
    g.beginPath();
    const n = Math.min(v.length, Math.floor(W));
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * W, y = Y(v[v.length - n + i]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.strokeStyle = '#e0a440'; g.lineWidth = 1.2; g.stroke();
  }
}

// the loudest `sec` seconds of a render (by short-term power), for quick searches
function loudest(mix, sec) {
  const n = Math.min(mix.left.length, Math.round(sec * mix.rate)), hop = Math.round(mix.rate);
  let best = 0, bestP = -1;
  for (let s = 0; s + n <= mix.left.length; s += hop) {
    let p = 0;
    for (let i = s; i < s + n; i += 16) p += mix.left[i] * mix.left[i] + mix.right[i] * mix.right[i];
    if (p > bestP) { bestP = p; best = s; }
  }
  return { left: mix.left.subarray(best, best + n), right: mix.right.subarray(best, best + n), rate: mix.rate };
}

void gainMix;
