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
        'src/hooks/useAppMessageBridge.ts': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 90,
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
          statements: 80,
          lines: 80,
          functions: 90,
          branches: 80,
        },
        'src/components/AppDialogs.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 90,
        },
        'src/components/StorageBreakdownTable.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 90,
        },
        'src/components/StorageCleanupActions.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 90,
        },
        'src/components/StorageManagementModal.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 80,
        },
        'src/components/CaCertificateInstallModal.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 90,
        },
        'src/components/ProfileCardEfficiency.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 75,
        },
        'src/components/ProfileCardIndicators.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 80,
        },
        'src/components/ProfileCardLeaderboard.tsx': {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 75,
        },
        'src/components/ProfileCardQuota.tsx': {
          statements: 75,
          lines: 75,
          functions: 100,
          branches: 75,
        },
        'src/components/ProfileCardWorkspaces.tsx': {
          statements: 85,
          lines: 85,
          functions: 100,
          branches: 60,
        },
      },
    },
  },
});
