import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@nx-mk/kernel', '@nx-mk/client', '@nx-mk/coverage', '@nx-mk/config', 'playwright-core'],
})
