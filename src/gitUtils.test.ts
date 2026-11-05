import { describe, it, expect } from 'vitest';
import {
  getChangeType,
  isIgnoredStatus,
  collectChanges,
  computeDiffAction,
  GitStatus,
} from './gitUtils';
import type { RawChange } from './gitUtils';

function makeChange(fsPath: string, status: number, originalPath?: string): RawChange {
  return {
    uri: { fsPath },
    originalUri: { fsPath: originalPath ?? fsPath },
    status,
  };
}

describe('GitStatus wire values', () => {
  // Pin the numeric values to the upstream git extension enum:
  // https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
  // (synced 2026-07-01). The git API returns these numbers at runtime, so if
  // upstream inserts a member this test fails loudly instead of files being
  // silently misclassified. Update git.d.ts and gitUtils.ts together.
  it('matches the upstream git extension enum', () => {
    const expected: Record<string, number> = {
      INDEX_MODIFIED: 0,
      INDEX_ADDED: 1,
      INDEX_DELETED: 2,
      INDEX_RENAMED: 3,
      INDEX_COPIED: 4,
      MODIFIED: 5,
      DELETED: 6,
      UNTRACKED: 7,
      IGNORED: 8,
      INTENT_TO_ADD: 9,
      INTENT_TO_RENAME: 10,
      TYPE_CHANGED: 11,
      ADDED_BY_US: 12,
      ADDED_BY_THEM: 13,
      DELETED_BY_US: 14,
      DELETED_BY_THEM: 15,
      BOTH_ADDED: 16,
      BOTH_DELETED: 17,
      BOTH_MODIFIED: 18,
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(GitStatus[name as keyof typeof GitStatus], name).toBe(value);
    }
    // No extra or missing members (numeric enums reverse-map, hence / 2)
    expect(Object.keys(GitStatus).length / 2).toBe(Object.keys(expected).length);
  });
});

describe('getChangeType', () => {
  it('maps staged modifications to M', () => {
    expect(getChangeType(GitStatus.INDEX_MODIFIED)).toBe('M');
  });

  it('maps staged additions to A', () => {
    expect(getChangeType(GitStatus.INDEX_ADDED)).toBe('A');
  });

  it('maps staged deletions to D', () => {
    expect(getChangeType(GitStatus.INDEX_DELETED)).toBe('D');
  });

  it('maps staged renames to R', () => {
    expect(getChangeType(GitStatus.INDEX_RENAMED)).toBe('R');
  });

  it('maps staged copies to A', () => {
    expect(getChangeType(GitStatus.INDEX_COPIED)).toBe('A');
  });

  it('maps unstaged modifications to M', () => {
    expect(getChangeType(GitStatus.MODIFIED)).toBe('M');
  });

  it('maps unstaged deletions to D', () => {
    expect(getChangeType(GitStatus.DELETED)).toBe('D');
  });

  it('maps untracked files to A', () => {
    expect(getChangeType(GitStatus.UNTRACKED)).toBe('A');
  });

  it('maps intent-to-add to A', () => {
    expect(getChangeType(GitStatus.INTENT_TO_ADD)).toBe('A');
  });

  it('maps intent-to-rename to R', () => {
    expect(getChangeType(GitStatus.INTENT_TO_RENAME)).toBe('R');
  });

  it('maps type changes to M', () => {
    expect(getChangeType(GitStatus.TYPE_CHANGED)).toBe('M');
  });

  it('maps all merge conflict statuses to U', () => {
    const conflictStatuses = [
      GitStatus.ADDED_BY_US,
      GitStatus.ADDED_BY_THEM,
      GitStatus.DELETED_BY_US,
      GitStatus.DELETED_BY_THEM,
      GitStatus.BOTH_ADDED,
      GitStatus.BOTH_DELETED,
      GitStatus.BOTH_MODIFIED,
    ];
    for (const status of conflictStatuses) {
      expect(getChangeType(status)).toBe('U');
    }
  });

  it('defaults unknown status codes to M', () => {
    expect(getChangeType(999)).toBe('M');
  });
});

