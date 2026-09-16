import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Demo app Vite 配置 —— 跨端口访问 demo 后端（默认 8787）
// SDK Facade 内部 fetch 通过 VITE_DEMO_API_BASE 注入 base URL
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Vite dev proxy：避免 CORS，demo 前端看到的路径同源
      '/api': {
        target: process.env.VITE_DEMO_API_BASE ?? 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  define: {
    __VITE_DEMO_API_BASE__: JSON.stringify(
      process.env.VITE_DEMO_API_BASE ?? 'http://localhost:8787',
    ),
    // Phase 2（Ruling 6/审查纠错）：analysis 开关在 vite dev server 启动时从
    // process.env.MK_ANALYSIS 烘焙 —— MK_ANALYSIS=true 必须给 vite 进程（重启生效），
    // 不是给 CLI 进程；detectMode() 读编译期全局 __MK_ANALYSIS__
    __MK_ANALYSIS__: JSON.stringify(process.env.MK_ANALYSIS === 'true'),
  },
})
