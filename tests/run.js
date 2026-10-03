// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Runs every tests/*.test.js file in its own Node process.
 *   npm test            → offline tests only
 *   npm run test:live   → also tests that need the internet (*.live.test.js)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const live = process.argv.includes('--live');
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => live || !f.endsWith('.live.test.js'))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n${file}`);
  // ELECTRON_RUN_AS_NODE may be set by editors; tests run in plain Node either way.
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
