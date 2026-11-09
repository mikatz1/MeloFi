// Click track. Scheduled ahead on the audio clock so it never drifts with the UI.
// Goes straight to the speakers: it is not part of recordings.

export class Metronome {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(ctx.destination);
    this.bpm = 100;
    this.beats = 4;
    this.on = false;
    this.next = 0;
    this.beat = 0;
    this.onBeat = () => {};
    this.timer = null;
  }

  setVolume(v) { this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  setTempo(bpm) {
    if (this.on && bpm !== this.bpm) { this.stop(); this.bpm = bpm; this.start(); return; } // restart keeps the grid exact
    this.bpm = bpm;
  }
  setBeats(n) { this.beats = n; }

  start() {
    if (this.on) return;
    this.on = true;
    this.beat = 0;
    this.next = this.ctx.currentTime + 0.06;
    this.originPerf = performance.now() + 60; // beat 0 on the page clock, for grid-aligned exports
    this.timer = setInterval(() => this.pump(), 25);
  }

  stop() {
    this.on = false;
    clearInterval(this.timer);
  }

  pump() {
    const ahead = this.ctx.currentTime + 0.12;
    while (this.next < ahead) {
      this.click(this.next, this.beat % this.beats === 0);
      const at = this.next, b = this.beat % this.beats;
      setTimeout(() => this.onBeat(b), Math.max(0, (at - this.ctx.currentTime) * 1000));
      this.next += 60 / this.bpm;
      this.beat++;
    }
  }

  click(t, accent) {
    // a woody tick: short pitched body + a very short noise transient
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(accent ? 1760 : 1320, t);
    o.frequency.exponentialRampToValueAtTime(accent ? 1100 : 900, t + 0.03);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.07);
  }
}
