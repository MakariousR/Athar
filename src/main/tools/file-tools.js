const fs = require('fs');
const path = require('path');

/**
 * Best-effort realpath resolution for a path that may not exist yet (e.g. a
 * write_file target). Walks up to the nearest existing ancestor, resolves
 * *that* through the filesystem (following any symlinks), then re-attaches
 * the non-existent tail. Returns null only if even the root can't be
 * resolved (should not happen in practice).
 */
function resolveRealPathBestEffort(fullPath) {
  let current = fullPath;
  let remainder = '';
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break; // hit filesystem root without finding anything real
    remainder = remainder ? path.join(path.basename(current), remainder) : path.basename(current);
    current = parent;
  }
  try {
    const real = fs.realpathSync(current);
    return remainder ? path.join(real, remainder) : real;
  } catch {
    return null;
  }
}

/**
 * Checks whether targetPath is inside workspaceDir (prevents path traversal outside workspace).
 * Performed in two passes: a fast syntactic check (catches plain ../ traversal),
 * then a symlink-aware check that resolves real filesystem paths on both sides
 * so a symlink planted inside the workspace can't be used to sneak a read,
 * write, or delete outside of it.
 */
function isPathInWorkspace(targetPath, workspaceDir) {
  if (!workspaceDir) return null;
  const rel = (targetPath === undefined || targetPath === null || targetPath === '') ? '.' : targetPath;

  // If the model provided an absolute path, strip it down to a relative one or reject it
  const resolvedWorkspace = path.resolve(workspaceDir);
  let resolvedTarget;

  if (path.isAbsolute(rel)) {
    // Accept absolute paths only if they're already inside the workspace
    resolvedTarget = path.resolve(rel);
  } else {
    resolvedTarget = path.resolve(resolvedWorkspace, rel);
  }

  // Pass 1: syntactic containment check (string/segment based)
  const relative = path.relative(resolvedWorkspace, resolvedTarget);
  const syntacticallyInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (!syntacticallyInside) return null;

  // Pass 2: symlink-aware containment check against real filesystem paths
  let realWorkspace;
  try { realWorkspace = fs.realpathSync(resolvedWorkspace); } catch { realWorkspace = resolvedWorkspace; }

  const realTarget = resolveRealPathBestEffort(resolvedTarget);
  if (realTarget) {
    const realRelative = path.relative(realWorkspace, realTarget);
    const reallyInside = realRelative === '' || (!realRelative.startsWith('..') && !path.isAbsolute(realRelative));
    if (!reallyInside) return null;
  }

  return resolvedTarget; // Returns resolved absolute path if valid inside workspace
}


// Max characters ONE read_file call may return. Ollama silently truncates
// anything past num_ctx, and a model that only saw half a file will happily
// "rewrite" it and drop the other half — so large files come back in parts,
// with an explicit hint on how to read the next part. Set from ollama-client
// (derived from num_ctx) via setReadBudget.
let readBudget = 16000;
const MAX_LINE_CHARS = 4000;

function setReadBudget(chars) {
  if (Number.isFinite(chars) && chars >= 2000) readBudget = Math.floor(chars);
}

function toLineNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Reads part of a text file inside the workspace, never more than the read
 * budget. Returns structured data so callers can track which lines the model
 * has actually seen:
 *   { error } | { fullPath, text, startLine, endLine, totalLines, complete }
 * `complete` is true only when every character of lines startLine..endLine
 * was returned (no line had to be clipped).
 */
function readFileSlice(workspaceDir, relPath, { startLine = null, endLine = null } = {}) {
  if (!workspaceDir) return { error: 'ERROR: No workspace folder selected. Please select a workspace directory first.' };
  const fullPath = isPathInWorkspace(relPath, workspaceDir);
  if (!fullPath) return { error: `ERROR: Access denied. Path "${relPath}" is outside the active workspace directory.` };

  try {
    if (!fs.existsSync(fullPath)) return { error: `ERROR: File not found: "${relPath}"` };
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) return { error: `ERROR: "${relPath}" is a directory, not a file. Use list_directory to view folders.` };
    if (stat.size > 20 * 1024 * 1024) return { error: `ERROR: File "${relPath}" is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB) to read.` };

    const buf = fs.readFileSync(fullPath);
    if (buf.subarray(0, 8000).includes(0)) return { error: `ERROR: "${relPath}" is a binary file, not text.` };

    const lines = buf.toString('utf8').split(/\r?\n/);
    const totalLines = lines.length;

    let start = toLineNumber(startLine) ?? 1;
    let end = toLineNumber(endLine) ?? totalLines;
    if (end < start) [start, end] = [end, start];
    start = Math.max(1, start);
    if (start > totalLines) {
      return { error: `ERROR: start_line ${start} is past the end of "${relPath}" (${totalLines} lines).` };
    }
    end = Math.min(end, totalLines);

    const out = [];
    let room = readBudget;
    let last = start - 1;
    let clipped = false;
    for (let n = start; n <= end; n++) {
      let line = lines[n - 1];
      if (line.length > MAX_LINE_CHARS) {
        line = `${line.slice(0, MAX_LINE_CHARS)} …[line ${n} truncated, ${line.length} chars total]`;
        clipped = true;
      }
      if (line.length + 1 > room && out.length > 0) break;
      out.push(line);
      room -= line.length + 1;
      last = n;
    }

    return { fullPath, text: out.join('\n'), startLine: start, endLine: last, totalLines, complete: !clipped };
  } catch (err) {
    return { error: `ERROR: Failed to read file "${relPath}": ${err.message}` };
  }
}

