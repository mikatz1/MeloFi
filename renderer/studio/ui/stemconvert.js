// A separated track -> MIDI, from the project itself. A project made from a separation keeps where
// the separation is (proj.stemsRef, ai.js fromStems) and which audio channel is which stem
// (ch.stem), so any time later — also after saving and opening the project again — a track can be
// converted from its right-click menu:
//   MIDI로 변환…       that stem only: instruments recognised, timbre matched (midiconvert.js), the
//                      best few candidates with their accuracy, the stem and the candidates to
//                      listen to, and a MIDI channel (with the automatic mixing) next to the track
//   보컬로 변환…        the lead vocal: lyrics recognised from the stem, a voice picked, a channel
//                      with the melody and a syllable per note, sung straight away (vocal.js)
//   모두 MIDI로 변환    every separated track with its best match, in the background (the progress
//                      card in the Studio's corner, aimini.js); instruments can be changed after
import { h } from './dom.js';
import { sections, candidates, rangeText, renderCandidate, assignInto, putNotes, stemTicks, stemNotes, fixStemOctaves, stemAudio, matchAll, highlightStart, candName, CATS, STEM_NAMES, useModelNotes } from './midiconvert.js';
import { newChannel, barTicks } from '../model.js';
import { t, tc, tdyn, N_ } from '../../i18n/i18n.js';

const ORDER = ['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'];

// The lead voice measured from its pitch curve (analyze.py: notes_clean.voice_expression): a note
// holds one pitch, so wide vibrato and slides are lost and long notes can come out chopped. Said
// before the conversion, so the result is not a surprise.
export function voiceWarning(r) {
  const x = r?.voice;
  if (!x || x.voiced < 5) return null;
  const vib = x.vibrato >= 0.2, gl = x.glide >= 0.08;
  if (!vib && !gl) return null;
  const what = vib && gl ? t('비브라토와 음을 미끄러지듯 잇는 부분이 많아요') : vib ? t('비브라토가 많아요 (노래 시간의 {n}%)', { n: Math.round(x.vibrato * 100) }) : t('음을 미끄러지듯 잇는 부분이 많아요');
  return h('p', { class: 'ai-warn' }, t('이 보컬은 {what}. 음표는 한 음높이만 담아서 떨림과 미끄러짐은 빠지고, 긴 음이 잘게 나뉠 수 있어요.', { what }));
}
const pct = (v) => `${Math.round(v)}%`;

