import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  // Integration tests live in src/test/ and compile to out/test/. Colocated
  // vitest unit tests (src/*.test.ts) are excluded from tsc, so nothing
  // else can land here.
  files: 'out/test/**/*.test.js',
  // Keep user-data-dir short and outside the checkout: macOS rejects IPC
  // socket paths over 103 chars, and the default location nests deep inside
  // the repo (worktrees and long clone paths hit the limit).
  launchArgs: ['--user-data-dir', join(tmpdir(), 'diff-navigator-test')],
  mocha: {
    ui: 'tdd',
    timeout: 20000,
  },
});
