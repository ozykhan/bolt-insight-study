import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The files share one database and each drops it at the end, so run them one at a time.
    fileParallelism: false,
    // Set before AppModule is imported, since ConfigModule validates env then.
    env: { MONGODB_URI: `mongodb://localhost:27017/probe-lab-e2e-${process.pid}` },
  },
});
