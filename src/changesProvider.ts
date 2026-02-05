/**
 * changesProvider.ts - Provides data for the tree view in the sidebar
 *
 * ARCHITECTURE: This file implements VS Code's TreeDataProvider interface.
 * Think of it like a data source for a list/tree UI component.
 *
 * The TreeDataProvider pattern separates:
 * - DATA (this file) - what items exist, their properties
 * - UI (VS Code) - how to render items, handle clicks, etc.
 *
 * This is the "Model" in Model-View-Controller (MVC) architecture.
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Two import styles for the same module:
 * - { Status } imports the enum VALUE (needed for comparisons at runtime)
 * - type { ... } imports only TYPE information (erased after compilation)
 *
 * Using 'type' imports helps bundlers remove unused code and makes
 * the intent clear: "I only need this for type-checking, not runtime."
 */
import { Status } from './git';
import type { API as GitAPI, Repository } from './git';

/**
 * TYPE ALIAS: Creates a shorthand for a union of string literals.
 *
 * ChangeType can ONLY be one of these 5 values - TypeScript enforces this.
 * This is more precise than just using 'string', which would allow any text.
 *
 * WHY single letters? They're displayed in the UI next to each file,
 * following git's convention (M=Modified, A=Added, D=Deleted, etc.)
 */
type ChangeType = 'M' | 'A' | 'D' | 'R' | 'U';

/**
 * INTERFACE: Defines the shape of an object (what properties it must have).
 *
 * WHY export? So extension.ts can use this type for the openDiff command handler.
 * This ensures type safety across file boundaries.
 *
 * Interfaces are purely compile-time - they're erased from JavaScript output.
 */
export interface FileChange {
  uri: vscode.Uri;          // Location of the file (current version)
  originalUri: vscode.Uri;  // Location of the original (for renames)
  status: Status;           // What kind of change (added, modified, etc.)
  repo: Repository;         // Which repository this file belongs to
}

/**
 * ChangesProvider implements TreeDataProvider to supply tree data to VS Code.
 *
 * GENERIC TYPE <RepoItem | FileItem>: Tells TypeScript that our tree contains
 * two types of items. The | means "or" (union type).
 *
 * WHY export? So extension.ts can create an instance of this class.
 */
export class ChangesProvider implements vscode.TreeDataProvider<RepoItem | FileItem> {
  /**
   * EVENT EMITTER: A pub/sub pattern for notifying VS Code when data changes.
   *
   * WHY private with underscore? Convention: _name means "internal use only".
   * We expose the event publicly but keep the emitter private so only
   * this class can fire events.
   *
   * The generic type <...> specifies what data the event can carry.
   * Here it's the item that changed, or undefined/null/void for "refresh all".
   */
  private _onDidChangeTreeData = new vscode.EventEmitter<RepoItem | FileItem | undefined | null | void>();

  /**
   * readonly: This property can only be set once (in the line above).
   * External code can read it but not reassign it.
   *
   * .event extracts just the subscribable event from the emitter.
   * VS Code listens to this to know when to re-render the tree.
   */
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /**
   * GitAPI | undefined: This variable can hold a GitAPI object OR be undefined.
   * WHY undefined? The git extension might not be available yet when we start.
   */
  private git: GitAPI | undefined;

  /**
   * Array of Disposables - things that need cleanup.
   *
   * WHY track these? When watching for changes, we create event listeners.
   * If we don't clean them up, they keep running forever (memory leak).
   */
  private disposables: vscode.Disposable[] = [];

  /**
   * CONSTRUCTOR: Called when 'new ChangesProvider()' is executed.
   * Sets up the initial state and starts async initialization.
   */
  constructor() {
    this.initGit();  // Note: this is async but we don't await it (fire-and-forget)
  }

