import { describe, it, expect } from 'vitest';
import { getChangeType, isIgnoredStatus, collectChanges, GitStatus } from './gitUtils';
import type { RawChange } from './gitUtils';

function makeChange(fsPath: string, status: number): RawChange {
  return {
    uri: { fsPath },
    originalUri: { fsPath },
    status,
  };
}

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

describe('collectChanges', () => {
  it('collects changes from working tree and index', () => {
    const working = [makeChange('/repo/a.ts', GitStatus.MODIFIED)];
    const index = [makeChange('/repo/b.ts', GitStatus.INDEX_ADDED)];

    const result = collectChanges(working, index);
    expect(result).toHaveLength(2);
    expect(result[0].uri.fsPath).toBe('/repo/a.ts');
    expect(result[1].uri.fsPath).toBe('/repo/b.ts');
  });

  it('deduplicates files appearing in both working tree and index', () => {
    const working = [makeChange('/repo/a.ts', GitStatus.MODIFIED)];
    const index = [makeChange('/repo/a.ts', GitStatus.INDEX_MODIFIED)];

    const result = collectChanges(working, index);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(GitStatus.MODIFIED); // working tree version wins
  });

  it('filters out IGNORED files from working tree', () => {
    const working = [
      makeChange('/repo/a.ts', GitStatus.MODIFIED),
      makeChange('/repo/ignored.log', GitStatus.IGNORED),
    ];
    const index: RawChange[] = [];

    const result = collectChanges(working, index);
    expect(result).toHaveLength(1);
    expect(result[0].uri.fsPath).toBe('/repo/a.ts');
  });

  it('filters out IGNORED files from index', () => {
    const working: RawChange[] = [];
    const index = [
      makeChange('/repo/b.ts', GitStatus.INDEX_ADDED),
      makeChange('/repo/ignored.log', GitStatus.IGNORED),
    ];

    const result = collectChanges(working, index);
    expect(result).toHaveLength(1);
    expect(result[0].uri.fsPath).toBe('/repo/b.ts');
  });

  it('returns empty array when both inputs are empty', () => {
    expect(collectChanges([], [])).toEqual([]);
  });

  it('returns empty when all files are IGNORED', () => {
    const working = [makeChange('/repo/a.log', GitStatus.IGNORED)];
    const index = [makeChange('/repo/b.log', GitStatus.IGNORED)];

    expect(collectChanges(working, index)).toEqual([]);
  });
});
