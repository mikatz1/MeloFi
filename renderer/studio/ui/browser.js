// Sample browser: the user's sample folders and the project's audio files. Click to listen,
// drag onto the playlist (an audio clip) or the channel rack (a sample channel), or use the
// buttons on each file.
import { h, popup } from './dom.js';
import { LOOP_GENRES, ROLES, renderLoop } from '../loops.js';

export class Browser {
  constructor(studio, el) {
    this.S = studio;
    this.el = el;
    this.cwd = null;     // current folder path, or null for the top level
    this.items = [];
    this.preview = null;
  }

  get roots() { return this.S.app.settings.get('browserRoots') || []; }

  async addRoot() {
    const p = await window.melofi.mediaPickFolder();
    if (!p) return;
    const list = [...new Set([...this.roots, p])];
    this.S.app.settings.set({ browserRoots: list });
    this.open(p);
  }

  async open(dir) {
    this.cwd = dir;
    if (dir) {
      await window.melofi.mediaAllowRoots(this.roots);
      this.items = (await window.melofi.mediaList(dir)) || [];
    }
    this.render();
  }

  async listen(item) {
    this.stopPreview();
    const data = item.data || await window.melofi.mediaRead(item.path);
    if (!data) return;
    const ctx = this.S.engine.ctx;
    try {
      const buf = await ctx.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      const src = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = 0.8;
      src.buffer = buf; src.connect(g).connect(ctx.destination); src.start();
      this.preview = src;
      src.onended = () => { if (this.preview === src) this.preview = null; };
    } catch { this.S.status('이 파일은 재생할 수 없습니다'); }
  }

  stopPreview() { try { this.preview?.stop(); } catch { /* ended */ } this.preview = null; }

  async use(item, how) {
    const data = await window.melofi.mediaRead(item.path);
    if (!data) return;
    if (how === 'clip') await this.S.addAudioClip(item.name, data);
    else await this.S.addSampleChannel(how, null, { name: item.name, data });
  }

  render() {
    const S = this.S;
    const head = h('div', { class: 'br-head' },
      h('button', { class: 'btn sm', onclick: () => this.addRoot() }, '+ 폴더 추가'),
      this.cwd ? h('button', { class: 'btn sm ghost', onclick: () => { const up = this.cwd.replace(/[\\/][^\\/]+$/, ''); this.open(this.roots.some((r) => up.length >= r.length && up.startsWith(r)) ? up : null); } }, '↑ 위로') : null,
      h('span', { class: 'br-path', title: this.cwd || '' }, this.cwd ? this.cwd.split(/[\\/]/).slice(-2).join(' / ') : '샘플 브라우저'));
    let body;
    if (!this.cwd) {
      const media = Object.entries(S.proj.media);
      body = h('div', { class: 'br-list' },
        h('div', { class: 'br-grp' }, '내 샘플 폴더'),
        ...(this.roots.length ? this.roots.map((r) => h('div', { class: 'br-item dir', onclick: () => this.open(r),
          oncontextmenu: (e) => { e.preventDefault(); popup(e.clientX, e.clientY, [{ label: '목록에서 빼기', act: () => { S.app.settings.set({ browserRoots: this.roots.filter((x) => x !== r) }); this.render(); } }]); } },
        h('span', {}, r.split(/[\\/]/).pop() || r), h('small', {}, r))) : [h('p', { class: 'hint' }, '원샷·루프 파일이 든 폴더를 추가하세요. 무료 샘플팩(예: 99Sounds, Freesound)을 받아 두면 좋습니다.')]),
        h('div', { class: 'br-grp' }, 'MeloFi 루프 (프로젝트 키·템포로 만들어짐)'),
        ...Object.entries(LOOP_GENRES).map(([g, G]) => this.loopGenre(g, G)),
        h('div', { class: 'br-grp' }, '이 프로젝트의 오디오'),
        ...(media.length ? media.map(([hash, m]) => this.row({ name: m.name, hash }, true)) : [h('p', { class: 'hint' }, '아직 없습니다.')]),
        h('div', { class: 'br-grp' }, 'MeloFi 악기'),
        h('div', { class: 'br-item', onclick: (e) => S.pickInstrument(e.clientX, e.clientY, (id) => S.rack.add(id)) }, h('span', {}, '악기 목록에서 채널 추가…')),
        h('div', { class: 'br-item', onclick: () => S.app.store.show() }, h('span', {}, '악기 다운로드 센터…')));
    } else {
      body = h('div', { class: 'br-list' }, ...(this.items.length ? this.items.map((it) => (it.dir
        ? h('div', { class: 'br-item dir', onclick: () => this.open(it.path) }, h('span', {}, it.name))
        : this.row(it))) : [h('p', { class: 'hint' }, '오디오 파일이 없습니다.')]));
    }
    this.el.replaceChildren(head, body);
  }

