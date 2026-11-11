// i18n: source table — every Korean string here is UI text and a translation key; the screen that shows it calls t() (docs/i18n.md)
// MeloFi Synth presets: only what differs from the defaults (synth.js SYNTH_PARAMS).
// Waves: 0 saw · 1 square · 2 triangle · 3 sine · 4 pulse 25% · 5 pulse 12% · 6 drawbar organ ·
// 7 bright brass · 8 vowel "ah" · 9 vowel "oo" · 10 half sine. FM: fm (index), fmr (ratio), fmd (decay).
// The first 28 keep their names (projects refer to them). "lvl" (dB) is measured, not tuned by ear:
// tools/e2e/synth-levels.js renders every preset with its family's phrase and brings it to that
// family's loudness, so presets sit at their natural size next to each other.

const PAD = { fa: 0.9, fd: 1.5, fs: 0.6, aa: 0.7, ad: 1, as: 0.9, ar: 1.8 };
const PLUCK = { fs: 0, as: 0, ad: 0.45, ar: 0.3, fd: 0.18, fenv: 3 };
const KEYS = { aa: 0.002, as: 0.25, ad: 1.6, ar: 0.45 };

export const SYNTH_PRESETS = {
  // ---------- the original set ----------
  '기본 쏘': { vol: 0.7, lvl: -3.5 },
  '슈퍼쏘 리드': { w2: 0, l2: 0.6, f2: 0, uni: 7, det: 28, spread: 0.9, cut: 9000, res: 0.8, fenv: 0.8, as: 0.9, ar: 0.35, vol: 0.7, lvl: -3.7 },
  '퓨처 베이스 코드': { w2: 0, uni: 5, det: 22, cut: 1800, res: 2, fenv: 2.4, fd: 0.25, fs: 0.15, aa: 0.003, ad: 0.6, as: 0.7, lt: 2, lr: 4, ld: 0.15, vol: 0.7, lvl: -2.1 },
  '808 서브': { w1: 3, l1: 1, l2: 0, sub: 0, cut: 2500, fenv: 0, as: 0.85, ad: 1.6, ar: 0.2, glide: 0.06, vol: 0.85, lvl: -5.5 },
  '리스 베이스': { w2: 0, f2: 12, l2: 0.8, uni: 2, det: 14, cut: 900, res: 1.4, fenv: 1, kt: 0.3, vol: 0.7, lvl: 0.5 },
  '신스 베이스': { w2: 1, o2: -1, l2: 0.5, cut: 700, res: 4, fenv: 2.5, fd: 0.18, fs: 0.1, ar: 0.12, vol: 0.7, lvl: -0.7 },
  '플럭': { w2: 1, l2: 0.5, cut: 1200, res: 2, fenv: 3.5, fd: 0.16, fs: 0, ad: 0.5, as: 0, ar: 0.25, vol: 0.7, lvl: -3.9 },
  '따뜻한 패드': { w2: 0, f2: 9, uni: 3, det: 16, cut: 1600, res: 0.7, fenv: 1, fa: 1.2, fd: 1.5, fs: 0.6, aa: 0.8, ad: 1, as: 0.9, ar: 1.8, lt: 2, lr: 0.3, ld: 0.2, vol: 0.7, lvl: -5.5 },
  '브라스': { w2: 0, f2: 6, uni: 2, det: 10, cut: 1200, res: 1, fenv: 2, fa: 0.06, fd: 0.4, fs: 0.5, aa: 0.04, ar: 0.25, vol: 0.7, lvl: -3.8 },
  '칩튠 리드': { w1: 1, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 6, ld: 0.08, aa: 0.001, ar: 0.05, vol: 0.7, lvl: -5.2 },
  '레트로 리드': { w1: 1, w2: 0, o2: 1, l2: 0.3, cut: 3500, res: 3, fenv: 1, lt: 1, lr: 5.5, ld: 0.1, glide: 0.04, vol: 0.7, lvl: -6.0 },
  '오르간': { w1: 3, w2: 3, o2: 1, l2: 0.6, s2: 0, f2: 0, sub: 0.4, cut: 12000, fenv: 0, aa: 0.005, as: 1, ar: 0.06, lt: 1, lr: 6, ld: 0.04, vol: 0.7, lvl: -12.3 },
  '벨': { w1: 3, w2: 2, o2: 2, s2: 7, f2: 0, l2: 0.5, cut: 9000, fenv: 0, ad: 1.5, as: 0, ar: 1.2, vol: 0.7, lvl: -6.1 },
  '애시드 베이스': { w1: 0, l2: 0, cut: 500, res: 12, fenv: 3, fd: 0.2, fs: 0, kt: 0.2, as: 0.7, ar: 0.08, glide: 0.05, vol: 0.7, lvl: 0.5 },
  '딥 하우스 베이스': { w1: 3, w2: 2, o2: -1, l2: 0.5, f2: 0, cut: 900, res: 1, fenv: 1, ad: 0.4, as: 0.6, ar: 0.1, vol: 0.8, lvl: -0.8 },
  '펀치 베이스': { w1: 1, w2: 0, o2: -1, l2: 0.6, cut: 600, res: 2, fenv: 3, fd: 0.1, fs: 0.2, ar: 0.08, vol: 0.7, lvl: -2.5 },
  '사인 리드': { w1: 3, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 5, ld: 0.06, glide: 0.05, ar: 0.2, vol: 0.7, lvl: -3.0 },
  '스퀘어 리드': { w1: 1, w2: 1, f2: 10, l2: 0.5, cut: 4000, res: 1.5, fenv: 1, ar: 0.2, vol: 0.7, lvl: -6.9 },
  '스트링 패드': { w2: 0, f2: 12, uni: 5, det: 20, spread: 0.9, cut: 2500, fenv: 0.5, fa: 0.8, aa: 0.6, as: 0.85, ar: 1.5, lt: 1, lr: 5, ld: 0.03, vol: 0.7, lvl: -5.0 },
  '앰비언트 패드': { w1: 2, w2: 3, o2: 1, l2: 0.5, uni: 4, det: 12, cut: 1200, res: 1.5, fenv: 1.5, fa: 3, fd: 3, fs: 0.5, aa: 2.5, as: 1, ar: 4, lt: 2, lr: 0.15, ld: 0.4, noise: 0.03, vol: 0.7, lvl: -5.0 },
  '다크 패드': { w2: 0, o2: -1, l2: 0.5, uni: 3, det: 10, cut: 600, res: 2, fenv: 0.8, fa: 1.5, aa: 1.2, as: 0.9, ar: 2.5, vol: 0.7, lvl: -4.8 },
  '하프 플럭': { w1: 2, w2: 3, o2: 1, l2: 0.4, f2: 0, cut: 5000, fenv: 2, fd: 0.3, fs: 0, ad: 1.2, as: 0, ar: 0.8, vol: 0.7, lvl: -4.3 },
  '하우스 스탭': { w2: 0, uni: 3, det: 15, cut: 2000, res: 3, fenv: 2.5, fd: 0.12, fs: 0.05, ad: 0.25, as: 0, ar: 0.1, vol: 0.7, lvl: 1.9 },
  '일렉 피아노': { w1: 3, w2: 2, o2: 1, l2: 0.3, f2: 4, cut: 6000, fenv: 1, fd: 0.6, fs: 0.3, ad: 1.8, as: 0.2, ar: 0.5, lt: 3, lr: 4, ld: 0.12, vol: 0.7, lvl: -5.8 },
  '마림바': { w1: 3, w2: 3, o2: 2, l2: 0.25, f2: 0, cut: 8000, fenv: 0, aa: 0.001, ad: 0.35, as: 0, ar: 0.2, vol: 0.7, lvl: 0.4 },
  '라이저 노이즈': { l1: 0, l2: 0, noise: 1, cut: 1200, res: 5, fenv: 3, fa: 2, fd: 0.5, fs: 1, aa: 1, as: 1, ar: 1, lt: 2, lr: 0.5, ld: 0.3, vol: 0.9, lvl: -4.3 },
  '레이저 FX': { w1: 0, l2: 0, cut: 8000, res: 8, fenv: -3, fd: 0.4, fs: 0, ad: 0.5, as: 0, ar: 0.2, vol: 0.7, lvl: 3.1 },
  '사이렌 FX': { w1: 3, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 2, ld: 1, ar: 0.3, vol: 0.6, lvl: -5.1 },

  // ---------- leads ----------
  '하이퍼 슈퍼쏘': { w2: 0, l2: 0.7, f2: 0, uni: 7, det: 40, spread: 1, cut: 12000, fenv: 0.5, as: 0.95, ar: 0.4, drv: 0.15, vol: 0.7, lvl: -6.9 },
  '트랜스 리드': { w2: 0, f2: 12, l2: 0.6, uni: 5, det: 24, spread: 0.8, cut: 7000, res: 1.5, fenv: 1.2, fd: 0.5, fs: 0.6, ar: 0.5, lt: 1, lr: 5.5, ld: 0.06, vol: 0.7, lvl: -2.6 },
  '퓨처 리드': { w1: 4, w2: 0, l2: 0.5, uni: 3, det: 18, cut: 5000, res: 2, fenv: 1.5, fd: 0.3, fs: 0.5, glide: 0.06, ar: 0.3, vol: 0.7, lvl: 3.2 },
  '싱크 리드': { w1: 0, w2: 0, s2: 19, l2: 0.6, f2: 0, cut: 6000, res: 3, fenv: 2, fd: 0.25, fs: 0.4, drv: 0.3, ar: 0.2, vol: 0.7, lvl: -6.5 },
  '펄스 리드': { w1: 4, w2: 5, f2: 8, l2: 0.4, cut: 4500, res: 1.5, fenv: 1, ar: 0.2, vol: 0.7, lvl: 2.6 },
  '가는 펄스 리드': { w1: 5, l2: 0, cut: 9000, fenv: 0.5, lt: 1, lr: 5, ld: 0.05, ar: 0.15, vol: 0.7, lvl: 4.0 },
  '부드러운 사인 리드': { w1: 3, w2: 2, o2: 1, l2: 0.15, cut: 9000, fenv: 0, aa: 0.03, ar: 0.35, lt: 1, lr: 5.2, ld: 0.05, glide: 0.08, vol: 0.7, lvl: -3.2 },
  '휘슬 리드': { w1: 3, l2: 0, noise: 0.06, cut: 14000, fenv: 0, aa: 0.04, lt: 1, lr: 6, ld: 0.07, glide: 0.07, ar: 0.25, vol: 0.7, lvl: -3.0 },
  '모노 리드 (아날로그)': { w1: 0, w2: 1, o2: -1, l2: 0.5, cut: 2400, res: 4, fenv: 2, fd: 0.35, fs: 0.4, glide: 0.08, ar: 0.15, vol: 0.7, lvl: -4.2 },
  '그라울 리드': { w1: 0, w2: 0, s2: 7, l2: 0.6, cut: 1400, res: 6, fenv: 2.5, lt: 2, lr: 4, ld: 0.5, drv: 0.6, ar: 0.12, vol: 0.7, lvl: -5.3 },
  '디스토션 리드': { w1: 0, w2: 1, f2: 15, l2: 0.6, uni: 2, det: 12, cut: 5000, res: 2, fenv: 1, drv: 0.8, ar: 0.2, vol: 0.7, lvl: -4.1 },
  '칩튠 펄스': { w1: 5, l2: 0, cut: 18000, fenv: 0, aa: 0.001, ar: 0.04, lt: 1, lr: 7, ld: 0.04, vol: 0.7, lvl: 4.2 },
  '칩튠 삼각': { w1: 2, l2: 0, cut: 18000, fenv: 0, aa: 0.001, ar: 0.04, vol: 0.7, lvl: -1.2 },
  'FM 리드': { w1: 3, l2: 0, fm: 3, fmr: 1, fmd: 1.2, cut: 12000, fenv: 0, ar: 0.25, lt: 1, lr: 5, ld: 0.05, vol: 0.7, lvl: -2.9 },
  'FM 브라이트 리드': { w1: 3, l2: 0, fm: 5, fmr: 2, fmd: 0.4, cut: 14000, fenv: 0, ar: 0.2, vol: 0.7, lvl: -4.1 },
  '오카리나 리드': { w1: 10, w2: 3, o2: 1, l2: 0.2, noise: 0.03, cut: 6000, fenv: 0, aa: 0.05, lt: 1, lr: 5, ld: 0.05, ar: 0.25, vol: 0.7, lvl: -1.8 },
  '보컬 리드 (아)': { w1: 8, w2: 0, l2: 0.15, cut: 6000, fenv: 0, aa: 0.04, lt: 1, lr: 5.5, ld: 0.08, glide: 0.06, ar: 0.3, vol: 0.7, lvl: -3.0 },
  '시티팝 리드': { w1: 4, w2: 3, o2: 1, l2: 0.3, uni: 2, det: 8, cut: 4000, res: 1, fenv: 1, fd: 0.4, fs: 0.6, lt: 1, lr: 5, ld: 0.04, ar: 0.3, vol: 0.7, lvl: 3.8 },
  '레이브 리드': { w2: 0, s2: 12, l2: 0.5, uni: 5, det: 30, cut: 6000, res: 2, fenv: 1, drv: 0.3, ar: 0.3, vol: 0.7, lvl: -5.2 },
  '스크리머 리드': { w1: 0, w2: 4, f2: 5, l2: 0.6, cut: 3000, res: 8, fenv: 2, fd: 0.2, fs: 0.6, drv: 0.5, ar: 0.15, vol: 0.7, lvl: -4.6 },

  // ---------- pads ----------
  '쥬노 패드': { w1: 4, w2: 0, l2: 0.5, uni: 3, det: 14, spread: 0.9, cut: 2000, res: 1, fenv: 0.6, ...PAD, lt: 1, lr: 0.5, ld: 0.03, vol: 0.7, lvl: -3.3 },
  '글래시 패드': { w1: 3, w2: 0, o2: 1, l2: 0.3, uni: 4, det: 20, cut: 6000, fenv: 0.5, ...PAD, ar: 2.5, vol: 0.7, lvl: -7.4 },
  '보컬 패드 (아)': { w1: 8, w2: 8, f2: 10, l2: 0.6, uni: 3, det: 14, cut: 5000, fenv: 0, ...PAD, lt: 3, lr: 0.3, ld: 0.15, vol: 0.7, lvl: -6.9 },
  '보컬 패드 (우)': { w1: 9, w2: 9, f2: 8, l2: 0.6, uni: 3, det: 12, cut: 4000, fenv: 0, ...PAD, vol: 0.7, lvl: -8.7 },
  '에어 패드': { w1: 2, l2: 0, noise: 0.12, uni: 3, det: 10, cut: 3000, res: 2, fenv: 0.5, ...PAD, aa: 1.5, ar: 3, vol: 0.7, lvl: -4.4 },
  '스윕 패드': { w2: 0, f2: 12, uni: 5, det: 22, cut: 500, res: 4, fenv: 3, fa: 3, fd: 3, fs: 0.3, aa: 1, as: 1, ar: 2.5, lt: 2, lr: 0.12, ld: 0.6, vol: 0.7, lvl: -5.9 },
  '어두운 드론': { w1: 0, w2: 0, o2: -1, l2: 0.7, uni: 4, det: 8, cut: 400, res: 2, fenv: 0.4, aa: 2.5, as: 1, ar: 4, lt: 2, lr: 0.08, ld: 0.3, vol: 0.7, lvl: -4.7 },
  '로파이 패드': { w1: 2, w2: 4, l2: 0.4, uni: 2, det: 25, cut: 1400, res: 0.8, fenv: 0.3, ...PAD, lt: 1, lr: 0.8, ld: 0.12, drv: 0.2, vol: 0.7, lvl: -10.7 },
  '시네마 패드': { w2: 0, f2: 7, uni: 6, det: 18, spread: 1, cut: 1800, res: 1.2, fenv: 1, fa: 2, fd: 2, fs: 0.7, aa: 1.6, as: 1, ar: 3.5, vol: 0.7, lvl: -6.1 },
  '크리스탈 패드': { w1: 3, l2: 0, fm: 1.5, fmr: 3.5, fmd: 2, uni: 3, det: 10, cut: 12000, fenv: 0, ...PAD, ar: 2.5, vol: 0.7, lvl: -7.1 },
  '하모니 패드': { w1: 0, w2: 0, s2: 7, l2: 0.4, uni: 3, det: 12, cut: 2400, fenv: 0.6, ...PAD, vol: 0.7, lvl: -5.9 },
  '퓨처 패드': { w2: 0, uni: 7, det: 30, spread: 1, cut: 3500, res: 1, fenv: 0.5, ...PAD, lt: 3, lr: 2, ld: 0.6, vol: 0.7, lvl: -2.9 },
  '오케스트라 패드': { w1: 7, w2: 0, l2: 0.4, uni: 5, det: 14, cut: 2200, fenv: 0.8, ...PAD, lt: 1, lr: 5, ld: 0.03, vol: 0.7, lvl: -7.0 },
  '버블 패드': { w1: 3, w2: 2, o2: 1, l2: 0.4, uni: 3, det: 12, cut: 4000, fenv: 0.5, ...PAD, lt: 3, lr: 6, ld: 0.5, vol: 0.7, lvl: -5.7 },
  '노스탤지어 패드': { w1: 4, w2: 1, f2: 12, l2: 0.4, uni: 2, det: 18, cut: 1600, res: 1, fenv: 0.5, ...PAD, lt: 1, lr: 0.6, ld: 0.08, vol: 0.7, lvl: -4.8 },

  // ---------- basses ----------
  '무그 베이스': { w1: 0, w2: 1, o2: -1, l2: 0.6, cut: 500, res: 3, fenv: 2.5, fd: 0.25, fs: 0.25, kt: 0.3, as: 0.8, ar: 0.1, vol: 0.7, lvl: -1.2 },
  '소프트 베이스': { w1: 2, w2: 3, o2: -1, l2: 0.5, cut: 1200, fenv: 0.5, as: 0.8, ar: 0.15, vol: 0.7, lvl: -0.1 },
  '고무 베이스': { w1: 3, l2: 0, fm: 1.5, fmr: 1, fmd: 0.15, cut: 3000, fenv: 0, ad: 0.6, as: 0.5, ar: 0.1, vol: 0.7, lvl: 1.5 },
  'FM 베이스': { w1: 3, l2: 0, fm: 4, fmr: 1, fmd: 0.2, cut: 6000, fenv: 0, ad: 0.5, as: 0.4, ar: 0.08, vol: 0.7, lvl: 2.5 },
  '와블 베이스': { w1: 0, w2: 1, o2: -1, l2: 0.6, uni: 2, det: 10, cut: 700, res: 6, fenv: 1, lt: 2, lr: 3, ld: 0.9, drv: 0.4, ar: 0.1, vol: 0.7, lvl: -0.4 },
  '그라임 베이스': { w1: 1, w2: 0, f2: 4, l2: 0.6, cut: 900, res: 5, fenv: 2, fd: 0.15, fs: 0.3, drv: 0.6, ar: 0.08, vol: 0.7, lvl: -2.7 },
  '서브 펄스 베이스': { w1: 4, l2: 0, sub: 0.7, cut: 1400, res: 1, fenv: 1, ar: 0.1, vol: 0.7, lvl: 2.9 },
  '디스코 옥타브 베이스': { w1: 0, w2: 0, o2: 1, l2: 0.35, cut: 1500, res: 2, fenv: 2, fd: 0.15, fs: 0.2, ad: 0.3, as: 0.4, ar: 0.08, vol: 0.7, lvl: 5.2 },
  '퓨처 베이스 서브': { w1: 3, w2: 2, o2: 1, l2: 0.2, cut: 2000, fenv: 0, glide: 0.05, as: 1, ar: 0.12, vol: 0.7, lvl: -2.6 },
  '트랩 808 디스토션': { w1: 3, l1: 1, l2: 0, cut: 3500, fenv: 0, ad: 2, as: 0.8, ar: 0.25, glide: 0.08, drv: 0.5, vol: 0.7, lvl: -3.6 },
  '해피 하드코어 베이스': { w1: 1, w2: 0, l2: 0.5, uni: 2, det: 8, cut: 1600, res: 3, fenv: 1.5, fd: 0.1, fs: 0.3, ar: 0.06, vol: 0.7, lvl: -2.0 },
  '시티팝 베이스': { w1: 4, w2: 3, o2: -1, l2: 0.4, cut: 1100, res: 1.5, fenv: 1.5, fd: 0.2, fs: 0.4, ad: 0.6, as: 0.6, ar: 0.12, vol: 0.7, lvl: 5.6 },
  '리퀴드 베이스': { w1: 3, w2: 0, l2: 0.2, cut: 900, res: 1, fenv: 1, fd: 0.4, fs: 0.6, glide: 0.04, ar: 0.15, vol: 0.7, lvl: -1.7 },
  '애시드 스퀘어': { w1: 1, l2: 0, cut: 450, res: 13, fenv: 3.2, fd: 0.18, fs: 0, kt: 0.2, as: 0.7, ar: 0.06, glide: 0.04, drv: 0.3, vol: 0.7, lvl: -2.9 },
  '할로우 베이스': { w1: 2, w2: 1, o2: -1, l2: 0.3, ft: 2, cut: 700, res: 3, fenv: 1, ar: 0.12, vol: 0.7, lvl: 20.6 },

  // ---------- plucks ----------
  '디지털 플럭': { w1: 3, l2: 0, fm: 4, fmr: 3, fmd: 0.15, cut: 10000, fenv: 0, ...PLUCK, ad: 0.35, vol: 0.7, lvl: -2.5 },
  '퓨처 플럭': { w2: 0, uni: 5, det: 22, cut: 1500, res: 2, ...PLUCK, fenv: 3.2, vol: 0.7, lvl: -0.6 },
  '스퀘어 플럭': { w1: 1, l2: 0, cut: 1800, res: 3, ...PLUCK, vol: 0.7, lvl: -3.4 },
  '마림바 플럭': { w1: 3, w2: 3, o2: 2, l2: 0.3, cut: 9000, fenv: 0, ...PLUCK, ad: 0.3, ar: 0.25, vol: 0.7, lvl: -0.4 },
  '칼림바 플럭': { w1: 3, l2: 0, fm: 1.2, fmr: 5, fmd: 0.08, cut: 12000, fenv: 0, ...PLUCK, ad: 0.9, ar: 0.6, vol: 0.7, lvl: -3.7 },
  '하프 신스': { w1: 2, w2: 0, o2: 1, l2: 0.15, cut: 4000, res: 1, ...PLUCK, ad: 1.4, ar: 1, vol: 0.7, lvl: -3.4 },
  '기타 신스 플럭': { w1: 0, w2: 4, f2: 5, l2: 0.4, cut: 2400, res: 1.5, ...PLUCK, ad: 0.8, vol: 0.7, lvl: -1.7 },
  '스타카토 스트링 신스': { w2: 0, f2: 10, uni: 4, det: 16, cut: 3500, res: 1, fenv: 1, fd: 0.12, fs: 0.1, ad: 0.18, as: 0, ar: 0.12, vol: 0.7, lvl: 1.4 },
  '물방울 플럭': { w1: 3, l2: 0, cut: 6000, res: 6, fenv: 2, fd: 0.06, fs: 0, ad: 0.25, as: 0, ar: 0.25, vol: 0.7, lvl: 1.0 },
  '뮤트 플럭': { w1: 0, l2: 0, cut: 700, res: 2, ...PLUCK, ad: 0.18, ar: 0.1, vol: 0.7, lvl: 4.5 },
  '트로피컬 플럭': { w1: 3, w2: 2, o2: 1, l2: 0.3, fm: 0.8, fmr: 2, fmd: 0.1, cut: 8000, fenv: 0, ...PLUCK, ad: 0.5, vol: 0.7, lvl: -1.9 },
  '로파이 플럭': { w1: 2, w2: 0, l2: 0.3, cut: 1600, res: 1, ...PLUCK, drv: 0.25, lt: 1, lr: 0.7, ld: 0.1, vol: 0.7, lvl: -3.4 },

  // ---------- keys ----------
  'FM 일렉 피아노': { w1: 3, l2: 0, fm: 1.8, fmr: 1, fmd: 0.9, cut: 12000, fenv: 0, ...KEYS, lt: 3, lr: 4.5, ld: 0.1, vol: 0.7, lvl: -5.1 },
  'FM 일렉 피아노 (밝게)': { w1: 3, w2: 3, o2: 4, l2: 0.08, fm: 2.6, fmr: 1, fmd: 0.6, cut: 14000, fenv: 0, ...KEYS, vol: 0.7, lvl: -5.5 },
  '다이노 EP': { w1: 3, l2: 0, fm: 3.5, fmr: 14, fmd: 0.05, cut: 12000, fenv: 0, ...KEYS, lt: 3, lr: 5, ld: 0.18, vol: 0.7, lvl: -6.3 },
  '튠 EP (토인)': { w1: 3, w2: 3, o2: 2, l2: 0.1, fm: 1.2, fmr: 7, fmd: 0.12, cut: 10000, fenv: 0, ...KEYS, vol: 0.7, lvl: -6.1 },
  '드로바 오르간': { w1: 6, l2: 0, cut: 14000, fenv: 0, aa: 0.005, as: 1, ar: 0.05, lt: 3, lr: 6.5, ld: 0.08, vol: 0.7, lvl: -7.9 },
  '재즈 오르간': { w1: 6, w2: 3, o2: 2, l2: 0.25, cut: 9000, fenv: 0, aa: 0.004, as: 1, ar: 0.05, lt: 1, lr: 6.6, ld: 0.05, drv: 0.2, vol: 0.7, lvl: -12.3 },
  '록 오르간': { w1: 6, w2: 6, o2: 1, l2: 0.4, cut: 7000, fenv: 0, aa: 0.004, as: 1, ar: 0.06, lt: 1, lr: 7, ld: 0.06, drv: 0.55, vol: 0.7, lvl: -12.1 },
  '교회 오르간 (신스)': { w1: 6, w2: 3, o2: -1, l2: 0.5, sub: 0.3, cut: 8000, fenv: 0, aa: 0.04, as: 1, ar: 0.4, vol: 0.7, lvl: -10.3 },
  '하프시코드 (신스)': { w1: 5, w2: 0, o2: 1, l2: 0.3, cut: 9000, res: 1, fenv: 1, fd: 0.3, fs: 0, ad: 1.2, as: 0, ar: 0.15, vol: 0.7, lvl: 2.2 },
  '클라비 (신스)': { w1: 4, l2: 0, cut: 2500, res: 4, fenv: 2, fd: 0.12, fs: 0.1, ad: 0.6, as: 0.2, ar: 0.06, vol: 0.7, lvl: 4.6 },
  '토이 피아노': { w1: 3, w2: 3, o2: 3, s2: 4, f2: 0, l2: 0.3, fm: 2, fmr: 4.2, fmd: 0.05, cut: 10000, fenv: 0, aa: 0.001, ad: 0.6, as: 0, ar: 0.4, vol: 0.7, lvl: -3.3 },
  '첼레스타 (신스)': { w1: 3, l2: 0, fm: 1, fmr: 4, fmd: 0.3, cut: 14000, fenv: 0, aa: 0.001, ad: 1.6, as: 0, ar: 1, vol: 0.7, lvl: -4.5 },
  '뮤직박스': { w1: 3, w2: 3, o2: 2, s2: 7, f2: 0, l2: 0.15, fm: 0.8, fmr: 5, fmd: 0.06, cut: 12000, fenv: 0, aa: 0.001, ad: 2, as: 0, ar: 1.5, vol: 0.7, lvl: -5.3 },
  '하모니움': { w1: 4, w2: 0, o2: 0, f2: 4, l2: 0.4, cut: 3000, res: 0.8, fenv: 0, aa: 0.08, as: 1, ar: 0.2, lt: 3, lr: 5, ld: 0.05, vol: 0.7, lvl: -4.3 },
  '아코디언 (신스)': { w1: 4, w2: 4, f2: 14, l2: 0.6, cut: 4000, fenv: 0, aa: 0.04, as: 1, ar: 0.12, lt: 3, lr: 6, ld: 0.08, vol: 0.7, lvl: -4.2 },
  '와이드 신스 피아노': { w1: 2, w2: 0, l2: 0.3, uni: 3, det: 10, cut: 5000, fenv: 1.5, fd: 0.6, fs: 0.2, ...KEYS, vol: 0.7, lvl: -2.0 },
  '하우스 오르간 스탭': { w1: 6, l2: 0, cut: 6000, fenv: 0.5, aa: 0.002, ad: 0.25, as: 0, ar: 0.12, vol: 0.7, lvl: 1.2 },
  '부드러운 일렉 그랜드': { w1: 2, w2: 3, o2: 1, l2: 0.35, fm: 0.6, fmr: 2, fmd: 0.4, cut: 7000, fenv: 0.8, fd: 0.8, fs: 0.3, ...KEYS, vol: 0.7, lvl: -5.8 },

  // ---------- arps & sequences ----------
  '아르프 쏘': { w2: 0, uni: 2, det: 10, cut: 2500, res: 3, fenv: 2.5, fd: 0.12, fs: 0.1, ad: 0.2, as: 0.1, ar: 0.08, vol: 0.7, lvl: -0.2 },
  '아르프 사인': { w1: 3, l2: 0, cut: 9000, fenv: 0, aa: 0.001, ad: 0.25, as: 0, ar: 0.1, vol: 0.7, lvl: -2.4 },
  '트랜스 게이트': { w2: 0, uni: 5, det: 20, cut: 4000, res: 2, fenv: 1, lt: 3, lr: 8, ld: 0.9, ar: 0.1, vol: 0.7, lvl: -3.5 },
  '시퀀스 베이스': { w1: 1, w2: 0, o2: -1, l2: 0.5, cut: 700, res: 4, fenv: 2.8, fd: 0.1, fs: 0.05, ad: 0.18, as: 0, ar: 0.05, vol: 0.7, lvl: 7.9 },
  '베를린 시퀀스': { w1: 0, w2: 1, l2: 0.4, cut: 900, res: 7, fenv: 3, fd: 0.15, fs: 0, ad: 0.25, as: 0, ar: 0.08, lt: 2, lr: 0.1, ld: 0.5, vol: 0.7, lvl: -4.8 },
  '칩튠 아르프': { w1: 4, l2: 0, cut: 18000, fenv: 0, aa: 0.001, ad: 0.1, as: 0.4, ar: 0.03, vol: 0.7, lvl: 4.8 },

  // ---------- brass & strings ----------
  '신스 브라스 (오버하임)': { w1: 0, w2: 0, f2: 9, l2: 0.6, uni: 2, det: 12, cut: 1500, res: 1, fenv: 2.2, fa: 0.08, fd: 0.5, fs: 0.5, aa: 0.05, as: 0.9, ar: 0.3, vol: 0.7, lvl: -5.6 },
  '브라스 스탭 (신스)': { w1: 7, w2: 0, l2: 0.4, uni: 3, det: 10, cut: 2500, fenv: 2, fa: 0.02, fd: 0.2, fs: 0.2, aa: 0.01, ad: 0.3, as: 0.2, ar: 0.12, vol: 0.7, lvl: 2.6 },
  '소프트 호른': { w1: 7, l2: 0, cut: 1400, res: 0.7, fenv: 1, fa: 0.12, fd: 0.6, fs: 0.6, aa: 0.08, as: 1, ar: 0.35, vol: 0.7, lvl: -8.1 },
  '파워 브라스': { w1: 7, w2: 0, f2: 6, l2: 0.6, uni: 3, det: 14, cut: 2600, res: 1, fenv: 1.8, fa: 0.05, fs: 0.6, aa: 0.03, ar: 0.3, drv: 0.25, vol: 0.7, lvl: -9.6 },
  '솔리나 스트링': { w1: 0, w2: 0, f2: 14, l2: 0.6, uni: 5, det: 22, spread: 1, cut: 3500, fenv: 0, aa: 0.4, as: 1, ar: 1.2, lt: 3, lr: 6, ld: 0.12, vol: 0.7, lvl: -4.2 },
  '신스 스트링 (밝게)': { w2: 0, f2: 10, uni: 6, det: 18, spread: 1, cut: 6000, res: 0.8, fenv: 0.5, aa: 0.25, as: 1, ar: 1, vol: 0.7, lvl: -3.9 },
  '첼로 신스': { w1: 0, l2: 0, cut: 1500, res: 1.5, fenv: 0.8, aa: 0.15, as: 1, ar: 0.5, lt: 1, lr: 5.3, ld: 0.05, o1: -1, vol: 0.7, lvl: -6.6 },
  '피치카토 신스': { w1: 2, w2: 0, l2: 0.3, cut: 2000, res: 1, fenv: 2, fd: 0.08, fs: 0, ad: 0.25, as: 0, ar: 0.15, vol: 0.7, lvl: 0.4 },

  // ---------- bells & mallets ----------
  'FM 벨': { w1: 3, l2: 0, fm: 2.5, fmr: 3.5, fmd: 1.5, cut: 14000, fenv: 0, aa: 0.001, ad: 2.5, as: 0, ar: 2, vol: 0.7, lvl: -8.2 },
  '튜블러 벨 (신스)': { w1: 3, l2: 0, fm: 3, fmr: 2.76, fmd: 2.5, cut: 12000, fenv: 0, aa: 0.001, ad: 3.5, as: 0, ar: 3, vol: 0.7, lvl: -9.2 },
  '글로켄 (신스)': { w1: 3, w2: 3, o2: 2, s2: 7, l2: 0.15, cut: 14000, fenv: 0, aa: 0.001, ad: 1.2, as: 0, ar: 1, vol: 0.7, lvl: -3.6 },
  '비브라폰 (신스)': { w1: 3, w2: 3, o2: 2, l2: 0.1, fm: 0.5, fmr: 4, fmd: 0.4, cut: 9000, fenv: 0, aa: 0.001, ad: 2.5, as: 0, ar: 1.5, lt: 3, lr: 5, ld: 0.35, vol: 0.7, lvl: -4.1 },
  '스틸 드럼 (신스)': { w1: 3, l2: 0, fm: 1.5, fmr: 2.4, fmd: 0.25, cut: 9000, fenv: 0, aa: 0.002, ad: 0.9, as: 0, ar: 0.6, vol: 0.7, lvl: -3.1 },
  '크리스탈 벨': { w1: 3, w2: 3, o2: 3, l2: 0.2, fm: 1.8, fmr: 7, fmd: 0.8, cut: 16000, fenv: 0, aa: 0.001, ad: 2, as: 0, ar: 2.5, vol: 0.7, lvl: -7.4 },
  '실로폰 (신스)': { w1: 3, w2: 2, o2: 2, l2: 0.25, cut: 12000, fenv: 0, aa: 0.001, ad: 0.25, as: 0, ar: 0.2, vol: 0.7, lvl: 2.0 },
  '팝 벨 (8비트)': { w1: 5, w2: 3, o2: 1, l2: 0.3, cut: 12000, fenv: 0, aa: 0.001, ad: 0.6, as: 0, ar: 0.3, vol: 0.7, lvl: 2.9 },

  // ---------- voices ----------
  '신스 콰이어 (아)': { w1: 8, w2: 8, f2: 12, l2: 0.6, uni: 5, det: 16, spread: 1, cut: 6000, fenv: 0, aa: 0.25, as: 1, ar: 1, lt: 1, lr: 5, ld: 0.04, vol: 0.7, lvl: -8.0 },
  '신스 콰이어 (우)': { w1: 9, w2: 9, f2: 10, l2: 0.6, uni: 5, det: 14, spread: 1, cut: 4000, fenv: 0, aa: 0.3, as: 1, ar: 1.2, vol: 0.7, lvl: -8.6 },
  '보코더 리드': { w1: 8, w2: 0, l2: 0.3, uni: 2, det: 8, cut: 5000, res: 2, fenv: 0.5, ar: 0.2, lt: 2, lr: 4, ld: 0.2, vol: 0.7, lvl: -5.3 },
  '토크박스 신스': { w1: 0, w2: 8, l2: 0.6, ft: 2, cut: 1200, res: 5, fenv: 2, fd: 0.25, fs: 0.4, ar: 0.15, vol: 0.7, lvl: 4.0 },

  // ---------- FX ----------
  '다운리프터': { w1: 0, l2: 0, noise: 0.4, cut: 9000, res: 4, fenv: -4, fd: 2, fs: 0, aa: 0.01, ad: 2, as: 0, ar: 0.5, vol: 0.7, lvl: 0.6 },
  '임팩트 붐': { w1: 3, l1: 1, l2: 0, noise: 0.3, cut: 600, fenv: 2, fd: 0.3, fs: 0, aa: 0.001, ad: 2.5, as: 0, ar: 1, o1: -2, vol: 0.7, lvl: -1.4 },
  '글리치 블립': { w1: 1, l2: 0, cut: 6000, res: 10, fenv: 3, fd: 0.03, fs: 0, ad: 0.06, as: 0, ar: 0.03, vol: 0.7, lvl: 4.5 },
  '바람 노이즈': { l1: 0, l2: 0, noise: 1, ft: 2, cut: 1500, res: 3, fenv: 0, aa: 1, as: 1, ar: 2, lt: 2, lr: 0.2, ld: 0.6, vol: 0.7, lvl: 7.8 },
  '스페이스 스윕': { w1: 0, w2: 0, s2: 5, l2: 0.6, uni: 3, det: 30, cut: 300, res: 8, fenv: 4, fa: 3, fd: 3, fs: 0.2, aa: 0.5, as: 1, ar: 3, vol: 0.7, lvl: -4.5 },
  '알람 FX': { w1: 1, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 8, ld: 0.9, ar: 0.1, vol: 0.7, lvl: -8.4 },
  '레트로 게임 코인': { w1: 1, w2: 1, s2: 5, l2: 0.6, cut: 18000, fenv: 0, aa: 0.001, ad: 0.25, as: 0, ar: 0.1, glide: 0.03, vol: 0.7, lvl: 0.6 },
};

