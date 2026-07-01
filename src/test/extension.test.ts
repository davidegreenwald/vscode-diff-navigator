/**
 * Integration smoke test - runs inside a real VS Code instance via
 * @vscode/test-cli (npm run test:integration). Uses the mocha TDD interface
 * configured in .vscode-test.mjs, so suite/test come from @types/mocha.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Diff Navigator smoke', () => {
  test('extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension('davidegreenwald.diff-navigator');
    assert.ok(ext, 'extension not found by id davidegreenwald.diff-navigator');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('commands are registered after activation', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'diffNavigator.refresh',
      'diffNavigator.openDiff',
      'diffNavigator.openTerminal',
      'diffNavigator.revealInExplorer',
    ]) {
      assert.ok(commands.includes(id), `command ${id} not registered`);
    }
  });
});