  // the built-in loop library: a genre folds open into its four parts; click to listen, drag to
  // the playlist or press 넣기
  loopGenre(g, G) {
    const open = this.openGenre === g;
    return h('div', { class: 'br-loops' },
      h('div', { class: `br-item dir${open ? ' open' : ''}`, onclick: () => { this.openGenre = open ? null : g; this.render(); } }, h('span', {}, G.name), h('small', {}, `${G.bpm[0]}–${G.bpm[1]} BPM`)),
      ...(open ? Object.entries(ROLES).map(([role, name]) => {
        const el = h('div', { class: 'br-item file', draggable: true, title: '클릭: 듣기 · 끌어서 플레이리스트에 놓기' },
          h('span', { onclick: () => this.listenLoop(g, role) }, `${G.name} · ${name}`),
          h('span', { class: 'acts' }, h('button', { class: 'btn sm ghost', title: '플레이리스트 빈 트랙에 넣기', onclick: () => this.S.addLoop(g, role) }, '넣기')));
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-melofi-loop', JSON.stringify({ genre: g, role })); e.dataTransfer.effectAllowed = 'copy'; });
        return el;
      }) : []));
  }

  async listenLoop(g, role) {
    this.stopPreview();
    const S = this.S, p = S.proj, key = `${g}:${role}:${p.scale?.root ?? 0}:${p.bpm}`;
    this.loopCache ||= new Map();
    if (!this.loopCache.has(key)) { S.status('루프 만드는 중…'); this.loopCache.set(key, await renderLoop(g, role, { root: p.scale?.root ?? 0, bpm: p.bpm, seed: 1 })); S.status(''); }
    const L = this.loopCache.get(key), ctx = S.engine.ctx;
    const buf = ctx.createBuffer(2, L.left.length, L.rate);
    buf.copyToChannel(L.left, 0); buf.copyToChannel(L.right, 1);
    const src = ctx.createBufferSource(), gn = ctx.createGain();
    gn.gain.value = 0.8;
    src.buffer = buf; src.connect(gn).connect(ctx.destination); src.start();
    this.preview = src;
    src.onended = () => { if (this.preview === src) this.preview = null; };
  }

  row(it, inProject = false) {
    const S = this.S;
    const el = h('div', { class: 'br-item file', draggable: !inProject, title: '클릭: 듣기 · 끌어서 플레이리스트나 채널 랙에 놓기' },
      h('span', { onclick: () => (inProject ? this.listenHash(it.hash) : this.listen(it)) }, it.name),
      h('span', { class: 'acts' },
        h('button', { class: 'btn sm ghost', title: '건반으로 연주하는 샘플 채널로', onclick: () => (inProject ? S.addSampleChannelFromHash('sample', it.hash) : this.use(it, 'sample')) }, '채널'),
        h('button', { class: 'btn sm ghost', title: '루프를 잘라 건반에 배치', onclick: () => (inProject ? S.addSampleChannelFromHash('slicer', it.hash) : this.use(it, 'slicer')) }, '슬라이스'),
        h('button', { class: 'btn sm ghost', title: '플레이리스트에 오디오 클립으로', onclick: () => (inProject ? S.addAudioClipFromHash(it.hash) : this.use(it, 'clip')) }, '클립')));
    if (!inProject) el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-melofi-file', it.path); e.dataTransfer.effectAllowed = 'copy'; });
    return el;
  }

  async listenHash(hash) {
    this.stopPreview();
    const { decode } = await import('../media.js');
    const buf = await decode(hash, this.S.engine.ctx.sampleRate);
    const ctx = this.S.engine.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start();
    this.preview = src;
  }
}
