import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Los tests comparten la base local: uno a la vez.
    fileParallelism: false,
  },
});
