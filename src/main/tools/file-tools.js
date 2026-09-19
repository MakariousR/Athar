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


/**
 * Reads text content of a file within the workspace.
 */
async function readFileTool(workspaceDir, relPath) {
  if (!workspaceDir) return 'ERROR: No workspace folder selected. Please select a workspace directory first.';
  const fullPath = isPathInWorkspace(relPath, workspaceDir);
  if (!fullPath) return `ERROR: Access denied. Path "${relPath}" is outside the active workspace directory.`;

  try {
    if (!fs.existsSync(fullPath)) return `ERROR: File not found: "${relPath}"`;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) return `ERROR: "${relPath}" is a directory, not a file. Use list_directory to view folders.`;
    if (stat.size > 2 * 1024 * 1024) return `ERROR: File "${relPath}" is too large (${(stat.size / 1024 / 1024).toFixed(2)} MB). Max supported text read size is 2 MB.`;

    const content = fs.readFileSync(fullPath, 'utf8');
    return `File content of "${relPath}":\n\n${content}`;
  } catch (err) {
    return `ERROR: Failed to read file "${relPath}": ${err.message}`;
  }
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

/**
 * Creates or overwrites a file within the workspace.
 */
async function writeFileTool(workspaceDir, relPath, content) {
  if (!workspaceDir) return 'ERROR: No workspace folder selected. Please select a workspace directory first.';
  const fullPath = isPathInWorkspace(relPath, workspaceDir);
  if (!fullPath) return `ERROR: Access denied. Path "${relPath}" is outside the active workspace directory.`;

  try {
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    fs.writeFileSync(fullPath, content || '', 'utf8');
    return `SUCCESS: File "${relPath}" has been written successfully (${Buffer.byteLength(content || '', 'utf8')} bytes).`;
  } catch (err) {
    return `ERROR: Failed to write file "${relPath}": ${err.message}`;
  }
}

/**
 * Replaces target text in a file within the workspace. By default the
 * target text must match EXACTLY ONCE in the file — this used to silently
 * replace only the first of several matches (via String.replace with a
 * string argument), which could edit the wrong occurrence without any sign
 * of failure. Pass replaceAll=true to intentionally replace every match.
 */
async function editFileTool(workspaceDir, relPath, targetText, replacementText, replaceAll = false) {
  if (!workspaceDir) return 'ERROR: No workspace folder selected. Please select a workspace directory first.';
  if (!targetText || typeof targetText !== 'string') return 'ERROR: target_text must be a non-empty string.';
  const fullPath = isPathInWorkspace(relPath, workspaceDir);
  if (!fullPath) return `ERROR: Access denied. Path "${relPath}" is outside the active workspace directory.`;

  try {
    if (!fs.existsSync(fullPath)) return `ERROR: File not found: "${relPath}"`;
    const existing = fs.readFileSync(fullPath, 'utf8');

    const occurrences = existing.split(targetText).length - 1;
    if (occurrences === 0) {
      return `ERROR: Could not find target text in file "${relPath}". Ensure exact string match including indentation and whitespace.`;
    }
    if (occurrences > 1 && !replaceAll) {
      return `ERROR: target_text appears ${occurrences} times in "${relPath}", so the edit is ambiguous. ` +
        `Either provide a longer, more specific target_text that matches only once, or call edit_file again ` +
        `with replace_all=true to intentionally replace all ${occurrences} occurrences.`;
    }

    const updated = replaceAll
      ? existing.split(targetText).join(replacementText || '')
      : existing.replace(targetText, replacementText || '');

    fs.writeFileSync(fullPath, updated, 'utf8');
    return occurrences > 1
      ? `SUCCESS: File "${relPath}" updated — replaced all ${occurrences} occurrences.`
      : `SUCCESS: File "${relPath}" updated successfully.`;
  } catch (err) {
    return `ERROR: Failed to edit file "${relPath}": ${err.message}`;
  }
}

/**
 * Deletes a file or an empty directory within the workspace. A non-empty
 * directory is refused by default — the caller must explicitly pass
 * recursive=true to permanently delete a folder and everything inside it.
 * (Previously this always did a recursive delete regardless of what the
 * tool's own description promised, so approving "delete_file" on a folder
 * could silently wipe an entire subtree.)
 */
async function deleteFileTool(workspaceDir, relPath, recursive = false) {
  if (!workspaceDir) return 'ERROR: No workspace folder selected. Please select a workspace directory first.';
  const fullPath = isPathInWorkspace(relPath, workspaceDir);
  if (!fullPath) return `ERROR: Access denied. Path "${relPath}" is outside the active workspace directory.`;

  try {
    if (!fs.existsSync(fullPath)) return `ERROR: File or folder not found: "${relPath}"`;
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(fullPath);
      if (entries.length > 0 && !recursive) {
        return `ERROR: "${relPath}" is a non-empty directory (${entries.length} top-level item(s)). ` +
          `This tool only deletes empty folders by default. To permanently delete this folder AND ` +
          `everything inside it, call delete_file again with recursive=true.`;
      }
      fs.rmSync(fullPath, { recursive: true, force: true });
      return entries.length > 0
        ? `SUCCESS: Directory "${relPath}" and its ${entries.length} top-level item(s) were permanently deleted.`
        : `SUCCESS: Empty directory "${relPath}" deleted successfully.`;
    } else {
      fs.unlinkSync(fullPath);
      return `SUCCESS: File "${relPath}" deleted successfully.`;
    }
  } catch (err) {
    return `ERROR: Failed to delete "${relPath}": ${err.message}`;
  }
}

module.exports = {
  isPathInWorkspace,
  readFileTool,
  listDirectoryTool,
  searchFilesTool,
  writeFileTool,
  editFileTool,
  deleteFileTool
};