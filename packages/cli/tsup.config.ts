import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
  shebang: true, // preserve #!/usr/bin/env node
  banner: { js: '#!/usr/bin/env node' },
})
