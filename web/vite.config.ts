import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = process.env.API_PORT ?? '3001';

export default defineConfig({
  root,
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': `http://127.0.0.1:${port}` } },
  preview: { port: 5173, proxy: { '/api': `http://127.0.0.1:${port}` } },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
