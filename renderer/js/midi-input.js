// Hardware MIDI keyboards (Web MIDI). Listens to every connected input.

export class MidiInput {
  constructor({ onNote, onSustain, onDevices }) {
    this.onNote = onNote;
    this.onSustain = onSustain;
    this.onDevices = onDevices;
    this.access = null;
    this.enabled = true;
    this.devices = [];
  }

  async init() {
    if (!navigator.requestMIDIAccess) return;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return;
    }
    this.access.onstatechange = () => this.bind();
    this.bind();
  }

  bind() {
    this.devices = [];
    for (const input of this.access.inputs.values()) {
      if (input.state !== 'connected') continue;
      this.devices.push(input.name || 'MIDI');
      input.onmidimessage = (e) => this.handle(e.data);
    }
    this.onDevices(this.devices);
  }

  handle(d) {
    if (!this.enabled || !d || d.length < 2) return;
    const type = d[0] & 0xf0;
    if (type === 0x90 && d[2] > 0) this.onNote(d[1], d[2], true);
    else if (type === 0x80 || (type === 0x90 && d[2] === 0)) this.onNote(d[1], 0, false);
    else if (type === 0xb0 && d[1] === 64) this.onSustain(d[2] >= 64);
  }
}
