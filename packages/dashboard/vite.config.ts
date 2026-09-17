import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI 构建流：root=包根（index.html 在包根），产物到 dist-ui/，base './' 便于任意挂载路径
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist-ui', emptyOutDir: true },
})
