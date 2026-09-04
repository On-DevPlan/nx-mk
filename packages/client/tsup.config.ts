import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    codegen: 'src/codegen/index.ts',
    react: 'src/react/index.ts',
    runtime: 'src/runtime/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', '@nx-mk/manifest-schema'],
})
