// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Writes THIRD-PARTY-NOTICES.txt: Athar's own license, what it uses without
 * shipping it (Ollama, AI models, Gemini, Claude), and the license of every
 * open-source package shipped inside Athar (production dependencies, plus the
 * copy of marked in src/renderer). Their licenses require these notices to
 * ship with the app.
 * Electron's and Chromium's own licenses are added to the installer by
 * electron-builder (LICENSE.electron.txt, LICENSES.chromium.html).
 *
 * Run: npm run notices   (also runs before every `npm run dist`)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.txt');
const LICENSE_FILE_RE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

function productionPackageDirs() {
  const out = execSync('npm ls --omit=dev --all --parseable', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return [...new Set(out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && path.resolve(l) !== path.resolve(ROOT)))];
}

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => LICENSE_FILE_RE.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null;
}

function licenseName(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ');
  return 'see license text';
}

const entries = new Map();
for (const dir of productionPackageDirs()) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (entries.has(key)) continue;
  entries.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: licenseName(pkg),
    homepage: pkg.homepage || (pkg.repository && (pkg.repository.url || pkg.repository)) || '',
    author: typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name) || null,
    text: licenseText(dir)
  });
}

const MIT_TEXT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

// Packages published without a license file: give the full standard text of
// the license they declare, so every entry stands on its own (Apache-2.0: the
// text another package ships, from the same authors' release).
const apacheText = ([...entries.values()].find((o) => o.license === 'Apache-2.0' && o.text && /Apache License\s+Version 2\.0/.test(o.text)) || {}).text;
for (const e of entries.values()) {
  if (e.license === 'Apache-2.0' && apacheText && !(e.text && /TERMS AND CONDITIONS/.test(e.text))) {
    // No license file, or only a pointer ("See the LICENSE file in the root of this repository")
    e.text = e.text ? `${e.text}\n\n${apacheText}` : apacheText;
  } else if (!e.text && e.license === 'MIT') {
    e.text = MIT_TEXT(e.author || `the ${e.name} authors`);
  }
}

// Bundled directly in the renderer (not an npm dependency)
const marked = fs.readFileSync(path.join(ROOT, 'src/renderer/marked.umd.js'), 'utf8');
const markedVersion = (marked.match(/marked v([\d.]+)/) || [])[1] || '';
entries.set(`marked@${markedVersion}`, {
  name: 'marked',
  version: markedVersion,
  license: 'MIT',
  homepage: 'https://github.com/markedjs/marked',
  text: `MIT License

Copyright (c) 2018-2026, MarkedJS (https://marked.js.org/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`
});

const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
const line = '='.repeat(78);
const body = sorted.map((e) => [
  line,
  `${e.name} ${e.version}  (${e.license})`,
  e.homepage ? String(e.homepage).replace(/^git\+/, '').replace(/\.git$/, '') : null,
  line,
  '',
  e.text || `Licensed under ${e.license}. No license file was included in the package.`,
  ''
].filter((x) => x !== null).join('\n')).join('\n');

const header = `THIRD-PARTY NOTICES — Athar

Athar is Copyright (C) 2026 Makarious Robert and is licensed under the GNU
Affero General Public License, version 3 or later (see LICENSE.txt). Its source
code is at https://github.com/MakariousR/Athar.

INCLUDED IN ATHAR
Athar includes the open-source software listed at the end of this file. Each
component is licensed by its authors under the license shown, which applies to
that component. Electron and Chromium, which Athar runs on, are covered by
LICENSE.electron.txt and LICENSES.chromium.html in the installation folder.

USED BY ATHAR, NOT INCLUDED
These are downloaded or used separately, under their own terms:
- Ollama (https://ollama.com, MIT License): the local AI engine. Athar can
  download Ollama's official installer for you.
- AI models run through Ollama, such as the chat model you choose and bge-m3
  (MIT License), the model used for search by meaning. Each model is
  downloaded from the Ollama library under its own license, shown on its page
  at https://ollama.com/library. You are responsible for following it.
- The model list in Athar (model names, sizes and short descriptions) is built
  from the Ollama library at https://ollama.com/library.
- Gemini models, used with your own API key, are provided by Google under the
  Gemini API terms (https://ai.google.dev/gemini-api/terms).
- Claude Desktop and Claude Code, which can use Athar's memory, are products
  of Anthropic under their own terms.

Components included (${sorted.length}): ${sorted.map((e) => e.name).join(', ')}

`;
fs.writeFileSync(OUT, header + body);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${sorted.length} components` +
  `${sorted.some((e) => !e.text) ? ` (no license file in: ${sorted.filter((e) => !e.text).map((e) => e.name).join(', ')})` : ''}`);
