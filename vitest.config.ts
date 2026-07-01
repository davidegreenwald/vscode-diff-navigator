import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Colocated unit tests only. src/test/ holds VS Code integration tests
    // (mocha via @vscode/test-cli), which import vscode and cannot run here.
    include: ['src/*.test.ts'],
    environment: 'node',
  },
});
