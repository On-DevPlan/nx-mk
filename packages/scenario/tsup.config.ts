import { defineConfig } from 'tsup'

export default defineConfig({
  // 主入口 + C9 request-dsl 纯量子入口（不引 playwright —— dashboard UI 安全消费）
  entry: ['src/index.ts', 'src/request-dsl-entry.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
})
