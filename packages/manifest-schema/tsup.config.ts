import { defineConfig } from 'tsup'

export default defineConfig({
  // index.ts 含 field-id（node:crypto）—— Node 侧；normalizer 子路径是浏览器
  // 安全入口（Client proxy 引用，缺它 Vite 把 barrel 里的 crypto externalize
  // 导致 demo app 启动即崩 —— Phase 2 手动验收发现）
  entry: ['src/index.ts', 'src/normalizer.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
})
