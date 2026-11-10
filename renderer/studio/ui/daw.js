// "DAW로 보내기": export stems / mix / MIDI / REAPER project and hand them to a DAW (open in it,
// or drag the files onto its timeline), and the live MIDI link (output port + clock).
import { h } from './dom.js';
import { exportForDaw } from '../io.js';
import { T } from '../../js/strings.js';

export class DawSheet {
  constructor(studio) {
    this.S = studio;
    this.daws = null;
    this.result = null;
    this.busy = false;
    this.el = h('section', { id: 'daw', class: 'sheet', hidden: true },
      h('div', { class: 'sheet-card daw-card' },
        h('div', { class: 'sheet-head' }, h('h2', {}, T.daw.title), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
        this.body = h('div', { class: 'daw-body' })));
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    document.body.append(this.el);
  }

  async show() {
    this.S.app.ui.close();
    this.el.hidden = false;
    this.render();
    if (!this.daws) { this.daws = await window.melofi.dawList(); this.render(); }
    await this.S.midiOut?.init();
    this.render();
  }

  close() { this.el.hidden = true; }

  async run() {
    if (this.busy) return;
    this.busy = true;
    this.result = null;
    this.progress = T.daw.preparing;
    this.render();
    try {
      const S = this.S;
      const { files, base } = await exportForDaw(S.proj, {
        isKit: (id) => S.isKit(id),
        onProgress: (f, name) => { this.progress = name === 'mix' ? T.daw.mixing : name ? T.daw.stem(name) : T.daw.writing; this.render(); },
      });
      this.result = await window.melofi.dawWrite({ base, dir: S.app.settings.get('recDir') ? `${S.app.settings.get('recDir')}\\DAW` : null, files });
    } catch (err) {
      console.error(err);
      this.progress = `${T.daw.fail} ${err.message || ''}`;
    }
    this.busy = false;
    this.render();
  }

  fileRow(p) {
    const name = p.split(/[\\/]/).slice(-2).join('/').replace(/^.*\(DAW [^)]*\)\//, '');
    const kind = /\.rpp$/i.test(p) ? 'REAPER' : /\.mid$/i.test(p) ? 'MIDI' : /mix\.wav$/i.test(p) ? T.daw.mix : T.daw.stemKind;
    const row = h('div', { class: 'daw-file', draggable: 'true', title: T.daw.dragTip },
      h('i', { class: 'grip' }), h('span', { class: 'fn' }, name), h('small', {}, kind));
    row.addEventListener('dragstart', (e) => { e.preventDefault(); window.melofi.dawDrag([p]); });
    return row;
  }

  render() {
    if (this.el.hidden) return;
    const D = T.daw, S = this.S, set = S.app.settings;
    const daws = this.daws;
    const found = daws == null ? h('p', { class: 'dim' }, D.looking)
      : daws.length ? h('p', { class: 'daw-found' }, D.found, ...daws.map((d) => h('b', {}, d.name)))
        : h('p', { class: 'dim' }, D.none);

    // export
    const r = this.result;
    const openBtns = r && daws ? daws.map((d) => {
      const want = d.opens === 'rpp' ? r.files.find((f) => /\.rpp$/i.test(f)) : d.opens === 'mid' ? r.files.find((f) => /\.mid$/i.test(f)) : d.opens === 'wav' ? r.files.find((f) => /mix\.wav$/i.test(f)) : null;
      return h('button', { class: 'btn', title: want ? D.openTip(want.split(/[\\/]/).pop()) : D.openEmptyTip, onclick: () => window.melofi.dawOpen(d.id, want || null) }, D.openIn(d.name));
    }) : [];
    const stems = r ? r.files.filter((f) => /[\\/]stems[\\/]/i.test(f)) : [];
    const exportSec = h('section', { class: 'daw-sec' },
      h('h3', {}, D.exportTitle),
      h('p', { class: 'dim' }, D.exportText),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: this.busy, onclick: () => this.run() }, this.busy ? D.working : r ? D.again : D.export),
        this.busy || (!r && this.progress) ? h('span', { class: 'dim' }, this.progress) : null),
      r ? h('div', { class: 'daw-result' },
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => window.melofi.dawOpenFolder(r.dir) }, D.folder), ...openBtns),
        h('p', { class: 'dim' }, D.dragHint),
        h('div', { class: 'daw-files' }, ...r.files.filter((f) => !stems.includes(f)).map((f) => this.fileRow(f)), ...stems.map((f) => this.fileRow(f))),
        stems.length > 1 ? h('div', { class: 'daw-file all', draggable: 'true', ondragstart: (e) => { e.preventDefault(); window.melofi.dawDrag(stems); } },
          h('i', { class: 'grip' }), h('span', { class: 'fn' }, D.allStems(stems.length))) : null) : null);

    // live MIDI link
    const out = S.midiOut;
    const ports = out ? out.ports() : [];
    const cur = set.get('midiOut') || '';
    const midiSec = h('section', { class: 'daw-sec' },
      h('h3', {}, D.midiTitle),
      h('p', { class: 'dim' }, D.midiText),
      h('div', { class: 'row' },
        h('label', {}, D.port, ' ',
          h('select', { onchange: (e) => { set.set({ midiOut: e.target.value }); out?.select(e.target.value); this.render(); } },
            h('option', { value: '' }, D.off),
            ...ports.map((p) => h('option', { value: p, selected: p === cur }, p)),
            cur && !ports.includes(cur) ? h('option', { value: cur, selected: true }, `${cur} ${D.missing}`) : null)),
        h('button', { class: 'btn sm ghost', onclick: () => { out?.select(cur); this.render(); } }, D.refresh)),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!set.get('midiClock'), onchange: (e) => { set.set({ midiClock: e.target.checked }); if (out) out.clock = e.target.checked; } }), ' ', D.clock),
      ports.length ? null : h('p', { class: 'dim' }, D.noPorts),
      h('p', { class: 'dim' }, D.midiIn));

    this.body.replaceChildren(found, exportSec, midiSec);
  }
}
