// Update flow with a fake updater (no network) and the 문제 신고 text. Run: node tools/test-app-infra.mjs
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { createUpdateController, newer, isOffline, START_DELAY, EVERY } = require('../updater.js');
const { compose, issueUrl, scrubber, ISSUES } = require('../report.js');

let fails = 0, passes = 0;
const ok = (cond, name) => { if (cond) passes++; else { fails++; console.log(`FAIL ${name}`); } };
const tick = () => new Promise((r) => setImmediate(r));

class FakeUpdater extends EventEmitter {
  constructor({ latest = null, failCheck = null, failDownload = null } = {}) {
    super();
    Object.assign(this, { latest, failCheck, failDownload, checks: 0, downloads: 0, installs: [] });
  }
  async checkForUpdates() {
    this.checks++;
    if (this.failCheck) { const e = new Error(this.failCheck); this.emit('error', e); throw e; }
    if (!this.latest) return { isUpdateAvailable: false, updateInfo: { version: '0.2.2' } };
    return { isUpdateAvailable: true, updateInfo: { version: this.latest } };
  }
  async downloadUpdate() {
    this.downloads++;
    if (this.failDownload) throw new Error(this.failDownload);
    for (const percent of [12.4, 55, 100]) { this.emit('download-progress', { percent }); await tick(); }
    this.emit('update-downloaded', { version: this.latest });
    return ['x.exe'];
  }
  quitAndInstall(...a) { this.installs.push(a); }
}
const fakeTimers = () => {
  const t = { timeouts: [], intervals: [] };
  t.setTimeout = (fn, ms) => { if (ms <= 100) fn(); else t.timeouts.push({ fn, ms }); return t.timeouts.length; };
  t.clearTimeout = () => {};
  t.setInterval = (fn, ms) => { t.intervals.push({ fn, ms }); return t.intervals.length; };
  t.clearInterval = () => {};
  return t;
};
const make = (updater, extra = {}) => {
  const seen = [];
  const ctl = createUpdateController({ updater, currentVersion: '0.2.2', broadcast: (s) => seen.push(s), timers: fakeTimers(), ...extra });
  return { ctl, seen };
};

// settings put on the updater
{
  const u = new FakeUpdater();
  make(u);
  ok(u.autoDownload === false && u.autoInstallOnAppQuit === false && u.allowPrerelease === true, 'updater: no auto download / install, pre-releases on');
  let threw = false;
  try { u.emit('error', new Error('x')); } catch { threw = true; }
  ok(!threw, 'updater: an error event without a pending call does not throw');
}

// found -> 받기 -> progress -> ready -> only the click installs
{
  const u = new FakeUpdater({ latest: '0.3.0' });
  const { ctl, seen } = make(u);
  await ctl.check();
  ok(ctl.state().phase === 'available' && ctl.state().version === '0.3.0', 'quiet check finds 0.3.0');
  ok(u.downloads === 0, 'nothing downloaded before 받기');
  await ctl.download();
  const pct = seen.filter((s) => s.phase === 'downloading').map((s) => s.percent);
  ok(pct[0] === 0 && pct.includes(12) && pct.includes(100), `download progress reported (${pct})`);
  ok(ctl.state().phase === 'ready', 'ready after download');
  ok(u.installs.length === 0, 'not installed without the restart click');
  await ctl.check();
  ok(u.checks === 1, 'no new check once an update is ready');
  ok(ctl.restart() === true && u.installs.length === 1 && u.installs[0][0] === true && u.installs[0][1] === true, 'restart click: quitAndInstall(silent, run after)');
}

// no network: quiet check shows nothing, manual check says so
{
  const u = new FakeUpdater({ failCheck: 'net::ERR_INTERNET_DISCONNECTED' });
  const { ctl, seen } = make(u);
  await ctl.check();
  ok(seen.length === 0 && ctl.state().phase === 'idle', 'offline quiet check: silent');
  await ctl.check({ manual: true });
  const s = ctl.state();
  ok(s.phase === 'error' && s.offline && /인터넷/.test(s.message), 'offline manual check: says no connection');
  ok(isOffline({ code: 'ENOTFOUND' }) && !isOffline(new Error('Cannot find latest.yml')), 'offline detection');
}