describe('isIgnoredStatus', () => {
  it('returns true for IGNORED', () => {
    expect(isIgnoredStatus(GitStatus.IGNORED)).toBe(true);
  });

  it('returns false for non-IGNORED statuses', () => {
    expect(isIgnoredStatus(GitStatus.MODIFIED)).toBe(false);
    expect(isIgnoredStatus(GitStatus.UNTRACKED)).toBe(false);
    expect(isIgnoredStatus(GitStatus.INDEX_ADDED)).toBe(false);
  });
});

describe('computeDiffAction', () => {
  it('opens new files directly (no committed counterpart to diff)', () => {
    const newStatuses = [
      GitStatus.INDEX_ADDED,
      GitStatus.INDEX_COPIED,
      GitStatus.UNTRACKED,
      GitStatus.INTENT_TO_ADD,
    ];
    for (const status of newStatuses) {
      expect(computeDiffAction(status)).toBe('openCurrent');
    }
  });

  it('opens conflicted files directly so conflict markers are visible', () => {
    const conflictStatuses = [
      GitStatus.ADDED_BY_US,
      GitStatus.ADDED_BY_THEM,
      GitStatus.DELETED_BY_US,
      GitStatus.DELETED_BY_THEM,
      GitStatus.BOTH_ADDED,
      GitStatus.BOTH_DELETED,
      GitStatus.BOTH_MODIFIED,
    ];
    for (const status of conflictStatuses) {
      expect(computeDiffAction(status)).toBe('openCurrent');
    }
  });

  it('shows the last committed version for deleted files', () => {
    expect(computeDiffAction(GitStatus.INDEX_DELETED)).toBe('openOriginalAtHead');
    expect(computeDiffAction(GitStatus.DELETED)).toBe('openOriginalAtHead');
  });

  it('diffs modified, renamed, and type-changed files against HEAD', () => {
    const diffStatuses = [
      GitStatus.INDEX_MODIFIED,
      GitStatus.INDEX_RENAMED,
      GitStatus.MODIFIED,
      GitStatus.INTENT_TO_RENAME,
      GitStatus.TYPE_CHANGED,
    ];
    for (const status of diffStatuses) {
      expect(computeDiffAction(status)).toBe('diffAgainstHead');
    }
  });
});

describe('collectChanges', () => {
  it('collects changes from merge, working tree, and index groups', () => {
    const merge = [makeChange('/repo/c.ts', GitStatus.BOTH_MODIFIED)];
    const working = [makeChange('/repo/a.ts', GitStatus.MODIFIED)];
    const index = [makeChange('/repo/b.ts', GitStatus.INDEX_ADDED)];

    const result = collectChanges(merge, working, index);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.uri.fsPath)).toEqual(['/repo/c.ts', '/repo/a.ts', '/repo/b.ts']);
  });

  it('deduplicates files appearing in both working tree and index', () => {
    const working = [makeChange('/repo/a.ts', GitStatus.MODIFIED)];
    const index = [makeChange('/repo/a.ts', GitStatus.INDEX_MODIFIED)];

    const result = collectChanges([], working, index);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(GitStatus.MODIFIED); // working tree version wins
  });

  it('prefers the merge group status for conflicted files', () => {
    // During a merge the same file can be listed as conflicted and as a
    // plain working tree change; the conflict status must win the dedup.
    const merge = [makeChange('/repo/a.ts', GitStatus.BOTH_MODIFIED)];
    const working = [makeChange('/repo/a.ts', GitStatus.MODIFIED)];

    const result = collectChanges(merge, working, []);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(GitStatus.BOTH_MODIFIED);
  });

  it('filters out IGNORED files from every group', () => {
    const merge = [makeChange('/repo/m.log', GitStatus.IGNORED)];
    const working = [
      makeChange('/repo/a.ts', GitStatus.MODIFIED),
      makeChange('/repo/ignored.log', GitStatus.IGNORED),
    ];
    const index = [makeChange('/repo/i.log', GitStatus.IGNORED)];

    const result = collectChanges(merge, working, index);
    expect(result).toHaveLength(1);
    expect(result[0].uri.fsPath).toBe('/repo/a.ts');
  });

  it('returns empty array when all inputs are empty', () => {
    expect(collectChanges([], [], [])).toEqual([]);
  });

  it('returns empty when all files are IGNORED', () => {
    const working = [makeChange('/repo/a.log', GitStatus.IGNORED)];
    const index = [makeChange('/repo/b.log', GitStatus.IGNORED)];

    expect(collectChanges([], working, index)).toEqual([]);
  });
});