/** Formats a readFileSlice result for the model, including how to continue. */
function formatFileSlice(relPath, slice) {
  if (slice.error) return slice.error;
  const whole = slice.startLine === 1 && slice.endLine === slice.totalLines;
  const header = whole
    ? `File content of "${relPath}" (all ${slice.totalLines} lines):`
    : `File content of "${relPath}", lines ${slice.startLine}-${slice.endLine} of ${slice.totalLines}:`;

  let footer = '';
  if (slice.endLine < slice.totalLines) {
    footer = `\n\n[File continues. To read more call read_file with rel_path="${relPath}", start_line=${slice.endLine + 1}. ` +
      `To change this file use edit_file on the part you need; do not rewrite it with write_file unless you have read all of it.]`;
  } else if (!whole) {
    footer = `\n\n[End of file.]`;
  }
  return `${header}\n\n${slice.text}${footer}`;
}

/**
 * Reads text content of a file within the workspace (capped; see readFileSlice).
 */
async function readFileTool(workspaceDir, relPath, options = {}) {
  return formatFileSlice(relPath, readFileSlice(workspaceDir, relPath, options));
}

/**
 * Lists contents of a directory within the workspace.
 */
async function listDirectoryTool(workspaceDir, relPath = '.') {
  if (!workspaceDir) return 'ERROR: No workspace folder selected. Please select a workspace directory first.';
  const fullPath = isPathInWorkspace(relPath, workspaceDir);
  if (!fullPath) return `ERROR: Access denied. Path "${relPath}" is outside the active workspace directory.`;

  try {
    if (!fs.existsSync(fullPath)) return `ERROR: Directory not found: "${relPath}"`;
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) return `ERROR: "${relPath}" is a file, not a directory. Use read_file to view file content.`;

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries.map((entry) => {
      if (entry.isDirectory()) return `[DIR]  ${entry.name}/`;
      let sizeStr = '';
      try {
        const itemStat = fs.statSync(path.join(fullPath, entry.name));
        sizeStr = ` (${(itemStat.size / 1024).toFixed(1)} KB)`;
      } catch {}
      return `[FILE] ${entry.name}${sizeStr}`;
    });

    return `Directory listing for "${relPath || '.'}" (${entries.length} items):\n${items.join('\n')}`;
  } catch (err) {
    return `ERROR: Failed to list directory "${relPath}": ${err.message}`;
  }
}

/**
 * Searches for files by filename or text content inside the workspace directory.
 */
async function searchFilesTool(workspaceDir, query) {
  if (!workspaceDir) return 'ERROR: No workspace folder selected. Please select a workspace directory first.';
  if (!query || typeof query !== 'string') return 'ERROR: Search query must be a non-empty string.';

  const results = [];
  const maxResults = 25;
  const lowerQuery = query.toLowerCase();

  const ignoreDirs = new Set(['node_modules', '.git', '.hg', 'dist', 'build', '.next', '.cache', 'coverage']);

  function walk(dir, currentRel) {
    if (results.length >= maxResults) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      // Never follow symlinks: a symlink planted inside the workspace could
      // otherwise be used to read or list content from outside it.
      if (entry.isSymbolicLink()) continue;

      const relPath = path.join(currentRel, entry.name);
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        // Match by filename
        if (entry.name.toLowerCase().includes(lowerQuery) || relPath.toLowerCase().includes(lowerQuery)) {
          results.push(`[FILENAME MATCH] ${relPath}`);
          continue;
        }

        // Match by content for text files < 500KB
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size < 500 * 1024) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.toLowerCase().includes(lowerQuery)) {
              results.push(`[CONTENT MATCH] ${relPath}`);
            }
          }
        } catch {}
      }
    }
  }

  walk(workspaceDir, '');

  if (results.length === 0) return `No files found matching query "${query}" in workspace.`;
  return `Search results for "${query}" (showing up to ${maxResults}):\n${results.join('\n')}`;
}

module.exports = {
  isPathInWorkspace,
  setReadBudget,
  readFileSlice,
  formatFileSlice,
  readFileTool,
  listDirectoryTool,
  searchFilesTool
};