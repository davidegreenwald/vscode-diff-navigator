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

import type { Status } from './git';
import type { API as GitAPI, Repository } from './git';
import { getChangeType, collectChanges } from './gitUtils';
import type { ChangeType } from './gitUtils';

/**
 * INTERFACE: Defines the shape of an object (what properties it must have).
 *
 * WHY export? So extension.ts can use this type for the openDiff command handler.
 * This ensures type safety across file boundaries.
 *
 * Interfaces are purely compile-time - they're erased from JavaScript output.
 */
export interface FileChange {
  uri: vscode.Uri; // Location of the file (current version)
  originalUri: vscode.Uri; // Location of the original (for renames)
  status: Status; // What kind of change (added, modified, etc.)
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
  private _onDidChangeTreeData = new vscode.EventEmitter<
    RepoItem | FileItem | undefined | null | void
  >();

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
   * Track per-repository watchers so they can be disposed when a repo is closed.
   * Without this, watchers for closed repos would leak until extension deactivation.
   */
  private repoWatchers = new Map<string, vscode.Disposable>();

  /**
   * Promise that resolves when git initialization completes.
   * getChildren() awaits this so the tree waits for git instead of returning empty.
   */
  private gitInitPromise: Promise<void>;

  /**
   * Pending debounced refresh. Git operations (branch switch, rebase, bulk
   * staging) fire onDidChange in bursts; one trailing refresh 150ms after
   * the last event replaces a full tree rebuild per event.
   */
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * CONSTRUCTOR: Called when 'new ChangesProvider()' is executed.
   * Sets up the initial state and starts async initialization.
   */
  constructor() {
    this.gitInitPromise = this.initGit();
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
      const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>(
        'vscode.git'
      );

      if (!gitExtension) {
        // Fail gracefully - maybe git isn't installed or enabled
        console.log('Diff Navigator: Git extension not found');
        vscode.window.showErrorMessage(
          'Diff Navigator: Git extension not found. Please ensure Git is installed.'
        );
        return; // Early return pattern - exit immediately if precondition fails
      }

      /**
       * Extensions can be installed but not yet activated (lazy loading).
       * We need to ensure it's active before using its API.
       */
      if (!gitExtension.isActive) {
        await gitExtension.activate(); // await pauses until activation completes
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
      this.git.repositories.forEach((repo) => this.watchRepo(repo));

      const openDisposable = this.git.onDidOpenRepository((repo) => {
        this.watchRepo(repo);
        // Refresh so the repo shows immediately - watchRepo only subscribes
        // to future state changes, and the initial populate may already be done.
        this.refresh();
      });
      const closeDisposable = this.git.onDidCloseRepository((repo) => {
        const key = repo.rootUri.toString();
        const watcher = this.repoWatchers.get(key);
        if (watcher) {
          watcher.dispose();
          this.repoWatchers.delete(key);
        }
        this.refresh();
      });
      this.disposables.push(openDisposable, closeDisposable);
    } catch (error) {
      // Log errors and notify the user
      console.error('Diff Navigator: Failed to initialize git', error);
      vscode.window.showErrorMessage(
        'Diff Navigator: Failed to initialize git. Check the console for details.'
      );
    }
  }

