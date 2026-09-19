import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI 构建流：root=包根（index.html 在包根），产物到 dist-ui/，base './' 便于任意挂载路径
// target es2022：本地分析台只跑开发者自己的现代浏览器，显式目标免降级（与 tsconfig 对齐）；
// 解构降级拒绝问题只存在于 esbuild 0.26+（根 override 已锁定 ^0.25.0，hygiene-A7），此处保留显式值作为稳定声明。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist-ui', emptyOutDir: true, target: 'es2022' },
})
