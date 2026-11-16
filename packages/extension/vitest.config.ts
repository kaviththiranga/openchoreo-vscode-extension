import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The real `vscode` module only exists inside the extension host.
    alias: { vscode: path.resolve(__dirname, 'src/test/vscodeStub.ts') },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