// categories for the preset browser (FL Studio's FLEX browses its presets the same way)
export const SYNTH_CATEGORIES = {
  '리드': ['기본 쏘', '슈퍼쏘 리드', '칩튠 리드', '레트로 리드', '사인 리드', '스퀘어 리드', '하이퍼 슈퍼쏘', '트랜스 리드', '퓨처 리드', '싱크 리드', '펄스 리드', '가는 펄스 리드', '부드러운 사인 리드', '휘슬 리드', '모노 리드 (아날로그)', '그라울 리드', '디스토션 리드', '칩튠 펄스', '칩튠 삼각', 'FM 리드', 'FM 브라이트 리드', '오카리나 리드', '보컬 리드 (아)', '시티팝 리드', '레이브 리드', '스크리머 리드'],
  '패드': ['따뜻한 패드', '스트링 패드', '앰비언트 패드', '다크 패드', '쥬노 패드', '글래시 패드', '보컬 패드 (아)', '보컬 패드 (우)', '에어 패드', '스윕 패드', '어두운 드론', '로파이 패드', '시네마 패드', '크리스탈 패드', '하모니 패드', '퓨처 패드', '오케스트라 패드', '버블 패드', '노스탤지어 패드'],
  '베이스': ['808 서브', '리스 베이스', '신스 베이스', '애시드 베이스', '딥 하우스 베이스', '펀치 베이스', '무그 베이스', '소프트 베이스', '고무 베이스', 'FM 베이스', '와블 베이스', '그라임 베이스', '서브 펄스 베이스', '디스코 옥타브 베이스', '퓨처 베이스 서브', '트랩 808 디스토션', '해피 하드코어 베이스', '시티팝 베이스', '리퀴드 베이스', '애시드 스퀘어', '할로우 베이스', '시퀀스 베이스'],
  '플럭': ['플럭', '하프 플럭', '하우스 스탭', '퓨처 베이스 코드', '디지털 플럭', '퓨처 플럭', '스퀘어 플럭', '마림바 플럭', '칼림바 플럭', '하프 신스', '기타 신스 플럭', '스타카토 스트링 신스', '물방울 플럭', '뮤트 플럭', '트로피컬 플럭', '로파이 플럭'],
  '건반': ['일렉 피아노', '오르간', 'FM 일렉 피아노', 'FM 일렉 피아노 (밝게)', '다이노 EP', '튠 EP (토인)', '드로바 오르간', '재즈 오르간', '록 오르간', '교회 오르간 (신스)', '하프시코드 (신스)', '클라비 (신스)', '토이 피아노', '첼레스타 (신스)', '뮤직박스', '하모니움', '아코디언 (신스)', '와이드 신스 피아노', '하우스 오르간 스탭', '부드러운 일렉 그랜드'],
  '아르프·시퀀스': ['아르프 쏘', '아르프 사인', '트랜스 게이트', '베를린 시퀀스', '칩튠 아르프'],
  '브라스·스트링': ['브라스', '신스 브라스 (오버하임)', '브라스 스탭 (신스)', '소프트 호른', '파워 브라스', '솔리나 스트링', '신스 스트링 (밝게)', '첼로 신스', '피치카토 신스'],
  '벨·말렛': ['벨', '마림바', 'FM 벨', '튜블러 벨 (신스)', '글로켄 (신스)', '비브라폰 (신스)', '스틸 드럼 (신스)', '크리스탈 벨', '실로폰 (신스)', '팝 벨 (8비트)'],
  '보컬': ['신스 콰이어 (아)', '신스 콰이어 (우)', '보코더 리드', '토크박스 신스'],
  'FX': ['라이저 노이즈', '레이저 FX', '사이렌 FX', '다운리프터', '임팩트 붐', '글리치 블립', '바람 노이즈', '스페이스 스윕', '알람 FX', '레트로 게임 코인'],
};
