// Start-up card: shows what the hidden main window is preparing (main.js forwards boot:progress).
const $ = (s) => document.querySelector(s);
let shown = 0;
window.melofi.onBootProgress(({ p, label, detail }) => {
  if (label) $('#label').textContent = label;
  if (detail != null) $('#detail').textContent = detail;
  if (typeof p === 'number') {
    shown = Math.max(shown, Math.min(1, p)); // never goes backwards
    $('#fill').style.width = `${(shown * 100).toFixed(1)}%`;
    $('#pct').textContent = `${Math.round(shown * 100)}%`;
  }
});
window.melofi.envInfo().then((env) => { $('#ver').textContent = env?.version ? `v${env.version}` : ''; }).catch(() => {});