// the automatic mixing's settings for a candidate, in words (the % column's tooltip)
export function mixText(S, mx) {
  const sg = (v) => `${v > 0 ? '+' : ''}${v}dB`, fq = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)}kHz` : `${f}Hz`);
  const bits = [], bands = [];
  for (const p of mx.eq || []) {
    if (p.low) bands.push(`${fq(p.lowF)}↓ ${sg(p.low)}`);
    if (p.mid) bands.push(`${fq(p.midF)} ${sg(p.mid)}`);
    if (p.high) bands.push(`${fq(p.highF)}↑ ${sg(p.high)}`);
  }
  if (bands.length) bits.push(t('EQ {bands}', { bands: bands.join(', ') }));
  bits.push(t('리버브 {n}', { n: pct(mx.send * 100) }));
  if (mx.env) bits.push(t('어택 ×{a} · 릴리스 ×{r}', { a: mx.env.a, r: mx.env.r }));
  if (mx.layer) bits.push(t('레이어 {name} {n}', { name: candName(S, mx.layer.id), n: pct(mx.layer.w * 100) }));
  return t('이 구간에 맞춰 믹스를 조정했어요. 조정 전 {acc}, {what}', { acc: pct(mx.acc0), what: bits.join(' · ') });
}

// the lead vocal's notes as one line: a chord keeps its top note and a note ends where the next
// starts (as vocal.js melodyOf reads a channel), so a syllable per note stays in step
export function melodyLine(notes) {
  const s = [...notes].sort((a, b) => a[0] - b[0] || b[2] - a[2]), out = [];
  for (const [t0, d, n, v] of s) {
    const prev = out.at(-1);
    if (prev && t0 - prev[0] < 0.03) continue;
    if (prev && prev[0] + prev[1] > t0) prev[1] = t0 - prev[0];
    out.push([t0, d, n, v]);
  }
  return out.filter((x) => x[1] > 0.02);
}

export class StemConvert {
  constructor(studio) {
    this.S = studio;
    this.busy = null;     // 'analyse' while matching (aimini.js reads busy, progress, stemLabel, error)
    this.progress = 0;
    this.stemLabel = '';
    this.error = null;
    this.cache = new Map(); // `${dir}|${stem}` -> { r, plan }: a stem matched once is not matched again
    this.results = new Map(); // dir -> the separation's result.json
    this.view = null;     // { kind: 'midi' | 'vocal' | 'batch', ... }
    this.el = h('section', { id: 'stemconv', class: 'sheet', hidden: true },
      h('div', { class: 'sheet-card ai-card' },
        h('div', { class: 'sheet-head' }, this.title = h('h2', {}), h('button', { class: 'x', 'aria-label': t('닫기'), onclick: () => this.close() })),
        this.body = h('div', { class: 'ai-body' })));
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el && !this.busy) this.close(); });
    document.body.append(this.el);
  }

  // ---------- which tracks can be converted ----------
  get ref() { return this.S.proj.stemsRef?.dir ? this.S.proj.stemsRef : null; }
  stemOf(ch) { return ch?.kind === 'audio' && ch.stem && this.ref ? ch.stem : null; }
  stemChannels() { return this.S.proj.channels.filter((c) => this.stemOf(c)).sort((a, b) => ORDER.indexOf(a.stem) - ORDER.indexOf(b.stem)); }
  clipOf(ch) { return this.S.proj.playlist.clips.filter((c) => c.kind === 'audio' && c.ch === ch.id).sort((a, b) => a.start - b.start)[0] || null; }
  // the separated track on a playlist track
  channelOfTrack(ti) {
    const p = this.S.proj;
    for (const c of p.playlist.clips) if (c.track === ti && c.kind === 'audio') { const ch = p.channels.find((x) => x.id === c.ch); if (this.stemOf(ch)) return ch; }
    return null;
  }
  // menu items for a separated track (track head, clip title, channel rack)
  menuItems(ch) {
    if (!this.stemOf(ch)) return [];
    return [
      ...(ch.stem === 'vocals' ? [{ label: t('보컬로 변환…'), hint: t('가사와 목소리로'), disabled: !!this.busy, act: () => this.openVocal(ch) }] : []),
      { label: t('MIDI로 변환…'), hint: t('닮은 악기 찾기'), disabled: !!this.busy, act: () => this.open(ch) },
      { label: t('분리한 트랙 모두 MIDI로 변환'), disabled: !!this.busy, act: () => this.convertAll() },
      { sep: true },
    ];
  }

  // ---------- the separation, read again ----------
  async result() {
    const dir = this.ref?.dir;
    if (!dir) throw new Error(t('이 프로젝트에는 분리한 트랙이 없어요.'));
    if (this.results.has(dir)) return this.results.get(dir);
    const b = await window.melofi.stemsRead(`${dir}\\result.json`);
    let r = null;
    try { r = b ? JSON.parse(new TextDecoder().decode(b)) : null; } catch { r = null; }
    if (!r?.stems) throw new Error(t('분리해 둔 결과를 찾지 못했어요. AI 창에서 이 곡을 다시 분석하면 변환할 수 있어요.'));
    this.results.set(dir, r);
    return r;
  }
  // what the recognition heard on every stem (kept beside the result once made)
  async instruments() {
    const dir = this.ref.dir;
    const b = await window.melofi.stemsRead(`${dir}\\instruments.json`);
    if (b) { try { return JSON.parse(new TextDecoder().decode(b)); } catch { /* made again below */ } }
    const eng = await window.melofi.stemsStatus();
    if (!eng.instruments) {
      this.stemLabel = t('악기 인식 구성 요소를 설치하고 있어요…'); this.paint();
      const a = await window.melofi.stemsAddInstruments();
      if (!a.ok) throw new Error(tdyn(a.message));
    }
    this.stemLabel = t('악기를 알아보고 있어요…'); this.paint();
    const r = await window.melofi.stemsInstruments(dir);
    if (!r.ok) throw new Error(tdyn(r.message));
    return r.result;
  }
  // A stem's notes from the model made for its instrument, where that optional component is
  // installed and applies (tools/stems/piano_notes.py, bass_notes.py, vocal_notes.py): made once
  // per song and saved beside the analysis. this.modelMissing[k]: the component is not installed.
  async modelNotes(r, k) {
    const M = { piano: ['stemsPiano', N_('피아노 음표를 다시 채보하고 있어요…')], bass: ['stemsBass', N_('베이스 음표를 다시 채보하고 있어요…')], vocals: ['stemsVocalNotes', N_('보컬 음표를 다시 채보하고 있어요…')] }[k];
    if (!M || !r.stems?.[k] || r.modelNotes?.[k] != null || !window.melofi[M[0]]) return;
    this.stemLabel = t(M[1]); this.paint();
    try {
      const res = await window.melofi[M[0]](this.ref.dir);
      if (res?.ok) { if (!useModelNotes(r, k, res.result)) (r.modelNotes ||= {})[k] = false; }
      else if (res?.missing) (this.modelMissing ||= {})[k] = true;
    } catch { /* the general transcription */ }
  }
  // one stem matched (once per stem and separation)
  async match(k, onProgress) {
    const key = `${this.ref.dir}|${k}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const r = await this.result();
    const inst = await this.instruments();
    if (this.cancelled) throw new Error('cancelled');
    // which instrument plays which note (the optional YourMT3+ component): saved beside the
    // analysis, or made now. A hint for splitting a stem that holds several instruments.
    if (!r.muscriptor?.notes && !r.labels && window.melofi.stemsLabels) {
      this.stemLabel = t('악기별로 나눌 수 있는지 듣고 있어요…'); this.paint();
      try { const lb = await window.melofi.stemsLabels(this.ref.dir); if (lb?.ok && lb.result?.parts) r.labels = lb.result; else if (lb?.missing) this.labelsMissing = true; } catch { /* without labels */ }
      if (this.cancelled) throw new Error('cancelled');
    }
    await this.modelNotes(r, k);
    if (this.cancelled) throw new Error('cancelled');
    const plan = sections(r, inst);
    plan.stems = { [k]: plan.stems[k] || [] };
    await matchAll(this.S, r, plan, { onProgress: (p, label) => { if (this.cancelled) throw new Error('cancelled'); onProgress(p, label); } });
    const hit = { r, plan };
    this.cache.set(key, hit);
    return hit;
  }
  // the best match of every group; stray parts stay out
  topChoice(k, plan) {
    const choice = {};
    for (const g of plan.stems[k] || []) choice[`${k}:${g.cat}`] = g.stray ? null : candidates(this.S, k, g)[0]?.id || null;
    return choice;
  }
  async download(ids) {
    const S = this.S;
    const want = [...new Set(ids.filter(Boolean))].filter((id) => { const m = S.app.instruments.find((i) => i.id === id); return m && !m.installed && m.downloadable; });
    for (const [i, id] of want.entries()) {
      this.stemLabel = t('악기 받는 중… {name} ({i}/{n})', { name: S.instName(id), i: i + 1, n: want.length }); this.paint();
      await S.app.downloadInstrument(id, { quiet: true });
    }
  }
  // the chosen instruments as channels behind the stem's track; the recording goes quiet
  add(ch, hit, choice) {
    const S = this.S, p = S.proj;
    let made = [];
    S.edit(() => {
      made = assignInto(p, hit.r, hit.plan, choice, S, { stems: [ch.stem], after: ch.id, tickOf: stemTicks(p, hit.r, this.clipOf(ch)) });
      if (made.length) { ch.mute = true; p.selected = made[0].id; }
    }, true, t('MIDI로 변환'));
    S.syncAudio?.();
    return made;
  }

  // ---------- the window ----------
  show() { this.S.app.ui.close(); this.el.hidden = false; this.render(); }
  close() { this.el.hidden = true; this.stopPreview(); if (!this.busy) this.done = null; }
  cancel() { if (!this.busy) return; this.cancelled = true; window.melofi.stemsCancel?.(); window.melofi.vocalCancel?.(); this.stemLabel = t('취소하는 중…'); this.paint(); }
  paint() {
    if (this.barEl) this.barEl.style.width = `${Math.round(this.progress * 100)}%`;
    if (this.labelEl) this.labelEl.textContent = tdyn(this.stemLabel || '');
  }
  start(label) { this.busy = 'analyse'; this.cancelled = false; this.error = null; this.progress = 0; this.stemLabel = label; this.t0 = Date.now(); this.etaHist = []; }
  busyView() {
    return h('div', { class: 'ai-step' },
      h('div', { class: 'row' }, this.labelEl = h('span', { class: 'dim' }, tdyn(this.stemLabel || '')), h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => this.cancel() }, t('취소'))),
      h('div', { class: 'ai-bar' }, this.barEl = h('i', { style: `width:${Math.round(this.progress * 100)}%` })));
  }
  render() {
    if (this.el.hidden) return;
    const v = this.view;
    this.title.textContent = !v ? t('MIDI로 변환') : v.kind === 'vocal' ? t('{name} · 보컬로 변환', { name: v.ch.name }) : v.kind === 'batch' ? t('분리한 트랙 모두 MIDI로 변환') : t('{name} · MIDI로 변환', { name: v.ch.name });
    this.barEl = this.labelEl = null;
    const parts = [];
    if (this.busy) parts.push(this.busyView());
    else if (v?.kind === 'midi' && v.hit) parts.push(this.midiView(v));
    else if (v?.kind === 'vocal') parts.push(this.vocalView(v));
    else if (v?.kind === 'batch') parts.push(this.batchView(v));
    if (this.busy && v?.kind === 'vocal') parts.push(this.vocalView(v));
    if (this.error) parts.push(h('p', { class: 'cl-msg err', style: 'white-space:pre-line' }, tdyn(this.error)), this.busy ? null : h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: () => this.close() }, t('닫기'))));
    this.body.replaceChildren(...parts.filter(Boolean));
  }

  // ---------- one track -> MIDI ----------
  async open(ch) {
    if (this.busy) return this.show();
    const k = this.stemOf(ch);
    if (!k) return;
    this.view = { kind: 'midi', ch, k, hit: null, choice: {} };
    this.start(t('{name} 트랙을 듣고 있어요…', { name: ch.name }));
    this.show();
    try {
      const hit = await this.match(k, (p, label) => { this.progress = p; this.stemLabel = label ? t('음색 비교 중 · {what}', { what: label }) : t('음색 비교 중…'); this.paint(); });
      this.view.hit = hit;
      this.view.choice = this.topChoice(k, hit.plan);
      if (!(hit.plan.stems[k] || []).length) this.error = t('이 트랙에서는 받아 적은 음표가 없어요.');
    } catch (err) {
      if (this.cancelled) { this.busy = null; this.close(); this.S.status(t('MIDI 변환을 취소했어요.')); return; }
      this.error = t('변환하지 못했어요: {why}', { why: tdyn(err.message) });
    }
    this.busy = null;
    this.render();
  }
  midiView(v) {
    const S = this.S, { k, hit } = v, groups = hit.plan.stems[k] || [];
    const row = (g) => {
      const key = `${k}:${g.cat}`, cands = candidates(S, k, g).slice(0, 5), cur = v.choice[key], best = cands[0], measured = best?.acc != null;
      const sel = h('select', { class: 'mc-sel', onchange: (e) => { v.choice[key] = e.target.value || null; this.stopPreview(); } },
        ...cands.map((c, i) => h('option', { value: c.id, selected: c.id === cur },
          measured ? `${pct(c.acc)} · ${c.name} (${c.kind})${c.mix ? (c.mix.layer ? t(' · 믹스 맞춤 + {name}', { name: candName(S, c.mix.layer.id) }) : t(' · 믹스 맞춤')) : ''}${i === 0 ? ' ★' : ''}${c.installed ? '' : c.downloadable ? t(' · 받기') : ''}`
            : `${c.recommended ? t('★ 추천 · ') : ''}${c.name}${c.installed ? '' : c.downloadable ? t(' (받기)') : ''}`)),
        h('option', { value: '', selected: !cur }, t('넣지 않음')));
      const pick = cands.find((c) => c.id === cur);
      const why = pick?.parts ? (pick.parts.n != null ? t('배음 {h} · 스펙트럼 {c} · 소리 모양 {e} · 잡음 {n}', { h: pct(pick.parts.h ?? 0), c: pct(pick.parts.c ?? 0), e: pct(pick.parts.e ?? 0), n: pct(pick.parts.n) }) : t('배음 {h} · 스펙트럼 {c} · 소리 모양 {e}', { h: pct(pick.parts.h ?? 0), c: pct(pick.parts.c ?? 0), e: pct(pick.parts.e ?? 0) })) : '';
      const oId = `o-${g.cat}`, cId = `c-${g.cat}`;
      const tip = g.stray ? t('{why}: 다른 악기 소리가 섞였거나 잘못 알아들었을 가능성이 커서 기본 선택에서 뺐어요.', { why: g.heard <= 2 ? t('곡 전체에서 {n}번만 들려요', { n: g.heard }) : t('음표가 {n}개뿐이에요', { n: g.notes }) })
        : g.match?.vocal ? t('노래는 음색 비교를 하지 않았어요. 멜로디만 악기로 듣고 싶을 때 골라 주세요.')
        : g.match?.unmeasured ? t('이 구간은 음이 또렷하지 않아 음색을 재지 못했어요') : '';
      return h('div', { class: `mc-row${g.stray ? ' thin' : ''}`, title: tip },
        h('span', { class: 'mc-cat' }, measured ? best.kind : t(CATS[g.label][0]), g.stray ? h('small', {}, t(' · 음표 {n}', { n: g.notes })) : null),
        h('span', { class: 'mc-range', title: rangeText(g.secs) }, rangeText(g.secs)),
        sel,
        h('span', { class: `mc-acc${measured && best.acc >= 90 ? ' ok' : ''}`, title: why ? t('고른 악기와 원음의 닮은 정도: {why}', { why }) + (pick?.mix ? `\n${mixText(S, pick.mix)}` : '') : '' }, pick?.acc != null ? pct(pick.acc) : '—'),
        h('button', { class: `btn sm ghost${this.playing === oId ? ' on' : ''}`, title: t('분리한 원음 듣기'), onclick: () => this.previewOriginal(v, g, oId) }, this.playing === oId ? t('■ 원음') : t('▶ 원음')),
        h('button', { class: `btn sm ghost${this.playing === cId ? ' on' : ''}`, title: t('고른 악기로 이 구간의 음표 듣기 (8초)'), onclick: () => this.previewCandidate(v, g, cId) }, this.playing === cId ? t('■ 악기') : t('▶ 악기')));
    };
    const valid = groups.filter((g) => !g.stray), stray = groups.filter((g) => g.stray);
    return h('div', { class: 'ai-step' },
      h('p', { class: 'dim' }, t('후보 악기가 이 트랙의 음표를 직접 연주해 원음과 비교한 닮은 정도예요. 들어 보고 골라 주세요.')),
      k === 'vocals' ? voiceWarning(hit.r) : null,
      k === 'other' && this.labelsMissing && !hit.r.labels && !hit.r.muscriptor?.notes ? h('div', { class: 'row' },
        h('span', { class: 'dim' }, t('이 트랙에 여러 악기가 섞여 있다면 악기별 채널로 분리할 수 있어요. 구성 요소를 한 번 내려받아야 해요 (약 540 MB).')), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: () => this.setupLabels(v) }, t('악기별 분리 받기'))) : null,
      this.modelMissing?.[k] && !hit.r.modelNotes?.[k] ? h('div', { class: 'row' },
        h('span', { class: 'dim' }, t({
          piano: N_('피아노 전용 채보 모델을 받으면 음표를 더 정확히 받아 적어요 (약 170 MB). 이 모델로 만든 음표는 비상업적 용도로만 쓸 수 있어요.'),
          bass: N_('베이스 전용 채보 모델을 받으면 음표를 더 정확히 받아 적어요 (약 100 MB). 이 모델로 만든 음표는 비상업적 용도로만 쓸 수 있어요.'),
          vocals: N_('보컬 전용 채보 모델을 받으면 음표와 음 길이를 더 정확히 받아 적어요 (약 190 MB). 이 모델로 만든 음표는 비상업적 용도로만 쓸 수 있어요.') }[k])), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: () => this.setupModel(v) }, t({ piano: N_('피아노 채보 모델 받기'), bass: N_('베이스 채보 모델 받기'), vocals: N_('보컬 채보 모델 받기') }[k]))) : null,
      hit.r.modelNotes?.[k] ? h('p', {}, h('span', { class: 'ai-nc' }, t('비상업 전용')), t({ piano: N_(' 피아노 전용 모델로 받아 적은 음표예요.'), bass: N_(' 베이스 전용 모델로 받아 적은 음표예요.'), vocals: N_(' 보컬 전용 모델로 받아 적은 음표예요.') }[k])) : null,
      h('div', { class: 'mc-table' }, ...valid.map(row),
        ...(stray.length ? [h('div', { class: 'mc-stem dim' }, t('한두 번만 들리는 소리예요. 잡음이거나 잘못 알아들은 소리일 수 있어요.')), ...stray.map(row)] : [])),
      h('div', { class: 'row' }, h('span', { class: 'dim' }, t('MIDI 채널은 이 트랙 바로 뒤에 생기고, 원래 트랙은 음소거돼요.')), h('span', { class: 'sp' }),
        h('button', { class: 'btn', onclick: () => this.close() }, t('취소')),
        h('button', { class: 'btn primary', onclick: () => this.make(v) }, t('MIDI 채널 만들기'))));
  }
  async make(v) {
    if (!Object.values(v.choice).some(Boolean)) { this.error = t('넣을 악기를 하나 이상 골라 주세요.'); this.render(); return; }
    this.stopPreview();
    this.start(t('트랙을 만드는 중…')); this.busy = 'build'; this.render();
    try {
      await this.download(Object.values(v.choice));
      const made = this.add(v.ch, v.hit, v.choice);
      this.busy = null;
      this.close();
      this.S.app.ui.toast(t('{name} 트랙을 MIDI 채널 {n}개로 바꿨어요.', { name: v.ch.name, n: made.length }));
    } catch (err) { this.busy = null; this.error = t('변환하지 못했어요: {why}', { why: tdyn(err.message) }); this.render(); }
  }

  // ---------- listening ----------
  stopPreview() {
    if (this.audioEl) { this.audioEl.pause(); URL.revokeObjectURL(this.audioUrl); }
    if (this.srcEl) { try { this.srcEl.stop(); } catch { /* ended */ } this.srcEl = null; }
    const was = this.playing;
    this.audioEl = null; this.playing = null;
    if (was && !this.el.hidden) this.render();
  }
  async previewOriginal(v, g, id) {
    if (this.playing === id) return this.stopPreview();
    this.stopPreview();
    const file = v.hit.r.stems[v.k], bytes = await window.melofi.stemsRead(file);
    if (!bytes) { this.error = t('분리한 트랙 파일을 찾지 못했어요.'); this.render(); return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: /\.flac$/i.test(file) ? 'audio/flac' : 'audio/wav' }));
    const a = new Audio(url), at = highlightStart(v.hit.r, v.k, g, v.hit.plan.bars);
    a.currentTime = Math.max(0, at);
    a.ontimeupdate = () => { if (a.currentTime > at + 8) this.stopPreview(); };
    a.onended = () => this.stopPreview();
    a.play();
    this.audioEl = a; this.audioUrl = url; this.playing = id;
    this.render();
  }
  async previewCandidate(v, g, id) {
    const S = this.S, instId = v.choice[`${v.k}:${g.cat}`];
    if (!instId) return;
    if (this.playing === id) return this.stopPreview();
    this.stopPreview();
    this.playing = id; this.error = null; this.render();
    try {
      const meta = S.app.instruments.find((i) => i.id === instId);
      if (meta && !meta.installed) {
        if (!meta.downloadable) throw new Error(t('{name}이(가) 이 PC에 없어 미리 들을 수 없어요.', { name: meta.name }));
        S.app.ui.toast(t('{name}을(를) 받고 있어요. 다 받으면 바로 들려드릴게요.', { name: meta.name }), { ms: 3000 });
        const r = await S.app.downloadInstrument(instId, { quiet: true });
        if (!r?.ok && !S.app.instruments.find((i) => i.id === instId)?.installed) throw new Error(t('{name}을(를) 받지 못했어요', { name: meta.name }));
        if (this.playing !== id) return;
      }
      const mix = await renderCandidate(S, v.hit.r, v.k, g, instId, v.hit.plan.bars);
      if (this.playing !== id) return;
      const c = S.app.engine.ctx, b = c.createBuffer(2, mix.left.length, mix.rate);
      b.copyToChannel(mix.left, 0); b.copyToChannel(mix.right, 1);
      const src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start();
      src.onended = () => { if (this.playing === id) this.stopPreview(); };
      this.srcEl = src;
    } catch (err) { this.error = t('들어보지 못했어요: {why}', { why: err.message }); this.playing = null; this.render(); }
  }

  // ---------- the lead vocal -> a singing channel ----------
  // the stem's notes as one melody line, octave errors put right as the matching does
  async vocalNotes(r) {
    await this.modelNotes(r, 'vocals');
    if (!r.fixed?.vocals) { try { fixStemOctaves(r, 'vocals', await stemAudio(r.stems.vocals)); } catch { /* as transcribed */ } }
    return melodyLine(stemNotes(r, 'vocals'));
  }
  // the voice for a language: one that sings it and is ready, else one that sings it, else any ready
  pickVoice(st, lang) {
    const sings = (x) => !lang || x.langs?.includes(lang);
    return st.voices.find((x) => x.ready && sings(x)) || st.voices.find((x) => sings(x) && (lang !== 'ko' || x.id === 'hanami')) || st.voices.find((x) => sings(x)) || st.voices.find((x) => x.ready) || st.voices[0] || null;
  }
  async openVocal(ch) {
    if (this.busy) return this.show();
    if (this.stemOf(ch) !== 'vocals') return;
    const V = await import('../vocal.js');
    const v = this.view = { kind: 'vocal', ch, V, st: null, notes: [], text: '', syl: null, lang: '', voice: null, line: '' };
    this.error = null;
    this.show();
    try {
      v.st = await V.voices(true);
      v.r = await this.result();
      v.notes = await this.vocalNotes(v.r);
      v.voice = this.pickVoice(v.st, null)?.id || null;
      if (!v.notes.length) this.error = t('이 트랙에서는 받아 적은 음표가 없어요.');
    } catch (err) { this.error = tdyn(err.message); }
    this.render();
    if (v.st?.lyrics && v.notes.length) this.hearLyrics(v);
  }
  // the lyrics from the vocal stem, a syllable per note
  async hearLyrics(v) {
    this.start(t('가사를 듣고 있어요…')); this.render();
    const r = await v.V.recognizeLyrics({ path: v.r.stems.vocals, notes: v.notes, language: v.lang || null, onProgress: (m) => { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); } });
    this.busy = null;
    if (this.cancelled) v.line = t('가사 인식을 취소했어요. 가사를 직접 적어도 돼요.');
    else if (!r.ok) v.line = tdyn(r.message);
    else {
      v.text = r.text || ''; v.heard = v.text; v.syl = (r.notes || []).map((x) => x || '+');
      if (r.language) { v.heardLang = r.language; const pick = this.pickVoice(v.st, r.language); if (pick) v.voice = pick.id; }
      v.line = v.text ? t('알아들은 가사예요. 고쳐도 돼요.') : t('가사를 알아듣지 못했어요. 직접 적어 주세요.');
    }
    this.render();
  }
  vocalView(v) {
    if (!v.st) return h('div', { class: 'ai-step' }, h('p', { class: 'dim' }, t('보이스를 확인하는 중…')));
    const st = v.st, cur = st.voices.find((x) => x.id === v.voice), busy = !!this.busy;
    const LANG = { ko: t('한국어'), ja: t('일본어'), en: t('영어') };
    const voiceSel = h('select', { class: 'ai-sel vo-sel', disabled: busy, onchange: (e) => { v.voice = e.target.value; this.render(); } },
      ...st.voices.map((x) => h('option', { value: x.id, selected: x.id === v.voice }, `${t(x.name)} · ${(x.langs || []).map((l) => LANG[l] || l).join(', ')}${x.ready ? '' : x.installed ? t(' · 구성 요소 필요') : t(' · 받아야 해요')}`)));
    const langSel = h('select', { class: 'ai-sel vo-sel', disabled: busy, onchange: (e) => { v.lang = e.target.value; } },
      ...[['', t('언어 자동')], ['ko', LANG.ko], ['ja', LANG.ja], ['en', LANG.en]].map(([k, l]) => h('option', { value: k, selected: k === v.lang }, l)));
    const area = h('textarea', { class: 'vo-lyrics', rows: 5, disabled: busy, placeholder: t('가사를 적어 주세요. 음표 하나에 음절 하나씩 붙어요.'), oninput: (e) => { v.text = e.target.value; } }, v.text);
    area.value = v.text;
    const get = cur && !cur.installed ? h('button', { class: 'btn sm', disabled: busy, onclick: () => this.getVoice(v, cur) }, t('받기')) : null;
    const setup = !st.engine ? h('p', { class: 'dim' }, t('노래 합성은 AI 분석 엔진을 함께 써요. AI 창에서 분석 엔진을 먼저 설치해 주세요.'))
      : st.componentsMissing ? h('div', { class: 'row' }, h('span', { class: 'dim' }, st.lyrics ? t('일부 보이스는 보컬 구성 요소가 더 필요해요.') : t('가사 인식은 보컬 구성 요소를 설치하면 쓸 수 있어요 (약 1.5 GB).')), h('span', { class: 'sp' }), h('button', { class: 'btn sm', disabled: busy, onclick: () => this.setupVocal(v) }, t('보컬 구성 요소 설치'))) : null;
    return h('div', { class: 'ai-step' },
      this.busy ? null : h('p', { class: 'dim' }, t('리드 보컬의 멜로디와 가사로 보컬 채널을 만들고 고른 보이스로 바로 불러요. 음표 {n}개를 찾았어요.', { n: v.notes.length })),
      this.busy ? null : voiceWarning(v.r),
      setup,
      h('label', { class: 'cl-lab' }, t('보이스')),
      h('div', { class: 'row' }, voiceSel, get, v.heardLang ? h('span', { class: 'dim' }, t('가사는 {lang}로 들렸어요.', { lang: LANG[v.heardLang] || v.heardLang })) : null),
      h('label', { class: 'cl-lab' }, t('가사')),
      area,
      h('div', { class: 'row' }, langSel, h('button', { class: 'btn sm', disabled: busy || !st.lyrics || !v.notes.length, onclick: () => this.hearLyrics(v) }, t('가사 다시 듣기')), h('span', { class: 'dim' }, tdyn(v.line || ''))),
      h('div', { class: 'row' }, h('span', { class: 'sp' }),
        h('button', { class: 'btn', disabled: busy, onclick: () => this.close() }, t('취소')),
        h('button', { class: 'btn primary', disabled: busy || !cur?.ready || !v.notes.length, title: cur?.ready ? '' : t('보이스를 먼저 받아 주세요'), onclick: () => this.makeVocal(v) }, t('보컬 채널 만들고 부르기'))));
  }
  async getVoice(v, x) {
    this.start(t('{name} 받는 중…', { name: t(x.name) })); this.render();
    const off = window.melofi.onVocalProgress((m) => { if (m.id === x.id) { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); } });
    const r = await window.melofi.vocalInstall(x.id);
    off();
    this.busy = null;
    if (!r.ok) v.line = tdyn(r.message);
    v.st = await v.V.voices(true);
    this.render();
    return r.ok;
  }
  // the optional component that tells the instruments of a mixed stem apart; then the stem again
  async setupLabels(v) {
    this.start(t('악기별 분리 구성 요소를 내려받고 있어요…')); this.render();
    const off = window.melofi.onStemsProgress?.((m) => { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); });
    const r = await window.melofi.stemsLabelsSetup();
    off?.();
    this.busy = null;
    if (!r.ok) { this.error = t('받지 못했어요: {why}', { why: tdyn(r.message || '') }); this.render(); return; }
    this.labelsMissing = false;
    this.cache.delete(`${this.ref.dir}|${v.k}`);
    this.open(v.ch);
  }
  // the optional transcription model for this stem's instrument; then the stem again
  async setupModel(v) {
    const M = { piano: ['stemsPianoSetup', N_('피아노 채보 구성 요소를 내려받고 있어요…')], bass: ['stemsBassSetup', N_('베이스 채보 구성 요소를 내려받고 있어요…')], vocals: ['stemsVocalNotesSetup', N_('보컬 채보 구성 요소를 내려받고 있어요…')] }[v.k];
    if (!M) return;
    this.start(t(M[1])); this.render();
    const off = window.melofi.onStemsProgress?.((m) => { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); });
    const r = await window.melofi[M[0]]();
    off?.();
    this.busy = null;
    if (!r.ok) { this.error = t('받지 못했어요: {why}', { why: tdyn(r.message || '') }); this.render(); return; }
    if (this.modelMissing) this.modelMissing[v.k] = false;
    this.cache.delete(`${this.ref.dir}|${v.k}`);
    this.open(v.ch);
  }
  async setupVocal(v) {
    this.start(t('보컬 구성 요소를 설치하고 있어요…')); this.render();
    const off = window.melofi.onVocalProgress((m) => { if (m.id === 'setup') { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); } });
    const r = await window.melofi.vocalSetup();
    off();
    this.busy = null;
    v.line = r.ok ? t('설치를 마쳤어요.') : tdyn(r.message);
    v.st = await v.V.voices(true);
    this.render();
    if (r.ok && v.st.lyrics && !v.text && v.notes.length) this.hearLyrics(v);
  }
  // the channel: the melody in the conversion's patterns, the voice, the lyrics and a syllable per
  // note (the recognised ones while the text is as heard; an edited text is spread over the notes)
  addVocal(ch, r, notes, { voice, text, syl }) {
    const S = this.S, p = S.proj;
    let made = null;
    S.edit(() => {
      const old = p.channels.filter((c) => c.conv === 'vocals');
      if (old.length && old.length < p.channels.length) { const ids = new Set(old.map((c) => c.id)); p.channels = p.channels.filter((c) => !ids.has(c.id)); for (const pt of p.patterns) for (const id of ids) delete pt.notes[id]; }
      const inst = S.app.instruments.find((i) => i.id === 'synlead' && i.installed) ? 'synlead' : (S.app.instruments.find((i) => i.installed)?.id || 'splendid');
      made = newChannel(inst, r.modelNotes?.vocals ? t('{name} (보컬 · 비상업)', { name: ch.name }) : t('{name} (보컬)', { name: ch.name }), p.channels.length, { vol: 0.75, send: 0.15, conv: 'vocals', vocal: { voice, lyrics: text, ...(syl ? { syl } : {}) } });
      const at = p.channels.findIndex((c) => c.id === ch.id);
      p.channels.splice(at + 1, 0, made);
      const tickOf = stemTicks(p, r, this.clipOf(ch));
      putNotes(p, notes.map((nt) => [nt, made, 1, null, 1]), tickOf, Math.max(1, Math.ceil(tickOf(r.duration) / barTicks(p))));
      ch.mute = true; p.selected = made.id;
    }, true, t('보컬로 변환'));
    S.syncAudio?.();
    return made;
  }
  async makeVocal(v) {
    const S = this.S;
    this.stopPreview();
    this.start(t('노래를 만드는 중…')); this.render();
    try {
      const same = v.syl && v.text.trim() === (v.heard || '').trim();
      const made = this.addVocal(v.ch, v.r, v.notes, { voice: v.voice, text: v.text, syl: same ? v.syl : null });
      // a syllable per note only holds while the channel reads back the same notes
      if (same && v.V.melodyOf(S.proj, made.id).length !== v.syl.length) S.edit(() => { delete made.vocal.syl; });
      const r = await S.sing(made, (m) => { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); });
      this.busy = null;
      if (!r?.ok) { this.error = t('보컬 채널은 만들었지만 노래는 만들지 못했어요: {why}', { why: tdyn(r?.message || '') }); this.render(); return; }
      this.close();
      S.app.ui.toast(t('{name}의 보컬 채널을 만들고 노래를 불렀어요.', { name: v.ch.name }));
    } catch (err) { this.busy = null; this.error = t('변환하지 못했어요: {why}', { why: tdyn(err.message) }); this.render(); }
  }

  // ---------- every separated track at once ----------
  // auto: started by itself when a separation opens as a project (ai.js openStems): the lead vocal
  // is left for 보컬로 변환… and nothing is asked
  async convertAll({ auto = false } = {}) {
    if (this.busy) return auto ? undefined : this.show();
    const S = this.S, chans = this.stemChannels().filter((c) => !auto || c.stem !== 'vocals');
    if (!chans.length) { if (!auto) S.status(t('이 프로젝트에는 분리한 트랙이 없어요.')); return; }
    const V = await import('../vocal.js');
    // the lead vocal is sung when a voice is ready; without one the user is asked once
    let sing = false, vst = null;
    const lead = chans.find((c) => c.stem === 'vocals');
    if (lead) {
      try { vst = await V.voices(true); } catch { vst = null; }
      sing = !!vst?.voices.some((x) => x.ready);
      if (!sing && vst?.engine) {
        const x = this.pickVoice(vst, null);
        if (x && !x.installed && confirm(t('리드 보컬을 노래로 바꾸려면 보이스가 필요해요. {name} 보이스를 받을까요? 받지 않으면 악기로 바꿔요.', { name: t(x.name) }))) {
          this.view = { kind: 'batch', rows: [] };
          this.start(t('{name} 받는 중…', { name: t(x.name) }));
          const off = window.melofi.onVocalProgress((m) => { if (m.id === x.id) { if (m.p != null) this.progress = m.p; if (m.label) this.stemLabel = m.label; this.paint(); } });
          const r = await window.melofi.vocalInstall(x.id);
          off();
          this.busy = null;
          vst = await V.voices(true);
          sing = r.ok && vst.voices.some((y) => y.ready);
        }
      }
    }
    const v = this.view = { kind: 'batch', rows: [] };
    this.start(t('분리한 트랙을 MIDI로 바꾸고 있어요…'));
    this.done = null;
    this.el.hidden = true; // the corner card shows the progress (aimini.js)
    const n = chans.length;
    try {
      for (const [i, ch] of chans.entries()) {
        if (this.cancelled) throw new Error('cancelled');
        const k = ch.stem, at = (p) => { this.progress = (i + p) / n; this.paint(); };
        this.stemLabel = t('{name} · {i}/{n}', { name: ch.name, i: i + 1, n }); at(0);
        try {
          if (k === 'vocals' && sing) {
            const r = await this.result(), notes = await this.vocalNotes(r);
            if (!notes.length) { v.rows.push([ch.name, t('음표가 없어 건너뛰었어요.')]); continue; }
            let text = '', syl = null, voice = this.pickVoice(vst, null);
            if (vst.lyrics) {
              this.stemLabel = t('{name} · 가사 듣는 중', { name: ch.name }); this.paint();
              const lr = await V.recognizeLyrics({ path: r.stems.vocals, notes, onProgress: (m) => { if (m.p != null) at(m.p * 0.5); } });
              if (this.cancelled) throw new Error('cancelled');
              if (lr.ok) { text = lr.text || ''; syl = (lr.notes || []).map((x) => x || '+'); const pv = this.pickVoice(vst, lr.language); if (pv?.ready) voice = pv; }
            }
            const made = this.addVocal(ch, r, notes, { voice: voice.id, text, syl });
            if (syl && V.melodyOf(S.proj, made.id).length !== syl.length) S.edit(() => { delete made.vocal.syl; });
            this.stemLabel = t('{name} · 노래하는 중', { name: ch.name }); this.paint();
            const sr = await S.sing(made, (m) => { if (m.p != null) at(0.5 + m.p * 0.5); });
            v.rows.push([ch.name, sr?.ok ? t('{voice} 보이스로 노래했어요.', { voice: t(voice.name) }) : t('보컬 채널을 만들었어요. 노래는 만들지 못했어요: {why}', { why: tdyn(sr?.message || '') })]);
            continue;
          }
          const hit = await this.match(k, (p, label) => { this.stemLabel = t('{name} · {what}', { name: ch.name, what: label || t('음색 비교 중') }); at(p); });
          const choice = this.topChoice(k, hit.plan);
          if (!Object.values(choice).some(Boolean)) { v.rows.push([ch.name, t('음표가 없어 건너뛰었어요.')]); continue; }
          await this.download(Object.values(choice));
          const made = this.add(ch, hit, choice);
          v.rows.push([ch.name, made.map((c) => c.name.replace(/^.*? · /, '')).join(', ')]);
        } catch (err) {
          if (this.cancelled) throw err;
          v.rows.push([ch.name, t('바꾸지 못했어요: {why}', { why: tdyn(err.message) })]);
        }
      }
      this.progress = 1;
      S.app.ui.toast(t('분리한 트랙 {n}개를 MIDI로 바꿨어요. 악기는 채널을 우클릭해 바꿀 수 있어요.', { n: v.rows.length }), { ms: 5000 });
    } catch (err) {
      if (this.cancelled) { v.cancelled = true; S.status(t('MIDI 변환을 취소했어요. 이미 바꾼 트랙은 그대로 있어요.')); }
      else this.error = t('변환하지 못했어요: {why}', { why: tdyn(err.message) });
    }
    this.busy = null;
    this.done = { ok: !this.error };
    this.render();
  }
  batchView(v) {
    return h('div', { class: 'ai-step' },
      h('p', { class: 'dim' }, v.cancelled ? t('도중에 취소했어요. 아래 트랙까지 바꿨어요.') : t('트랙마다 가장 닮은 악기로 바꿨어요. 악기는 채널 랙에서 채널을 우클릭해 바꿀 수 있어요.')),
      h('div', { class: 'mc-table' }, ...v.rows.map(([name, what]) => h('div', { class: 'mc-row', style: 'grid-template-columns: 140px 1fr' }, h('span', { class: 'mc-cat' }, name), h('span', { class: 'mc-range', title: what }, what)))),
      h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn primary', onclick: () => this.close() }, t('닫기'))));
  }
}
void tc; void STEM_NAMES;
