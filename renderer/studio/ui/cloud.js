// Online account for the composer: sign up (with the consent form), log in, save projects online,
// share them with a code / link, open shared projects, and manage the account (marketing
// consent, password, data download, withdrawal). All network calls go through the main process
// (account.js); the page never sees the login token.
import { h, ask } from './dom.js';
import { migrate } from '../model.js';
import { T } from '../../js/strings.js';
import { t, tdyn } from '../../i18n/i18n.js';

const A = (op, payload) => window.melofi.account(op, payload);
const fmtDate = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export class CloudSheet {
  constructor(studio) {
    this.S = studio;
    this.mode = 'login'; // login | signup | projects | account | shared | server
    this.st = null; // { server, user, signedIn }
    this.docs = null;
    this.agree = {};
    this.open = {}; // which consent texts are expanded
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
    this.S.app.ui.close();
    this.el.hidden = false;
    this.msg = '';
    const r = await A('state');
    this.st = r.ok ? r.data : { server: '', signedIn: false };
    if (where === 'shared') this.mode = 'shared';
    else if (!this.st.server) this.mode = 'server';
    else if (!this.st.signedIn) this.mode = this.mode === 'signup' ? 'signup' : 'login';
    else this.mode = where === 'account' ? 'account' : 'projects';
    this.render();
    if (this.mode === 'projects') this.loadList();
  }

  say(text, err = true) { this.msg = text ? { text: tdyn(text), err } : ''; this.render(); }

  async loadList() {
    const r = await A('projects');
    if (!r.ok) { if (r.error === 'login_required') return this.show(); return this.say(r.message); }
    this.list = r.data;
    this.render();
  }

  async ensureDocs() {
    if (this.docs) return true;
    const r = await A('consents');
    if (!r.ok) { this.say(r.message); return false; }
    this.docs = r.data;
    return true;
  }

  field(label, attrs) {
    const input = h('input', { class: 'cl-in', ...attrs });
    return [h('label', { class: 'cl-f' }, h('span', {}, label), input), input];
  }

  render() {
    if (this.el.hidden) return;
    const C = T.cloud;
    const parts = [];
    const tabs = (items) => h('div', { class: 'cl-tabs' }, ...items.map(([k, label]) => h('button', { class: this.mode === k ? 'on' : '', onclick: () => { this.mode = k; this.msg = ''; this.render(); if (k === 'projects') this.loadList(); if (k === 'signup') this.ensureDocs().then(() => this.render()); } }, label)));
    if (this.mode === 'shared') parts.push(this.renderShared());
    else if (this.mode === 'server') parts.push(this.renderServer());
    else if (!this.st?.signedIn) {
      parts.push(tabs([['login', C.login], ['signup', C.signup]]));
      parts.push(this.mode === 'signup' ? this.renderSignup() : this.renderLogin());
    } else {
      parts.push(h('div', { class: 'cl-who' }, h('b', {}, this.st.user?.nickname || ''), h('span', {}, this.st.user?.email || ''), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm ghost', onclick: async () => { await A('logout'); this.list = null; this.show(); } }, C.logout)));
      parts.push(tabs([['projects', C.myProjects], ['account', C.account]]));
      parts.push(this.mode === 'account' ? this.renderAccount() : this.renderProjects());
    }
    if (this.msg) parts.push(h('p', { class: `cl-msg${this.msg.err ? ' err' : ''}` }, this.msg.text));
    this.body.replaceChildren(...parts);
  }

  renderServer() {
    const C = T.cloud;
    const [f, input] = this.field(C.serverAddr, { value: this.st?.server || '', placeholder: 'https://' });
    return h('div', { class: 'cl-form' }, h('p', { class: 'dim' }, C.serverText), f,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => {
        const r = await A('setServer', { url: input.value });
        if (!r.ok) return this.say(r.message);
        this.st = r.data; this.mode = 'login'; this.msg = ''; this.render();
      } }, C.saveServer)));
  }

  renderLogin() {
    const C = T.cloud;
    const [f1, email] = this.field(C.email, { type: 'email', autocomplete: 'username' });
    const [f2, pw] = this.field(C.password, { type: 'password', autocomplete: 'current-password' });
    const go = async () => {
      const r = await A('login', { email: email.value, password: pw.value });
      if (!r.ok) return this.say(r.message);
      this.st = { ...this.st, user: r.data, signedIn: true };
      this.mode = 'projects'; this.msg = ''; this.render(); this.loadList();
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'cl-form' }, h('p', { class: 'dim' }, C.why), f1, f2,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, C.login), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm ghost', onclick: () => { this.mode = 'server'; this.render(); } }, C.serverAddr)));
  }

  renderSignup() {
    const C = T.cloud, d = this.docs;
    if (!d) { this.ensureDocs().then(() => this.render()); return h('p', { class: 'dim' }, C.loading); }
    const [f1, email] = this.field(C.email, { type: 'email', autocomplete: 'username' });
    const [f2, pw] = this.field(C.passwordNew, { type: 'password', autocomplete: 'new-password' });
    const [f3, pw2] = this.field(C.passwordAgain, { type: 'password', autocomplete: 'new-password' });
    const [f4, nick] = this.field(C.nickname, { maxlength: 24 });
    const order = ['age', 'terms', 'privacy', 'marketing'];
    const required = order.filter((k) => d[k]?.required);
    const all = order.every((k) => this.agree[k]);
    const submit = h('button', { class: 'btn primary', disabled: !required.every((k) => this.agree[k]) }, C.signupGo);
    const keep = () => ({ e: email.value, p: pw.value, p2: pw2.value, n: nick.value });
    const restore = (v) => { email.value = v.e; pw.value = v.p; pw2.value = v.p2; nick.value = v.n; };
    if (this.draft) restore(this.draft);
    const toggle = (k, on) => { this.draft = keep(); this.agree[k] = on; this.render(); };
    const doc = (k) => {
      const x = d[k];
      return h('div', { class: 'cl-doc' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!this.agree[k], onchange: (e) => toggle(k, e.target.checked) }),
          h('span', { class: x.required ? 'req' : 'opt' }, x.required ? C.req : C.opt), ` ${x.title}`),
        x.table || x.body.length > 1 || k !== 'age' ? h('button', { class: 'btn sm ghost', onclick: () => { this.draft = keep(); this.open[k] = !this.open[k]; this.render(); } }, this.open[k] ? C.hide : C.view) : null,
        this.open[k] ? h('div', { class: 'cl-text' },
          x.table ? h('table', {}, ...x.table.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b)))) : null,
          ...x.body.map((t) => h('p', {}, t))) : null);
    };
    submit.addEventListener('click', async () => {
      if (pw.value !== pw2.value) return this.say(C.pwMismatch);
      const consents = {};
      for (const k of order) if (this.agree[k]) consents[k] = d[k].version;
      const r = await A('signup', { email: email.value, password: pw.value, nickname: nick.value, consents });
      if (!r.ok) { this.draft = keep(); return this.say(r.message); }
      this.draft = null; this.agree = {};
      this.st = { ...this.st, user: r.data, signedIn: true };
      this.mode = 'projects'; this.say(C.welcome(r.data.nickname), false); this.loadList();
    });
    return h('div', { class: 'cl-form' }, f1, f2, f3, f4,
      h('div', { class: 'cl-consent' },
        h('label', { class: 'chk all' }, h('input', { type: 'checkbox', checked: all, onchange: (e) => { this.draft = keep(); for (const k of order) this.agree[k] = e.target.checked; this.render(); } }), ` ${C.agreeAll}`),
        ...order.filter((k) => d[k]).map(doc)),
      h('div', { class: 'row' }, submit, h('a', { class: 'cl-link', href: '#', onclick: (e) => { e.preventDefault(); A('openPolicy'); } }, C.policy)));
  }

  renderProjects() {
    const C = T.cloud, S = this.S, proj = S.proj;
    const mine = this.list?.find((p) => p.id === proj.cloudId);
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      const data = JSON.parse(JSON.stringify(proj));
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
      h('td', { class: 'sh' }, p.share ? h('button', { class: 'btn sm ghost', title: C.copyTip, onclick: () => this.copyShare(p) }, C.shareOn) : h('span', { class: 'dim' }, C.shareOff)),
      h('td', { class: 'ac' },
        h('button', { class: 'btn sm', onclick: () => this.openProject(p) }, C.open),
        h('button', { class: 'btn sm ghost', onclick: () => this.toggleShare(p) }, p.share ? C.unshare : C.share),
        h('button', { class: 'btn sm ghost', onclick: async () => { if (!confirm(C.deleteAsk(p.name))) return; const r = await A('removeProject', { id: p.id }); if (!r.ok) return this.say(r.message); if (proj.cloudId === p.id) delete proj.cloudId; this.loadList(); } }, C.del))));
    return h('div', {},
      h('div', { class: 'row' }, saveBtn, h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => { this.mode = 'shared'; this.render(); } }, C.openShared)),
      this.list == null ? h('p', { class: 'dim' }, C.loading)
        : this.list.length ? h('table', { class: 'cl-list' }, ...rows) : h('p', { class: 'dim' }, C.empty));
  }

  async openProject(p) {
    const r = await A('loadProject', { id: p.id });
    if (!r.ok) return this.say(r.message);
    const proj = migrate(r.data.data);
    proj.cloudId = p.id;
    this.S.setProject(proj);
    this.close();
    this.S.app.ui.toast(T.cloud.opened(p.name));
  }

  async toggleShare(p) {
    const r = await A('share', { id: p.id, on: !p.share });
    if (!r.ok) return this.say(r.message);
    await this.loadList();
    if (r.data.share) this.copyShare(r.data);
  }

  copyShare(p) {
    const link = `${this.st.server}/s/${p.share}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    this.say(T.cloud.copied(p.share, link), false);
  }

  renderShared() {
    const C = T.cloud;
    const [f, code] = this.field(C.code, { placeholder: C.codeHint });
    const go = async () => {
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
    return h('div', { class: 'cl-form' }, h('p', { class: 'dim' }, C.sharedText), f,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, C.open),
        this.st?.signedIn ? h('button', { class: 'btn sm ghost', onclick: () => { this.mode = 'projects'; this.render(); this.loadList(); } }, C.back) : null));
  }

  renderAccount() {
    const C = T.cloud, u = this.st.user || {};
    const [f1, nick] = this.field(C.nickname, { value: u.nickname || '', maxlength: 24 });
    const [f2, cur] = this.field(C.passwordNow, { type: 'password', autocomplete: 'current-password' });
    const [f3, nw] = this.field(C.passwordNew, { type: 'password', autocomplete: 'new-password' });
    const upd = async (patch, okText) => {
      const r = await A('update', patch);
      if (!r.ok) return this.say(r.message);
      this.st.user = r.data; this.say(okText, false);
    };
    return h('div', { class: 'cl-form' },
      h('div', { class: 'cl-grp' }, f1, h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => upd({ nickname: nick.value }, C.nickSaved) }, C.change))),
      h('div', { class: 'cl-grp' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!u.marketing, onchange: (e) => upd({ marketing: e.target.checked }, e.target.checked ? C.mkOn(fmtDate(Date.now())) : C.mkOff(fmtDate(Date.now()))) }), ` ${C.marketing}`),
        h('p', { class: 'dim' }, C.marketingText)),
      h('div', { class: 'cl-grp' }, f2, f3, h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => upd({ password: cur.value, newPassword: nw.value }, C.pwChanged) }, C.changePw))),
      h('div', { class: 'cl-grp' },
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async () => { const r = await A('exportData'); if (!r.ok) return this.say(r.message); this.say(C.exported, false); window.melofi.showItem(r.data); } }, C.exportData),
          h('span', { class: 'sp' }),
          h('button', { class: 'btn sm danger', onclick: async () => {
            const pw = await ask(C.deleteAccountAsk, '', { type: 'password', ok: C.deleteAccount });
            if (pw == null) return;
            const r = await A('deleteAccount', { password: pw });
            if (!r.ok) return this.say(r.message);
            this.list = null; this.st = { ...this.st, user: null, signedIn: false }; this.mode = 'login'; this.say(C.deleted, false);
          } }, C.deleteAccount))));
  }
}
