# Changelog

## 1.0.0

### Features

- Sidebar tree view showing changed files across all workspace git repositories
- Change type indicators: **M** (Modified), **A** (Added), **D** (Deleted), **R** (Renamed), **U** (Unmerged)
- Click any file to open its diff view (new files open directly, deleted files show last committed version)
- Terminal button on repository items to open a terminal at the repo root
- Reveal button on file items to show the file in VS Code's explorer
- Auto-refresh when git state changes
- Configurable terminal and reveal buttons via settings

### Bug Fixes

- Fix race condition where tree view could return empty if git extension hadn't initialized yet
- Fix memory leak: repository watchers are now cleaned up when repos are closed
- Fix memory leak: `onDidOpenRepository` and `onDidCloseRepository` disposables are now tracked
- Fix ignored files (`.gitignore` matches) appearing in the changes list
- Add error handling to `openDiff` command with user-facing error messages
- Add parameter validation guard in `openDiff` command
- Show user-facing error messages when git extension is unavailable
- Terminal reuse: clicking the terminal button for the same repo reuses the existing terminal
