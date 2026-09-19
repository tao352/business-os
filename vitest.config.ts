import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@business-os/types': path.resolve(__dirname, './packages/types/src/index.ts'),
      '@business-os/logger': path.resolve(__dirname, './packages/logger/src/index.ts'),
      '@business-os/database': path.resolve(__dirname, './packages/database/src/index.ts'),
      '@business-os/core': path.resolve(__dirname, './packages/core/src/index.ts'),
    },
  },
});
