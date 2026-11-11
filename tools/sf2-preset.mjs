// Inspect a SoundFont and plan a preset for MeloFi.
//   node tools/sf2-preset.mjs <file.sf2>                      list presets
//   node tools/sf2-preset.mjs <file.sf2> <bank> <program>     zones, files and the byte ranges they need
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sf2 from '../lib/sf2.js';

export function localReader(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const read = (a, b) => { const buf = Buffer.alloc(Math.min(b, size) - a); fs.readSync(fd, buf, 0, buf.length, a); return buf; };
  return { fd, size, read, close: () => fs.closeSync(fd) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, bank, program] = process.argv.slice(2);
  const r = localReader(file);
  const sf = await sf2.readSf2(r.read, r.size);
  if (bank == null) {
    for (const p of sf.presets.slice(0, -1).sort((a, b) => a.bank - b.bank || a.program - b.program)) console.log(`${p.bank}:${p.program}\t${p.name}`);
  } else {
    const plan = sf2.planPreset(sf, +bank, +program);
    const ranges = sf2.rangesFor(sf, plan.files);
    const bytes = ranges.reduce((s, [a, b]) => s + b - a, 0);
    console.log(`${plan.name}: ${plan.regions.length} regions, ${plan.files.length} files, ${ranges.length} ranges, ${(bytes / 1e6).toFixed(2)} MB`);
    for (const f of plan.files) console.log(`  ${f.name}\t${f.rate} Hz\t${f.chans.length}ch\t${f.chans[0][1] - f.chans[0][0]} frames\tloop ${f.loop ? f.loop.join('-') : '-'}\tenv ${f.env ? JSON.stringify(f.env) : '-'}`);
    const z = sf2.presetZones(sf, +bank, +program).zones;
    for (const x of z) console.log(`  zone ${x.instrumentName} keys ${x.klo}-${x.khi} vel ${x.vlo}-${x.vhi} sample ${sf.samples[x.sampleID].name} root ${x.overridingRootKey}/${sf.samples[x.sampleID].pitch} att ${x.initialAttenuation} A ${x.attackVolEnv} H ${x.holdVolEnv} D ${x.decayVolEnv} S ${x.sustainVolEnv} R ${x.releaseVolEnv} fc ${x.initialFilterFc} modes ${x.sampleModes} scale ${x.scaleTuning} tune ${x.coarseTune}/${x.fineTune}`);
  }
  r.close();
}
