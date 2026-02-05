/**
 * extension.ts - The entry point for a VS Code extension
 *
 * ARCHITECTURE: VS Code extensions have two main functions:
 * - activate(): Called once when the extension first loads
 * - deactivate(): Called when VS Code shuts down (cleanup)
 *
 * This file is intentionally thin - it just wires up commands and UI.
 * The actual logic lives in changesProvider.ts (separation of concerns).
 */

// IMPORTS: We use two styles here to demonstrate the difference
import * as vscode from 'vscode';  // Import everything as a namespace object
import * as path from 'path';       // Node.js built-in for cross-platform path handling
import { ChangesProvider, FileChange } from './changesProvider';  // Named imports (specific items)
import { Status } from './git';     // Value import - we need the actual enum values
import type { Repository } from './git';  // Type-only import - erased at runtime, just for TypeScript

/**
 * activate() is called by VS Code when your extension is first needed.
 *
 * WHY export? VS Code looks for this specific exported function name.
 * WHY context parameter? VS Code passes this so we can register disposables
 * (things that need cleanup when the extension unloads).
 */
export function activate(context: vscode.ExtensionContext) {
  // Create our tree data provider - this supplies data for the sidebar view
  const changesProvider = new ChangesProvider();

  /**
   * createTreeView() connects our data provider to the UI.
   *
   * The first argument 'diffNavigator.changes' must EXACTLY match
   * the "id" in package.json under contributes.views. This is how
   * VS Code knows which view this provider fills.
   */
  const treeView = vscode.window.createTreeView('diffNavigator.changes', {
    treeDataProvider: changesProvider,
    showCollapseAll: true  // Adds a "collapse all" button to the view header
  });

  /**
   * COMMANDS: These are actions users can trigger (via buttons, menus, or command palette).
   *
   * registerCommand() takes:
   * - Command ID (must match package.json contributes.commands)
   * - Handler function (what to do when triggered)
   *
   * Commands return a Disposable - an object with a dispose() method for cleanup.
   */
  const refreshCommand = vscode.commands.registerCommand('diffNavigator.refresh', () => {
    changesProvider.refresh();
  });

  /**
   * openDiff command - Opens a file's diff view or the file itself
   *
   * WHY async? We use 'await' inside, which requires the function to be async.
   * TypeScript will enforce that we handle the Promise properly.
   *
   * The parameters (change, repo) come from the tree item's command.arguments
   * array (set in FileItem constructor in changesProvider.ts).
   */
  const openDiffCommand = vscode.commands.registerCommand(
    'diffNavigator.openDiff',
    async (change: FileChange, repo: Repository) => {
      // path.basename() extracts just the filename from a full path
      // e.g., "/users/bob/project/src/index.ts" → "index.ts"
      const filename = path.basename(change.uri.fsPath);

      /**
       * Determine what kind of change this is using the Status enum.
       *
       * WHY named constants instead of numbers? Compare:
       *   change.status === 1  // What does 1 mean? Who knows!
       *   change.status === Status.INDEX_ADDED  // Self-documenting!
       *
       * This makes the code readable without comments.
       */
      const isNewFile =
        change.status === Status.INDEX_ADDED ||
        change.status === Status.INDEX_COPIED ||
        change.status === Status.UNTRACKED ||
        change.status === Status.INTENT_TO_ADD;

      const isDeleted =
        change.status === Status.INDEX_DELETED ||
        change.status === Status.DELETED;

      /**
       * Handle different file states appropriately:
       * - New files: No previous version exists, so just open the file
       * - Deleted files: Current version doesn't exist, so show the old version
       * - Modified files: Show side-by-side diff (old vs new)
       */
      if (isNewFile) {
        // vscode.open is a built-in command that opens any file
        await vscode.commands.executeCommand('vscode.open', change.uri);
      } else if (isDeleted) {
        // Get the HEAD (last committed) version of the file
        const gitUri = toGitUri(change.uri, 'HEAD');
        await vscode.commands.executeCommand('vscode.open', gitUri);
      } else {
        // vscode.diff opens VS Code's built-in diff editor
        // Arguments: left file (old), right file (new), title
        const gitUri = toGitUri(change.uri, 'HEAD');
        await vscode.commands.executeCommand(
          'vscode.diff',
          gitUri,
          change.uri,
          `${filename} (Working Tree)`  // Template literal for string interpolation
        );
      }
    }
  );

  /**
   * openTerminal command - Opens a terminal at the repository root
   *
   * WHY the weird type { repo?: Repository }?
   * This matches the shape of RepoItem. The ? means repo is optional,
   * so we must check it exists before using it (defensive coding).
   */
  const openTerminalCommand = vscode.commands.registerCommand(
    'diffNavigator.openTerminal',
    (item: { repo?: Repository }) => {
      /**
       * Optional chaining (?.) safely accesses nested properties.
       * If any part is null/undefined, the whole expression returns undefined
       * instead of throwing an error.
       *
       * item?.repo?.rootUri is equivalent to:
       *   item && item.repo && item.repo.rootUri
       */
      if (item?.repo?.rootUri) {
        const terminal = vscode.window.createTerminal({
          name: path.basename(item.repo.rootUri.fsPath) || 'Terminal',
          cwd: item.repo.rootUri  // Set working directory to repo root
        });
        terminal.show();  // Make the terminal panel visible
      }
    }
  );

  /**
   * revealInExplorer command - Shows the file in VS Code's file explorer
   */
  const revealInExplorerCommand = vscode.commands.registerCommand(
    'diffNavigator.revealInExplorer',
    (item: { change?: { uri: vscode.Uri } }) => {
      if (item?.change?.uri) {
        // revealInExplorer is a built-in VS Code command
        vscode.commands.executeCommand('revealInExplorer', item.change.uri);
      }
    }
  );

  /**
   * DISPOSABLES: Register everything for cleanup when extension deactivates.
   *
   * context.subscriptions is an array that VS Code automatically disposes
   * when the extension unloads. This prevents memory leaks.
   *
   * WHY push all at once? It's cleaner than multiple push() calls,
   * and the order doesn't matter for disposal.
   */
  context.subscriptions.push(
    treeView,
    refreshCommand,
    openDiffCommand,
    openTerminalCommand,
    revealInExplorerCommand,
    changesProvider  // ChangesProvider has a dispose() method too
  );
}

