/** .nx-mk/manifest.json → app/src/generated-sdk.ts（G4：产物入 git，同 demo） */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateSdk } from '../../packages/client/dist/codegen.js'

const manifest = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const code = generateSdk(manifest, { baseUrl: '/api' })
writeFileSync(new URL('./app/src/generated-sdk.ts', import.meta.url), code)
console.log(`[codegen] wrote app/src/generated-sdk.ts (${code.length} bytes)`)
