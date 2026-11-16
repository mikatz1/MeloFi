// Runs tools/e2e/vst-e2e.js headless on a throw-away userData:
//   node tools/e2e/vst-run.mjs
// Uses the MeloFi Test Synth / Test Effect VST3s built next to the helper (native/build, see
// native/vsthost/CMakeLists.txt). The page reads <userData>/user/vst-e2e.json for their paths and
// loads <userData>/user/vst-cap.js, a tiny AudioWorklet that records the studio's output with the
// frame number of every block (so timing can be checked to the sample).
// Writes the report lines to stdout; exit code 1 when a check failed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, 'native/build');
const UD = path.join(os.tmpdir(), 'melofi-vst-e2e');
fs.rmSync(UD, { recursive: true, force: true });
fs.mkdirSync(path.join(UD, 'user'), { recursive: true });
fs.mkdirSync(path.join(UD, 'shots'), { recursive: true });

const synth = path.join(BUILD, 'MeloFiTestSynth_artefacts/Release/VST3/MeloFi Test Synth.vst3');
const effect = path.join(BUILD, 'MeloFiTestEffect_artefacts/Release/VST3/MeloFi Test Effect.vst3');
for (const p of [synth, effect]) if (!fs.existsSync(p)) { console.error(`missing ${p} (build native/vsthost first)`); process.exit(2); }
fs.writeFileSync(path.join(UD, 'user/vst-e2e.json'), JSON.stringify({ synth, effect, folders: [path.dirname(synth), path.dirname(effect)] }));
fs.writeFileSync(path.join(UD, 'user/vst-cap.js'), `
registerProcessor('e2e-cap', class extends AudioWorkletProcessor {
  constructor() { super(); this.from = 0; this.to = 0; this.port.onmessage = (e) => { this.from = e.data.from; this.to = e.data.to; }; }
  process(inputs) {
    const x = inputs[0];
    if (x.length && currentFrame + 128 > this.from && currentFrame < this.to) this.port.postMessage({ f: currentFrame, L: new Float32Array(x[0]), R: new Float32Array(x[1] || x[0]) });
    return true;
  }
});`);

const electron = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const env = { ...process.env, MELOFI_USERDATA: UD, MELOFI_SHOT: path.join(UD, 'shots'), MELOFI_SCRIPT: path.join(ROOT, process.argv.includes('--shots') ? 'tools/e2e/vst-shots.js' : 'tools/e2e/vst-e2e.js') };
const child = spawn(electron, ['.'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; process.stderr.write(d); });
child.stderr.on('data', (d) => process.stderr.write(d));
const timer = setTimeout(() => { console.error('timeout'); child.kill(); }, 300000);
child.on('exit', () => {
  clearTimeout(timer);
  if (process.argv.includes('--shots')) { console.log(`screenshots: ${path.join(UD, 'shots')}`); process.exit(0); }
  const m = out.match(/VST-E2E-BEGIN([\s\S]*?)VST-E2E-END/);
  if (!m) { console.log('no report'); process.exit(1); }
  const lines = m[1].split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean);
  console.log(lines.join('\n'));
  process.exit(lines.some((l) => l.startsWith('FAIL')) ? 1 : 0);
});
