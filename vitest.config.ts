import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/__tests__/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/__tests__/**',
        'packages/*/src/**/index.ts',
      ],
      thresholds: {
        // Per-package thresholds (see spec §8.3). Files outside any glob
        // are not enforced; the kernel glob is the strict one.
        'packages/kernel/src/**/*.ts': {
          lines: 85,
          functions: 85,
          branches: 75,
          statements: 85,
        },
        'packages/config/src/**/*.ts': {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
        'packages/cli/src/**/*.ts': {
          lines: 50,
          functions: 50,
          branches: 40,
          statements: 50,
        },
      },
    },
  },
})