  /**
   * Initialize connection to VS Code's built-in git extension.
   *
   * WHY async? We might need to wait for the git extension to activate.
   * WHY Promise<void>? We don't return a value, just signal completion.
   * WHY private? Only called internally, not part of public API.
   */
  private async initGit(): Promise<void> {
    try {
      /**
       * getExtension() finds another installed extension by its ID.
       *
       * The generic type <{ getAPI(version: number): GitAPI }> tells TypeScript
       * what shape the extension's exports have. This gives us autocomplete
       * and type-checking when we call gitExtension.exports.getAPI().
       */
      const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>('vscode.git');

      if (!gitExtension) {
        // Fail gracefully - maybe git isn't installed or enabled
        console.log('Diff Navigator: Git extension not found');
        return;  // Early return pattern - exit immediately if precondition fails
      }

      /**
       * Extensions can be installed but not yet activated (lazy loading).
       * We need to ensure it's active before using its API.
       */
      if (!gitExtension.isActive) {
        await gitExtension.activate();  // await pauses until activation completes
      }

      // Get version 1 of the git API (the only version currently)
      this.git = gitExtension.exports.getAPI(1);

      /**
       * Set up event listeners to refresh our tree when git state changes.
       *
       * forEach: Loop through each existing repository
       * onDidOpenRepository: Listen for new repos being opened
       * onDidCloseRepository: Listen for repos being closed
       */
      this.git.repositories.forEach(repo => this.watchRepo(repo));
      this.git.onDidOpenRepository(repo => this.watchRepo(repo));
      this.git.onDidCloseRepository(() => this.refresh());

    } catch (error) {
      // Log errors but don't crash - extension can still partially work
      console.error('Diff Navigator: Failed to initialize git', error);
    }
  }

  /**
   * Subscribe to state changes for a single repository.
   *
   * Arrow function syntax in forEach: (repo) => this.watchRepo(repo)
   * This preserves 'this' context. Using function() would lose it.
   */
  private watchRepo(repo: Repository): void {
    // Subscribe to the repo's change event, call refresh() when it fires
    const disposable = repo.state.onDidChange(() => this.refresh());

    // Track this subscription so we can clean it up later
    this.disposables.push(disposable);
  }

  /**
   * Tell VS Code to re-fetch and re-render all tree data.
   *
   * fire() emits an event to all listeners. Passing no argument (or undefined)
   * means "everything might have changed, refresh the whole tree."
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * REQUIRED by TreeDataProvider: Convert our data item to a VS Code TreeItem.
   *
   * WHY so simple? Our RepoItem and FileItem classes already extend TreeItem,
   * so we just return them as-is. In more complex cases, you might
   * transform your data model into TreeItems here.
   */
  getTreeItem(element: RepoItem | FileItem): vscode.TreeItem {
    return element;
  }

  /**
   * REQUIRED by TreeDataProvider: Get children of an element (or root items).
   *
   * VS Code calls this with:
   * - undefined: Get root-level items (repositories)
   * - RepoItem: Get that repo's children (files)
   * - FileItem: Get that file's children (none - files are leaves)
   *
   * WHY async? In complex cases, fetching children might require I/O.
   * Here it's synchronous, but the interface requires Promise.
   *
   * The ? in 'element?' means the parameter is optional (can be undefined).
   */
  async getChildren(element?: RepoItem | FileItem): Promise<(RepoItem | FileItem)[]> {
    // Guard clause: If git isn't initialized, return empty array
    if (!this.git) {
      return [];
    }

    // Root level: no parent element, so return repositories
    if (!element) {
      return this.getRepoItems();
    }

    /**
     * instanceof checks if an object was created by a specific class.
     * This is runtime type checking (unlike TypeScript's compile-time checks).
     *
     * WHY needed? 'element' could be RepoItem or FileItem. We need to know
     * which to decide what children to return.
     */
    if (element instanceof RepoItem) {
      return this.getFileItems(element.repo);
    }

    // FileItem has no children (it's a leaf node)
    return [];
  }

  /**
   * Build the list of repository items for the root level.
   *
   * Uses functional programming style with map() and filter():
   * 1. map(): Transform each repo into a RepoItem
   * 2. filter(): Keep only repos that have changes
   */
  private getRepoItems(): RepoItem[] {
    if (!this.git) return [];  // Guard clause (defensive programming)

    return this.git.repositories
      .map(repo => {
        const changes = this.getChangesForRepo(repo);
        return new RepoItem(repo, changes.length);
      })
      .filter(item => item.changeCount > 0);  // Hide repos with no changes
  }

