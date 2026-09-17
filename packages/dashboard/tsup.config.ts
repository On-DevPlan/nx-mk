import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'server/index': 'src/server/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['better-sqlite3', 'fastify', '@nx-mk/coverage'],
})
