import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
