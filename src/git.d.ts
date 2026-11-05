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

import { Uri, Event } from 'vscode';

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

  /**
   * Build a git-scheme URI that resolves to a file's content at a specific
   * ref. Provided by the git extension so consumers do not depend on the
   * internal query format of git-scheme URIs.
   */
  toGitUri(uri: Uri, ref: string): Uri;
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
 * Copied verbatim from the git extension source so the implicit numeric
 * values stay aligned with what the API returns at runtime:
 * https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 * (synced 2026-07-01). Do not reorder, remove, or renumber members - the
 * positions ARE the wire values. GitStatus in gitUtils.ts mirrors this enum
 * and a unit test pins the expected numbers to catch drift.
 *
 * INDEX_* = staged changes (in the git index/staging area)
 * Others = unstaged changes (working tree) or merge conflict states
 */
export const enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,

  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,

  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED,
}
