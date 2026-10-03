// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * This computer's memory and graphics card, to show which local models fit.
 *
 * Graphics memory comes from the display drivers' entries in the Windows
 * registry (what Task Manager shows as "Dedicated GPU memory"). Integrated
 * graphics (Intel, basic display) share the computer's memory and don't
 * speed up Ollama, so they don't count.
 */
const os = require('os');
const { execFile } = require('child_process');

const GiB = 1024 ** 3;
const DISPLAY_CLASS = 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*';
const SHARED_MEMORY_GPU = /intel|microsoft basic|remote display|virtual|parsec|citrix|vmware|hyper-v/i;

// One line per adapter: name|qwMemorySize|MemorySize
const QUERY = `Get-ItemProperty '${DISPLAY_CLASS}' -ErrorAction SilentlyContinue | ForEach-Object { ` +
  `$dw = $_.'HardwareInformation.MemorySize'; if ($dw -is [byte[]]) { $dw = [BitConverter]::ToUInt32(($dw + @(0,0,0,0))[0..3], 0) }; ` +
  `'{0}|{1}|{2}' -f $_.DriverDesc, $_.'HardwareInformation.qwMemorySize', $dw }`;

/** "NVIDIA GeForce RTX 4050 Laptop GPU|6439305216|4293918720" lines → graphics cards with their memory. */
function parseAdapters(text) {
  const gpus = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const [name, qw, dw] = line.split('|').map((s) => (s || '').trim());
    if (!name || SHARED_MEMORY_GPU.test(name)) continue;
    // The 64-bit value is exact; the old 32-bit one stops at 4 GB
    const bytes = Number(qw) > 0 ? Number(qw) : Number(dw) > 0 ? Number(dw) : 0;
    if (bytes < 1 * GiB) continue;
    gpus.push({ name, vramGB: Math.round((bytes / GiB) * 10) / 10 });
  }
  return gpus.sort((a, b) => b.vramGB - a.vramGB);
}

function readAdapters() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', QUERY], { timeout: 15000, windowsHide: true },
      (err, stdout) => resolve(err ? [] : parseAdapters(stdout)));
  });
}

let cached = null;

/** { ramGB, gpu: { name, vramGB } | null } — looked up once per app start. */
function getHardware() {
  if (!cached) {
    cached = readAdapters().then((gpus) => ({
      ramGB: Math.round((os.totalmem() / GiB) * 10) / 10,
      gpu: gpus[0] || null
    }));
  }
  return cached;
}

module.exports = { getHardware, parseAdapters };
