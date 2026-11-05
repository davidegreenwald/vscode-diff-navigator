/**
 * gitUtils.ts - Pure utility functions for git status processing.
 *
 * These functions have no dependency on the vscode module, making them
 * directly testable with vitest without mocking.
 *
 * Status values are defined here as a regular enum (not const enum) so they
 * exist at runtime for both tsc compilation and vitest execution. The values
 * mirror the Status const enum in git.d.ts exactly, which is itself copied
 * verbatim from the git extension source:
 * https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 * (synced 2026-07-01). A unit test pins these numbers so upstream drift is
 * caught by the suite instead of silently misclassifying files.
 */

export enum GitStatus {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  INDEX_COPIED = 4,
  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
  IGNORED = 8,
  INTENT_TO_ADD = 9,
  INTENT_TO_RENAME = 10,
  TYPE_CHANGED = 11,
  ADDED_BY_US = 12,
  ADDED_BY_THEM = 13,
  DELETED_BY_US = 14,
  DELETED_BY_THEM = 15,
  BOTH_ADDED = 16,
  BOTH_DELETED = 17,
  BOTH_MODIFIED = 18,
}

export type ChangeType = 'M' | 'A' | 'D' | 'R' | 'U';

/**
 * Minimal change shape for pure-function processing (no vscode.Uri dependency).
 */
export interface RawChange {
  uri: { fsPath: string };
  originalUri: { fsPath: string };
  status: number;
}

/**
 * Convert git's numeric status codes to human-readable letters.
 *
 * Maps each git Status to a single-letter code following git conventions:
 * M=Modified, A=Added, D=Deleted, R=Renamed, U=Unmerged (conflict)
 */
export function getChangeType(status: number): ChangeType {
  switch (status) {
    case GitStatus.INDEX_MODIFIED:
      return 'M';
    case GitStatus.INDEX_ADDED:
      return 'A';
    case GitStatus.INDEX_DELETED:
      return 'D';
    case GitStatus.INDEX_RENAMED:
      return 'R';
    case GitStatus.INDEX_COPIED:
      return 'A';
    case GitStatus.MODIFIED:
      return 'M';
    case GitStatus.DELETED:
      return 'D';
    case GitStatus.UNTRACKED:
      return 'A';
    case GitStatus.INTENT_TO_ADD:
      return 'A';
    case GitStatus.INTENT_TO_RENAME:
      return 'R';
    case GitStatus.TYPE_CHANGED:
      return 'M';
    case GitStatus.ADDED_BY_US:
    case GitStatus.ADDED_BY_THEM:
    case GitStatus.DELETED_BY_US:
    case GitStatus.DELETED_BY_THEM:
    case GitStatus.BOTH_ADDED:
    case GitStatus.BOTH_DELETED:
    case GitStatus.BOTH_MODIFIED:
      return 'U';
    default:
      return 'M';
  }
}

/**
 * Check whether a git status code represents an ignored file.
 */
export function isIgnoredStatus(status: number): boolean {
  return status === GitStatus.IGNORED;
}

/**
 * How the openDiff command should present a change.
 *
 * - openCurrent: open the working file directly - either no committed
 *   counterpart exists to diff against (new files), or it is a conflict
 *   where the working file with conflict markers is the actionable view
 * - openOriginalAtHead: the file no longer exists, show the last committed version
 * - diffAgainstHead: show HEAD vs working tree side by side
 */
export type DiffAction = 'openCurrent' | 'openOriginalAtHead' | 'diffAgainstHead';

export function computeDiffAction(status: number): DiffAction {
  switch (status) {
    // New files: no committed counterpart exists to diff against
    case GitStatus.INDEX_ADDED:
    case GitStatus.INDEX_COPIED:
    case GitStatus.UNTRACKED:
    case GitStatus.INTENT_TO_ADD:
      return 'openCurrent';
    // Conflicts also open the working file rather than a HEAD diff: HEAD may
    // not contain the file at all (BOTH_ADDED, ADDED_BY_*) and the conflict
    // markers are what the user needs to act on. BOTH_DELETED is degenerate
    // (no working file either) and surfaces as an open error, which is the
    // honest outcome for a file no side has.
    case GitStatus.ADDED_BY_US:
    case GitStatus.ADDED_BY_THEM:
    case GitStatus.DELETED_BY_US:
    case GitStatus.DELETED_BY_THEM:
    case GitStatus.BOTH_ADDED:
    case GitStatus.BOTH_DELETED:
    case GitStatus.BOTH_MODIFIED:
      return 'openCurrent';
    case GitStatus.INDEX_DELETED:
    case GitStatus.DELETED:
      return 'openOriginalAtHead';
    default:
      return 'diffAgainstHead';
  }
}

/**
 * Collect and deduplicate changes across a repository's change groups.
 *
 * Merge changes come first so a conflicted file keeps its conflict status
 * even when it also appears in the working tree or index groups.
 * Filters out IGNORED files. Returns the deduplicated list.
 */
export function collectChanges(
  mergeChanges: RawChange[],
  workingTreeChanges: RawChange[],
  indexChanges: RawChange[]
): RawChange[] {
  const results: RawChange[] = [];
  const seenPaths = new Set<string>();

  for (const group of [mergeChanges, workingTreeChanges, indexChanges]) {
    for (const change of group) {
      if (isIgnoredStatus(change.status)) continue;
      const p = change.uri.fsPath;
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        results.push(change);
      }
    }
  }

  return results;
}
