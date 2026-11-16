// Screenshots of the VST panels (mixer effect editor, channel sheet, mastering window), headless.
// Run like vst-e2e.js but with MELOFI_SCRIPT=tools/e2e/vst-shots.js (vst-run.mjs --shots).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const cfg = await (await fetch('melofi://app/user/vst-e2e.json')).json();
const model = await imp('studio/model.js');
A.settings.set({ studioTourSeen: true });
const S = A.studio;
await S.open();
const p = model.newProject();
const ch0 = model.newChannel('splendid', 'MeloFi Test Synth', 0, { kind: 'vst', send: 0, vst: { plugin: cfg.synth, file: cfg.synth, name: 'MeloFi Test Synth', vendor: 'MeloFi' } });
const fx = { id: model.uid('f'), type: 'vst', on: true, params: {}, vst: { plugin: cfg.effect, file: cfg.effect, name: 'MeloFi Test Effect', vendor: 'MeloFi' } };
const mfx = { id: model.uid('f'), type: 'vst', on: true, params: {}, vst: { plugin: cfg.effect, file: cfg.effect, name: 'MeloFi Test Effect', vendor: 'MeloFi' } };
ch0.fx = [fx];
p.channels = [ch0, ...p.channels.slice(0, 2)]; p.selected = ch0.id;
p.master.fx = [mfx];
S.setProject(p);
await S.syncAudio();
await sleep(800);
S.setTab('mixer');
S.mixer.edit = { strip: ch0.id, fx: fx.id };
S.mixer.render();
// later steps run while main.js takes the pictures (dark: 0-2, white: 3-5)
const th = await imp('studio/ui/theme.js');
const sheetOff = () => S.channelSheet.close?.();
const plan = [
  () => {},
  () => { S.mixer.edit = { strip: 'master', fx: mfx.id }; S.mixer.render(); },
  () => S.channelSheet.show(ch0.id, 'sound'),
  () => { sheetOff(); th.setStudioTheme('white'); S.mixer.edit = { strip: ch0.id, fx: fx.id }; S.render?.(); S.mixer.render(); },
  () => { S.mixer.edit = { strip: 'master', fx: mfx.id }; S.mixer.render(); },
  () => S.channelSheet.show(ch0.id, 'sound'),
];
plan.forEach((f, i) => setTimeout(f, i * 2500));
return [1500, 2500, 2500, 2500, 2500, 2500];
