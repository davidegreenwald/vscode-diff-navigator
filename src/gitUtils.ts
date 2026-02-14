/**
 * gitUtils.ts - Pure utility functions for git status processing.
 *
 * These functions have no dependency on the vscode module, making them
 * directly testable with vitest without mocking.
 *
 * Status values are defined here as a regular enum (not const enum) so they
 * exist at runtime for both tsc compilation and vitest execution. The values
 * mirror those in git.d.ts exactly.
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
  ADDED_BY_US = 10,
  ADDED_BY_THEM = 11,
  DELETED_BY_US = 12,
  DELETED_BY_THEM = 13,
  BOTH_ADDED = 14,
  BOTH_DELETED = 15,
  BOTH_MODIFIED = 16,
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
    case GitStatus.INDEX_MODIFIED: return 'M';
    case GitStatus.INDEX_ADDED: return 'A';
    case GitStatus.INDEX_DELETED: return 'D';
    case GitStatus.INDEX_RENAMED: return 'R';
    case GitStatus.INDEX_COPIED: return 'A';
    case GitStatus.MODIFIED: return 'M';
    case GitStatus.DELETED: return 'D';
    case GitStatus.UNTRACKED: return 'A';
    case GitStatus.INTENT_TO_ADD: return 'A';
    case GitStatus.ADDED_BY_US:
    case GitStatus.ADDED_BY_THEM:
    case GitStatus.DELETED_BY_US:
    case GitStatus.DELETED_BY_THEM:
    case GitStatus.BOTH_ADDED:
    case GitStatus.BOTH_DELETED:
    case GitStatus.BOTH_MODIFIED: return 'U';
    default: return 'M';
  }
}

/**
 * Check whether a git status code represents an ignored file.
 */
export function isIgnoredStatus(status: number): boolean {
  return status === GitStatus.IGNORED;
}

/**
 * Collect and deduplicate changes from working tree and index arrays.
 * Filters out IGNORED files. Returns the deduplicated list.
 */
export function collectChanges(
  workingTreeChanges: RawChange[],
  indexChanges: RawChange[]
): RawChange[] {
  const results: RawChange[] = [];
  const seenPaths = new Set<string>();

  for (const change of workingTreeChanges) {
    if (isIgnoredStatus(change.status)) continue;
    const p = change.uri.fsPath;
    if (!seenPaths.has(p)) {
      seenPaths.add(p);
      results.push(change);
    }
  }

  for (const change of indexChanges) {
    if (isIgnoredStatus(change.status)) continue;
    const p = change.uri.fsPath;
    if (!seenPaths.has(p)) {
      seenPaths.add(p);
      results.push(change);
    }
  }

  return results;
}
