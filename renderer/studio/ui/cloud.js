// Online projects for the composer. MeloFi has no server of its own: projects are saved as secret
// gists on the person's own GitHub (sign in with GitHub), shared by the gist link, and anyone can
// open a shared link without signing in. Sign-in itself is the shared account panel
// (js/accounts-ui.js); all network calls go through the main process (account.js).
import { h } from './dom.js';
import { migrate } from '../model.js';
import { T } from '../../js/strings.js';
import { t, tdyn } from '../../i18n/i18n.js';
import { openAccountCenter } from '../../js/accounts-ui.js';
import { openWorkshop } from '../../js/workshop-ui.js';

const A = (op, payload) => window.melofi.account(op, payload);
const fmtDate = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export class CloudSheet {
  constructor(studio) {
    this.S = studio;
    this.mode = 'projects'; // projects | shared | account
    this.st = null;
    this.list = null;
    this.msg = '';
    this.el = h('section', { id: 'cloud', class: 'sheet', hidden: true },
      h('div', { class: 'sheet-card cloud-card' },
        h('div', { class: 'sheet-head' }, this.titleEl = h('h2', {}, T.cloud.title), h('button', { class: 'x', 'aria-label': t('닫기'), onclick: () => this.close() })),
        this.body = h('div', { class: 'cloud-body' })));
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    document.body.append(this.el);
  }

  close() { this.el.hidden = true; }

  // where: 'projects' (default), 'shared', 'account'
  async show(where = 'projects') {
    if (where === 'account') { openAccountCenter({ openWorkshop: (w) => openWorkshop({ where: 'studio', app: this.S.app }, w) }); return; }
    this.S.app.ui.close();
    this.el.hidden = false;
    this.msg = '';
    this.mode = where;
    const r = await A('state');
    this.st = r.ok ? r.data : null;
    this.render();
    if (this.mode === 'projects' && this.st?.github) this.loadList();
  }

  say(text, err = true) { this.msg = text ? { text: tdyn(text), err } : ''; this.render(); }

  async loadList() {
    const r = await A('projects');
    if (!r.ok) { if (r.error === 'github_required') return this.show('projects'); return this.say(r.message); }
    this.list = r.data;
    this.render();
  }

  render() {
    if (this.el.hidden) return;
    const C = T.cloud;
    if (this.mode === 'account') this.mode = 'projects'; // the account has its own sheet now (accounts-ui.js)
    const tabs = h('div', { class: 'cl-tabs' }, ...[['projects', C.myProjects], ['shared', C.openShared]].map(([k, label]) =>
      h('button', { class: this.mode === k ? 'on' : '', onclick: () => this.show(k) }, label)));
    const parts = [tabs];
    if (this.mode === 'shared') parts.push(this.renderShared());
    else if (!this.st?.github) parts.push(this.renderAccount());
    else parts.push(this.renderProjects());
    if (this.msg) parts.push(h('p', { class: `cl-msg${this.msg.err ? ' err' : ''}` }, this.msg.text));
    this.body.replaceChildren(...parts);
  }

  // not connected to GitHub: say why, and open the account center
  renderAccount() {
    return h('div', { class: 'cl-need' },
      h('p', { class: 'dim' }, T.cloud.why),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => {
        this.close();
        openAccountCenter({ openWorkshop: (w) => openWorkshop({ where: 'studio', app: this.S.app }, w) });
      } }, t('계정 열기'))));
  }

  renderProjects() {
    const C = T.cloud, S = this.S, proj = S.proj;
    const mine = this.list?.find((p) => p.id === proj.cloudId);
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      this.say(C.saving, false);
      const data = JSON.parse(JSON.stringify(proj));
      delete data.cloudId;
      const r = await A('saveProject', { id: mine ? mine.id : null, name: proj.name, data });
      if (!r.ok) return this.say(r.message);
      proj.cloudId = r.data.id; S.changed?.();
      this.say(mine ? C.updated : C.saved, false);
      this.loadList();
    } }, mine ? C.saveOver(proj.name) : C.saveNew(proj.name));
    const rows = (this.list || []).map((p) => h('tr', { class: p.id === proj.cloudId ? 'cur' : '' },
      h('td', { class: 'nm' }, p.name),
      h('td', { class: 'dt' }, fmtDate(p.updated)),
      h('td', { class: 'sz' }, kb(p.size)),
      h('td', { class: 'ac' },
        h('button', { class: 'btn sm', onclick: () => this.openProject(p) }, C.open),
        h('button', { class: 'btn sm ghost', title: C.copyTip, onclick: () => this.copyLink(p) }, C.copyLink),
        h('button', { class: 'btn sm ghost', onclick: async () => { if (!confirm(C.deleteAsk(p.name))) return; const r = await A('removeProject', { id: p.id }); if (!r.ok) return this.say(r.message); if (proj.cloudId === p.id) delete proj.cloudId; this.loadList(); } }, C.del))));
    return h('div', {},
      h('p', { class: 'dim' }, C.gistNote(this.st.github.handle || this.st.github.name)),
      h('div', { class: 'row' }, saveBtn),
      this.list == null ? h('p', { class: 'dim' }, C.loading)
        : this.list.length ? h('table', { class: 'cl-list' }, ...rows) : h('p', { class: 'dim' }, C.empty));
  }

  async openProject(p) {
    this.say(T.cloud.loading, false);
    const r = await A('loadProject', { id: p.id });
    if (!r.ok) return this.say(r.message);
    const proj = migrate(r.data.data);
    proj.cloudId = p.id;
    this.S.setProject(proj);
    this.close();
    this.S.app.ui.toast(T.cloud.opened(p.name));
  }

  copyLink(p) {
    navigator.clipboard?.writeText(p.link).catch(() => {});
    this.say(T.cloud.copied(p.link), false);
  }

  renderShared() {
    const C = T.cloud;
    const code = h('input', { class: 'cl-in', placeholder: C.codeHint });
    const go = async () => {
      this.say(C.loading, false);
      const r = await A('shared', { code: code.value });
      if (!r.ok) return this.say(r.message);
      const proj = migrate(r.data.data);
      delete proj.cloudId;
      proj.name = `${r.data.name}`;
      this.S.setProject(proj);
      this.close();
      this.S.app.ui.toast(C.sharedOpened(r.data.name, r.data.owner));
    };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'cl-form' }, h('p', { class: 'dim' }, C.sharedText),
      h('label', { class: 'cl-f' }, h('span', {}, C.code), code),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, C.open)));
  }
}
