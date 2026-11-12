// Studio colour theme: dark (default) or white. The colours are CSS custom properties in studio/theme.css;
// switching sets html[data-studio-theme], and canvases take their colours from studioPalette(), which reads
// the --cv-* properties once per switch.
export const STUDIO_THEMES = ['dark', 'white'];

// every --cv-* property in theme.css (both themes define all of them)
const CV = 'bg row row-black row-out root-line root-line-scale past loop-shade grid-bar grid-beat grid-step ghost note-a0 note-a1 note-line note-edge note-mark note-ink mute-note sel-note sel-mark sel-ink chord-ghost playhead key-w key-b key-lit key-out key-ink-w key-ink-b ruler ruler-ink lane lane-line lane-ink track track-alt loop-on loop-off pl-beat pl-bar pl-bar4 clip-mute clip-a clip-band clip-ink clip-sel clip-notes clip-wave auto-line auto-point head head-ink head-ink-mute ms-off ms-ink ms-ink-on mute-on solo-on marker-lane marker tempo sig loop-bar-on loop-bar-off loop-drag scroll thumb thumb-on well well-fade well-line well-grid well-ink well-zero trace wave-off target-band riff-bg riff-grid nt-bg nt-row nt-row-black nt-row-out nt-key-b nt-ink-w nt-ink-b nt-line nt-note nt-motion nt-ink ms-mix ms-target ms-ref lane-shade'.split(' ');

let cache = null;

export const studioTheme = () => (document.documentElement.dataset.studioTheme === 'white' ? 'white' : 'dark');

// on: false takes the theme off the page (the piano window, when the studio closes there)
export function setStudioTheme(name, on = true) {
  const html = document.documentElement;
  const want = on && name === 'white' ? 'white' : null;
  if ((html.dataset.studioTheme || null) === want && cache) return false;
  if (want) html.dataset.studioTheme = want; else delete html.dataset.studioTheme;
  cache = null;
  return true;
}

// the canvases' colours for the current theme: { bg, row, playhead, … } from --cv-bg, --cv-row, --cv-playhead …
// (numbers such as noteA0 come back as numbers; a property set to `none` comes back as '')
export function studioPalette() {
  if (cache) return cache;
  const cs = getComputedStyle(document.documentElement);
  const out = { theme: studioTheme() };
  for (const name of CV) {
    const v = cs.getPropertyValue(`--cv-${name}`).trim();
    const k = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    out[k] = v === 'none' ? '' : /^-?\d*\.?\d+$/.test(v) ? +v : v;
  }
  cache = out;
  return out;
}

export const invalidatePalette = () => { cache = null; };