/**
 * Convert a regular file URI to a Git URI that references a specific version.
 *
 * WHY do we need this? VS Code's git extension uses a special URI scheme
 * to access historical versions of files. The 'git' scheme tells VS Code
 * to fetch the file content from git instead of the filesystem.
 *
 * Example:
 *   Input:  file:///users/bob/project/index.ts, "HEAD"
 *   Output: git:///users/bob/project/index.ts?{"path":"...","ref":"HEAD"}
 */
function toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
  // The git extension expects these params in the query string
  const params = {
    path: uri.fsPath,  // Filesystem path (OS-specific format)
    ref: ref           // Git reference (HEAD, commit hash, branch name, etc.)
  };

  /**
   * uri.with() creates a new URI with some properties changed.
   * URIs are immutable, so we can't modify the original.
   *
   * JSON.stringify converts the params object to a string for the query.
   */
  return uri.with({
    scheme: 'git',              // Change from 'file' to 'git'
    path: uri.path,             // Keep the same path
    query: JSON.stringify(params)  // Add our params as query string
  });
}

/**
 * deactivate() is called when VS Code shuts down or the extension is disabled.
 *
 * WHY is it empty? We registered everything in context.subscriptions,
 * which VS Code automatically cleans up. If we had resources that
 * couldn't be registered (external connections, temp files, etc.),
 * we'd clean them up here.
 */
export function deactivate() {}
