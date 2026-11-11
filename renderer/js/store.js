// Instrument download center: every instrument MeloFi knows, with search, genre and family filters,
// what each one is used for, size, licence, and download / remove / use. Samples come straight
// from each library's own GitHub repository (main.js, instruments:download).
import { T } from './strings.js';
import { haystack, matches } from './search.js';
import { t } from '../i18n/i18n.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const FAMILY_ORDER = ['piano', 'keys', 'organ', 'synth', 'strings', 'brass', 'winds', 'vocal', 'guitar', 'bass', 'mallets', 'world', 'drums', 'fx'];
const GENRES = ['kpop', 'pop', 'jpop'];

export class Store {
  constructor(app) {
    this.app = app;
    this.q = '';
    this.genre = 'all';
    this.family = 'all';
    this.state = 'all';
    this.queue = [];
    this.el = $('#store');
    $('#store .x').addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
  }

  get open() { return !this.el.hidden; }
  show() { this.el.hidden = false; this.render(); setTimeout(() => this.el.querySelector('.st-q')?.focus(), 30); }
  close() { this.el.hidden = true; }
  toggle() { if (this.open) this.close(); else this.show(); }

  list() {
    const q = this.q.trim();
    if (this.hayFor !== this.app.instruments) { this.hayFor = this.app.instruments; this.hay = new Map(this.app.instruments.map((i) => [i.id, haystack(i, T)])); }
    return this.app.instruments.filter((i) => {
      if (this.genre !== 'all' && !(i.tags || []).includes(this.genre)) return false;
      if (this.family !== 'all' && i.family !== this.family) return false;
      if (this.state === 'installed' && !i.installed) return false;
      if (this.state === 'missing' && i.installed) return false;
      if (q && !matches(q, this.hay.get(i.id))) return false;
      return true;
    });
  }

  // queue several downloads; they run one after another
  async getAll(ids) {
    for (const id of ids) if (!this.queue.includes(id)) this.queue.push(id);
    if (this.running) return;
    this.running = true;
    this.render();
    while (this.queue.length) {
      const id = this.queue[0];
      await this.app.downloadInstrument(id);
      this.queue.shift();
      if (this.open) this.render();
    }
    this.running = false;
    if (this.open) this.render();
  }

  cancelAll() {
    const [cur, ...rest] = this.queue;
    this.queue = cur ? [cur] : [];
    if (cur) this.app.cancelDownload(cur);
    void rest;
    this.render();
  }

  action(i) {
    const S = T.store, app = this.app, cur = app.settings.get('instrument') === i.id;
    if (app.dl.has(i.id)) {
      return h('button', { class: 'btn sm', 'data-dl': i.id, onclick: () => { this.queue = this.queue.filter((x) => x !== i.id); app.cancelDownload(i.id); } }, app.ui.dlText(i.id));
    }
    if (this.queue.includes(i.id)) return h('button', { class: 'btn sm ghost', onclick: () => { this.queue = this.queue.filter((x) => x !== i.id); this.render(); } }, S.queued);
    if (!i.installed) return h('button', { class: 'btn sm get', onclick: () => this.getAll([i.id]) }, S.get);
    return h('span', { class: 'acts' },
      cur ? h('span', { class: 'using' }, S.using) : h('button', { class: 'btn sm', onclick: () => { app.settings.set({ instrument: i.id }); this.render(); } }, S.use),
      i.downloadable && !i.bundled ? h('button', { class: 'btn sm ghost', title: S.removeTip, onclick: async () => { await app.removeInstrument(i.id); this.render(); } }, S.remove) : null);
  }

  render() {
    if (!this.open) return;
    const S = T.store, app = this.app, all = app.instruments;
    const rows = this.list();
    const fams = FAMILY_ORDER.filter((f) => all.some((i) => i.family === f));
    const missing = rows.filter((i) => !i.installed && i.downloadable && !app.dl.has(i.id) && !this.queue.includes(i.id));
    const missBytes = missing.reduce((a, i) => a + (i.size || 0), 0);
    const have = all.filter((i) => i.installed);
    const haveBytes = have.filter((i) => i.downloadable && !i.bundled).reduce((a, i) => a + (i.size || 0), 0);

    const seg = (val, items, set) => h('div', { class: 'seg' }, ...items.map(([k, label]) => h('button', { class: val === k ? 'on' : '', onclick: () => { set(k); this.render(); } }, label)));
    const select = (val, items, set) => {
      const s = h('select', { onchange: (e) => { set(e.target.value); this.render(); } }, ...items.map(([k, label]) => h('option', { value: k, selected: val === k }, label)));
      return s;
    };

    const head = h('div', { class: 'store-tools' },
      h('input', { class: 'st-q', type: 'search', placeholder: S.search, value: this.q, oninput: (e) => { this.q = e.target.value; this.renderBody(); } }),
      seg(this.genre, [['all', S.allGenres], ...GENRES.map((g) => [g, S.genres[g]])], (v) => { this.genre = v; }),
      select(this.family, [['all', S.allFamilies], ...fams.map((f) => [f, T.families[f] || f])], (v) => { this.family = v; }),
      select(this.state, [['all', S.allStates], ['installed', S.installed], ['missing', S.missing]], (v) => { this.state = v; }));

    const sum = h('div', { class: 'store-sum' },
      h('span', {}, S.summary(all.length, have.length, mb(haveBytes))),
      h('span', { class: 'sp' }),
      this.queue.length > 1 ? h('button', { class: 'btn sm ghost', onclick: () => this.cancelAll() }, S.stopAll) : null,
      missing.length ? h('button', { class: 'btn sm', onclick: () => this.getAll(missing.map((i) => i.id)) }, S.getAll(missing.length, mb(missBytes))) : null);

    this.bodyEl = h('div', { class: 'store-body' });
    this.el.querySelector('.store-main').replaceChildren(head, sum, this.bodyEl);
    this.renderBody();
  }

  renderBody() {
    const S = T.store, rows = this.list();
    const fams = FAMILY_ORDER.filter((f) => rows.some((i) => i.family === f));
    if (!rows.length) { this.bodyEl.replaceChildren(h('p', { class: 'store-empty' }, S.none)); return; }
    const table = h('table', { class: 'store-table' },
      h('colgroup', {}, h('col', { class: 'c-name' }), h('col', { class: 'c-use' }), h('col', { class: 'c-tag' }), h('col', { class: 'c-size' }), h('col', { class: 'c-lic' }), h('col', { class: 'c-act' })),
      ...fams.flatMap((f) => [
        h('tr', { class: 'fam' }, h('th', { colspan: 6 }, T.families[f] || f)),
        ...rows.filter((i) => i.family === f).map((i) => h('tr', { class: `${i.installed ? 'have' : ''}${this.app.settings.get('instrument') === i.id ? ' cur' : ''}` },
          h('td', { class: 'name' }, h('b', {}, i.name), h('small', {}, t(i.model || ''))),
          h('td', { class: 'use' }, t(i.use || '')),
          h('td', { class: 'tags' }, ...GENRES.filter((g) => (i.tags || []).includes(g)).map((g) => h('i', { title: S.genres[g] }, S.genreShort[g]))),
          h('td', { class: 'size' }, i.procedural ? S.synth : i.bundled ? S.builtIn : mb(i.size || 0)),
          h('td', { class: 'lic', title: i.credit || '' }, i.license || ''),
          h('td', { class: 'act' }, this.action(i)))),
      ]));
    this.bodyEl.replaceChildren(table, h('p', { class: 'store-foot' }, S.foot));
  }
}
