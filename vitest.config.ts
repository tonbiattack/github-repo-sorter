import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentOptions: { jsdom: { url: 'https://github.com/owner?tab=repositories' } },
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