// a release without latest.yml (the old ones): quiet failure
{
  const u = new FakeUpdater({ failCheck: 'Cannot find latest.yml in the latest release artifacts' });
  const { ctl, seen } = make(u);
  await ctl.check();
  ok(seen.length === 0 && ctl.state().phase === 'idle', 'missing latest.yml: silent');
}

// download fails -> 다시 받기
{
  const u = new FakeUpdater({ latest: '0.3.1', failDownload: 'ECONNRESET' });
  const { ctl } = make(u);
  await ctl.check();
  await ctl.download();
  ok(ctl.state().phase === 'error' && ctl.state().version === '0.3.1' && ctl.state().retry, 'download failure keeps the version for 다시 받기');
  u.failDownload = null;
  await ctl.download();
  ok(ctl.state().phase === 'ready', 'retry works');
}

// manual check, already up to date / dev run
{
  const { ctl } = make(new FakeUpdater());
  await ctl.check({ manual: true });
  ok(ctl.state().phase === 'latest', 'manual: up to date');
  const u = new FakeUpdater({ latest: '9.9.9' });
  const dev = make(u, { isPackaged: false }).ctl;
  await dev.check({ manual: true });
  ok(dev.state().phase === 'dev' && u.checks === 0, 'dev run: no check');
}

// timer: start check and every few hours, nothing when turned off
{
  const u = new FakeUpdater({ latest: '0.3.0' });
  let on = false;
  const timers = fakeTimers();
  const ctl = createUpdateController({ updater: u, currentVersion: '0.2.2', enabled: () => on, timers });
  ctl.start();
  ok(timers.timeouts[0]?.ms === START_DELAY && timers.intervals[0]?.ms === EVERY, 'start: first check soon, then every few hours');
  timers.timeouts[0].fn();
  await tick();
  ok(u.checks === 0, 'setting off: no check');
  on = true;
  timers.intervals[0].fn();
  await tick();
  ok(u.checks === 1 && ctl.state().phase === 'available', 'setting on: periodic check runs');
}

// version order
ok(newer('0.2.10', '0.2.9') && newer('0.3.0', '0.3.0-beta.2') && !newer('0.2.2', '0.2.2') && newer('0.3.0-beta.2', '0.3.0-beta.1') && !newer('0.2.1', '0.2.2'), 'version compare');

// 문제 신고 text: user folder, names, e-mail hidden; the issue link fits
{
  const os = require('node:os');
  const scrub = scrubber();
  const t = scrub(`at ${os.homedir()}\\AppData\\x.js mail someone@example.com token=abc123`);
  ok(!t.includes(os.homedir()) && !t.includes('someone@example.com') && !t.includes('abc123'), `scrub: ${t}`);
  const system = { MeloFi: '0.2.2', OS: 'Windows 11' };
  const errors = Array.from({ length: 40 }, (_, i) => `2026-11-12 10:00:${String(i).padStart(2, '0')}.000 v0.2.2 win32 [piano] error: boom ${i} ${'x'.repeat(300)}`);
  const text = compose({ system, errors, description: '연주 중에 멈췄어요' });
  ok(text.includes('연주 중에 멈췄어요') && text.includes('MeloFi: 0.2.2') && text.includes('boom 39'), 'report text has description, system, errors');
  const url = issueUrl({ system, errors, description: '연주 중에 멈췄어요\n두 번째 줄' });
  ok(url.startsWith(ISSUES + '?title=') && url.length <= 7000, `issue link fits (${url.length})`);
  const body = decodeURIComponent(url.split('&body=')[1]);
  ok(body.includes('boom 39') && !body.includes('boom 0 '), 'issue link keeps the newest errors');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
