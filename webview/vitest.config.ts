import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      thresholds: {
        statements: 40,
        lines: 40,
        functions: 80,
        branches: 70,
        'src/appMessageState.ts': {
          statements: 80,
          lines: 80,
          functions: 100,
          branches: 45,
        },
        'src/api/vscodeApi.ts': {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 95,
        },
        'src/bootError.ts': {
          statements: 80,
          lines: 80,
          functions: 100,
          branches: 50,
        },
        'src/components/ProfileCard.tsx': {
          statements: 70,
          lines: 70,
          functions: 70,
          branches: 65,
        },
      },
    },
  },
});
