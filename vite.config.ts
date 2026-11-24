import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = { '/api': 'http://localhost:8791' };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
