// melofi://piano?vmic=1 (Discord /piano → MeloFi Helper /open → this app), headless.
// Run with the link on the command line and a scratch userData whose settings.json already has
// {"vmic":{"sink":"__none__"}} so nothing reaches a real cable:
//   MELOFI_LINK_TEST=1 MELOFI_USERDATA=<dir> MELOFI_SHOT=<out> MELOFI_SCRIPT=tools/e2e/deeplink-e2e.js electron . "melofi://piano?vmic=1"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const ok = (name, pass, note = '') => { R.push({ name, pass: !!pass, note }); console.log(`[link] ${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`); };
const vm = A.vmic;
for (let i = 0; i < 80 && vm?.status.state !== 'on'; i++) await sleep(100);
ok('the link turned sending on', A.settings.v.vmic?.on === true && vm.status.state === 'on', `${vm?.status.state} · sink ${A.settings.v.vmic?.sink}`);
ok('the microphone setting untouched', !A.settings.v.vmic?.mic);
ok('first link: the card opens on the Discord steps', !document.querySelector('#settings').hidden && !!document.querySelector('#vmicCard') && A.settings.v.vmic?.linkGuided === true);
A.ui.close?.();
await A.fromDiscordLink();
ok('next link: a toast only', /Discord로 연주를 보내는 중/.test(document.body.innerText));
ok('the link is taken once', (await window.melofi.takeDeepLink()) === null);
// a later link while running (second-instance sends 'deeplink'): with the cable gone, the card opens
A.settings.set({ vmic: { ...A.settings.v.vmic, on: false, sink: 'no-such-device' } });
await sleep(300);
await A.fromDiscordLink();
ok('no device: the card opens', !document.querySelector('#settings').hidden && !!document.querySelector('#vmicCard'), vm.status.state);
A.settings.set({ vmic: { on: false, sink: 'auto', level: 1, mic: false, micDevice: '', micLevel: 1, gate: -55 } });
await sleep(500);
console.log(`[link] ${R.filter((r) => r.pass).length}/${R.length} passed`);
return [];
