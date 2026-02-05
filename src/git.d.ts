/**
 * git.d.ts - Type definitions for VS Code's built-in Git extension API
 *
 * WHAT IS A .d.ts FILE?
 * The ".d.ts" extension stands for "declaration file". It contains ONLY type
 * information, no actual code. Think of it as a contract that describes
 * what shapes data will have at runtime.
 *
 * WHY DO WE NEED THIS?
 * VS Code's git extension doesn't ship TypeScript types. We create our own
 * declarations so TypeScript can check our usage of the git API.
 * Without this, we'd have to use 'any' everywhere (losing type safety).
 *
 * HOW TO CREATE DECLARATIONS?
 * 1. Read the API documentation or source code
 * 2. Define interfaces that match the runtime objects
 * 3. Import and use them with 'import type' for type-only imports
 *
 * NOTE: These types only need to cover what WE use, not the entire API.
 * We've defined just enough for our extension to work.
 */

import { Uri, Event, Disposable } from 'vscode';

/**
 * The main API object returned by gitExtension.exports.getAPI(1)
 *
 * This is our entry point to all git functionality. From here we can
 * access repositories and listen for repository events.
 */
export interface API {
  /** Array of all git repositories in the current workspace */
  repositories: Repository[];

  /** Fires when a new repository is opened (e.g., user opens a folder) */
  onDidOpenRepository: Event<Repository>;

  /** Fires when a repository is closed (e.g., user closes a folder) */
  onDidCloseRepository: Event<Repository>;
}

/**
 * Represents a single git repository.
 *
 * In VS Code, each folder with a .git directory becomes a Repository.
 * Multi-root workspaces can have multiple repositories.
 */
export interface Repository {
  /** The root folder of this repository (where .git lives) */
  rootUri: Uri;

  /** Current state including all changes (staged, unstaged, conflicts) */
  state: RepositoryState;
}

/**
 * The current state of a repository.
 *
 * Git tracks changes in several "areas":
 * - Working tree: Files you've modified but not staged
 * - Index (staging area): Files staged with 'git add'
 * - Merge: Files with conflicts during merge/rebase
 */
export interface RepositoryState {
  /** Unstaged changes (modified files not yet added to index) */
  workingTreeChanges: Change[];

  /** Staged changes (files added with 'git add', ready to commit) */
  indexChanges: Change[];

  /** Files with merge conflicts */
  mergeChanges: Change[];

  /** Event that fires whenever any state changes */
  onDidChange: Event<void>;
}

/**
 * Represents a single changed file.
 *
 * Each change has a URI (file location), a status (what kind of change),
 * and optionally a rename URI (for moved/renamed files).
 */
export interface Change {
  /** The current location of the file */
  uri: Uri;

  /** The original location (same as uri unless renamed) */
  originalUri: Uri;

  /** For renames: the new location. Undefined for other change types */
  renameUri: Uri | undefined;

  /** What kind of change this is (added, modified, deleted, etc.) */
  status: Status;
}

/**
 * CONST ENUM: The type of change for a file.
 *
 * WHY 'const enum'? Regular enums create runtime objects.
 * Const enums are inlined at compile time - the compiler replaces
 * Status.INDEX_MODIFIED with 0 directly. This is more efficient
 * but means you can't iterate over enum values at runtime.
 *
 * These values come from VS Code's git extension source code.
 * The numbers are arbitrary but must match what the git extension uses.
 *
 * INDEX_* = staged changes (in the git index/staging area)
 * Others = unstaged changes (working tree)
 */
export const enum Status {
  INDEX_MODIFIED = 0,   // Staged: file was modified
  INDEX_ADDED = 1,      // Staged: new file added
  INDEX_DELETED = 2,    // Staged: file was deleted
  INDEX_RENAMED = 3,    // Staged: file was renamed/moved
  INDEX_COPIED = 4,     // Staged: file was copied

  MODIFIED = 5,         // Unstaged: file was modified
  DELETED = 6,          // Unstaged: file was deleted
  UNTRACKED = 7,        // New file not yet tracked by git
  IGNORED = 8,          // File matches .gitignore pattern
  INTENT_TO_ADD = 9,    // Tracked with 'git add -N' but content not staged

  // Merge conflict states (during merge, rebase, or cherry-pick)
  ADDED_BY_US = 10,     // We added a file that doesn't exist in theirs
  ADDED_BY_THEM = 11,   // They added a file that doesn't exist in ours
  DELETED_BY_US = 12,   // We deleted a file they modified
  DELETED_BY_THEM = 13, // They deleted a file we modified
  BOTH_ADDED = 14,      // Both sides added the same file (content conflict)
  BOTH_DELETED = 15,    // Both sides deleted the file
  BOTH_MODIFIED = 16    // Both sides modified the same file (content conflict)
}
