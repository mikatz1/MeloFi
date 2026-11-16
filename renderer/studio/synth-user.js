// MeloFi Synth — the user's own presets and waveforms ("내 파형"), kept in userData/synth-user.json:
// { v: 1, presets: { name: synth params (with wt1 / wt2 tables) }, waves: { name: stored table } }.
// Loaded once when the studio opens; the preset browser and the channel sheet read the cache.
import { SYNTH_PRESETS } from './synth-presets.js';

let store = { v: 1, presets: {}, waves: {} };
let loading = null;

export function loadSynthUser() {
  if (!loading) {
    loading = (async () => {
      try {
        const txt = await window.melofi?.synthUserLoad?.();
        if (txt) { const o = JSON.parse(txt); store = { v: 1, presets: o.presets || {}, waves: o.waves || {} }; }
      } catch (e) { console.warn('synth-user', e?.message || e); }
      return store;
    })();
  }
  return loading;
}
const save = () => window.melofi?.synthUserSave?.(JSON.stringify(store));

export const userPresets = () => store.presets;
export const userWaves = () => store.waves;
// a preset's parameters by name: the built-in ones first, then the user's
export const presetParams = (name) => SYNTH_PRESETS[name] || store.presets[name] || null;
export const isUserPreset = (name) => !SYNTH_PRESETS[name] && !!store.presets[name];

export async function saveUserPreset(name, params) { await loadSynthUser(); store.presets[name] = JSON.parse(JSON.stringify(params)); return save(); }
export async function deleteUserPreset(name) { await loadSynthUser(); delete store.presets[name]; return save(); }
export async function saveUserWave(name, table) { await loadSynthUser(); store.waves[name] = table; return save(); }
export async function deleteUserWave(name) { await loadSynthUser(); delete store.waves[name]; return save(); }
