import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    ssr: 'src/entry.ts',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: ['vue', '@unhead/vue', '@unhead/vue/server', 'vue/server-renderer'],
      output: {
        format: 'es',
        entryFileNames: 'entry.js',
      },
    },
  },
})
