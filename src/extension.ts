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
import * as vscode from 'vscode'; // Import everything as a namespace object
import * as path from 'path'; // Node.js built-in for cross-platform path handling
import { ChangesProvider, FileChange } from './changesProvider'; // Named imports (specific items)
import type { Repository } from './git'; // Type-only import - erased at runtime, just for TypeScript
import { computeDiffAction } from './gitUtils'; // Pure status-routing logic (unit tested)

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
    showCollapseAll: true, // Adds a "collapse all" button to the view header
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
   * The change parameter comes from the tree item's command.arguments array
   * (set in FileItem constructor in changesProvider.ts). The status-to-action
   * routing lives in gitUtils.computeDiffAction so it can be unit tested;
   * this handler only maps the action onto vscode commands.
   */
  const openDiffCommand = vscode.commands.registerCommand(
    'diffNavigator.openDiff',
    async (change: FileChange) => {
      if (!change?.uri) return;

      try {
        // path.basename() extracts just the filename from a full path
        // e.g., "/users/bob/project/src/index.ts" -> "index.ts"
        const filename = path.basename(change.uri.fsPath);
        const action = computeDiffAction(change.status);

        if (action === 'openCurrent') {
          // New files and conflicts: open the working file directly. New files
          // have no committed counterpart; for conflicts the working file
          // holds the markers the user needs to act on.
          await vscode.commands.executeCommand('vscode.open', change.uri);
          return;
        }

        // Ask the git extension for the HEAD-side URI instead of hand-building
        // a git-scheme URI: the query format is internal to the git extension
        // and can change without notice.
        const git = changesProvider.getAPI();
        if (!git) return; // Tree items only render once the git API is live

        // Use originalUri so renamed files resolve to the path that exists at
        // HEAD (uri points at the new name, which HEAD does not have).
        const headUri = git.toGitUri(change.originalUri ?? change.uri, 'HEAD');

        if (action === 'openOriginalAtHead') {
          // Deleted files: current version doesn't exist, show the old version
          await vscode.commands.executeCommand('vscode.open', headUri);
        } else {
          // vscode.diff opens VS Code's built-in diff editor
          // Arguments: left file (old), right file (new), title
          await vscode.commands.executeCommand(
            'vscode.diff',
            headUri,
            change.uri,
            `${filename} (Working Tree)` // Template literal for string interpolation
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Diff Navigator: Failed to open diff - ${message}`);
      }
    }
  );

  /**
   * openTerminal command - Opens a terminal at the repository root
   *
   * WHY the weird type { repo?: Repository }?
   * This matches the shape of RepoItem. The ? means repo is optional,
   * so we must check it exists before using it (defensive coding).
   *
   * Reuses an existing terminal for the same repo if one is still open.
   * The terminal map is scoped to activate() rather than module level so a
   * deactivate/reactivate cycle starts clean instead of holding disposed
   * Terminal references in module state.
   */
  const repoTerminals = new Map<string, vscode.Terminal>();

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
        const key = item.repo.rootUri.toString();
        const existing = repoTerminals.get(key);

        // Reuse only live terminals: exitStatus stays undefined while a
        // terminal runs. A stale entry can survive if the close listener was
        // not active when the terminal died (e.g. shell process crash).
        if (existing && existing.exitStatus === undefined) {
          existing.show();
          return;
        }

        const terminal = vscode.window.createTerminal({
          name: path.basename(item.repo.rootUri.fsPath) || 'Terminal',
          cwd: item.repo.rootUri, // Set working directory to repo root
        });
        repoTerminals.set(key, terminal);
        terminal.show(); // Make the terminal panel visible
      }
    }
  );

  /**
   * Clean up terminal references when terminals are closed by the user.
   */
  const terminalCloseListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
    for (const [key, terminal] of repoTerminals) {
      if (terminal === closedTerminal) {
        repoTerminals.delete(key);
        break;
      }
    }
  });

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
    terminalCloseListener,
    changesProvider // ChangesProvider has a dispose() method too
  );
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
