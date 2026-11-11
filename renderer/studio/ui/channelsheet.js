// Channel settings: what the channel plays (instrument / synth editor / sample editor / slicer),
// its rhythm (own swing, groove template, step loop length) and where it goes in the mixer.
import { h, knob, popup } from './dom.js';
import { SYNTH_PARAMS, SYNTH_PRESETS, synthDefaults } from '../synth.js';
import { GROOVES } from '../transport.js';
import { decode, onsets, gridSlices, peaks } from '../media.js';
import { STEP, pattern, notesOf } from '../model.js';
import { fmtParam } from '../fx.js';
import { t, tdyn } from '../../i18n/i18n.js';

export class ChannelSheet {
  constructor(studio) {
    this.S = studio;
    this.tab = 'sound';
    // like FL Studio's channel / plugin window: it floats over the studio without dimming it,
    // moves by its title bar, stays open while you keep working and remembers where it was
    let head;
    this.el = h('section', { id: 'chsheet', class: 'ch-float', hidden: true },
      h('div', { class: 'sheet-card ch-card' },
        head = h('div', { class: 'sheet-head ch-drag', title: t('끌어서 옮기기') }, this.title = h('h2', {}), h('button', { class: 'x', 'aria-label': t('닫기'), onclick: () => this.close() })),
        this.tabsEl = h('div', { class: 'cl-tabs ch-tabs' }),
        this.body = h('div', { class: 'ch-body' })));
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
    document.body.append(this.el);
  }

  place() {
    const p = this.pos || { x: Math.max(20, innerWidth / 2 - 430), y: 90 };
    this.el.style.left = `${p.x}px`; this.el.style.top = `${p.y}px`;
  }

  get ch() { return this.S.proj.channels.find((c) => c.id === this.id); }
  close() { this.el.hidden = true; }

  show(id, tab) {
    this.id = id;
    if (tab) this.tab = tab;
    this.el.hidden = false;
    this.place();
    this.render();
  }

  render() {
    const ch = this.ch;
    if (!ch) return this.close();
    this.title.textContent = t('{name} 설정', { name: ch.name });
    this.tabsEl.replaceChildren(...[['sound', t('소리')], ['rhythm', t('리듬')], ['vocal', t('보컬')], ['out', t('출력')]].map(([k, l]) => h('button', { class: this.tab === k ? 'on' : '', onclick: () => { this.tab = k; this.render(); } }, l)));
    this.body.replaceChildren(this.tab === 'rhythm' ? this.rhythm(ch) : this.tab === 'out' ? this.output(ch) : this.tab === 'vocal' ? this.vocal(ch) : this.sound(ch));
  }

