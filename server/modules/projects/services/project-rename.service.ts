import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getConnection, projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/**
 * Renaming a project in the sidebar renames its directory on disk and migrates
 * everything this app knows about it: the project row, the session rows, and
 * the Claude transcript directory keyed by the old path.
 *
 * It refuses rather than half-moving a project. Anything still using the
 * folder, a git repo with linked worktrees, or an occupied target path aborts
 * the rename before the first byte moves.
 */

type ProcessUsingPath = { pid: string | null; command: string | null };

/** Claude stores transcripts under ~/.claude/projects/<path with / and . as ->. */
function encodeClaudeDir(projectPath: string): string {
  return projectPath.replace(/[/.]/g, '-');
}

/** Every process whose cwd is the folder or something inside it. */
function processesUsing(rawProjectPath: string): ProcessUsingPath[] {
  // lsof reports resolved paths, so /tmp/x never matches a stored /private/tmp/x.
  let projectPath = rawProjectPath;
  try {
    projectPath = fs.realpathSync(rawProjectPath);
  } catch {
    // Missing path is handled by the caller.
  }

  let out = '';
  try {
    out = execFileSync('lsof', ['-a', '-d', 'cwd', '-Fpcn'], { encoding: 'utf8' });
  } catch (error) {
    // lsof exits non-zero when some process is unreadable; use what it printed.
    const stdout = (error as { stdout?: unknown }).stdout;
    out = stdout ? String(stdout) : '';
  }

  const inside = projectPath + path.sep;
  const found: ProcessUsingPath[] = [];
  let pid: string | null = null;
  let command: string | null = null;
  for (const line of out.split('\n')) {
    const value = line.slice(1);
    if (line[0] === 'p') {
      pid = value;
      command = null;
    } else if (line[0] === 'c') {
      command = value;
    } else if (line[0] === 'n' && (value === projectPath || value.startsWith(inside))) {
      found.push({ pid, command });
    }
  }
  return found;
}

/** A repo with extra worktrees, or a worktree itself, must not move. */
function gitWorktreeBlocker(projectPath: string): string | null {
  const gitPath = path.join(projectPath, '.git');
  if (!fs.existsSync(gitPath)) {
    return null;
  }
  if (fs.statSync(gitPath).isFile()) {
    return 'it is a linked git worktree';
  }

  try {
    const out = execFileSync('git', ['-C', projectPath, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    const worktrees = out.split('\n').filter((line) => line.startsWith('worktree ')).length;
    if (worktrees > 1) {
      return `it has ${worktrees - 1} linked git worktree(s)`;
    }
  } catch {
    // Not a usable git repo; nothing to protect.
  }
  return null;
}

function refuse(message: string): never {
  throw new AppError(message, { code: 'PROJECT_RENAME_REFUSED', statusCode: 400 });
}

/** Renames the project's folder to `newDisplayName` and moves every record that points at it. */
export function renameProjectDirectory(projectId: string, newDisplayName: unknown): void {
  const trimmed = typeof newDisplayName === 'string' ? newDisplayName.trim() : '';
  if (!trimmed) {
    refuse('Project name cannot be empty');
  }
  if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    refuse('Project name cannot contain a path separator');
  }

  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    refuse('Project not found');
  }

  const oldPath = row.project_path;
  const newPath = path.join(path.dirname(oldPath), trimmed);
  if (newPath === oldPath) {
    projectsDb.updateCustomProjectNameById(projectId, trimmed);
    return;
  }
  if (!fs.existsSync(oldPath)) {
    refuse(`${oldPath} no longer exists on disk`);
  }
  if (fs.existsSync(newPath)) {
    refuse(`${newPath} already exists`);
  }

  const busy = processesUsing(oldPath);
  if (busy.length > 0) {
    const sample = busy.slice(0, 3).map((p) => `${p.command} (${p.pid})`).join(', ');
    refuse(`${oldPath} is in use by ${busy.length} process(es): ${sample}. Close sessions and terminals in this project first.`);
  }

  const worktreeBlocker = gitWorktreeBlocker(oldPath);
  if (worktreeBlocker) {
    refuse(`Cannot rename ${path.basename(oldPath)}: ${worktreeBlocker}. Move it by hand.`);
  }

  const claudeProjects = path.join(os.homedir(), '.claude', 'projects');
  const claudeOld = path.join(claudeProjects, encodeClaudeDir(oldPath));
  const claudeNew = path.join(claudeProjects, encodeClaudeDir(newPath));
  if (fs.existsSync(claudeOld) && fs.existsSync(claudeNew)) {
    refuse(`Claude already has a transcript directory for ${newPath}`);
  }

  fs.renameSync(oldPath, newPath);
  let claudeMoved = false;
  try {
    if (fs.existsSync(claudeOld)) {
      fs.renameSync(claudeOld, claudeNew);
      claudeMoved = true;
    }
    const db = getConnection();
    db.transaction(() => {
      db.prepare('UPDATE projects SET project_path = ?, custom_project_name = ? WHERE project_id = ?')
        .run(newPath, trimmed, projectId);
      // sessions.project_path is a foreign key with ON UPDATE CASCADE, so the
      // statement above already moved it. Only the transcript path is left,
      // and it must be matched on both values to survive either behaviour.
      db.prepare('UPDATE sessions SET project_path = ?, jsonl_path = REPLACE(jsonl_path, ?, ?) WHERE project_path IN (?, ?)')
        .run(newPath, claudeOld, claudeNew, newPath, oldPath);
    })();
  } catch (error) {
    // Put everything back rather than leave a project split across two paths.
    if (claudeMoved) {
      fs.renameSync(claudeNew, claudeOld);
    }
    fs.renameSync(newPath, oldPath);
    throw error;
  }
}
