const { execFile } = require('child_process');
const fs = require('fs');

// A repository's own .git/config can make even "read-only" git commands run
// programs (core.fsmonitor on status, external diff drivers / textconv on
// diff). The project folder may come from anywhere, so switch those off.
const SAFE_GIT_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'diff.external='];
const MAX_GIT_OUTPUT_CHARS = 16000;

/**
 * Checks if Git executable is available in PATH.
 */
function isGitInstalled() {
  return new Promise((resolve) => {
    execFile('git', ['--version'], (err) => {
      resolve(!err);
    });
  });
}

/**
 * Helper to run Git commands safely inside workspaceDir.
 */
async function execGit(workspaceDir, args) {
  if (!workspaceDir) {
    return 'ERROR: No workspace folder selected. Please select a workspace folder first.';
  }

  const gitAvailable = await isGitInstalled();
  if (!gitAvailable) {
    return 'ERROR: Git is not installed or not found on the system PATH. Please install Git to use Git operations.';
  }

  if (!fs.existsSync(workspaceDir)) {
    return `ERROR: Workspace directory "${workspaceDir}" does not exist.`;
  }

  return new Promise((resolve) => {
    execFile('git', [...SAFE_GIT_CONFIG, ...args], { cwd: workspaceDir, maxBuffer: 1024 * 1024 * 5, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const errorMsg = (stderr || stdout || err.message).trim();
        if (errorMsg.includes('not a git repository')) {
          return resolve(`ERROR: The project folder "${workspaceDir}" is not a Git repository.`);
        }
        return resolve(`ERROR: Git command "git ${args.join(' ')}" failed:\n${errorMsg}`);
      }
      let output = (stdout || stderr || 'Command executed successfully with no output.').trim();
      if (output.length > MAX_GIT_OUTPUT_CHARS) {
        output = `${output.slice(0, MAX_GIT_OUTPUT_CHARS)}\n\n[Output truncated — ${output.length} characters in total.]`;
      }
      resolve(output);
    });
  });
}

async function gitStatusTool(workspaceDir) {
  return await execGit(workspaceDir, ['status']);
}

async function gitLogTool(workspaceDir, count = 5) {
  const num = Math.min(Math.max(parseInt(count, 10) || 5, 1), 30);
  return await execGit(workspaceDir, ['log', `-n`, String(num), '--oneline', '--decorate']);
}

async function gitDiffTool(workspaceDir) {
  const diff = await execGit(workspaceDir, ['diff', '--no-ext-diff', '--no-textconv']);
  if (!diff || diff.trim() === '') return 'No uncommitted changes found in working directory.';
  return diff;
}

module.exports = {
  isGitInstalled,
  gitStatusTool,
  gitLogTool,
  gitDiffTool
};