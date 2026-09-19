const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

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
 * Rejects values that look like CLI flags (start with "-"). execFile already
 * avoids shell injection since args are passed as an array, not a shell
 * string, but a positional value like a branch name or file path that
 * starts with "-" can still be misread by git itself as an option (e.g. a
 * branch/target value of "--orphan" or "-f"). Apply this to any
 * model-supplied positional argument before it reaches execFile.
 */
function isSafeGitArg(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-');
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
    execFile('git', args, { cwd: workspaceDir, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err) {
        const errorMsg = (stderr || stdout || err.message).trim();
        if (errorMsg.includes('not a git repository')) {
          return resolve(`ERROR: Workspace directory "${workspaceDir}" is not a Git repository. Run "git init" or select a Git project.`);
        }
        return resolve(`ERROR: Git command "git ${args.join(' ')}" failed:\n${errorMsg}`);
      }
      const output = (stdout || stderr || 'Command executed successfully with no output.').trim();
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
  const diff = await execGit(workspaceDir, ['diff']);
  if (!diff || diff.trim() === '') return 'No uncommitted changes found in working directory.';
  return diff;
}

async function gitAddTool(workspaceDir, files = '.') {
  const target = files || '.';
  if (!isSafeGitArg(target)) {
    return `ERROR: Invalid files value "${target}". Values starting with "-" are rejected to prevent them from being read as git flags.`;
  }
  const res = await execGit(workspaceDir, ['add', target]);
  if (res.startsWith('ERROR:')) return res;
  return `SUCCESS: Staged files "${target}" for commit.`;
}

async function gitCommitTool(workspaceDir, message) {
  if (!message || typeof message !== 'string') {
    return 'ERROR: Commit message must be a non-empty string.';
  }
  const res = await execGit(workspaceDir, ['commit', '-m', message]);
  if (res.startsWith('ERROR:')) return res;
  return `SUCCESS: Created commit.\n${res}`;
}

async function gitCheckoutTool(workspaceDir, target) {
  if (!target) return 'ERROR: Target branch or file path required for checkout.';
  if (!isSafeGitArg(target)) {
    return `ERROR: Invalid checkout target "${target}". Values starting with "-" are rejected to prevent them from being read as git flags.`;
  }
  const res = await execGit(workspaceDir, ['checkout', target]);
  if (res.startsWith('ERROR:')) return res;
  return `SUCCESS: Checked out "${target}".\n${res}`;
}

async function gitBranchTool(workspaceDir, name) {
  if (!name) {
    return await execGit(workspaceDir, ['branch', '-a']);
  }
  if (!isSafeGitArg(name)) {
    return `ERROR: Invalid branch name "${name}". Values starting with "-" are rejected to prevent them from being read as git flags.`;
  }
  const res = await execGit(workspaceDir, ['branch', name]);
  if (res.startsWith('ERROR:')) return res;
  return `SUCCESS: Created branch "${name}".`;
}

module.exports = {
  isGitInstalled,
  isSafeGitArg,
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitCheckoutTool,
  gitBranchTool
};