  /**
   * Collect all changed files in a repository (both staged and unstaged).
   *
   * WHY deduplicate? A file can appear in both workingTreeChanges AND
   * indexChanges if it has both staged and unstaged modifications.
   * We only want to show it once.
   */
  private getChangesForRepo(repo: Repository): FileChange[] {
    const changes: FileChange[] = [];

    /**
     * Set<string>: A collection that only stores unique values.
     * We use it to track which file paths we've already added.
     *
     * WHY Set over Array? Set.has() is O(1), Array.includes() is O(n).
     * For large repos, this matters.
     */
    const seenPaths = new Set<string>();

    /**
     * for...of loop: Modern way to iterate over arrays.
     * Cleaner than traditional for(i=0; i<arr.length; i++)
     *
     * Working tree = unstaged changes (modified but not 'git add'ed)
     */
    for (const change of repo.state.workingTreeChanges) {
      const path = change.uri.fsPath;
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        /**
         * Object literal with shorthand property syntax:
         * { repo } is the same as { repo: repo }
         */
        changes.push({
          uri: change.uri,
          originalUri: change.originalUri,
          status: change.status,
          repo  // Shorthand for repo: repo
        });
      }
    }

    // Index = staged changes (after 'git add')
    for (const change of repo.state.indexChanges) {
      const path = change.uri.fsPath;
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        changes.push({
          uri: change.uri,
          originalUri: change.originalUri,
          status: change.status,
          repo
        });
      }
    }

    return changes;
  }

  /**
   * Build FileItem objects for all changes in a repository.
   *
   * Uses map() to transform each FileChange into a FileItem.
   */
  private getFileItems(repo: Repository): FileItem[] {
    const changes = this.getChangesForRepo(repo);
    const repoRoot = repo.rootUri.fsPath;

    return changes.map(change => {
      /**
       * Calculate relative path by removing the repo root prefix.
       *
       * The regex /^[\/\\]/ matches a leading slash (forward or back).
       * We remove it so paths don't start with "/" or "\".
       */
      const relativePath = change.uri.fsPath.replace(repoRoot, '').replace(/^[/\\]/, '');
      return new FileItem(relativePath, change, repo);
    });
  }

  /**
   * Clean up resources when the extension is deactivated.
   *
   * This is called because we registered ChangesProvider in
   * context.subscriptions (see extension.ts).
   *
   * WHY dispose the emitter? EventEmitters hold references to listeners.
   * If not disposed, those references prevent garbage collection.
   */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}

/**
 * RepoItem represents a git repository in the tree.
 *
 * INHERITANCE: 'extends vscode.TreeItem' means RepoItem IS a TreeItem
 * with additional properties. It inherits all TreeItem functionality
 * and can add or override behavior.
 *
 * WHY not export? Only used internally by ChangesProvider.
 * Keeping it private reduces the public API surface.
 */
class RepoItem extends vscode.TreeItem {
  /**
   * CONSTRUCTOR PARAMETER PROPERTIES: A TypeScript shorthand.
   *
   * 'public readonly repo: Repository' in the constructor:
   * 1. Declares a class property 'repo'
   * 2. Sets it to readonly (can't be changed after construction)
   * 3. Makes it public (accessible from outside)
   * 4. Automatically assigns the parameter value to it
   *
   * This is equivalent to:
   *   private _repo: Repository;
   *   constructor(repo: Repository) { this._repo = repo; }
   *   get repo() { return this._repo; }
   */
  constructor(
    public readonly repo: Repository,
    public readonly changeCount: number
  ) {
    // path.basename extracts the folder name from a full path
    const repoName = path.basename(repo.rootUri.fsPath) || 'Unknown';

    /**
     * super() calls the parent class constructor (TreeItem).
     *
     * TreeItem constructor takes:
     * - label: Text to display
     * - collapsibleState: Whether it can be expanded/collapsed
     *
     * Expanded = show children by default, Collapsed = hide children,
     * None = no expand arrow (leaf node)
     */
    super(repoName, vscode.TreeItemCollapsibleState.Expanded);

    /**
     * TreeItem properties we can set:
     * - description: Secondary text shown after the label
     * - iconPath: Icon to show (ThemeIcon uses VS Code's icon set)
     * - contextValue: Used in package.json "when" clauses for menus
     */
    this.description = changeCount > 0 ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : '';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.contextValue = 'repo';  // Enables context menu items with "viewItem == repo"
  }
}