  /**
   * Subscribe to state changes for a single repository.
   *
   * Arrow function syntax in forEach: (repo) => this.watchRepo(repo)
   * This preserves 'this' context. Using function() would lose it.
   */
  private watchRepo(repo: Repository): void {
    const key = repo.rootUri.toString();

    // Dispose existing watcher if re-watching the same repo
    const existing = this.repoWatchers.get(key);
    if (existing) {
      existing.dispose();
    }

    // Subscribe to the repo's change event; refreshes are debounced because
    // git operations fire onDidChange in bursts
    const disposable = repo.state.onDidChange(() => this.scheduleRefresh());

    // Track this subscription keyed by repo URI for targeted cleanup
    this.repoWatchers.set(key, disposable);
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
   * Debounced refresh for git state events. The manual refresh command still
   * calls refresh() directly so the toolbar button feels immediate.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 150);
  }

  /**
   * Expose the git API to command handlers (extension.ts) so they can use
   * official API helpers like toGitUri instead of duplicating git internals.
   */
  getAPI(): GitAPI | undefined {
    return this.git;
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
    // Wait for git initialization to complete before returning data
    await this.gitInitPromise;

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
    if (!this.git) return []; // Guard clause (defensive programming)

    return this.git.repositories
      .map((repo) => {
        const changes = this.getChangesForRepo(repo);
        return new RepoItem(repo, changes.length);
      })
      .filter((item) => item.changeCount > 0); // Hide repos with no changes
  }

  /**
   * Collect all changed files in a repository: merge conflicts, unstaged,
   * and staged changes.
   *
   * WHY deduplicate? A file can appear in several groups at once (e.g. both
   * staged and unstaged modifications, or conflicted while also listed in
   * the working tree). Merge changes are passed first so a conflicted file
   * keeps its conflict status.
   *
   * Ignored files (Status.IGNORED) are filtered out since they shouldn't
   * appear in a "changes" view.
   */
  private getChangesForRepo(repo: Repository): FileChange[] {
    const raw = collectChanges(
      repo.state.mergeChanges,
      repo.state.workingTreeChanges,
      repo.state.indexChanges
    );

    return raw.map((change) => ({
      uri: change.uri as vscode.Uri,
      originalUri: change.originalUri as vscode.Uri,
      status: change.status,
    }));
  }

  /**
   * Build FileItem objects for all changes in a repository.
   *
   * Uses map() to transform each FileChange into a FileItem.
   */
  private getFileItems(repo: Repository): FileItem[] {
    const changes = this.getChangesForRepo(repo);
    const repoRoot = repo.rootUri.fsPath;

    return changes.map((change) => {
      // path.relative anchors at the repo root; the previous String.replace
      // was unanchored and case-sensitive, so a casing mismatch (common on
      // macOS case-insensitive filesystems) rendered the full absolute path.
      const relativePath = path.relative(repoRoot, change.uri.fsPath);
      return new FileItem(relativePath, change);
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
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.repoWatchers.forEach((d) => d.dispose());
    this.repoWatchers.clear();
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
    this.description =
      changeCount > 0 ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : '';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.contextValue = 'repo'; // Enables context menu items with "viewItem == repo"
    // Full path in the tooltip disambiguates same-named repos in multi-root workspaces
    this.tooltip = repo.rootUri.fsPath;
  }
}

/**
 * FileItem represents a changed file in the tree.
 */
class FileItem extends vscode.TreeItem {
  constructor(
    public readonly relativePath: string,
    public readonly change: FileChange
  ) {
    // Files are leaf nodes (can't be expanded), so use None
    super(relativePath, vscode.TreeItemCollapsibleState.None);

    const changeType = getChangeType(change.status);
    this.iconPath = this.getIcon(changeType);
    this.contextValue = 'file'; // Enables context menu items with "viewItem == file"

    /**
     * Setting command makes the item clickable.
     *
     * When clicked, VS Code executes this command with these arguments.
     * The arguments array is passed to the command handler in extension.ts.
     */
    this.command = {
      command: 'diffNavigator.openDiff',
      title: 'Open Diff', // Shown in tooltips/accessibility
      arguments: [change], // Passed to the command handler
    };

    /**
     * resourceUri enables VS Code's file decorations.
     * If the user has other extensions that colorize files (by git status,
     * errors, etc.), those decorations will apply to this item too.
     */
    this.resourceUri = change.uri;
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
      case 'M':
        return new vscode.ThemeIcon(
          'diff-modified',
          new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
        );
      case 'A':
        return new vscode.ThemeIcon(
          'diff-added',
          new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        );
      case 'D':
        return new vscode.ThemeIcon(
          'diff-removed',
          new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
        );
      case 'R':
        return new vscode.ThemeIcon(
          'diff-renamed',
          new vscode.ThemeColor('gitDecoration.renamedResourceForeground')
        );
      case 'U':
        return new vscode.ThemeIcon(
          'diff-ignored',
          new vscode.ThemeColor('gitDecoration.conflictingResourceForeground')
        );
      default:
        return new vscode.ThemeIcon('file'); // Generic file icon
    }
  }
}
