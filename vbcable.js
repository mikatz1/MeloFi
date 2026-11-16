'use strict';
// VB-CABLE (VB-Audio's virtual audio cable) for 가상 마이크로 내보내기 (renderer/js/vmic.js):
// download the official driver pack from vb-audio.com when the user asks, install it, and set the
// cable's internal latency, all behind one Windows administrator prompt (UAC).
//
// Terms: the licence in the pack (readme.txt) allows copying the package AS IS but not integrating
// it "in another software installation procedure without Author agreement"; the website's
// licensing page is looser. So MeloFi does not ship it and does not install it silently: at the
// user's click it fetches the pack from vb-audio.com and opens VB-CABLE's own setup window, where
// the user installs it. The app shows "www.vb-cable.com" and "VB-CABLE is a donationware, all
// participations are welcome." (A silent install would need VB-Audio's agreement first.)
//
// The latency setting lives in HKLM\SOFTWARE\VB-Audio\Cable (VBAudioCableWDM_Latency, samples;
// VBAudioCableWDM_SR) and is read when the driver starts, so the device is restarted after a change.
// That key is not documented; if a VB-CABLE version moves it, this is the place to fix.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { t } = require('./i18n-main.js');

const PACK_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack46.zip';
const KEY = 'HKLM\\SOFTWARE\\VB-Audio\\Cable';
const SIGNER = /BUREL VINCENT/i; // VB-Audio's code signing certificate
const LATENCIES = [512, 1024, 2048, 3072, 4096, 7168];
const RECOMMENDED = 1024;

const run = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 120000, ...opts }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout || ''), err: String(stderr || '') }));
});
const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
const fail = (code, message) => Object.assign(new Error(message), { code });

