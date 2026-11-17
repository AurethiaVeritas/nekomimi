import type { ViteUserConfig } from 'vitest/config' with { "resolution-mode": "import" };

const config: ViteUserConfig = {
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*.ts', 'scraper/**/*.ts', 'filesystem/**/*.ts'],
      exclude: ['server/reset-auth.ts', '**/*.test.ts', '**/*.spec.ts']
    },
    pool: 'threads',
    // Keep enough headroom for API tests that exercise scans and filesystem setup.
    testTimeout: 30000,
    // Allow test files to run in parallel (Vitest's main advantage!)
    fileParallelism: true
  }
};

export default config;
