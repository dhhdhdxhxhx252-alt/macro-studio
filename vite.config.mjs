import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'web',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