  // ---------- sound ----------
  sound(ch) {
    const S = this.S;
    const kinds = h('div', { class: 'seg sm ch-kind' }, ...[['inst', t('악기')], ['synth', t('신스')], ['sample', t('샘플')], ['slicer', t('슬라이서')], ['audio', t('오디오')], ...(ch.kind === 'vst' ? [['vst', 'VST']] : [])].map(([k, l]) =>
      h('button', { class: (ch.kind || 'inst') === k ? 'on' : '', onclick: () => this.setKind(k) }, l)));
    let body;
    if ((ch.kind || 'inst') === 'inst') {
      body = h('div', { class: 'ch-inst' }, h('p', {}, `${t('지금 악기:')} `, h('b', {}, S.instName(ch.inst))),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => S.pickInstrument(e.clientX, e.clientY, (id) => { S.edit(() => { ch.inst = id; ch.name = S.instName(id); }); S.syncAudio(); this.render(); }, ch.inst) }, t('악기 바꾸기…')),
          h('button', { class: 'btn ghost', onclick: () => S.app.store.show() }, t('악기 다운로드 센터…'))));
    } else if (ch.kind === 'vst') body = this.vst(ch);
    else if (ch.kind === 'synth') body = this.synth(ch);
    else if (ch.kind === 'sample' || ch.kind === 'slicer') body = this.sample(ch);
    else body = h('p', { class: 'dim' }, t('오디오 트랙은 플레이리스트에 놓인 오디오 클립을 재생합니다. 브라우저에서 파일을 플레이리스트로 끌어오세요.'));
    return h('div', {}, kinds, body);
  }

  // ---------- vocal: voice, lyrics (typed or recognised), singing ----------
  vocal(ch) {
    const S = this.S;
    const setV = (o) => S.edit(() => { ch.vocal = { ...(ch.vocal || {}), ...o }; });
    const LANG = { ko: t('한국어'), ja: t('일본어'), en: t('영어') };
    const USE = { commercial: [t('상업 이용 가능'), ''], noncommercial: [t('비상업'), 'ai-nc'], unverified: [t('라이선스 미확인'), 'ai-nc'] };
    const mb = (b) => (b >= 1e9 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);
    const root = h('div', { class: 'ch-vocal' }, h('p', { class: 'dim' }, t('보이스를 확인하는 중…')));
    const progress = (bar, label) => (m) => {
      if (m.p != null) bar.firstChild.style.width = `${Math.round(m.p * 100)}%`;
      if (m.label) label.textContent = tdyn(m.label);
    };

    (async () => {
      const V = await import('../vocal.js');
      const st = await V.voices(true);
      const v = ch.vocal || {};
      const cur = st.voices.find((x) => x.id === (v.voice === 'r9y9/yoko_latest' ? 'yoko' : v.voice)) || st.voices.find((x) => x.ready) || st.voices[0];
      const notes = V.melodyOf(S.proj, ch.id);
      const parts = [h('p', {}, t('이 채널의 멜로디를 노래로 만들어요. 노트 하나에 음절 하나씩 붙고, 결과는 오디오 트랙으로 들어가며 이 채널은 음소거돼요.'))];

      // the engine and the extra packages
      const engLine = h('span', { class: 'dim' });
      const engBar = h('div', { class: 'ai-bar', hidden: true }, h('i', { style: 'width:0%' }));
      const engBtn = h('button', { class: 'btn', onclick: async () => {
        engBtn.disabled = true; engBar.hidden = false;
        const off = window.melofi.onVocalProgress((m) => { if (m.id === 'setup') progress(engBar, engLine)(m); });
        const r = await window.melofi.vocalSetup();
        off();
        engLine.textContent = r.ok ? (r.notes?.length ? t('설치를 마쳤어요. 일부 항목 건너뜀: {list}', { list: r.notes.map(tdyn).join(' / ') }) : t('설치를 마쳤어요.')) : tdyn(r.message);
        engBtn.disabled = false;
        if (r.ok) setTimeout(() => this.tab === 'vocal' && this.render(), r.notes?.length ? 4000 : 600);
      } }, t('보컬 구성 요소 설치'));
      if (!st.engine) {
        parts.push(h('div', { class: 'vo-note' }, t('노래 합성과 가사 인식은 AI 분석 엔진(Python)을 함께 써요. AI 창에서 분석 엔진을 먼저 설치해 주세요.')));
      } else if (st.componentsMissing) {
        engLine.textContent = t('가사 인식, NNSVS 보이스, 7z 압축 해제, GPU 가속에 필요한 패키지를 분석 엔진에 더해요 (약 1.5 GB).') + (st.lyrics ? '' : ` ${t('가사 인식은 이걸 설치해야 쓸 수 있어요.')}`);
        parts.push(h('div', { class: 'vo-note' }, engLine, engBar, h('div', { class: 'row' }, engBtn)));
      }

      // voices
      const list = h('div', { class: 'vo-list' });
      const detail = h('div', { class: 'vo-detail' });
      const dlBar = h('div', { class: 'ai-bar', hidden: true }, h('i', { style: 'width:0%' }));
      const dlLabel = h('span', { class: 'dim' });
      const dlCancel = h('button', { class: 'btn ghost sm', hidden: true, onclick: () => window.melofi.vocalCancel() }, t('취소'));
      const showDetail = (x) => {
        const lic = h('pre', { class: 'vo-lic', hidden: true });
        detail.replaceChildren(
          h('div', {}, tdyn(x.note)),
          x.credit ? h('div', { class: 'dim' }, t('크레딧: {credit}', { credit: x.credit })) : null,
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost sm', onclick: async () => { if (lic.hidden && !lic.textContent) lic.textContent = await window.melofi.vocalLicense(x.id); lic.hidden = !lic.hidden; } }, t('라이선스 보기')),
            h('button', { class: 'btn ghost sm', onclick: () => window.melofi.openExternal?.(x.licenseUrl) }, t('배포 페이지'))),
          lic);
      };
      for (const x of st.voices) {
        const [useText, useCls] = USE[x.use] || USE.unverified;
        const pick = h('input', { type: 'radio', name: `vo-${ch.id}`, checked: x.id === cur?.id, disabled: !x.installed, onchange: () => { setV({ voice: x.id }); showDetail(x); this.render(); } });
        const act = x.installed
          ? h('button', { class: 'btn ghost sm', title: t('이 보이스 파일을 지워요'), onclick: async () => { if (!confirm(t('{name} 보이스를 지울까요?', { name: t(x.name) }))) return; const r = await window.melofi.vocalRemove(x.id); if (!r.ok && r.message) { dlRow.hidden = false; dlLabel.textContent = tdyn(r.message); return; } this.render(); } }, t('삭제'))
          : h('button', { class: 'btn sm', onclick: async () => {
            for (const b of list.querySelectorAll('button')) b.disabled = true;
            dlRow.hidden = false; dlBar.hidden = false; dlCancel.hidden = false; dlLabel.textContent = t('{name} 받는 중…', { name: t(x.name) });
            const off = window.melofi.onVocalProgress((m) => { if (m.id === x.id) progress(dlBar, dlLabel)(m); });
            const r = await window.melofi.vocalInstall(x.id);
            off();
            dlCancel.hidden = true;
            if (r.ok) { if (!ch.vocal?.voice || !st.voices.find((y) => y.id === ch.vocal.voice)?.installed) setV({ voice: x.id }); this.render(); return; }
            dlLabel.textContent = tdyn(r.message); dlBar.hidden = true;
            for (const b of list.querySelectorAll('button')) b.disabled = false;
          } }, t('받기'));
        list.append(h('label', { class: `vo-row${x.id === cur?.id ? ' on' : ''}` }, pick,
          h('b', {}, t(x.name)),
          h('span', { class: 'dim' }, `${x.gender === 'male' ? t('남성') : t('여성')}${x.genderNote ? ` (${tdyn(x.genderNote)})` : ''} · ${x.langs.map((l) => LANG[l]).join(' ')}`),
          h('span', { class: useCls || 'vo-ok' }, useText),
          h('small', { class: 'dim' }, x.installed ? (x.ready ? t('설치됨') : t('구성 요소 필요')) : mb(x.bytes)),
          act));
      }
      if (cur) showDetail(cur);
      const dlRow = h('div', { class: 'vo-dl', hidden: true }, dlBar, h('div', { class: 'row' }, dlLabel, dlCancel));
      parts.push(h('label', { class: 'cl-lab' }, t('보이스')), list, dlRow, detail);
      if (cur?.speakers) {
        parts.push(h('div', { class: 'row' }, h('span', { class: 'dim' }, t('스타일')), h('div', { class: 'seg sm' }, ...Object.entries(cur.speakers).map(([k, l]) =>
          h('button', { class: (v.speaker || Object.keys(cur.speakers)[0]) === k ? 'on' : '', onclick: () => { setV({ speaker: k }); this.render(); } }, tdyn(l))))));
      }

      // lyrics: a line spread over the notes, and each note's syllable
      const langs = cur?.langs || ['ja'];
      const count = h('span', { class: 'dim' });
      const grid = h('div', { class: 'vo-grid' });
      const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const MAX = 600;
      const fillGrid = () => {
        const syl = V.channelSyllables(ch, notes.length, langs);
        grid.replaceChildren(...notes.slice(0, MAX).map((n, i) => h('label', { class: 'vo-cell', title: t('{n}번째 노트', { n: i + 1 }) },
          h('small', {}, `${NAMES[n.n % 12]}${Math.floor(n.n / 12) - 1}`),
          h('input', { class: 'cl-in', value: syl[i], spellcheck: false, onchange: (e) => {
            const arr = Array.from({ length: notes.length }, (_, k) => (Array.isArray(ch.vocal?.syl) ? ch.vocal.syl[k] ?? '' : ''));
            arr[i] = e.target.value.trim();
            setV({ syl: arr });
          } }))));
        const typed = V.syllables(area.value, langs).length;
        const bad = V.unsupported(area.value, langs);
        count.textContent = bad.length ? t('한자는 읽는 소리로 적어 주세요: {chars}', { chars: bad.slice(0, 6).join(' ') })
          : [t('음절 {s}개 · 노트 {n}개', { s: typed, n: notes.length }), typed && typed < notes.length ? t('남는 노트는 앞 모음을 늘려요') : '', typed > notes.length ? t('남는 음절은 부르지 않아요') : '', V.approximates(area.value, langs) ? t('이 보이스는 한국어를 가까운 일본어 발음으로 불러요') : '', notes.length > MAX ? t('앞 {n}개 노트만 표시', { n: MAX }) : ''].filter(Boolean).join(' · ');
      };
      const ph = langs.includes('ko') ? '사랑해 너를 사랑해' /* i18n-ignore: a Korean lyric example for a Korean voice */ : langs.includes('en') ? 'twinkle twinkle little star' : 'きらきら ひかる';
      const area = h('textarea', { class: 'cl-in vo-lyrics', rows: 3, placeholder: ph, oninput: fillGrid });
      area.value = v.lyrics || '';
      const spreadBtn = h('button', { class: 'btn ghost sm', title: t('줄 가사를 노트에 처음부터 다시 나눠요 (노트별로 고친 내용은 지워져요)'), onclick: () => { setV({ lyrics: area.value, syl: null }); fillGrid(); } }, t('노트에 나누기'));
      area.addEventListener('change', () => setV({ lyrics: area.value }));
      fillGrid();
      parts.push(h('label', { class: 'cl-lab' }, t('가사 ({langs}) — "+"는 앞 모음 끌기, "-"는 쉼', { langs: langs.map((l) => LANG[l]).join(' · ') + (langs.includes('ja') ? ` · ${t('로마자')}` : '') })), area,
        h('div', { class: 'row' }, spreadBtn, count),
        h('label', { class: 'cl-lab' }, t('노트별 가사')), notes.length ? grid : h('p', { class: 'dim' }, t('이 채널에 노트가 없어요. 피아노 롤에 멜로디를 먼저 입력해 주세요.')));

      // lyrics recognition from a recording (a separated vocal stem works best)
      const lyrLine = h('span', { class: 'dim' }, st.lyrics ? '' : t('가사 인식은 \'보컬 구성 요소 설치\' 뒤에 쓸 수 있어요.'));
      const lyrBar = h('div', { class: 'ai-bar', hidden: true }, h('i', { style: 'width:0%' }));
      const lang = h('select', { class: 'ai-sel vo-sel' }, ...[['', t('언어 자동')], ['ko', t('한국어')], ['ja', t('일본어')], ['en', t('영어')]].map(([k, l]) => h('option', { value: k }, l)));
      const audioClips = [...new Map(S.proj.playlist.clips.filter((c) => c.kind === 'audio' && S.proj.media[c.media]).map((c) => [c.media, c])).values()];
      const src = h('select', { class: 'ai-sel vo-sel' }, h('option', { value: '' }, t('파일 고르기…')),
        ...audioClips.map((c) => h('option', { value: c.media }, S.proj.media[c.media].name)));
      const file = h('input', { type: 'file', accept: 'audio/*,.wav,.flac,.mp3,.ogg,.m4a', hidden: true });
      const recognize = async (payload, offsetSec) => {
        lyrBtn.disabled = true; lyrBar.hidden = false; lyrLine.textContent = t('가사 듣는 중…');
        const secs = V.toSeconds(S.proj, notes).map(([t, d, n]) => [t - offsetSec, d, n]);
        const r = await V.recognizeLyrics({ ...payload, notes: secs, language: lang.value || null, onProgress: progress(lyrBar, lyrLine) });
        lyrBtn.disabled = false; lyrBar.hidden = true;
        if (!r.ok) { lyrLine.textContent = tdyn(r.message); return; }
        const syl = (r.notes || []).map((x) => x || '+');
        setV({ lyrics: r.text, syl });
        area.value = r.text;
        fillGrid();
        lyrLine.textContent = t('알아들은 가사: {text} · 노트별 가사에서 고칠 수 있어요.', { text: r.text.slice(0, 80) + (r.text.length > 80 ? '…' : '') });
      };
      file.addEventListener('change', async () => {
        const f = file.files[0];
        file.value = '';
        if (f) await recognize({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }, 0);
      });
      const lyrBtn = h('button', { class: 'btn sm', disabled: !st.lyrics || !notes.length, onclick: async () => {
        if (!src.value) { file.click(); return; }
        const clip = audioClips.find((c) => c.media === src.value);
        const secPerBar = (60 / S.proj.bpm) * S.proj.sig[0] * (4 / S.proj.sig[1]);
        const data = await window.melofi.mediaGet(src.value);
        if (!data) { lyrLine.textContent = t('오디오 파일을 찾지 못했어요.'); return; }
        await recognize({ name: S.proj.media[src.value].name, data }, (clip.start - (clip.offset || 0)) * secPerBar);
      } }, t('가사 인식'));
      parts.push(h('label', { class: 'cl-lab' }, t('녹음에서 가사 알아듣기 (분리한 보컬 트랙이 가장 정확해요)')),
        h('div', { class: 'row' }, src, lang, lyrBtn, file), lyrBar, lyrLine);

      // sing
      const singLine = h('span', { class: 'dim' });
      const singBar = h('div', { class: 'ai-bar', hidden: true }, h('i', { style: 'width:0%' }));
      const singBtn = h('button', { class: 'btn', disabled: !cur?.ready || !notes.length, onclick: async () => {
        setV({ lyrics: area.value });
        singBtn.disabled = true; singBar.hidden = false;
        const r = await S.sing(ch, progress(singBar, singLine));
        singBtn.disabled = false; singBar.hidden = true;
        singLine.textContent = r.ok ? t('만들었어요 ({s}초). 플레이리스트에 오디오 트랙으로 들어갔어요.', { s: r.seconds }) : tdyn(r.message || '');
      } }, t('노래 만들기'));
      if (cur && !cur.ready) singLine.textContent = cur.installed ? t('이 보이스는 보컬 구성 요소를 설치해야 노래할 수 있어요.') : t('먼저 보이스를 받아 주세요.');
      parts.push(h('div', { class: 'vo-go' }, singBtn, singLine), singBar);
      root.replaceChildren(...parts);
    })().catch((err) => { root.replaceChildren(h('p', { class: 'dim' }, t('보컬 정보를 읽지 못했어요: {err}', { err: tdyn(err.message || err) }))); });
    return root;
  }

  vst(ch) {
    const S = this.S, v = ch.vst || {};
    const msg = h('p', { class: 'dim' });
    return h('div', { class: 'ch-inst' },
      h('p', {}, `${t('VST 플러그인:')} `, h('b', {}, v.name || t('없음')), v.vendor ? h('span', { class: 'dim' }, ` · ${v.vendor}`) : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { const r = await window.melofi.vstEditor(ch.id); msg.textContent = r.ok ? '' : r.error === 'no_editor' ? t('이 플러그인은 편집 창이 없습니다.') : t('창을 열지 못했습니다: {err}', { err: tdyn(r.message || r.error) }); } }, t('플러그인 창 열기')),
        h('button', { class: 'btn ghost', onclick: (e) => S.vstMenu(e.clientX, e.clientY, (p) => { S.edit(() => { ch.vst = { plugin: p.id, file: p.file, name: p.name, vendor: p.vendor }; ch.name = p.name; }); S.syncAudio(); this.render(); }) }, t('플러그인 바꾸기…'))),
      msg,
      h('p', { class: 'dim' }, t('실시간 연주 및 재생은 VST 호스트에서 직접 출력됩니다. 믹서 이펙트는 내보내기 및 \'Consolidate\' 실행 시 적용되며, 플러그인 설정은 프로젝트 저장 시 함께 기록됩니다.')));
  }

  setKind(kind) {
    const S = this.S, ch = this.ch;
    if ((ch.kind || 'inst') === kind) return;
    if ((kind === 'sample' || kind === 'slicer') && !ch.sample) { S.addSampleChannel(kind, ch); return; }
    S.edit(() => {
      ch.kind = kind;
      if (kind === 'synth' && !ch.synth) { ch.synth = synthDefaults(); ch.synthPreset = '기본 쏘'; /* i18n-ignore: preset name (a key of SYNTH_PRESETS) */ }
    });
    S.syncAudio();
    this.render();
  }

  synth(ch) {
    const S = this.S;
    const p = { ...synthDefaults(), ...ch.synth };
    const apply = () => { S.engine.channels.get(ch.id)?.src?.setParams?.(ch.synth); };
    const presets = h('select', { onchange: (e) => { S.edit(() => { ch.synth = { ...synthDefaults(), ...SYNTH_PRESETS[e.target.value] }; ch.synthPreset = e.target.value; }); apply(); this.render(); S.preview(ch.id, 60, 100); } },
      h('option', { value: '' }, t('프리셋 고르기…')), ...Object.keys(SYNTH_PRESETS).map((k) => h('option', { value: k, selected: ch.synthPreset === k }, t(k))));
    const groups = [];
    let cur = null;
    for (const d of SYNTH_PARAMS) {
      if (d.group) { cur = h('div', { class: 'sy-grp' }, h('b', {}, t(d.group))); groups.push(cur); continue; }
      const val = p[d.key];
      let ctl;
      if (d.choices) ctl = h('select', { onchange: (e) => { S.edit(() => { ch.synth = { ...p, ...ch.synth, [d.key]: +e.target.value }; ch.synthPreset = null; }); apply(); } }, ...d.choices.map((c, i) => h('option', { value: i, selected: Math.round(val) === i }, t(c))));
      else {
        const out = h('em', {}, fmtParam(d, val));
        ctl = h('span', { class: 'sy-k' }, knob({ value: val, min: d.min, max: d.max, def: d.def, size: 26, title: t(d.label), fmt: (v) => fmtParam(d, v),
          onInput: (v) => { ch.synth = { ...p, ...ch.synth, [d.key]: d.step ? Math.round(v / d.step) * d.step : v }; ch.synthPreset = null; out.textContent = fmtParam(d, ch.synth[d.key]); apply(); },
          onChange: () => S.changed() }), out);
      }
      cur.append(h('label', { class: 'sy-p' }, h('span', {}, t(d.label)), ctl));
    }
    return h('div', { class: 'sy' }, h('div', { class: 'row' }, presets, h('button', { class: 'btn sm', onclick: () => S.preview(ch.id, 60, 100) }, t('들어보기')),
      h('span', { class: 'dim' }, t('노브를 돌리면서 건반을 눌러 보세요.'))), h('div', { class: 'sy-grid' }, ...groups));
  }

  sample(ch) {
    const S = this.S, sp = ch.sample || {};
    const m = S.proj.media[sp.media];
    const cv = h('canvas', { class: 'wave' });
    const set = (patch) => { S.edit(() => { ch.sample = { ...ch.sample, ...patch }; }, false); S.syncAudio(); this.drawWave(cv, ch); };
    const num = (label, key, min, max, step, def) => h('label', { class: 'frm-row' }, h('span', {}, label),
      h('input', { type: 'number', class: 'cl-in', min, max, step, value: sp[key] ?? def, onchange: (e) => set({ [key]: +e.target.value }) }));
    const chk = (label, key) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!sp[key], onchange: (e) => set({ [key]: e.target.checked }) }), ` ${label}`);
    const tools = ch.kind === 'slicer'
      ? h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: async () => { const b = await decode(sp.media, 48000); S.edit(() => { ch.slices = onsets(b, 0.55); }); S.syncAudio(); this.render(); } }, t('소리 시작점으로 자르기')),
        h('button', { class: 'btn sm', onclick: (e) => popup(e.clientX, e.clientY, [4, 8, 16, 32].map((n) => ({ label: t('{n}등분', { n }), act: () => { S.edit(() => { ch.slices = gridSlices(m.dur, n); }); S.syncAudio(); this.render(); } }))) }, t('같은 간격으로 자르기 ▾')),
        h('button', { class: 'btn sm', onclick: () => this.slicesToPattern(ch) }, t('슬라이스 순서대로 패턴 만들기')),
        h('span', { class: 'dim' }, t('{n}조각 · 파형 클릭: 자르기 추가 · 우클릭: 지우기', { n: (ch.slices || []).length })))
      : h('div', { class: 'row' }, h('span', { class: 'dim' }, t('파형에서 왼쪽 드래그: 시작점 · 오른쪽 드래그: 끝점')));
    const out = h('div', { class: 'smp' },
      h('p', {}, h('b', {}, m?.name || t('파일 없음')), m ? h('span', { class: 'dim' }, `  ${t('{s}초', { s: m.dur.toFixed(2) })}${m.bpm ? ` · ${t('추정 {bpm} BPM', { bpm: m.bpm })}` : ''}`) : null,
        h('button', { class: 'btn sm ghost', onclick: () => S.addSampleChannel(ch.kind, ch) }, t('파일 바꾸기…'))),
      cv, tools,
      h('div', { class: 'smp-ctl' },
        num(t('기준음 (MIDI)'), 'root', 0, 127, 1, 60), num(t('미세 조정 (센트)'), 'tune', -100, 100, 1, 0),
        num(t('어택 (초)'), 'attack', 0, 2, 0.005, 0), num(t('릴리스 (초)'), 'release', 0.01, 4, 0.01, 0.12), num(t('게인'), 'gain', 0.1, 4, 0.05, 1),
        chk(t('거꾸로 재생'), 'reverse'), ch.kind === 'sample' ? chk(t('반복 (루프)'), 'loop') : null));
    requestAnimationFrame(() => this.drawWave(cv, ch, true));
    return out;
  }

  async drawWave(cv, ch, bind = false) {
    const S = this.S, sp = ch.sample;
    if (!sp?.media) return;
    const buf = await decode(sp.media, 48000).catch(() => null);
    if (!buf || !cv.isConnected) return;
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const pk = peaks(buf, W);
    g.fillStyle = '#0b0c0f'; g.fillRect(0, 0, W, H);
    const x0 = ((sp.start || 0) / buf.duration) * W, x1 = ((sp.end ?? buf.duration) / buf.duration) * W;
    for (let x = 0; x < W; x++) {
      const lo = pk[x * 2], hi = pk[x * 2 + 1];
      g.fillStyle = ch.kind === 'sample' && (x < x0 || x > x1) ? '#3a3b40' : ch.color;
      g.fillRect(x, H / 2 - hi * H / 2, 1, Math.max(1, (hi - lo) * H / 2));
    }
    g.fillStyle = '#e0a440';
    if (ch.kind === 'slicer') for (const t of ch.slices || []) g.fillRect((t / buf.duration) * W, 0, d, H);
    else { g.fillRect(x0, 0, 2 * d, H); g.fillRect(x1 - 2 * d, 0, 2 * d, H); }
    if (!bind) return;
    const tAt = (e) => { const rr = cv.getBoundingClientRect(); return Math.max(0, Math.min(buf.duration, ((e.clientX - rr.left) / rr.width) * buf.duration)); };
    cv.oncontextmenu = (e) => {
      e.preventDefault();
      if (ch.kind !== 'slicer') return;
      const t = tAt(e), list = ch.slices || [];
      let best = -1, bd = Infinity;
      list.forEach((s, i) => { const dd = Math.abs(s - t); if (i > 0 && dd < bd) { bd = dd; best = i; } });
      if (best > 0) { S.edit(() => { ch.slices.splice(best, 1); }); S.syncAudio(); this.drawWave(cv, ch); }
    };
    cv.onpointerdown = (e) => {
      if (e.button !== 0) return;
      if (ch.kind === 'slicer') { const t = tAt(e); S.edit(() => { ch.slices = [...(ch.slices || [0]), t].sort((a, b) => a - b); }); S.syncAudio(); this.drawWave(cv, ch); S.preview(ch.id, (sp.root ?? 60) + ch.slices.indexOf(t)); return; }
      const t = tAt(e), end = sp.end ?? buf.duration, which = Math.abs(t - (sp.start || 0)) < Math.abs(t - end) ? 'start' : 'end';
      S.history.push();
      const move = (ev) => { const v = tAt(ev); ch.sample = { ...ch.sample, [which]: which === 'start' ? Math.min(v, (ch.sample.end ?? buf.duration) - 0.01) : Math.max(v, (ch.sample.start || 0) + 0.01) }; this.drawWave(cv, ch); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); S.syncAudio(); S.preview(ch.id, sp.root ?? 60); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      move(e);
    };
  }

  // the slices in order, one per 16th (or spread over the loop's real length when the tempo is known)
  slicesToPattern(ch) {
    const S = this.S, proj = S.proj, pat = pattern(proj), m = proj.media[ch.sample.media];
    const sl = ch.slices || [];
    if (!sl.length) return;
    const secPerTick = 60 / proj.bpm / 96;
    S.edit(() => {
      const list = notesOf(pat, ch.id);
      list.length = 0;
      sl.forEach((t, i) => {
        const end = sl[i + 1] ?? m.dur;
        const tt = Math.round(t / secPerTick / STEP) * STEP, d = Math.max(STEP, Math.round((end - t) / secPerTick / STEP) * STEP);
        list.push({ t: tt, d, n: (ch.sample.root ?? 60) + i, v: 100 });
      });
      const len = Math.max(...list.map((n) => n.t + n.d));
      pat.bars = Math.max(pat.bars, Math.ceil(len / (96 * 4)));
    });
    S.select(ch.id);
  }

  // ---------- rhythm ----------
  rhythm(ch) {
    const S = this.S, pat = pattern(S.proj);
    const steps = pat.bars * 16;
    return h('div', { class: 'cl-form' },
      h('label', { class: 'frm-row' }, h('span', {}, t('스윙')),
        h('select', { onchange: (e) => S.edit(() => { ch.swing = e.target.value === '' ? null : +e.target.value; }) },
          h('option', { value: '', selected: ch.swing == null }, t('프로젝트 설정 따르기')), ...[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => h('option', { value: v, selected: ch.swing === v }, `${Math.round(v * 100)}%`)))),
      h('label', { class: 'frm-row' }, h('span', {}, t('그루브')),
        h('select', { onchange: (e) => S.edit(() => { ch.groove = e.target.value || null; }) },
          h('option', { value: '', selected: !ch.groove }, t('없음')), ...Object.keys(GROOVES).map((k) => h('option', { value: k, selected: ch.groove === k }, t(k))))),
      h('p', { class: 'dim' }, t('그루브는 16분음표마다 타이밍과 벨로시티를 조금씩 밀고 당겨 사람이 연주한 느낌을 줍니다. 그루브를 고르면 스윙 대신 적용됩니다.')),
      h('label', { class: 'frm-row' }, h('span', {}, t('스텝 반복 길이')),
        h('select', { onchange: (e) => S.edit(() => { ch.loopSteps = +e.target.value; }) },
          h('option', { value: 0, selected: !ch.loopSteps }, t('패턴 전체')), ...[3, 4, 5, 6, 7, 8, 12, 16, 24, 32].filter((n) => n < steps).map((n) => h('option', { value: n, selected: ch.loopSteps === n }, t('{n}칸마다 반복', { n }))))),
      h('p', { class: 'dim' }, t('이 채널만 짧게 반복시켜 다른 채널과 엇갈리는 리듬(폴리리듬)을 만들 수 있습니다.')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!ch.arp?.on, onchange: (e) => S.edit(() => { ch.arp = { mode: 'up', rate: 24, octaves: 1, gate: 0.85, ...(ch.arp || {}), on: e.target.checked }; }) }), ` ${t('아르페지에이터: 화음을 재생할 때 한 음씩 펼쳐서 연주')}`),
      ch.arp?.on ? h('div', {},
        h('label', { class: 'frm-row' }, h('span', {}, t('순서')), h('select', { onchange: (e) => S.edit(() => { ch.arp.mode = e.target.value; }) }, ...[['up', t('위로')], ['down', t('아래로')], ['updown', t('위아래')], ['random', t('무작위')]].map(([v, l]) => h('option', { value: v, selected: ch.arp.mode === v }, l)))),
        h('label', { class: 'frm-row' }, h('span', {}, t('빠르기')), h('select', { onchange: (e) => S.edit(() => { ch.arp.rate = +e.target.value; }) }, ...[[48, t('8분음표')], [24, t('16분음표')], [12, t('32분음표')], [16, t('16분 셋잇단')]].map(([v, l]) => h('option', { value: v, selected: ch.arp.rate === v }, l)))),
        h('label', { class: 'frm-row' }, h('span', {}, t('옥타브')), h('select', { onchange: (e) => S.edit(() => { ch.arp.octaves = +e.target.value; }) }, ...[1, 2, 3].map((v) => h('option', { value: v, selected: ch.arp.octaves === v }, t('{n}옥타브', { n: v }))))),
        h('label', { class: 'frm-row' }, h('span', {}, t('음 길이')), h('select', { onchange: (e) => S.edit(() => { ch.arp.gate = +e.target.value; }) }, ...[[0.3, t('짧게 (스타카토)')], [0.6, t('중간')], [0.85, t('길게')], [1, t('끊김 없이')]].map(([v, l]) => h('option', { value: v, selected: ch.arp.gate === v }, l))))) : null);
  }

  output(ch) {
    const S = this.S;
    return h('div', { class: 'cl-form' },
      h('label', { class: 'frm-row' }, h('span', {}, t('보낼 곳')),
        h('select', { onchange: (e) => { S.edit(() => { ch.out = e.target.value; }); S.syncAudio(); } },
          h('option', { value: 'master' }, t('마스터')), ...S.proj.buses.map((b) => h('option', { value: b.id, selected: ch.out === b.id }, b.name)))),
      h('p', { class: 'dim' }, t('이펙트 {n}개 · 이펙트는 믹서에서 넣고 조절합니다.', { n: ch.fx.length })),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { this.close(); S.setTab('mixer'); } }, t('믹서 열기'))));
  }
}

