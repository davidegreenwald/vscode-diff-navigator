# Changelog

## 1.0.1

### Bug Fixes

- Sync git Status values with the upstream git extension: `INTENT_TO_RENAME` and `TYPE_CHANGED` were missing, so all conflict statuses were shifted by two and `BOTH_MODIFIED` / `BOTH_DELETED` files rendered as plain modifications
- Show merge conflicts: the merge change group was never read, so conflicted files were missing from the tree during merges and rebases
- Renamed files diff against their original path at HEAD instead of showing the whole file as added
- Use the git extension's `toGitUri` API instead of hand-building git-scheme URIs, which depended on an internal format
- Conflicted files open the working file (with conflict markers) instead of a broken HEAD diff
- Newly opened repositories appear immediately instead of after their next state change
- Repo labels show the full path as a tooltip to disambiguate same-named repos in multi-root workspaces
- Relative paths are computed with `path.relative`, fixing unanchored and case-sensitive string replacement
- Reused terminals are checked for liveness before showing
- Context-dependent commands (Open Diff, Open Terminal Here, Reveal in Explorer) are hidden from the command palette

### Performance

- Debounce tree refresh (150ms trailing) so git operations that fire event bursts rebuild the tree once
- Activate lazily when the view is first opened instead of on every VS Code startup

### Maintenance

- Integration test harness wired up: `src/test/` compiles to `out/test/` and `npm run test:integration` runs a smoke test in a real VS Code instance
- Unit tests pin the `GitStatus` numeric values to catch upstream enum drift
- Renamed `changesProvider.test.ts` to `gitUtils.test.ts` to match what it tests
- Removed redundant `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` dependencies
- VSIX no longer packages test output or the unused icon source SVG

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