/**
 * FileItem represents a changed file in the tree.
 */
class FileItem extends vscode.TreeItem {
  constructor(
    public readonly relativePath: string,
    public readonly change: FileChange,
    public readonly repo: Repository
  ) {
    // Files are leaf nodes (can't be expanded), so use None
    super(relativePath, vscode.TreeItemCollapsibleState.None);

    const changeType = this.getChangeType(change.status);
    this.iconPath = this.getIcon(changeType);
    this.contextValue = 'file';  // Enables context menu items with "viewItem == file"

    /**
     * Setting command makes the item clickable.
     *
     * When clicked, VS Code executes this command with these arguments.
     * The arguments array is passed to the command handler in extension.ts.
     */
    this.command = {
      command: 'diffNavigator.openDiff',
      title: 'Open Diff',  // Shown in tooltips/accessibility
      arguments: [change, repo]  // Passed to the command handler
    };

    /**
     * resourceUri enables VS Code's file decorations.
     * If the user has other extensions that colorize files (by git status,
     * errors, etc.), those decorations will apply to this item too.
     */
    this.resourceUri = change.uri;
  }

  /**
   * Convert git's numeric status codes to human-readable letters.
   *
   * SWITCH statement: Efficient way to handle many discrete cases.
   * Each case can "fall through" to the next if there's no return/break.
   *
   * WHY group some cases? Multiple statuses map to the same display letter.
   * INDEX_ADDED and UNTRACKED both show as "A" (Added).
   */
  private getChangeType(status: Status): ChangeType {
    switch (status) {
      case Status.INDEX_MODIFIED: return 'M';  // Staged modification
      case Status.INDEX_ADDED: return 'A';     // Staged new file
      case Status.INDEX_DELETED: return 'D';   // Staged deletion
      case Status.INDEX_RENAMED: return 'R';   // Staged rename
      case Status.INDEX_COPIED: return 'A';    // Staged copy (treat as add)
      case Status.MODIFIED: return 'M';        // Unstaged modification
      case Status.DELETED: return 'D';         // Unstaged deletion
      case Status.UNTRACKED: return 'A';       // New file not yet tracked
      case Status.IGNORED: return 'D';         // In .gitignore (rare to see)
      case Status.INTENT_TO_ADD: return 'A';   // git add -N (intent to add)

      /**
       * Fall-through cases: Multiple cases with no return share
       * the same result. These are all merge conflict states.
       */
      case Status.ADDED_BY_US:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.BOTH_ADDED:
      case Status.BOTH_DELETED:
      case Status.BOTH_MODIFIED: return 'U';   // Unmerged (conflict)

      default: return 'M';  // Fallback for unknown status codes
    }
  }

  /**
   * Get an appropriate icon with color for each change type.
   *
   * ThemeIcon: Uses VS Code's built-in icon library.
   * ThemeColor: Uses colors from the user's theme (respects dark/light mode).
   *
   * The color names like 'gitDecoration.modifiedResourceForeground' are
   * standard VS Code theme variables that all themes define.
   */
  private getIcon(changeType: ChangeType): vscode.ThemeIcon {
    switch (changeType) {
      case 'M': return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
      case 'A': return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
      case 'D': return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
      case 'R': return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
      case 'U': return new vscode.ThemeIcon('diff-ignored', new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'));
      default: return new vscode.ThemeIcon('file');  // Generic file icon
    }
  }
}
