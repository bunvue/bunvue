import { defineConfig } from 'vite'
import bunvue from 'bunvue/plugin'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [bunvue(), vue()],
})
