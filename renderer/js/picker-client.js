// Opens the instrument picker window (renderer/picker.html) and hands back what was chosen.
// Only the latest request is answered, so an older caller never gets a stale pick.
let token = null, onPick = null, onStore = null, wired = false;

export function openPicker(opts, pick, store = null) {
  if (!wired) {
    wired = true;
    window.melofi.onPickerChosen(({ token: t, id }) => { if (t === token) onPick?.(id); });
    window.melofi.onPickerStore(() => onStore?.());
  }
  token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  onPick = pick;
  onStore = store;
  return window.melofi.openInstrumentPicker({ ...opts, token });
}
