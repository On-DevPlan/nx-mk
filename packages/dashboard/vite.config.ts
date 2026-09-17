import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI 构建流：root=包根（index.html 在包根），产物到 dist-ui/，base './' 便于任意挂载路径
// target es2022：本地分析台只跑开发者自己的现代浏览器；esbuild 0.27 对默认
// 'modules' 目标集（chrome87 等）拒绝降级解构语法，显式 es2022 免降级（与 tsconfig 对齐）。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist-ui', emptyOutDir: true, target: 'es2022' },
})
