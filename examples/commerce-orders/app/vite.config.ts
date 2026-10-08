import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 验证项目二前端 —— 跨端口访问后端 8802（proxy 剥 /api 前缀，页面同源无 CORS）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5202,
    proxy: {
      '/api': {
        target: process.env.VITE_ORDERS_API_BASE ?? 'http://localhost:8802',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  define: {
    __VITE_ORDERS_API_BASE__: JSON.stringify(process.env.VITE_ORDERS_API_BASE ?? 'http://localhost:8802'),
    // G6：MK_ANALYSIS 必须给 vite 进程（启动时烘焙 __MK_ANALYSIS__），不是给 CLI
    __MK_ANALYSIS__: JSON.stringify(process.env.MK_ANALYSIS === 'true'),
  },
})
