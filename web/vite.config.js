import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [vue(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    // `npm run dev` proxies the API to a local `node server.js` (start it with HUB_DEV_EMAIL=you@example.com)
    proxy: { '/api': 'http://127.0.0.1:8088' },
  },
});