async function status() {
  if (process.platform !== 'win32') return { installed: false, supported: false };
  const r = await run('reg.exe', ['query', KEY]);
  const num = (name) => { const m = r.out.match(new RegExp(`${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'i')); return m ? parseInt(m[1], 16) : null; };
  return { supported: true, installed: r.code === 0, latency: num('VBAudioCableWDM_Latency'), sampleRate: num('VBAudioCableWDM_SR'), recommended: RECOMMENDED };
}

// the folder the pack is unpacked to (userData/vbcable/pack)
async function fetchPack(dir, onState) {
  await fsp.mkdir(dir, { recursive: true });
  const zip = path.join(dir, 'VBCABLE_Driver_Pack.zip');
  onState?.(t('VB-CABLE 받는 중'));
  let res;
  try { res = await fetch(PACK_URL, { signal: AbortSignal.timeout(60000) }); } catch { throw fail('offline', t('VB-Audio 사이트에 연결하지 못했습니다.')); }
  if (!res.ok) throw fail('download', t('VB-CABLE을 받지 못했습니다 ({status})', { status: res.status }));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200000 || buf.length > 20e6) throw fail('download', t('받은 파일이 VB-CABLE 패키지가 아닙니다.'));
  await fsp.writeFile(zip, buf);
  const out = path.join(dir, 'pack');
  await fsp.rm(out, { recursive: true, force: true });
  const x = await ps(`Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`);
  if (x.code) throw fail('unzip', t('패키지의 압축을 풀지 못했습니다.'));
  // (the pack has no separate ARM64 setup: the x64 one carries the ARM driver too)
  const exe = path.join(out, process.arch === 'ia32' ? 'VBCABLE_Setup.exe' : 'VBCABLE_Setup_x64.exe');
  if (!fs.existsSync(exe)) throw fail('unzip', t('패키지에 설치 프로그램이 없습니다.'));
  // only a setup signed by VB-Audio is run with administrator rights
  const sig = await ps(`$s = Get-AuthenticodeSignature -LiteralPath '${exe.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`);
  const [state, subject] = sig.out.trim().split('|');
  if (state !== 'Valid' || !SIGNER.test(subject || '')) throw fail('signature', t('설치 프로그램의 서명을 확인하지 못해 실행하지 않았습니다.'));
  return exe;
}

// One elevated PowerShell run: install (optional), latency + sample rate, restart the cable device.
// The script writes its result to a JSON file next to it; UAC declined = 'cancelled'.
async function elevated({ setup = null, latency = RECOMMENDED, dir }) {
  if (!LATENCIES.includes(latency)) throw fail('bad_latency', 'latency');
  await fsp.mkdir(dir, { recursive: true });
  const result = path.join(dir, 'result.json');
  const script = path.join(dir, 'apply.ps1');
  await fsp.rm(result, { force: true });
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  await fsp.writeFile(script, [
    "$ErrorActionPreference = 'Stop'",
    '$r = @{ installed = $false; latency = $null; restart = $null; error = $null }',
    'try {',
    // VB-CABLE's own setup window, as the user would open it; the user presses its Install button
    setup ? `  $p = Start-Process -FilePath ${q(setup)} -Wait -PassThru; $r.setupExit = $p.ExitCode; $r.installed = Test-Path 'HKLM:\\SOFTWARE\\VB-Audio\\Cable'` : '',
    setup ? `  if (-not $r.installed) { $r.error = 'not installed'; $r | ConvertTo-Json | Set-Content -LiteralPath ${q(result)} -Encoding UTF8; exit }` : '',
    `  New-Item -Path 'HKLM:\\SOFTWARE\\VB-Audio\\Cable' -Force | Out-Null`,
    `  Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\VB-Audio\\Cable' -Name 'VBAudioCableWDM_Latency' -Value ${latency} -Type DWord`,
    "  Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\VB-Audio\\Cable' -Name 'VBAudioCableWDM_SR' -Value 48000 -Type DWord",
    `  $r.latency = ${latency}`,
    "  $d = Get-PnpDevice -Class MEDIA -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like 'VB-Audio Virtual Cable*' } | Select-Object -First 1",
    '  if ($d) { $o = pnputil /restart-device "$($d.InstanceId)" 2>&1 | Out-String; $r.restart = $(if ($LASTEXITCODE -eq 0) { "ok" } elseif ($o -match "reboot|restart|다시 시작") { "reboot" } else { "failed: $o" }) } else { $r.restart = "reboot" }',
    '} catch { $r.error = $_.Exception.Message }',
    `$r | ConvertTo-Json | Set-Content -LiteralPath ${q(result)} -Encoding UTF8`,
  ].filter(Boolean).join('\r\n'), 'utf8');
  const go = await ps(`try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${q(script)}; 'ok' } catch { 'declined' }`);
  if (go.out.includes('declined') || !fs.existsSync(result)) throw fail('cancelled', t('관리자 권한 요청이 취소되었습니다.'));
  const r = JSON.parse((await fsp.readFile(result, 'utf8')).replace(/^\uFEFF/, ''));
  if (r.error) throw fail('apply', r.error);
  return r;
}

function register(ipcMain, { app }) {
  const dir = () => path.join(app.getPath('userData'), 'vbcable');
  const ops = {
    status: () => status(),
    // download, install and tune in one go
    install: async ({ latency } = {}, send) => {
      const setup = await fetchPack(dir(), send);
      send?.(t('VB-CABLE 설치 창에서 Install Driver를 눌러 주십시오 (관리자 권한 확인 창이 먼저 뜹니다)'));
      let r;
      try { r = await elevated({ setup, latency: latency || RECOMMENDED, dir: dir() }); } catch (e) {
        if (e.message === 'not installed') throw fail('not_installed', t('VB-CABLE이 설치되지 않았습니다. 설치 창에서 Install Driver를 눌렀는지 확인해 주십시오.'));
        throw e;
      }
      return { ...r, ...(await status()) };
    },
    // only the latency (and 48 kHz)
    tune: async ({ latency } = {}) => ({ ...(await elevated({ latency: latency || RECOMMENDED, dir: dir() })), ...(await status()) }),
    openPanel: async () => {
      const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VB', 'CABLE', 'VBCABLE_ControlPanel.exe');
      if (!fs.existsSync(exe)) throw fail('missing', t('VB-CABLE 제어판을 찾지 못했습니다.'));
      // its settings are saved only with administrator rights
      await ps(`try { Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs } catch { }`);
      return true;
    },
  };
  ipcMain.handle('vbcable', async (e, op, payload) => {
    if (!ops[op]) return { ok: false, error: 'bad_op' };
    const send = (msg) => { try { e.sender.send('vbcable:state', msg); } catch { /* window gone */ } };
    try { return { ok: true, data: await ops[op](payload || {}, send) }; } catch (err) { return { ok: false, error: err.code || 'error', message: err.message }; }
  });
}

module.exports = { register, status, LATENCIES, RECOMMENDED, PACK_URL, _test: { elevated, fetchPack } };
