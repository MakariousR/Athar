const fs = require('fs');

/**
 * Write via temp file + rename so a crash or power loss mid-write can't leave
 * a half-written (unparseable) store behind — the old file stays intact until
 * the new one is completely on disk.
 */
function atomicWrite(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, typeof data === 'string' ? 'utf-8' : undefined);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    // Last resort (e.g. Windows refusing the rename while antivirus holds the
    // target open): a direct write is still better than losing the data.
    fs.writeFileSync(filePath, data, typeof data === 'string' ? 'utf-8' : undefined);
  }
}

module.exports = { atomicWrite };
