import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // all files share one test database
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test', OTP_PROVIDER: 'memory', OTP_DEV_CODE: '' },
  },
});
